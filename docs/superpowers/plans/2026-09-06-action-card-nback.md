# アクションカード n-back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5th bottom-nav tab, 🎯 アクション, a true dual-n-back where the player walks a book-sourced *sequence* of action cards and, at step *i*, speaks the **purpose** (Layer 1) or **concrete action** (Layer 2) of the card *N* steps back — scored by the existing judge.

**Architecture:** A new isolated subsystem under `src/actions/` that consumes `src/engine/`, `src/judge/`, and `src/speech/` **read-only**. The key finding from planning: the existing `RoundEngine.submitStep` already scores each step's transcript against `steps[recallTarget].question.accept` (`src/engine/round.ts:72-85`) — i.e. the card N steps back — while the prime spoken at step *i* is `steps[i].question.q`. That is exactly the "prime is card *i*, answer belongs to card *i−N*" split the spec worried about, so we use the **reuse path**: a pure `plan.ts` builder emits a standard `RoundPlan` and the stock `RoundRunner` + `RoundEngine` + `JudgeQueue` drive the round. No parallel runner is needed.

**Tech Stack:** Expo / React Native + react-native-web, TypeScript, Jest + `@testing-library/react-native`. JSON imports via `resolveJsonModule` (already enabled). Reuses `RoundRunner`, `RoundEngine`, `buildRound`-style planning, `JudgeQueue`/`localMatch`/`ClaudeJudgeClient`, and the `Speaker`/`Listener` speech interfaces.

**Spec:** `docs/superpowers/specs/2026-09-05-action-card-nback-design.md`

## Global Constraints

- No new npm dependencies (keeps the iOS-bundle `node:` pitfall out of play). CONTEXT.md pitfall #1.
- `src/engine/round.ts`, `src/engine/runner.ts`, `src/engine/types.ts` internals are **NOT modified**. The engine is consumed read-only; all new logic lives under `src/actions/`.
- Content is static, Japanese-first (canonical), mirroring `series.json` / `cases.json`. No `sequences.en.json`, no generation/audit harness in this plan — both deferred (spec §Deferred).
- No persistence of judge-grown accept terms in v1 (in-memory only, exactly as the quiz does today).
- `product` is exactly one of: `'sub-finance' | 'nav-finance' | 'hybrid-pref' | 'gp-facility'` (reuses `FUNDS_FINANCE_CATEGORIES` ids/icons from `src/content/series.ts`).
- `category` is exactly one of: `'universal' | 'conditional' | 'arbitrary'` (lowercased from the book's `Universal`/`Conditional`/`Arbitrary`).
- The `Question` shape the engine consumes is `{ id: string; tier: number; q: string; accept: string[] }` (`src/engine/types.ts`). Action cards map to it: `q` = the prime (card title), `accept` = the recalled field's authored accept-set.
- UI chrome text goes through the typed `Strings` interface in `src/strings/index.ts` (both `ja` and `en`), consumed via `useStrings()`. Card *content* stays in `sequences.json`.
- Theme colors come from `getTheme()` → `ThemeColors` (`src/ui/theme.ts`). Real keys: `bg`, `cardBorder`, `textPrimary`, `textSecondary`, `textMuted`, `accentGold`. Use these verbatim.
- Tests must pass under `npm test` and `npx tsc --noEmit`. Components tested with `@testing-library/react-native` via `testID`/`getByText`, matching `src/ui/__tests__/CasesScreen.test.tsx`.
- Book source (a Google-Drive symlink that intermittently returns `No such device`; if reads fail, pin the folder offline — see [[gdrive-mount-stale]]):
  `/mnt/c/Projects/book/Books/24.ファンドファイナンスの徹底解剖書_jpen_jppn_enen_enpn/contents/chapter_{02,03,05,06,07,09,10,11}.actions.json`

---

## File Structure

Create:
- `src/actions/actions.ts` — types (`ActionCard`, `Sequence`, `Product`, `Category`) + loader (`listSequences`, `getSequence`, `sequencesByProduct`, `PRODUCT_ORDER`).
- `src/actions/sequences.json` — 2 hand-authored sequences (ch.02 sub-finance, one more mapping to a different product), JA.
- `src/actions/plan.ts` — pure builder `buildActionRound(sequence, { n, layer, mode })` → `RoundPlan`, plus `eligibleCards()` helper for `layer2Skipped`.
- `src/actions/__tests__/actions.test.ts` — content-invariant + loader tests.
- `src/actions/__tests__/plan.test.ts` — builder unit tests.
- `src/ui/SequencesScreen.tsx` — sequence list grouped by product.
- `src/ui/ActionGameScreen.tsx` — intro → play(Layer1) → results → play(Layer2) → results, driven by the reused engine.
- `src/ui/__tests__/SequencesScreen.test.tsx` — list-screen tests.
- `src/ui/__tests__/ActionGameScreen.test.tsx` — game-screen tests (intro + layer/N selection + reaching play; the realtime voice loop is verified on device, not in Jest — CONTEXT.md pitfall #2).

Modify:
- `src/strings/index.ts` — add an `actions` block to the `Strings` interface and to both `ja` and `en`.
- `App.tsx` — add `'sequences'` + `'action-game'` to the `Screen` union, render the two screens, add the 5th nav tab, show bottom bar on `sequences`.

---

## Task 1: Action-card types and content loader

**Files:**
- Create: `src/actions/actions.ts`
- Create: `src/actions/sequences.json` (minimal stub for this task; real content in Task 2)
- Test: `src/actions/__tests__/actions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Product = 'sub-finance' | 'nav-finance' | 'hybrid-pref' | 'gp-facility'`
  - `type Category = 'universal' | 'conditional' | 'arbitrary'`
  - `interface ActionCard { id: string; order: number; title: string; purpose: string; purposeAccept: string[]; action: string; actionAccept: string[]; category: Category; note?: string; layer2Skipped?: boolean }`
  - `interface Sequence { id: string; product: Product; goal: string; scenario: string; credit: string; cards: ActionCard[] }`
  - `function listSequences(): Sequence[]`
  - `function getSequence(id: string): Sequence | undefined`
  - `function sequencesByProduct(): { product: Product; sequences: Sequence[] }[]` — groups in `PRODUCT_ORDER`, omitting empty products.
  - `const PRODUCT_ORDER: Product[] = ['sub-finance', 'nav-finance', 'hybrid-pref', 'gp-facility']`

- [ ] **Step 1: Write the failing test**

Create `src/actions/__tests__/actions.test.ts`:

```ts
import {
  getSequence,
  listSequences,
  PRODUCT_ORDER,
  sequencesByProduct,
} from '../actions';

const CATEGORIES = ['universal', 'conditional', 'arbitrary'];

describe('sequences content', () => {
  it('loads at least one sequence', () => {
    expect(listSequences().length).toBeGreaterThan(0);
  });

  it('has unique sequence ids and unique card ids across everything', () => {
    const seqIds = listSequences().map((s) => s.id);
    expect(new Set(seqIds).size).toBe(seqIds.length);
    const cardIds = listSequences().flatMap((s) => s.cards.map((c) => c.id));
    expect(new Set(cardIds).size).toBe(cardIds.length);
  });

  it('every sequence has a valid product, non-empty goal/scenario/credit, and cards', () => {
    for (const s of listSequences()) {
      expect(PRODUCT_ORDER).toContain(s.product);
      expect(s.goal.trim()).not.toBe('');
      expect(s.scenario.trim()).not.toBe('');
      expect(s.credit.trim()).not.toBe('');
      expect(s.cards.length).toBeGreaterThan(0);
    }
  });

  it('card orders are contiguous from 1', () => {
    for (const s of listSequences()) {
      const orders = s.cards.map((c) => c.order);
      expect(orders).toEqual(orders.map((_, i) => i + 1));
    }
  });

  it('every card has a valid category, non-empty title/purpose, and a non-empty purposeAccept', () => {
    for (const s of listSequences()) {
      for (const c of s.cards) {
        expect(CATEGORIES).toContain(c.category);
        expect(c.title.trim()).not.toBe('');
        expect(c.purpose.trim()).not.toBe('');
        expect(c.purposeAccept.length).toBeGreaterThan(0);
        for (const a of c.purposeAccept) expect(a.trim()).not.toBe('');
      }
    }
  });

  it('a card is either Layer-2 playable (non-empty action + actionAccept) or explicitly layer2Skipped', () => {
    for (const s of listSequences()) {
      for (const c of s.cards) {
        if (c.layer2Skipped) {
          continue;
        }
        expect(c.action.trim()).not.toBe('');
        expect(c.actionAccept.length).toBeGreaterThan(0);
        for (const a of c.actionAccept) expect(a.trim()).not.toBe('');
      }
    }
  });

  it('getSequence returns the matching sequence and undefined for unknown ids', () => {
    const first = listSequences()[0];
    expect(getSequence(first.id)).toEqual(first);
    expect(getSequence('nope')).toBeUndefined();
  });

  it('sequencesByProduct groups in PRODUCT_ORDER and omits empty products', () => {
    const groups = sequencesByProduct();
    const products = groups.map((g) => g.product);
    const orderIdx = products.map((p) => PRODUCT_ORDER.indexOf(p));
    expect(orderIdx).toEqual([...orderIdx].sort((a, b) => a - b));
    for (const g of groups) expect(g.sequences.length).toBeGreaterThan(0);
    expect(groups.flatMap((g) => g.sequences).length).toBe(listSequences().length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/actions/__tests__/actions.test.ts --testPathIgnorePatterns worktrees`
Expected: FAIL — cannot find module `../actions`.

- [ ] **Step 3: Write a minimal `sequences.json` stub**

Create `src/actions/sequences.json` (Task 2 replaces this with real content):

```json
[
  {
    "id": "stub-ch02",
    "product": "sub-finance",
    "goal": "スタブ目標",
    "scenario": "スタブのシナリオ説明。",
    "credit": "『FundsFinanceの教科書』より",
    "cards": [
      {
        "id": "stub-a01",
        "order": 1,
        "title": "スタブ・アクション",
        "purpose": "スタブの目的",
        "purposeAccept": ["スタブの目的", "目的のスタブ"],
        "action": "スタブの具体アクション",
        "actionAccept": ["スタブの具体アクション"],
        "category": "universal"
      }
    ]
  }
]
```

- [ ] **Step 4: Write the loader**

Create `src/actions/actions.ts`:

```ts
import raw from './sequences.json';

export type Product = 'sub-finance' | 'nav-finance' | 'hybrid-pref' | 'gp-facility';
export type Category = 'universal' | 'conditional' | 'arbitrary';

export interface ActionCard {
  id: string;
  order: number;
  title: string;
  purpose: string;
  purposeAccept: string[];
  action: string;
  actionAccept: string[];
  category: Category;
  note?: string;
  layer2Skipped?: boolean;
}

export interface Sequence {
  id: string;
  product: Product;
  goal: string;
  scenario: string;
  credit: string;
  cards: ActionCard[];
}

export const PRODUCT_ORDER: Product[] = [
  'sub-finance',
  'nav-finance',
  'hybrid-pref',
  'gp-facility',
];

const SEQUENCES = raw as Sequence[];

export function listSequences(): Sequence[] {
  return SEQUENCES;
}

export function getSequence(id: string): Sequence | undefined {
  return SEQUENCES.find((s) => s.id === id);
}

export function sequencesByProduct(): { product: Product; sequences: Sequence[] }[] {
  return PRODUCT_ORDER.map((product) => ({
    product,
    sequences: SEQUENCES.filter((s) => s.product === product),
  })).filter((g) => g.sequences.length > 0);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/actions/__tests__/actions.test.ts --testPathIgnorePatterns worktrees`
Expected: PASS (all 8).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/actions/actions.ts src/actions/sequences.json src/actions/__tests__/actions.test.ts
git commit -m "feat(actions): action-card types and sequence loader"
```

---

## Task 2: Author the real sequences (ch.02 + one more)

**Files:**
- Modify: `src/actions/sequences.json` (replace the Task 1 stub)

**Interfaces:**
- Consumes: the `Sequence` / `ActionCard` shape from Task 1.
- Produces: real content. No code signatures; the Task 1 invariant tests are the gate.

No new test code — Task 1's invariant tests are the acceptance gate, plus a manual read for quality. Content is adapted from the book's `chapter_N.actions.json` (verified present, 8 files). Author in Japanese. **User approves both sequences before Task 3.**

- [ ] **Step 1: Read the two source chapters**

Read the JSON arrays and, for `goal`/`scenario`, the chapter prose:
- `chapter_02.actions.json` (証拠格付け / 情報開示誠実性, 7 steps) — the canonical first sequence, matches the user's worked example. Maps to `product: 'sub-finance'`.
- Pick a **second** chapter whose theme maps to a **different** product so both list groupings are exercised (e.g. `chapter_10.actions.json` 回収可能性/Authority-Priority-Control → `nav-finance`, or `chapter_11` 担保・通知・執行). Read its `.md`/`_revised.md` prose for `goal`/`scenario`.

Field mapping per action (spec §Content sourcing):
- `action_number` → `order`
- `title` → `title`
- `category` (`Universal`/`Conditional`/`Arbitrary`) → lowercased `category`
- `purpose` → `purpose` (carried over, reviewed for accuracy)
- `sample_phrase` → `action` (see null handling below)
- fold `trigger` / `when_not_to_use` / `best_timing` / `order_and_relationships` into a short `note`

- [ ] **Step 2: Write the two sequences into `sequences.json`**

Replace the stub array with two real sequences. Each must satisfy the invariants. Requirements per sequence:
- `product`: one `sub-finance` (ch.02), one different product.
- `goal`: authored one line from the chapter theme (e.g. ch.02 → 「証拠格付けで情報開示の誠実性を見極める」).
- `scenario`: authored one paragraph setting up why the sequence is walked (the user's worked-example style: 「Nav financeの申し込みがあった。…を見極めるための手順がある」).
- `credit`: `『FundsFinanceの教科書』第○章 より`.
- `cards`: ordered by `order`, contiguous from 1.
- **`purposeAccept[]`**: 2–4 authored paraphrases of `purpose` per card, so the judge grades the spoken answer by concept, not spelling.
- **`actionAccept[]`**: 2–4 authored paraphrases of the concrete action per card.
- **null `sample_phrase`** (e.g. ch02-a07, typically an Arbitrary action): either author a concrete `action` + `actionAccept`, **or** set `"layer2Skipped": true` and leave `action: ""`, `actionAccept: []`. The invariant test permits an empty action **only** when `layer2Skipped` is true.

Illustrative shape (author real content, do not ship verbatim):

```json
[
  {
    "id": "ch02",
    "product": "sub-finance",
    "goal": "証拠格付けで情報開示の誠実性を見極める",
    "scenario": "サブスクリプション・ラインの申し込みがあった。証拠格付けで開示の誠実性を見極めるには、文書確保から検証まで順序だった手順がある。",
    "credit": "『FundsFinanceの教科書』第2章 より",
    "cards": [
      {
        "id": "ch02-a01",
        "order": 1,
        "title": "グレードA文書の早期確保",
        "purpose": "グレードAの最優先文書を早期に確保し、証拠格付けの土台を確立する",
        "purposeAccept": [
          "最優先の一次文書を先に押さえて格付けの土台を作る",
          "グレードA文書を早く集めて評価の基礎を固める",
          "根拠となる一次資料を初動で確保する"
        ],
        "action": "審査に必要な最優先文書を10営業日以内に提出するよう依頼する",
        "actionAccept": [
          "期限を切って一次文書の提出を求める",
          "グレードA文書を期日付きで請求する"
        ],
        "category": "universal",
        "note": "初動で使う。文書が揃わない場合は保守的な代替推計を用いる旨を添える。"
      }
    ]
  }
]
```

- [ ] **Step 3: Run the content-invariant tests**

Run: `npx jest src/actions/__tests__/actions.test.ts --testPathIgnorePatterns worktrees`
Expected: PASS. If a card is missing an accept-set or has an empty non-skipped action, the invariants fail — fix the content.

- [ ] **Step 4: Manual quality read + user approval**

Re-read both sequences end to end. Each `purpose`/`action` must read as the true reason/step, and each `*Accept[]` must be genuine paraphrases (a wrong-but-plausible answer should NOT match). Present both sequences to the user and get approval before proceeding (spec: "user approves").

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/actions/sequences.json
git commit -m "content(actions): author ch.02 and a second sequence from the book"
```

---

## Task 3: Round-plan builder

**Files:**
- Create: `src/actions/plan.ts`
- Test: `src/actions/__tests__/plan.test.ts`

**Interfaces:**
- Consumes: `Sequence`, `ActionCard` from `src/actions/actions.ts`; `Question`, `RoundPlan`, `RoundMode`, `StepPlan` from `src/engine` (re-exported from `src/engine/types`).
- Produces:
  - `type Layer = 'purpose' | 'action'`
  - `interface ActionRoundOpts { n: number; layer: Layer; mode: RoundMode }`
  - `function eligibleCards(seq: Sequence, layer: Layer): ActionCard[]` — Layer 1: all cards. Layer 2: cards where `!layer2Skipped`.
  - `function cardToQuestion(card: ActionCard, layer: Layer): Question` — `{ id: card.id, tier: 2, q: card.title, accept: layer === 'purpose' ? card.purposeAccept : card.actionAccept }`.
  - `function buildActionRound(seq: Sequence, opts: ActionRoundOpts): RoundPlan` — walks `eligibleCards(seq, layer)` in order; step *i* has `question = cardToQuestion(card_i)`, `position = mode === 'dual' ? (i % 9) : null`, `recallTarget = i >= n ? i - n : null`. Returns `{ n, mode, steps }`.

Rationale: this mirrors `src/engine/sequence.ts buildRound` (`recallTarget: i >= n ? i - n : null`) but walks the authored sequence in order instead of sampling a random pool. `tier: 2` is the mid value used across the content banks. Position in `dual` mode is deterministic (`i % 9`) rather than random — a sequence is an ordered walk, not a shuffled bank, and determinism keeps the builder pure and testable. The engine then scores each step's transcript against `steps[recallTarget].question.accept` unchanged (`src/engine/round.ts:72-85`), which is the whole point of the reuse.

- [ ] **Step 1: Write the failing test**

Create `src/actions/__tests__/plan.test.ts`:

```ts
import type { Sequence } from '../actions';
import { buildActionRound, cardToQuestion, eligibleCards } from '../plan';

function card(id: string, order: number, extra: Partial<Sequence['cards'][number]> = {}) {
  return {
    id,
    order,
    title: `title-${id}`,
    purpose: `purpose-${id}`,
    purposeAccept: [`p-${id}`],
    action: `action-${id}`,
    actionAccept: [`a-${id}`],
    category: 'universal' as const,
    ...extra,
  };
}

const SEQ: Sequence = {
  id: 's',
  product: 'sub-finance',
  goal: 'g',
  scenario: 'sc',
  credit: 'c',
  cards: [card('c1', 1), card('c2', 2), card('c3', 3), card('c4', 4)],
};

describe('action round builder', () => {
  it('cardToQuestion maps title to q and the layer field to accept', () => {
    const c = SEQ.cards[0];
    expect(cardToQuestion(c, 'purpose')).toEqual({
      id: 'c1',
      tier: 2,
      q: 'title-c1',
      accept: ['p-c1'],
    });
    expect(cardToQuestion(c, 'action').accept).toEqual(['a-c1']);
  });

  it('recallTarget is i - n, null for the first n steps', () => {
    const plan = buildActionRound(SEQ, { n: 2, layer: 'purpose', mode: 'question' });
    expect(plan.steps.map((s) => s.recallTarget)).toEqual([null, null, 0, 1]);
  });

  it('question mode has null positions; dual mode assigns positions', () => {
    const q = buildActionRound(SEQ, { n: 1, layer: 'purpose', mode: 'question' });
    expect(q.steps.every((s) => s.position === null)).toBe(true);
    const d = buildActionRound(SEQ, { n: 1, layer: 'purpose', mode: 'dual' });
    expect(d.steps.every((s) => s.position !== null)).toBe(true);
  });

  it('each step primes card i and targets the accept-set of card i-n', () => {
    const plan = buildActionRound(SEQ, { n: 1, layer: 'purpose', mode: 'question' });
    // step 1 primes c2, recalls c1
    expect(plan.steps[1].question?.q).toBe('title-c2');
    const target = plan.steps[plan.steps[1].recallTarget!];
    expect(target.question?.accept).toEqual(['p-c1']);
  });

  it('Layer 2 drops layer2Skipped cards from the walk', () => {
    const seq: Sequence = {
      ...SEQ,
      cards: [
        card('c1', 1),
        card('c2', 2, { layer2Skipped: true, action: '', actionAccept: [] }),
        card('c3', 3),
      ],
    };
    expect(eligibleCards(seq, 'purpose').map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(eligibleCards(seq, 'action').map((c) => c.id)).toEqual(['c1', 'c3']);
    const plan = buildActionRound(seq, { n: 1, layer: 'action', mode: 'question' });
    expect(plan.steps.map((s) => s.question?.id)).toEqual(['c1', 'c3']);
  });

  it('n >= card count yields all prime-only steps (every recallTarget null)', () => {
    const plan = buildActionRound(SEQ, { n: 9, layer: 'purpose', mode: 'question' });
    expect(plan.steps.every((s) => s.recallTarget === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/actions/__tests__/plan.test.ts --testPathIgnorePatterns worktrees`
Expected: FAIL — cannot find module `../plan`.

- [ ] **Step 3: Write the builder**

Create `src/actions/plan.ts`:

```ts
import type { Question, RoundMode, RoundPlan, StepPlan } from '../engine';
import type { ActionCard, Sequence } from './actions';

export type Layer = 'purpose' | 'action';

export interface ActionRoundOpts {
  n: number;
  layer: Layer;
  mode: RoundMode;
}

const GRID_SIZE = 9;

export function eligibleCards(seq: Sequence, layer: Layer): ActionCard[] {
  if (layer === 'purpose') return seq.cards;
  return seq.cards.filter((c) => !c.layer2Skipped);
}

export function cardToQuestion(card: ActionCard, layer: Layer): Question {
  return {
    id: card.id,
    tier: 2,
    q: card.title,
    accept: layer === 'purpose' ? card.purposeAccept : card.actionAccept,
  };
}

export function buildActionRound(seq: Sequence, opts: ActionRoundOpts): RoundPlan {
  const { n, layer, mode } = opts;
  const cards = eligibleCards(seq, layer);
  const steps: StepPlan[] = cards.map((card, i) => ({
    index: i,
    position: mode === 'dual' ? i % GRID_SIZE : null,
    question: cardToQuestion(card, layer),
    recallTarget: i >= n ? i - n : null,
  }));
  return { n, mode, steps };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/actions/__tests__/plan.test.ts --testPathIgnorePatterns worktrees`
Expected: PASS (all 6).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/actions/plan.ts src/actions/__tests__/plan.test.ts
git commit -m "feat(actions): pure RoundPlan builder for the sequence walk"
```

---

## Task 4: Strings for the actions UI

**Files:**
- Modify: `src/strings/index.ts`
- Test: (covered by Task 5/6 screen tests + tsc; no separate test)

**Interfaces:**
- Consumes: nothing.
- Produces: an `actions` block on the `Strings` interface, present in both `ja` and `en`:
  - `actions: { tab: string; layer1: string; layer2: string; promptPurpose: string; promptAction: string; answer: string; next: string; toLayer2: string; again: string; backToList: string; start: string; nLabel: string; goalLabel: string; cardsPreview: string; productLabel: (p: string) => string }`

- [ ] **Step 1: Add the `actions` block to the `Strings` interface**

In `src/strings/index.ts`, inside `export interface Strings { ... }`, add after the `cases` block:

```ts
  actions: {
    tab: string;
    layer1: string;
    layer2: string;
    promptPurpose: string;
    promptAction: string;
    answer: string;
    next: string;
    toLayer2: string;
    again: string;
    backToList: string;
    start: string;
    nLabel: string;
    goalLabel: string;
    cardsPreview: string;
    productLabel: (p: string) => string;
  };
```

- [ ] **Step 2: Add the `ja` values**

Inside `export const ja: Strings = { ... }`, after the `cases` block:

```ts
  actions: {
    tab: 'アクション',
    layer1: '目的',
    layer2: '具体アクション',
    promptPurpose: 'N手前のカードの目的は？',
    promptAction: 'N手前のカードで具体的に何をする？',
    answer: '答える',
    next: '次へ',
    toLayer2: 'Layer 2 へ',
    again: 'もう一度',
    backToList: '一覧へ',
    start: 'はじめる',
    nLabel: 'N',
    goalLabel: '目標',
    cardsPreview: 'カードの並び',
    productLabel: (p) =>
      p === 'sub-finance' ? 'サブスクリプション・ファイナンス'
      : p === 'nav-finance' ? 'NAV ファイナンス'
      : p === 'hybrid-pref' ? 'ハイブリッド & 優先株'
      : p === 'gp-facility' ? 'GP ファシリティ'
      : p,
  },
```

- [ ] **Step 3: Add the `en` values**

Inside `export const en: Strings = { ... }`, after the `cases` block:

```ts
  actions: {
    tab: 'Actions',
    layer1: 'Purpose',
    layer2: 'Concrete action',
    promptPurpose: 'Purpose of the card N steps back?',
    promptAction: 'What do you concretely do for the card N steps back?',
    answer: 'Answer',
    next: 'Next',
    toLayer2: 'To Layer 2',
    again: 'Again',
    backToList: 'Back to list',
    start: 'Start',
    nLabel: 'N',
    goalLabel: 'Goal',
    cardsPreview: 'Card order',
    productLabel: (p) =>
      p === 'sub-finance' ? 'Subscription Finance'
      : p === 'nav-finance' ? 'NAV Finance'
      : p === 'hybrid-pref' ? 'Hybrid & Preferred'
      : p === 'gp-facility' ? 'GP Facilities'
      : p,
  },
```

- [ ] **Step 4: Typecheck (the gate — both `ja` and `en` must satisfy the interface)**

Run: `npx tsc --noEmit`
Expected: no errors. (A missing `actions` key in either object errors here.)

- [ ] **Step 5: Commit**

```bash
git add src/strings/index.ts
git commit -m "feat(actions): UI strings for the actions tab (ja/en)"
```

---

## Task 5: Sequences list screen

**Files:**
- Create: `src/ui/SequencesScreen.tsx`
- Test: `src/ui/__tests__/SequencesScreen.test.tsx`

**Interfaces:**
- Consumes: `sequencesByProduct`, `Product` from `src/actions/actions`; `FUNDS_FINANCE_CATEGORIES` from `src/content/series`; `useStrings`; `getTheme`.
- Produces: `export function SequencesScreen({ onSelect }: { onSelect: (sequenceId: string) => void })`. Each row: `testID={`seq-${id}`}`; each card-count node: `testID={`seq-count-${id}`}` rendering the raw card count.

(Design note: mirror `src/ui/CasesScreen.tsx` exactly — same grouping, same icon fallback, same raw-count node. The count node renders `s.cards.length` as bare text, NOT a formatted `"N / N"`, so `toHaveTextContent(String(length))` matches — this is the same correction applied in the cases list screen.)

- [ ] **Step 1: Write the failing test**

Create `src/ui/__tests__/SequencesScreen.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { listSequences } from '../../actions/actions';
import { SequencesScreen } from '../SequencesScreen';

describe('SequencesScreen', () => {
  it('renders every sequence with its goal', async () => {
    render(<SequencesScreen onSelect={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId(`seq-${listSequences()[0].id}`)).toBeTruthy();
    });
    for (const s of listSequences()) {
      expect(screen.getByText(s.goal)).toBeTruthy();
    }
  });

  it('shows the card count for a sequence', async () => {
    render(<SequencesScreen onSelect={jest.fn()} />);
    const first = listSequences()[0];
    await waitFor(() => {
      expect(screen.getByTestId(`seq-count-${first.id}`)).toHaveTextContent(
        String(first.cards.length),
      );
    });
  });

  it('calls onSelect with the sequence id on press', async () => {
    const onSelect = jest.fn();
    render(<SequencesScreen onSelect={onSelect} />);
    const first = listSequences()[0];
    await waitFor(() => expect(screen.getByTestId(`seq-${first.id}`)).toBeTruthy());
    fireEvent.press(screen.getByTestId(`seq-${first.id}`));
    expect(onSelect).toHaveBeenCalledWith(first.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/ui/__tests__/SequencesScreen.test.tsx --testPathIgnorePatterns worktrees`
Expected: FAIL — cannot find module `../SequencesScreen`.

- [ ] **Step 3: Write the screen**

Create `src/ui/SequencesScreen.tsx`:

```tsx
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { sequencesByProduct, type Product } from '../actions/actions';
import { FUNDS_FINANCE_CATEGORIES } from '../content/series';
import { useStrings } from '../strings';
import { getTheme } from './theme';

function iconFor(product: Product): string {
  return FUNDS_FINANCE_CATEGORIES.find((c) => c.id === product)?.icon ?? '🎯';
}

export function SequencesScreen({ onSelect }: { onSelect: (sequenceId: string) => void }) {
  const strings = useStrings();
  const theme = getTheme();
  const groups = sequencesByProduct();

  return (
    <ScrollView style={[styles.root, { backgroundColor: theme.bg }]} contentContainerStyle={styles.content}>
      {groups.map((group) => (
        <View key={group.product} style={styles.group}>
          <Text style={[styles.groupLabel, { color: theme.accentGold }]}>
            {iconFor(group.product)} {strings.actions.productLabel(group.product)}
          </Text>
          {group.sequences.map((s) => (
            <Pressable
              key={s.id}
              testID={`seq-${s.id}`}
              onPress={() => onSelect(s.id)}
              style={[styles.row, { borderColor: theme.cardBorder }]}
            >
              <Text style={[styles.goal, { color: theme.textPrimary }]}>{s.goal}</Text>
              <Text style={[styles.credit, { color: theme.textMuted }]}>{s.credit}</Text>
              <Text testID={`seq-count-${s.id}`} style={[styles.count, { color: theme.textMuted }]}>
                {s.cards.length}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16 },
  group: { marginBottom: 24 },
  groupLabel: { fontSize: 14, fontWeight: 'bold', marginBottom: 8 },
  row: { borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 10 },
  goal: { fontSize: 16, fontWeight: '600' },
  credit: { fontSize: 12, marginTop: 4 },
  count: { fontSize: 12, marginTop: 6 },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/ui/__tests__/SequencesScreen.test.tsx --testPathIgnorePatterns worktrees`
Expected: PASS (all 3).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/ui/SequencesScreen.tsx src/ui/__tests__/SequencesScreen.test.tsx
git commit -m "feat(actions): sequence-list screen grouped by product"
```

---

## Task 6: Action game screen (intro → play → results, both layers)

**Files:**
- Create: `src/ui/ActionGameScreen.tsx`
- Test: `src/ui/__tests__/ActionGameScreen.test.tsx`

**Interfaces:**
- Consumes: `getSequence`, `Sequence` from `src/actions/actions`; `buildActionRound`, `eligibleCards`, `type Layer` from `src/actions/plan`; `RoundRunner`, `RoundEngine` from `src/engine`; the judge path (`JudgeQueue`, `localMatch`, `ClaudeJudgeClient`) from `src/judge`; the speech path (`Speaker`/`Listener` makers) from `src/speech`; `useStrings`; `getTheme`.
- Produces: `export function ActionGameScreen({ sequenceId, onExit }: { sequenceId: string; onExit: () => void })`.
  - Phase testIDs: `action-intro` (intro container), `action-layer1`/`action-layer2` (layer selector), `action-n-up`/`action-n-down` (N picker), `action-n-value` (current N), `action-start` (start button), `action-prompt` (the N手前… prompt text), `action-answer` (submit/answer button), `action-next` (advance), `action-results` (results container), `action-to-layer2` (offered after Layer 1), `action-again`, `action-back`.

**Design (read before writing — this is the one screen that wires the reused engine):**

Study `src/ui/GameScreen.tsx` as the reference wiring (it constructs `RoundEngine`, `RoundRunner`, `JudgeQueue`, and the speaker/listener, and repaints on runner state). `ActionGameScreen` reuses that machinery with three differences:

1. The `RoundPlan` comes from `buildActionRound(seq, { n, layer, mode: 'question' })` instead of `buildRound(...)`. Default `mode: 'question'` (the semantic chain is the target; grid-flash `dual` is a later toggle and out of scope for v1 wiring beyond passing the mode through).
2. Two layers: after the Layer-1 results, offer `action-to-layer2`, which rebuilds the plan with `layer: 'action'` over `eligibleCards(seq, 'action')` and restarts the runner. After Layer-2 results, offer `action-again` / `action-back`.
3. Local state machine: `phase: 'intro' | 'play' | 'results'`, plus `layer` and `n`. Keep the component thin — the play loop is the runner; the component renders runner/judge state and owns the intro/results toggles.

**Jest scope (CONTEXT.md pitfall #2):** the realtime voice loop (TTS speaking the prime, recognizer capturing the answer) is verified on device/browser in Task 8, NOT in Jest. The screen test drives only the deterministic shell: the intro renders, the layer selector and N picker update `action-n-value`, pressing `action-start` moves to the `play` phase (`action-prompt` visible), and — using the app's existing fake speaker/listener test doubles (the same ones `GameScreen.test.tsx` uses; check that file for the exact helper) — a round can be stepped to `action-results`. If wiring a full fake-driven round through the runner proves heavy for a component test, assert the phase transition to `play` and the presence of `action-prompt`, and leave the full round to the reused engine's own unit tests plus Task 8. Match whatever `GameScreen.test.tsx` does.

- [ ] **Step 1: Read the reference wiring and its test**

Read `src/ui/GameScreen.tsx` (runner/engine/judge/speech construction, repaint pattern) and `src/ui/__tests__/GameScreen.test.tsx` (how speech is faked, how a round is stepped in Jest). The action screen mirrors these. Note the exact import paths and helper names — use them verbatim.

- [ ] **Step 2: Write the failing test**

Create `src/ui/__tests__/ActionGameScreen.test.tsx`. Start from the deterministic shell (adapt fakes to match `GameScreen.test.tsx`):

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { listSequences } from '../../actions/actions';
import { ActionGameScreen } from '../ActionGameScreen';

const SEQ = listSequences()[0];

describe('ActionGameScreen', () => {
  it('shows the intro with the goal and the card-order preview', () => {
    render(<ActionGameScreen sequenceId={SEQ.id} onExit={jest.fn()} />);
    expect(screen.getByTestId('action-intro')).toBeTruthy();
    expect(screen.getByText(SEQ.goal)).toBeTruthy();
    // titles are previewed
    expect(screen.getByText(SEQ.cards[0].title)).toBeTruthy();
  });

  it('the N picker updates the shown N', () => {
    render(<ActionGameScreen sequenceId={SEQ.id} onExit={jest.fn()} />);
    const before = screen.getByTestId('action-n-value').props.children;
    fireEvent.press(screen.getByTestId('action-n-up'));
    const after = screen.getByTestId('action-n-value').props.children;
    expect(after).not.toBe(before);
  });

  it('start moves from intro to the play phase with a prompt', async () => {
    render(<ActionGameScreen sequenceId={SEQ.id} onExit={jest.fn()} />);
    fireEvent.press(screen.getByTestId('action-start'));
    await waitFor(() => expect(screen.getByTestId('action-prompt')).toBeTruthy());
    expect(screen.queryByTestId('action-intro')).toBeNull();
  });
});
```

(If `GameScreen.test.tsx` provides a fake speaker/listener + clock harness that makes a full stepped round tractable, extend this file with a test that steps to `action-results` and asserts `action-to-layer2` is offered after Layer 1. Otherwise keep the three shell tests above and rely on the engine's own tests + Task 8 for the round.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/ui/__tests__/ActionGameScreen.test.tsx --testPathIgnorePatterns worktrees`
Expected: FAIL — cannot find module `../ActionGameScreen`.

- [ ] **Step 4: Write the screen**

Create `src/ui/ActionGameScreen.tsx`, mirroring `GameScreen.tsx`'s engine/runner/judge/speech construction. Concrete requirements the tests and spec pin down:
- `getSequence(sequenceId)`; if undefined, render a container with an `action-back` pressable calling `onExit` (same defensive pattern as `CaseGameScreen`).
- `phase` state starts `'intro'`. Intro renders `action-intro`, the `scenario`, the `goal` (via `strings.actions.goalLabel` + `seq.goal`), a titles-only preview of `eligibleCards(seq, 'purpose')`, the layer selector (`action-layer1` / `action-layer2`), the N picker (`action-n-up` / `action-n-down` / `action-n-value`, default N from `adaptive`/a sensible constant like 2, floored at 1), and `action-start`.
- On `action-start`: build `buildActionRound(seq, { n, layer, mode: 'question' })`, construct the `RoundEngine` + `RoundRunner` + judge queue + speaker/listener exactly as `GameScreen` does, set `phase='play'`, start the runner. Render the running prompt as `action-prompt` (text from `strings.actions.promptPurpose`/`promptAction`), the reused answer input/`action-answer`, and `action-next`.
- When the runner finishes, set `phase='results'`, render `action-results` (reuse the results view where it fits — score/N/hits). After **Layer 1**, show `action-to-layer2`; pressing it sets `layer='action'`, rebuilds over `eligibleCards(seq,'action')`, and restarts at `phase='play'`. After **Layer 2**, show `action-again` (restart Layer 1) and `action-back` (`onExit`).
- Keep the component thin; the play loop is the runner. Do not modify any `src/engine` file.

(No verbatim full-screen code here because the exact speaker/listener/judge construction must be copied from the current `GameScreen.tsx` to stay in sync with it; Step 1 is where that reading happens. Everything the tests assert — the testIDs, the phase transitions, the layer/N controls — is specified above.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/ui/__tests__/ActionGameScreen.test.tsx --testPathIgnorePatterns worktrees`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/ui/ActionGameScreen.tsx src/ui/__tests__/ActionGameScreen.test.tsx
git commit -m "feat(actions): action game screen — intro, dual-n-back play, results, two layers"
```

---

## Task 7: Wire the 5th tab into App.tsx

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `SequencesScreen` (Task 5), `ActionGameScreen` (Task 6).
- Produces: two new `Screen` states and the 5th nav tab. No exported signatures.

- [ ] **Step 1: Add imports**

In `App.tsx`, near the other UI imports (the `cases` imports are already there):

```tsx
import { ActionGameScreen } from './src/ui/ActionGameScreen';
import { SequencesScreen } from './src/ui/SequencesScreen';
```

- [ ] **Step 2: Extend the `Screen` union**

After the `cases` / `case-game` members:

```tsx
  | { name: 'sequences' }
  | { name: 'action-game'; sequenceId: string };
```

- [ ] **Step 3: Update `activeTab` and `showBottomBar`**

```tsx
  const activeTab =
    screen.name === 'questions' ? 'questions'
    : screen.name === 'settings' ? 'settings'
    : screen.name === 'cases' ? 'cases'
    : screen.name === 'sequences' ? 'sequences'
    : 'series';
  const showBottomBar =
    screen.name === 'series' ||
    screen.name === 'questions' ||
    screen.name === 'settings' ||
    screen.name === 'cases' ||
    screen.name === 'sequences';
```

- [ ] **Step 4: Render the two new screens**

Alongside the `cases` / `case-game` blocks:

```tsx
        {screen.name === 'sequences' && (
          <SequencesScreen onSelect={(sequenceId) => setScreen({ name: 'action-game', sequenceId })} />
        )}

        {screen.name === 'action-game' && (
          <ActionGameScreen
            sequenceId={screen.sequenceId}
            onExit={() => setScreen({ name: 'sequences' })}
          />
        )}
```

- [ ] **Step 5: Add the 5th nav button (after 💼 案件)**

The 案件 nav button hardcodes its label `案件` (the other labels are hardcoded literals too). Add the アクション button right after it, hardcoding `アクション`:

```tsx
          <Pressable
            onPress={() => setScreen({ name: 'sequences' })}
            style={[styles.navBtn, activeTab === 'sequences' && styles.navBtnActive]}
          >
            <Text style={styles.navIcon}>🎯</Text>
            <Text style={[styles.navLabel, activeTab === 'sequences' && styles.navLabelActive]}>
              アクション
            </Text>
          </Pressable>
```

Also update the nav comment from "4 Main Bottom Navigation Buttons" to "5 Main Bottom Navigation Buttons: 教材, 案件, アクション, 作成, 設定".

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Run the full test suite**

Run: `npm test -- --testPathIgnorePatterns worktrees`
Expected: all suites pass (the existing suites plus the 4 new ones).

- [ ] **Step 8: Commit**

```bash
git add App.tsx
git commit -m "feat(actions): add 🎯 アクション as the 5th bottom-nav tab"
```

---

## Task 8: Bundle check and manual smoke (incl. voice loop)

**Files:** none (verification only).

- [ ] **Step 1: iOS + web bundle check**

Run: `npm run check:bundle`
Expected: both the iOS and web exports complete. No new deps were added, so this should pass; run it because "tests + types pass but the iOS bundle fails" is a real failure mode (CONTEXT.md pitfall #1).

- [ ] **Step 2: Browser smoke (semantic flow)**

Run: `npx expo start --web`, open the app, tap the 🎯 アクション tab. Verify:
- The sequence list shows both sequences grouped by product.
- Opening a sequence shows the intro: scenario, goal, the card-order preview (titles), layer selector, N picker.
- Layer 1 → はじめる → the round primes card titles and prompts for the purpose of the card N steps back; 答える scores and reveals the authored purpose + note beside your answer; 次へ advances.
- Reaching results offers Layer 2 へ; Layer 2 re-walks the same sequence asking for the concrete action; layer2Skipped cards do not appear as scored targets.
- After Layer 2: もう一度 / 一覧へ work.

- [ ] **Step 3: Voice-loop verification on device/browser (CONTEXT.md pitfall #2)**

This mode reuses `src/speech` end-to-end, so the fake-TTS blind spot applies. On a real browser (and, if available, device):
- The prime card title is actually spoken via TTS before the mic opens.
- A spoken purpose/action is recognized and scored (local match offline; Claude when a key is set in Settings).
- The typed-input fallback works when the mic is unavailable.
Confirm the utterance is not clipped and the recognizer's final transcript is not lost (the `readyToClose`/`settle` timing the engine already handles — verify it holds for these primes, which are card titles).

- [ ] **Step 4: Final commit (if any tweaks)**

```bash
git add -A
git commit -m "chore(actions): bundle-check and smoke fixes"
```

---

## Self-Review

**Spec coverage:**
- 5th nav tab 🎯 アクション → Task 7. ✓
- Two screens (sequence list, action game) → Tasks 5, 6. ✓
- Data model (`ActionCard`/`Sequence`, 4 products, 3 categories, purpose/action + accept-sets) → Task 1 types, Task 2 content. ✓
- Content adapted from the book's `chapter_N.actions.json` with the field mapping, `goal`/`scenario` authored, `purposeAccept[]`/`actionAccept[]` authored, null `sample_phrase` → `layer2Skipped` → Task 2. ✓
- True dual-n-back reusing the engine: prime = card *i*, scored answer = card *i−N*'s accept-set → Task 3 builder + the verified `round.ts:72-85` scoring. ✓
- `recallTarget = i − N`, null for first N → Task 3 (`recallTarget: i >= n ? i - n : null`), tested. ✓
- Layer selects purpose vs action field → Task 3 `cardToQuestion`, tested. ✓
- `mode: 'question'` default, `dual` optional → Task 3 `position` mapping; Task 6 passes `mode`. ✓
- Scoring via existing `src/judge` (local → claude → queue), in-memory accept growth → Task 6 reuses `GameScreen`'s judge wiring; no write-back. ✓
- Voice via existing `src/speech`, typed fallback → Task 6 reuses; Task 8 step 3 verifies on device. ✓
- Two layers sequential (Layer 1 whole sequence, then Layer 2) → Task 6 `action-to-layer2` transition. ✓
- Results reuse where it fits → Task 6 results phase. ✓
- Engine internals not modified; new logic under `src/actions/` → Global Constraints + no task edits `src/engine`. ✓
- No new deps → nothing installed; Task 8 confirms via `check:bundle`. ✓
- JA-first content, no en/harness → Task 2 authors JA only; deferred (spec §Deferred). ✓
- `layer2Skipped` cards prime in Layer 1 but are dropped as Layer-2 targets → Task 3 `eligibleCards`, tested; Task 6 uses it. ✓

**Placeholder scan:** No TBD/TODO. Task 6's screen body is described by exact testIDs, phase transitions, and control behavior rather than a verbatim dump, because the speaker/listener/judge construction must be copied from the live `GameScreen.tsx` (Step 1 reads it) to avoid shipping a stale copy — this is a deliberate "match the reference" instruction, not a missing detail. Every other code step has real code.

**Type consistency:** `Product`/`Category`/`ActionCard`/`Sequence` defined in Task 1 and reused unchanged in Tasks 2/3/5/6. `Layer`/`ActionRoundOpts`/`buildActionRound`/`cardToQuestion`/`eligibleCards` defined in Task 3 and used in Task 6. The engine `Question` shape (`{id,tier,q,accept}`) and `RoundPlan`/`StepPlan`/`RoundMode` are consumed from `src/engine` verbatim. `strings.actions.*` keys defined in Task 4 match uses in Tasks 5/6/7. testIDs are consistent between each screen and its test.
```
