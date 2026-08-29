# Subscription tier enforcement & paywall redesign

Date: 2026-08-30

## Problem

`SubscriptionTier` (`'free' | 'pro' | 'enterprise'`) exists in `Settings`
and is displayed in the header and paywall modal, but nothing in the app
actually enforces it — any tier can create unlimited custom decks, play
unlimited rounds, and access every series. The paywall modal itself
(`SubscriptionModal.tsx`) overflows the viewport on mobile web, uses
placeholder pricing ($19.99–$99), and its "Enterprise Desk"/"Wall Street
Pro" tiers don't match the pricing the user actually wants to ship.

Separately, two hardcoded series — the synthesized "標準問題" (Standard
Questions) and the authored "説得のデザイン" (persuasion) — appear in the
picker's "だれでも答えられる" group but aren't part of the custom-deck
system and should be removed.

## Goals

1. Three real tiers with enforced limits: Starter (free), Funds Finance
   Pro ($5/mo annual, $10/mo monthly), Funds Finance God ($10/mo annual,
   $20/mo monthly).
2. Redesign the paywall modal so all three tiers are reachable without
   scrolling on a ~390px mobile viewport, with correct copy/pricing.
3. Remove the "標準問題" and "説得のデザイン" series.

## Non-goals

- Real payment processing / IAP integration. `handleSelectPlan` continues
  to just persist `subscriptionTier` locally, as today.
- Server-side enforcement. All checks are client-side against local
  `AsyncStorage` state, consistent with the rest of the app.

## Tier model

`src/store/storage.ts`:

```ts
export type SubscriptionTier = 'free' | 'pro' | 'god';
```

`'enterprise'` is removed. `DEFAULT_SETTINGS.subscriptionTier` changes
from `'pro'` to `'free'`.

Per-tier limits, colocated with the type:

```ts
export interface TierLimits {
  maxDecks: number;
  maxQuestionsPerDeck: number;
  /** Rounds playable per local calendar day. Infinity = unlimited. */
  maxRoundsPerDay: number;
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: { maxDecks: 0, maxQuestionsPerDeck: 0, maxRoundsPerDay: 3 },
  pro: { maxDecks: 5, maxQuestionsPerDeck: 3, maxRoundsPerDay: Infinity },
  god: { maxDecks: 20, maxQuestionsPerDeck: 10, maxRoundsPerDay: Infinity },
};
```

`maxQuestionsPerDeck` replaces the flat `MAX_DECK_QUESTIONS = 10` constant
(removed). `MAX_CUSTOM_DECKS = 10` (flat deck-count cap) is also removed,
superseded by `TIER_LIMITS[tier].maxDecks`.

A stored settings blob from before this change can still contain
`subscriptionTier: 'enterprise'`, which no longer matches any
`TIER_LIMITS` key. Add a `tierLimits(tier: SubscriptionTier): TierLimits`
accessor that falls back to `TIER_LIMITS.free` for any unrecognized value,
and use it everywhere instead of indexing `TIER_LIMITS` directly — this is
a defensive read, not a data migration, since the stored value itself is
harmless (just unused) and nothing else reads `subscriptionTier` as a raw
string.

## Enforcement points

### Deck/question limits (`storage.ts`)

`addCustomDeck` and `updateCustomDeck` gain a `tier: SubscriptionTier`
parameter (first positional arg, before `title`, since it's the
authorization context — same call-site pattern as the existing
`title`/`category`/`drafts` args). Each throws `Error` with an
upgrade-flavored message when a limit is exceeded:

- Creating beyond `maxDecks` existing decks: `"◯◯プランでは最大{n}デッキまでです。アップグレードしてください。"`
- Drafts longer than `maxQuestionsPerDeck`: `"◯◯プランでは1デッキ最大{n}問までです。アップグレードしてください。"`

`QuestionsScreen.tsx` already catches thrown errors into `deckError` and
renders them — no new UI plumbing needed there. It currently doesn't load
`Settings` at all, so it gains a `loadSettings()` call on mount (same
pattern as `SeriesScreen`) to read `subscriptionTier` and pass it into
`addCustomDeck`/`updateCustomDeck`.

The "自作問題不可" (Starter) case falls out of this for free: `maxDecks:
0` on `free` means the very first `addCustomDeck` call throws, and
`QuestionsScreen` shows the message inline — no separate screen-level
gate. The "新しいデッキ" button and form stay visible for all tiers, per
the earlier decision (show the form, block + upsell on save).

### Daily round cap (`storage.ts` + `GameScreen.tsx`)

New helper in `storage.ts`:

```ts
export function roundsPlayedToday(history: RoundRecord[]): number {
  const today = localDate();
  return history.filter((r) => r.date === today).length;
}
```

`GameScreen.tsx`'s round-start flow (around the existing `MIN_QUESTIONS`
check) adds: load `subscriptionTier` and `history` (both already loaded
elsewhere in the app's settings/history flow), and if
`roundsPlayedToday(history) >= tierLimits(tier).maxRoundsPerDay`, refuse
to start and show an upgrade message using the same inline-error styling
GameScreen already has for the `MIN_QUESTIONS` shortfall case, rather than
inventing a new UI pattern.

## Content removal

`src/content/series.ts`:
- Delete the `STANDARD_TITLE` map and the synthesized series object built
  from it (`series.ts:269-274`). Confirmed `loadBank` (imported from
  `./bank`) has no other caller in `series.ts`, so drop that import too;
  `bank.ts` itself is out of scope (untouched, still has its own tests).
- Keep the `STANDARD_SERIES_ID` string constant itself — `storage.ts`
  uses it in two legacy migration paths (`loadSettings`'s old
  `questionSource` migration at line 106, and `loadNMap`'s legacy-N
  seeding at line 139) that convert pre-series stored data into a
  `seriesId`/lag map keyed by this id. Those migrations must keep
  producing the same id for existing installs; `findSeries`'s new
  fallback (below) makes a stored-but-now-nonexistent `'standard'` id
  resolve safely instead of crashing.
- `DEFAULT_SETTINGS.seriesId` (`storage.ts:59`) currently points at
  `STANDARD_SERIES_ID`. Repoint it to `CUSTOM_SERIES_ID` (`'自分の問題'`,
  which stays — it's the free-text quick-add series, unrelated to the
  deck-picker category being cleaned up today) so a fresh install still
  lands on a real series.
- `findSeries()` (`series.ts:311-316`) falls back to
  `all.find(series => series.id === STANDARD_SERIES_ID)!` when a stored
  `seriesId` doesn't resolve — e.g. after this change, or after a user's
  last custom deck is deleted while it was selected. With `standard`
  removed this fallback returns `undefined!`, a runtime crash. Change the
  fallback to `all.find(series => series.id === CUSTOM_SERIES_ID) ?? all[0]`
  — `custom` always exists (synthesized unconditionally), and `all[0]` is
  a last-resort guard against an empty list.
- Delete the `persuasion` entry from `series.json` and `series.en.json`
  (confirmed present in both) — content data, not code.

## Paywall redesign (`SubscriptionModal.tsx`)

Structure:
- Header: shrink `headerTitle` font size (28→~18) and tighten padding —
  the "too large" complaint from the screenshot.
- Replace the vertical `tiersGrid` (3 stacked cards) with a horizontal
  tab row (Starter / Pro / God) above a single content pane showing only
  the selected tier's card. This is what makes all three reachable
  without scrolling on a 390px-tall-constrained view — only one card
  renders at a time.
- Within the Pro and God cards, keep a compact monthly/annual toggle
  (small pill, not the current full-width two-button row) since each
  tier has two real prices: Pro $10/mo monthly vs $5/mo annual; God
  $20/mo monthly vs $10/mo annual.
- Copy per tier:
  - **Starter** — $0. "自作問題不可・教材は1日3回まで。"
  - **Funds Finance Pro** — annual $5/mo ("コーヒー一杯分"), monthly
    $10/mo. "解回数無制限・自作問題は最大5デッキ×3問まで。"
  - **Funds Finance God** — annual $10/mo ("昼食一回分"), monthly
    $20/mo. "解回数無制限・自作問題は最大20デッキ×10問まで。"
- Remove the "Enterprise Desk" tier entirely.
- `handleSelectPlan(tier)` keeps its current behavior (persist to
  settings, call `onTierChanged`), just retargeted at the three new tier
  ids.
- Footer note and Done button stay as-is, just re-verified they fit under
  the new compact layout.

## Testing

- `storage.test.ts`: `TIER_LIMITS` shape, `roundsPlayedToday`, tier-aware
  `addCustomDeck`/`updateCustomDeck` throwing correctly at each tier's
  deck/question boundary, default settings tier is `'free'`.
- `QuestionsScreen.test.tsx`: Starter blocked with upgrade message on
  first save attempt; Pro blocked at 6th deck / 4th question; God blocked
  at 21st deck / 11th question.
- `GameScreen.test.tsx`: Starter blocked on 4th round of the same day;
  Pro/God never blocked regardless of history size.
- `series.test.ts` / `SeriesScreen.test.tsx`: no more `standard` or
  `persuasion` series/rows anywhere in `listSeries`/`groupSeries` output.
- No dedicated `SubscriptionModal` test file exists today; add one
  covering tab switching and that all three tier labels/prices render.

