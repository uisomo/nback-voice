# 案件 (Cases) — Loan Conversation Game — Design

Date: 2026-09-02
Status: Approved (brainstorming), ready for implementation planning
Author: brainstormed with the user

## Summary

A new game mode, **案件 (Cases)**, added as a 4th bottom-nav tab in the
nback-voice app. Each case is a **loan report sheet** (a real funds-finance
credit deal: amount, tenor, pricing, collateral, investors, legal structure,
legal terms, risk traits) paired with a **scripted conversation** that runs
from the analyst's presentation all the way to CRO approval.

The conversation plays out one turn at a time. Each turn shows the speaker
and a blank; the user types their guess of the **most natural next line
given the conversation so far**, taps to reveal the real line, compares their
guess against it, then taps to advance. There is **no scoring** — the point is
to learn, by repeated guessing, the most statistically natural sentence that
follows in a professional funds-finance credit dialogue. Because the natural
line is always the professionally-correct one, credit judgment is absorbed as
a side effect of language-fluency practice.

## Goals

- Teach the natural *language* of a funds-finance credit conversation
  (phrasing, terminology, register), turn by turn, from presentation to CRO
  approval — **language-led**, with judgment as a side effect.
- Ground every case in the FundsFinance book so content is professionally
  accurate.
- Ship a self-contained, isolated subsystem that does not touch the existing
  N-back / quiz scoring engine.

## Non-Goals (out of scope for this sub-project)

- No scoring, similarity feedback, or graded progression. Reveal +
  self-compare only.
- No English `cases.en.json` and no generation/audit harness yet. Both are a
  **deferred second sub-project** (the harness mirrors `src/content/review.ts`).
- No history records, no IAP/tier gating — all cases are free for now.
- No branching conversations, no per-turn judging. Each case is one authored
  golden path.
- No new dependencies (so the iOS-bundle `node:` pitfall is not in play).

## Learning-goal decisions (from brainstorming)

- **Core goal**: Both language + judgment, *language-led*. The user guesses
  the natural next line; the natural line is always the professionally-correct
  one, so judgment is absorbed indirectly.
- **Turn feedback**: Reveal + self-compare. No scoring, never blocks progress.
  The user types anything, taps to reveal, reads/compares, advances.
- **Whose lines**: Every line, all speakers. The user guesses the next line
  regardless of who says it — learning the whole dialogue's flow, not one role.
- **Guess persistence**: after reveal, the user's typed guess stays on screen
  next to the real line for self-comparison.
- **Tap-through**: two taps per turn — 「めくる」(reveal), then 「次へ」(advance) —
  so the user always commits a guess before seeing the answer and always
  consciously advances. Consistent with commit `08eb15d`.

## Architecture

New game mode, isolated from `RoundEngine`, `judge/`, `speech/`, `store/`
(IAP + history). Reveal + self-compare means no scoring, so none of the
scoring/entitlement machinery is touched.

```
CasesScreen (list of cases)  →  CaseGameScreen (sheet intro → conversation → CRO approval)
```

- `App.tsx`'s `Screen` union gains two states: `{ name: 'cases' }` and
  `{ name: 'case-game'; caseId: string }`. The bottom bar shows on `cases`.
- A 4th bottom-nav tab: `💼 案件`.
- Content lives in a new `src/cases/` module parallel to `src/content/`.

### Data model (`src/cases/cases.ts` types, `src/cases/cases.json` data)

```ts
interface LoanCase {
  id: string;                    // "subline-midmarket-buyout-01"
  product: 'sub-finance' | 'nav-finance' | 'hybrid-pref' | 'gp-facility';
  title: string;                 // "中堅バイアウトファンドへのサブスクライン"
  credit: string;                // 『FundsFinanceの教科書』第16章 より
  sheet: SheetField[];           // the report sheet, ordered, product-adaptive
  conversation: Turn[];          // presentation → CRO approval
}

interface SheetField {
  label: string;                 // "金額 / Amount"
  value: string;                 // "コミットメントの30%、上限150億円"
  group: 'terms' | 'collateral' | 'investors' | 'legal' | 'risk';
}

interface Turn {
  speaker: string;               // "RM" | "審査担当" | "リスク" | "法務" | "CRO"
  line: string;                  // the real, natural line the user guesses
  note?: string;                 // optional one-liner shown after reveal (why this line)
}
```

Rationale:

- **`sheet` is a flat ordered list of `{label, value, group}`**, not a fixed
  struct — this is what makes it product-adaptive without conditional types.
  Subscription cases list uncalled commitment / investors / borrowing base;
  NAV cases list NAV collateral / LTV / asset coverage. The five `group`s map
  to the fields the user named:
  - **terms** — amount, tenor, pricing
  - **collateral** — subscription: security over uncalled commitments /
    capital-call rights; NAV: NAV collateral, LTV, asset coverage
  - **investors** — LP mix and their types/quality (book ch.18)
  - **legal** — legal structure (AIV / blocker / parallel funds), legal terms,
    LPA provisions
  - **risk** — risk traits addressed in the book
  The groups drive the section headers on the intro card and the peek panel.
- **`conversation` is a flat ordered array.** The "conversation so far" that
  makes the next line predictable is simply all prior turns rendered above the
  current blank. No branching — one authored golden path per case.
- **`note?`** is optional post-reveal color (e.g. "CROはまず返済原資を問う"),
  tying back to the book.
- One JSON file, **Japanese first** (canonical, matching `series.json`).

## Screens & interaction

### `CasesScreen` (the list — mirrors `SeriesScreen`'s structure)

- Cases grouped by `product`, reusing icons/labels from
  `FUNDS_FINANCE_CATEGORIES` in `src/content/series.ts`
  (💳 Subscription, 📊 NAV, ⚖️ Hybrid, 🏛️ GP).
- Each row: title + credit + turn count. Tap → `case-game`.

### `CaseGameScreen` — two phases in one screen

1. **Sheet intro** — the full report sheet as a scrollable card, sectioned by
   the five groups with headers. A single primary button 「会話を始める」starts
   the conversation.

2. **Conversation** — one turn at a time:
   - Prior turns render as a stacked transcript above (speaker + revealed
     line), so "the conversation so far" is always in view.
   - Current turn shows the **speaker name** and a **blank** with a controlled
     `TextInput`. The user types their guess and taps 「めくる」(reveal).
   - On reveal: the blank is replaced by the real line; if `note` exists it
     shows beneath in muted text. **The user's own guess stays visible above
     the real line** for self-comparison. A 「次へ」button advances.
   - A collapsible **「案件メモ」peek panel** (pinned, collapsed by default)
     re-shows the sheet fields during turns.
   - After the final turn (CRO approval): an end card with a 「承認」stamp +
     「もう一度」(replay) / 「案件一覧へ」(back to list).

Interaction reuses the **typed-input idea** from `src/speech/typed.ts`, but
uses a plain controlled `TextInput` — there is no scoring to settle, so the
full `Listener` contract is overkill. Reveal is a pure per-turn UI state
toggle.

## Components & isolation

New files:

```
src/cases/cases.json                 — 2-3 hand-authored cases (JA, canonical)
src/cases/cases.ts                    — loader + types; listCases(), getCase(id)
src/cases/__tests__/cases.test.ts     — shape/invariant tests
src/ui/CasesScreen.tsx                — the case list
src/ui/CaseGameScreen.tsx             — sheet intro + conversation turns
```

Edited files:

```
App.tsx                — add 'cases' + 'case-game' to Screen union; render; 4th nav tab 💼 案件
src/strings/index.ts   — labels: 案件, 会話を始める, めくる, 次へ, 承認, もう一度, 案件一覧へ, 案件メモ
```

To keep `CaseGameScreen` thin and testable, the reveal/advance logic is a
small **pure state reducer** (turn index + phase + per-turn revealed flag +
stored guess) that is unit-tested directly; the component renders from it.

## Testing

Matches the existing `npm test` + `npx tsc --noEmit` gate. All logic here is
pure (no TTS realtime), so the fake-TTS blind spot does not apply.

- **`cases.ts` loader / content invariants** (`cases.test.ts`): every case has
  ≥1 turn; `sheet` non-empty; every `group` ∈ the five valid values; ids
  unique across cases; every turn has non-empty `speaker` and `line`;
  `product` ∈ the four valid values; `getCase(id)` returns the right case and
  `undefined`/throws consistently for unknown ids.
- **Reveal/advance reducer**: unit tests for initial state, reveal sets the
  revealed flag and keeps the guess, advance moves to the next turn, advancing
  past the last turn reaches the end card, replay resets.
- **Screens**: follow the existing component-test pattern in
  `src/ui/__tests__/` (e.g. `SeriesScreen.test.tsx`) — check before writing.

## Content sourcing

Cases are hand-authored (2-3), drawn from the FundsFinance book at
`/mnt/c/Projects/book/Books2/6.FundsFinanceの教科書`:

- ch.16 (case studies, product × fund type) and ch.24 (exercises:
  judgment → clause → ops → remediation) as the conversation backbone.
- Sheet facts and legal/risk fields grounded in ch.2 (product types),
  ch.3 (fund structure: AIV / blocker / parallel funds / side letters),
  ch.10-12 (collateral / legal / notice / enforcement), ch.18 (LP types).

Minimum: **one subscription case and one NAV case**, so both product sheet
shapes are exercised.

Note: the original request named `24.ファンドファイナンスの徹底解剖書...` and a
`0.Central` reading-rule folder. Neither path exists on disk; the actual book
is `6.FundsFinanceの教科書` (whose title matches the credit strings already in
`series.json`), and there is no `0.Central`. Content sourcing uses the book as
found; if the user later provides the `0.Central` reading rules, they layer on
at the harness step (deferred sub-project).

## Deferred second sub-project (not planned here)

- English `cases.en.json` via a translate step (mirroring `translate.ts`).
- A `cases-review` generation/audit harness mirroring `src/content/review.ts`
  (`npm run review-cases`) that reads the book chapters and generates/audits
  cases, keeping quality at build time rather than runtime — consistent with
  the project's "no runtime generation" rule (CONTEXT.md pitfall #5).
