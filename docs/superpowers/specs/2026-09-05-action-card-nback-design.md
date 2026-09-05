# アクションカード n-back — Design

Date: 2026-09-05
Status: Approved (brainstorming), ready for implementation planning
Author: brainstormed with the user

## Summary

A new game mode, **アクションカード n-back (Action-card n-back)**, added as a 5th
bottom-nav tab. Each **sequence** is an ordered chain of **action cards** drawn
from the book's "Sequence Theory" — a set of steps toward a chapter goal
(e.g. 「NAV LTVを見極める」→ 7 steps). Each card carries an authored
**purpose** and a concrete **action**.

The player walks a sequence twice, as a **true dual-n-back** built on the
existing engine:

- **Layer 1 — 目的:** step through the cards in order; at step *i* the app
  primes with card *i* but asks the user to **speak the purpose of card *i−N***
  (the card N steps back).
- **Layer 2 — 具体アクション:** same walk, same n-back offset, but the user
  speaks **what to concretely do** for card *i−N*.

Spoken answers are **scored** by the existing `src/judge` path (local first,
Claude when online), against the target card's accept-set — exactly like the
quiz's answer channel. This is a real n-back: the user holds the last N cards
in working memory. The purpose channel is the semantic target; the grid
position channel is kept optional (question-only by default).

This is **sub-project A**. The 案件 recording front-end (ブリーフィング → 録画・
文字起こし → スクリプト照合チェック → Take2) is **sub-project B**, specced
separately afterward.

## Goals

- Train recall of **why each step exists** (purpose) and **what to concretely
  do** (action), in professional sequence order, under real n-back working-
  memory load.
- Ground every card in the FundsFinance book so content is professionally
  accurate; the **purpose** field is authored precisely (it is not in the raw
  text) and reviewed by the user.
- **Reuse** the existing dual-n-back engine (`src/engine/`) and scoring
  (`src/judge/`, `src/speech/`) read-only, rather than forking them.

## Non-Goals (out of scope for this sub-project)

- No 案件 recording/transcription/checkbox front-end (sub-project B).
- No English `sequences.en.json` and no generation/audit harness yet — a
  **deferred sub-project** mirroring `src/content/review.ts` / `translate.ts`.
- No modification of `RoundEngine` / `round.ts` / `types.ts` internals. The
  engine is consumed read-only; new logic lives in `src/actions/`.
- No new runtime dependencies (so the iOS-bundle `node:` pitfall is not in
  play — see CONTEXT.md pitfall #1).
- No persistence of judge-grown accept terms in v1 (in-memory only).

## Decisions (from brainstorming)

- **n-back meaning**: a *true* dual-n-back load. Walk the sequence in order,
  but the scored prompt at step *i* is about the card at *i−N*. Reuses the
  engine's `recallTarget` pointer as the N-steps-back mechanism.
- **Two layers, sequential**: full sequence in Layer 1 (目的), then the same
  sequence again in Layer 2 (具体アクション). Not interleaved per-step.
- **Scoring**: use the existing n-back scoring (`src/judge`), unlike the 案件
  game which had no scoring. Spoken answer graded by concept, not spelling.
- **Content source**: authored from the book. The book project defines the
  action schema (`/mnt/c/Projects/book/.claude/agents/action-{cataloger,
  scenario-writer,sequencer}.md`). The `chapter_N.actions.json` files the user
  referenced **do not exist on disk yet**; raw action prose lives in
  `Books2/6.FundsFinanceの教科書/*.md`. Claude reads chapters → drafts
  structured cards + sequences + purpose statements → **user approves** (same
  author→approve loop as the 案件 cases and the review harness).
- **Purpose is authored, first-class**: precise, specific per-card purpose is
  written by Claude and reviewed by the user; it is the value-add layer, not
  scraped from the text.
- **Position channel optional**: question-only by default (semantic chain is
  the target); grid-flash dual mode is a toggle.

## Architecture

New game mode, isolated. Consumes `src/engine/`, `src/judge/`, `src/speech/`
read-only. New logic and content live under `src/actions/`.

```
SequencesScreen (list of sequences)
  → ActionGameScreen (intro → play(Layer1) → results → play(Layer2) → results)
       └── consumes RoundEngine via src/actions/plan.ts (read-only)
       └── scores via src/judge (local → claude → queue)
       └── voice via src/speech (speak prime, recognize answer, typed fallback)
```

- `App.tsx`'s `Screen` union gains `{ name: 'sequences' }` and
  `{ name: 'action-game'; sequenceId: string; layer: 'purpose' | 'action';
  n: number }`. The bottom bar shows on `sequences`.
- 5th bottom-nav tab: **🎯 アクション** (after 💼 案件).

### Data model (`src/actions/actions.ts` types, `src/actions/sequences.json` data)

```ts
interface ActionCard {
  id: string;                 // "nav-ltv-01-legal-info"
  order: number;              // 1-based position in the sequence
  title: string;              // short card label, e.g. "法的情報の整理"
  purpose: string;            // Layer-1 answer: THE specific goal of this step
  purposeAccept: string[];    // synonym/paraphrase set the judge grows against
  action: string;             // Layer-2 answer: what to concretely do
  actionAccept: string[];
  category: 'universal' | 'conditional' | 'arbitrary';  // from book schema
  note?: string;              // optional post-reveal color, ties back to book
}

interface Sequence {
  id: string;                 // "nav-ltv"
  product: 'sub-finance' | 'nav-finance' | 'hybrid-pref' | 'gp-facility';
  goal: string;               // chapter goal, e.g. "NAV LTVを見極める"
  scenario: string;           // one-paragraph setup
  credit: string;             // 『FundsFinanceの教科書』第○章 より
  cards: ActionCard[];        // ordered by `order`
}
```

Rationale:

- **`purpose` / `purposeAccept` and `action` / `actionAccept`** mirror
  `series.json`'s `{q, accept}` so the existing judge grades a spoken answer by
  concept and grows the accept-set at runtime, unchanged.
- **`scenario` + `goal`** are the framing that makes each card's purpose
  predictable (the user's worked example:「Nav financeの申し込みがあった。NAV
  LTVを見極めるためには7つのステップがある」).
- **`category`** carries the book's Universal/Conditional/Arbitrary tag for
  post-reveal color; not required for scoring in v1.
- One JSON file, **Japanese first** (canonical, matching `series.json` /
  `cases.json`).

## Engine integration (`src/actions/plan.ts`)

A new **pure builder** turns a `Sequence` + `{ n, layer, mode }` into the
`RoundPlan` the existing engine already understands. Mapping:

- `StepPlan.position` → the card's optional grid flash (`null` in question-only
  mode).
- `StepPlan.question` → the **prime** at step *i* (card *i*'s title, spoken).
- `StepPlan.recallTarget` → `i − N`, `null` for the first N steps. **This is the
  n-back** — the card whose purpose/action must be recalled and is scored.
- `layer` selects which field of the *recallTarget* card is the scored answer:
  `purpose`/`purposeAccept` (Layer 1) vs `action`/`actionAccept` (Layer 2).
- `mode: 'question'` (default) drops the visual channel; `mode: 'dual'` keeps
  grid positions. The engine already supports both `RoundMode`s.

The engine's round progression, adaptive-N (`adaptive.ts`), and budget
(`budget.ts`) are reused unchanged.

**Constraint / fallback:** `RoundEngine` / `round.ts` / `types.ts` internals are
NOT modified. If `StepPlan` genuinely cannot express the prime-card vs
answer-card split (the prime shows card *i*'s title while the scored accept-set
belongs to card *i−N*), the fallback is a thin parallel runner inside
`src/actions/` that drives the same `src/judge` path — decided at planning time.
Reuse is attempted first.

## Scoring

Unchanged `src/judge` path:

- Spoken answer graded against the *recallTarget* card's `purposeAccept[]` /
  `actionAccept[]`.
- `local.ts` offline/degraded, `claude.ts` when online, `queue.ts` absorbs the
  gap — as the quiz does today.
- Runtime accept-set growth is **in-memory only** in v1 (no write-back to
  `sequences.json`), keeping content-build untouched.

## Screens & interaction

### `SequencesScreen` (the list — mirrors `SeriesScreen` / `CasesScreen`)

- Sequences grouped by `product`, reusing the 💳/📊/⚖️/🏛️ icons/labels from
  `FUNDS_FINANCE_CATEGORIES` in `src/content/series.ts`.
- Each row: `goal` + `credit` + card count. Tap → `action-game` (intro phase).

### `ActionGameScreen` — three phases in one screen

1. **Intro** — the `scenario` paragraph + `goal`, then the ordered card
   **titles** as a preview (titles only — purposes are what the user recalls).
   A **layer selector** (Layer 1 目的 / Layer 2 具体) and an **N picker**
   (defaulting via `adaptive.ts`). Primary button 「はじめる」.

2. **Play** — one card at a time, driven by the reused engine:
   - **Prime**: current card *i*'s title, spoken via `expo-speech`; optionally
     flashed at its grid position in `dual` mode.
   - **Prompt**: 「N手前のカードの目的は?」(Layer 1) / 「…具体的に何をする?」
     (Layer 2). The user **speaks** the answer via `expo-speech-recognition`,
     with `src/speech/typed.ts` typed-input fallback.
   - Tap 「答える」→ judge scores against the *i−N* card's accept-set → reveal
     the authored answer + `note`, with the user's answer beside it. Tap
     「次へ」advances. Two-tap commit, consistent with `08eb15d` and the 案件
     spec.
   - First N steps are prime-only (nothing to recall yet).

3. **Results** — reuse the existing results view where it fits (score, N
   reached, per-step hits/misses). After **Layer 1**, offer 「Layer 2 へ」to
   re-walk the same sequence recording concrete actions; after **Layer 2**,
   「もう一度」/「一覧へ」.

### Voice

Reuses `src/speech` end-to-end: `expo-speech` speaks the prime card,
`expo-speech-recognition` captures the spoken purpose/action, `typed.ts` is the
fallback. Nothing new in the speech layer. Per CONTEXT.md pitfall #2, speech
timing must be verified on device/browser, not just via fake-TTS tests.

### Strings

New labels in `src/strings/index.ts` (multilingual): アクション, 目的,
具体アクション, N手前のカードの目的は?, 具体的に何をする?, 答える, 次へ,
Layer 2 へ, もう一度, 一覧へ, はじめる.

## Components & isolation

New files:

```
src/actions/sequences.json                 — 2 hand-authored sequences (JA, canonical)
src/actions/actions.ts                       — loader + types; listSequences(), getSequence(id)
src/actions/plan.ts                          — pure builder: Sequence + {n,layer,mode} → RoundPlan
src/actions/__tests__/actions.test.ts        — content shape/invariant tests
src/actions/__tests__/plan.test.ts           — plan-builder unit tests
src/ui/SequencesScreen.tsx                   — the sequence list
src/ui/ActionGameScreen.tsx                  — intro + play(Layer1/2) + results
```

Edited files:

```
App.tsx                — add 'sequences' + 'action-game' to Screen union; render; 5th nav tab 🎯 アクション
src/strings/index.ts   — the labels above
```

`ActionGameScreen` stays thin: the play loop is driven by the reused engine and
`plan.ts`; the component renders from engine/judge state and owns only the
per-phase UI toggles.

## Testing

Matches the existing `npm test` + `npx tsc --noEmit` gate, plus
`npm run check:bundle` once (new module, verify iOS bundle still exports).

- **`actions.ts` loader / content invariants** (`actions.test.ts`): every
  sequence has ≥1 card; `cards` non-empty and `order` contiguous from 1;
  `product` ∈ the four valid values; `category` ∈ the three valid values; ids
  unique across sequences and across cards; every card has non-empty `title`,
  `purpose`, `action`, and non-empty `purposeAccept` / `actionAccept`;
  `getSequence(id)` returns the right sequence and handles unknown ids
  consistently.
- **`plan.ts` builder** (`plan.test.ts`): `recallTarget = i − N` and `null` for
  the first N steps; `layer` selects the correct answer field; `mode:
  'question'` yields `position: null`; the produced plan is accepted by the
  engine; edge cases (N ≥ card count → all prime-only; N = 0 → recall current).
- **Screens**: follow the existing component-test pattern in `src/ui/__tests__/`
  (e.g. `SeriesScreen.test.tsx` / any `CasesScreen.test.tsx`) — check before
  writing.

All logic here is pure except the speech/TTS realtime path; the fake-TTS blind
spot (CONTEXT.md pitfall #2) applies only to the voice loop, which is verified
on device/browser.

## Content sourcing

Sequences are hand-authored (minimum **2**: one NAV, one Subscription — so both
product shapes are exercised), drawn from the FundsFinance book at
`/mnt/c/Projects/book/Books2/6.FundsFinanceの教科書`:

- Sequence backbone from the book's action/sequence structure (see the book
  agents `action-cataloger` / `action-sequencer` for the schema), e.g. ch.16
  (case studies), ch.19 (審査設計テンプレ), ch.23 (実務チェックリスト集),
  ch.24 (演習: 判断→条項→運用→是正).
- Per-card `action` / `title` grounded in the relevant chapter; **`purpose`
  authored precisely by Claude and approved by the user.**
- The NAV worked example (「NAV LTVを見極める」, 7 steps) is the canonical first
  sequence.

Note: the `chapter_N.actions.json` files referenced in the original request do
not exist on disk (no `24.ファンドファイナンスの徹底解剖書` folder, no
`.actions.json` anywhere under `/mnt/c/Projects/book`). Content is authored from
the chapters as found. If those JSONs are produced later by the book pipeline,
they layer in at the deferred harness step.

## Deferred sub-projects (not planned here)

- **Sub-project B** — the 案件 recording front-end: ブリーフィング → 説明を
  録画・録音しながら文字起こし (mirroring `/mnt/c/Projects/communication`
  index.html's take/live-transcript/replay pattern) → next page replays the
  audio, shows the script, checkboxes the required-info coverage + 反省点
  comment box → all checked unlocks the existing 案件 conversation flow, else
  Take2. Specced separately.
- English `sequences.en.json` via a translate step (mirroring `translate.ts`).
- A `review-sequences` generation/audit harness mirroring `src/content/
  review.ts` that reads the book chapters and generates/audits sequences +
  purpose statements, keeping quality at build time (CONTEXT.md pitfall #5).
- Persisting judge-grown accept terms back to content.
```
