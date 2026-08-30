# Mac handoff — iPhone App Store publish

Everything that could be prepared on Windows/WSL is done. This is the
remaining work, in order, that requires a Mac (Xcode, App Store Connect
sandbox testing) or a human decision in App Store Connect's web UI.

## What's already done (Windows side)

- `expo-iap` integrated for real StoreKit subscriptions (`src/store/iap.ts`,
  `src/ui/SubscriptionModal.tsx`). No more fake "Secure SSL" paywall —
  tapping a plan now triggers a real purchase; tier only changes on a
  verified purchase or verified restore.
- `app.json` has the `expo-iap` config plugin wired in.
- `eas.json` has `preview` and `production` build profiles, plus an iOS
  `submit` profile pointed at tkyukyou826isomoto@gmail.com.
- App icon is already 1024×1024 RGB with no alpha channel — meets Apple's
  requirement, no action needed.
- Privacy policy is live: **https://nback-voice.pages.dev/privacy-policy.html**
  — use this URL in App Store Connect's "Privacy Policy URL" field.
- Full test suite (509 tests) and `npx tsc --noEmit` pass. `npm run
  check:bundle` (iOS + web export) passes.
- The `apple-dev` Claude Code plugin (AutisticAF/claude-code-apple-dev-plugin)
  is installed and enabled globally — it'll be available in Claude Code on
  the Mac too if you're using the same `~/.claude` config, otherwise repeat
  the install steps below.

## 0. Re-install the apple-dev plugin (if the Mac has a separate ~/.claude)

The plugin's repo has a `.claude-plugin/plugin.json` but no
`marketplace.json`, so it can't be installed with a plain `claude plugin
install`. Register a tiny wrapper marketplace first:

```bash
mkdir -p ~/.claude/local-marketplaces/apple-dev-mp/.claude-plugin
cat > ~/.claude/local-marketplaces/apple-dev-mp/.claude-plugin/marketplace.json <<'EOF'
{
  "name": "apple-dev-mp",
  "description": "Local wrapper marketplace exposing the AutisticAF apple-dev plugin",
  "owner": { "name": "Alex Karp", "url": "https://github.com/AutisticAF" },
  "plugins": [
    {
      "name": "apple-dev",
      "source": {
        "source": "git-subdir",
        "url": "https://github.com/AutisticAF/claude-code-apple-dev-plugin.git",
        "path": ".",
        "ref": "main"
      },
      "description": "Apple platform development skills for iOS/macOS/App Store.",
      "version": "1.0.5"
    }
  ]
}
EOF
claude plugin marketplace add ~/.claude/local-marketplaces/apple-dev-mp
claude plugin install apple-dev@apple-dev-mp
```

(Omitting `sha` lets it float to the latest commit on `main`; add a pinned
`sha` from `gh api repos/AutisticAF/claude-code-apple-dev-plugin/commits/HEAD
--jq .sha` if you want reproducibility instead.)

## 1. Apple Developer Program

If not already enrolled: sign up at developer.apple.com ($99/yr). Identity
verification can take 24–48h — this is the long pole, start it first if
it isn't done yet.

## 2. Create the app record in App Store Connect

- Bundle ID: `com.nbackvoice.app` (already set in `app.json`).
- App name: 音声N-back (or an App-Store-facing English/mixed name — see
  suggested metadata below).
- Category: primary **Education** or **Productivity**; suggest **Education**
  given the finance-vocabulary framing.
- Privacy Policy URL: `https://nback-voice.pages.dev/privacy-policy.html`

## 3. In-App Purchases — 4 auto-renewable subscriptions

Create **one Subscription Group** (e.g. "Funds Finance Membership") so
upgrading Pro→God or switching monthly/annual prorates instead of stacking
two active subscriptions. Inside it, create these 4 products, ranked
Pro below God:

| Product ID | Reference Name | Price tier target |
|---|---|---|
| `com.nbackvoice.app.pro.monthly` | Funds Finance Pro (Monthly) | $10/month |
| `com.nbackvoice.app.pro.annual` | Funds Finance Pro (Annual) | $5/month billed annually |
| `com.nbackvoice.app.god.monthly` | Funds Finance God (Monthly) | $20/month |
| `com.nbackvoice.app.god.annual` | Funds Finance God (Annual) | $10/month billed annually |

These exact product IDs are hardcoded in `src/store/iap.ts` (`IAP_SKUS`) —
if you change them here, update that file too (and re-run
`npm test -- iap`).

Each product needs: a localized display name/description, a review
screenshot (any screen showing the paywall is fine), and to be submitted
"with the next app version" (first-time IAP submission requires this).

## 4. Sandbox tester

Create a sandbox Apple ID under Users and Access → Sandbox Testers (use an
email you don't otherwise use for an Apple ID). You'll sign into this
account on-device, *not* through Settings → your real Apple ID — StoreKit
prompts for it at purchase time in the sandbox.

## 5. Build

```bash
cd nback-voice
npx eas build --profile production --platform ios
```

First production build will prompt for (or auto-manage, if you let EAS
handle certs) your Distribution Certificate and Provisioning Profile —
let EAS manage these unless you already have your own.

## 6. Test IAP end-to-end on a real device — cannot be done from Windows

This is the one thing that genuinely required a Mac/device:

- Install the build via TestFlight or `eas build --profile preview` +
  direct install.
- Sign into the **sandbox tester** Apple ID on the device (Settings → App
  Store → Sandbox Account, iOS 17+; older iOS prompts inline at purchase).
- Open the paywall, purchase Pro monthly → confirm `subscriptionTier`
  updates in Settings, confirm the tier-gated limits in `storage.ts`
  (`TIER_LIMITS`) actually unlock.
- Force-quit and relaunch the app → confirm the launch-time entitlement
  sync in `App.tsx` keeps the tier without re-purchasing.
- Delete and reinstall the app → open Settings → Subscription →
  "購入を復元" (Restore Purchases) → confirm the tier comes back.
- Let a sandbox subscription renew (sandbox renewals are accelerated —
  minutes, not months) and confirm nothing breaks on renewal.
- Run through `docs/RUNBOOK.md`'s "実機スモークテスト" checklist for the
  core N-back mechanics (mic permissions, TTS volume consistency across
  steps, phase timing) — none of that is testable from WSL either.

## 7. Screenshots

App Store Connect requires screenshots for at least one 6.9" (iPhone 16 Pro
Max class) and one 6.5" or 6.3" size. Easiest path: run the app in
Xcode's iOS Simulator at the right device size and use Cmd+S to capture —
no physical device needed for this part. Suggested shots: series picker,
an active round (grid + question), results screen, paywall.

## 8. Suggested App Store metadata (edit freely)

**Name:** 音声N-back — Funds Finance Vocabulary Trainer
**Subtitle** (30 char max): ファンド用語を鍛えるN-back
**Promotional text** (170 char max, editable without review):
音声とタップで鍛えるデュアルN-back。ファンドファイナンスの実務語彙をゲーム形式で。
**Description draft:**

```
音声N-backは、ワーキングメモリ訓練の定番「デュアルN-back」に、
ファンドファイナンス実務の語彙学習を組み合わせたアプリです。

・グリッドのタップ（位置）と口頭回答（質問）を、Nステップ遅れて答える
  デュアルN-back方式
・キャピタルコール、NAVファシリティ、サブスクリプションラインなど、
  実務書籍を出典とする本格的な語彙シリーズを収録
・自分の問題を登録して、独自の教材でN-back訓練も可能
・正答率に応じてNが自動調整、無理なく難易度が上がる

回答の採点にはAIを利用します。詳細はプライバシーポリシーをご確認ください。
```

**Keywords:** N-back,ワーキングメモリ,脳トレ,ファンドファイナンス,金融英語,認知トレーニング
**Support URL:** (needs a real page — a GitHub repo README or a Cloudflare
Pages page both work; the repo is currently private, so either make a
public support page or a minimal public repo section)
**Age rating:** No mature content — should clear as 4+.

## Known follow-up (not blocking this submission)

- No Android/Play Store submission is set up (out of scope for this pass —
  say the word if you want that too).
- Receipt/entitlement verification is on-device only (StoreKit's own JWS
  signature, no backend) — acceptable for this app's scale per the earlier
  design discussion, but note it if you ever add server-side features that
  depend on trusted entitlement state.
