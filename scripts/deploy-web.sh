#!/usr/bin/env bash
#
# Deploys the web builds to Cloudflare Pages.
#
#   scripts/deploy-web.sh          → both
#   scripts/deploy-web.sh realapp  → nback-voice.pages.dev       (real limits)
#   scripts/deploy-web.sh demo     → nback-voice-demo.pages.dev  (no daily cap)
#
# The two deploys differ only by EXPO_PUBLIC_DEMO, which Metro inlines into
# the bundle. That is deliberate: nothing at runtime can turn the paying app
# into the demo, and nothing served from the demo URL can be mistaken for the
# real one (it carries a DEMO badge).
#
# **Both variants are always built, whichever one is being deployed**, and the
# script refuses to ship if they come out byte-identical. That check is not
# paranoia: Metro's transform cache is not keyed on EXPO_PUBLIC_* values, so
# building demo and then realapp without --clear silently reuses the demo's
# inlined constants and ships an unlimited "real" app. It happened on the
# first attempt at this, and the only reason it was caught was comparing the
# two outputs by hand.
#
# `wrangler login` does not work on this machine — the browser reaches the
# grant page but the code never gets back to the CLI's localhost listener.
# The API token at ~/.cf-token is the way in. It is read into the environment
# and never printed.
set -euo pipefail

TARGET="${1:-both}"
case "$TARGET" in
  realapp|demo|both) ;;
  *) echo "usage: $0 [realapp|demo|both]" >&2; exit 2 ;;
esac

if [ ! -r "$HOME/.cf-token" ]; then
  echo "missing ~/.cf-token (needs Account · Cloudflare Pages · Edit)" >&2
  exit 1
fi

CLOUDFLARE_API_TOKEN="$(tr -d ' \t\r\n' < "$HOME/.cf-token")"
export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID=9edaf3109e6d9633c45b02c2af547648

# EXPO_PUBLIC_* is inlined at build time, so a real key in .env would ship as
# readable JS. Blanked here so the published bundle never carries one; the key
# is pasted into the settings screen at runtime instead.
build() {
  local variant="$1" demo="$2" out="dist/web-$1"
  rm -rf "$out"
  echo "==== building $variant (EXPO_PUBLIC_DEMO=$demo) ===="
  EXPO_PUBLIC_ANTHROPIC_API_KEY= \
  EXPO_PUBLIC_DEMO="$demo" \
    npx expo export --platform web --output-dir "$out" --clear
}

build realapp 0
build demo 1

# Content-hashed filenames, so identical names mean identical bundles.
real_bundle=$(basename "$(ls dist/web-realapp/_expo/static/js/web/index-*.js)")
demo_bundle=$(basename "$(ls dist/web-demo/_expo/static/js/web/index-*.js)")
if [ "$real_bundle" = "$demo_bundle" ]; then
  echo >&2
  echo "REFUSING TO DEPLOY: realapp and demo built to the same bundle" >&2
  echo "($real_bundle). EXPO_PUBLIC_DEMO was not inlined — a stale Metro" >&2
  echo "cache would ship the real app with no daily round cap." >&2
  exit 1
fi
echo "==== realapp $real_bundle / demo $demo_bundle — variants differ, ok ===="

deploy() {
  local variant="$1" project="$2"
  # Idempotent: an existing project makes create fail, which is fine to ignore.
  npx wrangler pages project create "$project" --production-branch main 2>/dev/null || true
  npx wrangler pages deploy "dist/web-$variant" \
    --project-name "$project" --branch main --commit-dirty=true
  echo "==== deployed $variant -> https://$project.pages.dev ===="
}

if [ "$TARGET" = realapp ] || [ "$TARGET" = both ]; then
  deploy realapp nback-voice
fi
if [ "$TARGET" = demo ] || [ "$TARGET" = both ]; then
  deploy demo nback-voice-demo
fi
