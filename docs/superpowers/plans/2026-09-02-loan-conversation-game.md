# 案件 (Cases) Loan-Conversation Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th bottom-nav tab, 案件 (Cases), where each case is a loan report sheet plus a scripted presentation-to-CRO-approval conversation the user guesses one turn at a time (type a guess → reveal the real line → self-compare → advance), with no scoring.

**Architecture:** A self-contained subsystem isolated from the existing N-back/quiz `RoundEngine`, `judge/`, `speech/`, and `store/`. Static content in `src/cases/cases.json` loaded by a thin `src/cases/cases.ts`. A pure reducer (`src/cases/reducer.ts`) drives the two-phase (sheet-intro → conversation) `CaseGameScreen`, with `CasesScreen` listing cases grouped by product. `App.tsx` gains two screen states and the 4th nav tab.

**Tech Stack:** Expo / React Native + react-native-web, TypeScript, Jest + `@testing-library/react-native`. JSON imports enabled via `resolveJsonModule`.

**Spec:** `docs/superpowers/specs/2026-09-02-loan-conversation-game-design.md`

## Global Constraints

- No new npm dependencies (keeps the iOS-bundle `node:` pitfall out of play). CONTEXT.md pitfall #1.
- Content is static and Japanese-first (canonical), mirroring `series.json`. No English `cases.en.json`, no generation/audit harness in this plan — both deferred.
- No scoring, no history records, no IAP/tier gating. Reveal + self-compare only; the game never touches `RoundEngine`, `src/judge/`, `src/speech/`, or `src/store/`.
- Two taps per turn: 「めくる」(reveal) then 「次へ」(advance). The user's typed guess stays on screen next to the revealed real line.
- Every line, all speakers: the user guesses each turn regardless of speaker.
- Sheet `group` is exactly one of: `'terms' | 'collateral' | 'investors' | 'legal' | 'risk'`.
- `product` is exactly one of: `'sub-finance' | 'nav-finance' | 'hybrid-pref' | 'gp-facility'`.
- UI chrome text goes through the typed `Strings` interface in `src/strings/index.ts` (both `ja` and `en` objects), consumed via `useStrings()`. Case *content* (sheet/turns) stays in `cases.json`, not in strings.
- Theme colors come from `getTheme()` → `ThemeColors` (`src/ui/theme.ts`). The keys used by this plan's screens are the real ones: `bg`, `cardBorder`, `textPrimary`, `textSecondary`, `textMuted`, `accentGold`. There is no `text`/`muted`/`accent`/`border` key — use the real names verbatim.
- Tests must pass under `npm test` and `npx tsc --noEmit`. Components tested with `@testing-library/react-native` using `testID`/`getByText`, matching `src/ui/__tests__/SeriesScreen.test.tsx`.

---

## File Structure

Create:
- `src/cases/cases.ts` — types (`LoanCase`, `SheetField`, `Turn`, `Product`, `SheetGroup`) + loader (`listCases`, `getCase`, `casesByProduct`).
- `src/cases/cases.json` — 2 hand-authored cases (1 subscription, 1 NAV), JA.
- `src/cases/reducer.ts` — pure state machine for the game (`initState`, `reveal`, `advance`, `replay`, derived selectors).
- `src/cases/__tests__/cases.test.ts` — content-invariant + loader tests.
- `src/cases/__tests__/reducer.test.ts` — reducer unit tests.
- `src/ui/CasesScreen.tsx` — case list grouped by product.
- `src/ui/CaseGameScreen.tsx` — sheet-intro + conversation, renders from the reducer.
- `src/ui/__tests__/CasesScreen.test.tsx` — list-screen tests.
- `src/ui/__tests__/CaseGameScreen.test.tsx` — game-screen tests.

Modify:
- `src/strings/index.ts` — add a `cases` block to the `Strings` interface and to both `ja` and `en`.
- `App.tsx` — add `'cases'` + `'case-game'` to the `Screen` union, render the two screens, add the 4th nav tab, show bottom bar on `cases`.

---

## Task 1: Case types and content loader

**Files:**
- Create: `src/cases/cases.ts`
- Create: `src/cases/cases.json` (minimal stub for this task; real content added in Task 2)
- Test: `src/cases/__tests__/cases.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Product = 'sub-finance' | 'nav-finance' | 'hybrid-pref' | 'gp-facility'`
  - `type SheetGroup = 'terms' | 'collateral' | 'investors' | 'legal' | 'risk'`
  - `interface SheetField { label: string; value: string; group: SheetGroup }`
  - `interface Turn { speaker: string; line: string; note?: string }`
  - `interface LoanCase { id: string; product: Product; title: string; credit: string; sheet: SheetField[]; conversation: Turn[] }`
  - `function listCases(): LoanCase[]`
  - `function getCase(id: string): LoanCase | undefined`
  - `function casesByProduct(): { product: Product; cases: LoanCase[] }[]` — groups in `PRODUCT_ORDER`, omitting products with no cases.
  - `const PRODUCT_ORDER: Product[]` = `['sub-finance', 'nav-finance', 'hybrid-pref', 'gp-facility']`.

- [ ] **Step 1: Write the failing test**

Create `src/cases/__tests__/cases.test.ts`:

```ts
import { casesByProduct, getCase, listCases, PRODUCT_ORDER } from '../cases';

const GROUPS = ['terms', 'collateral', 'investors', 'legal', 'risk'];

describe('cases content', () => {
  it('loads at least one case', () => {
    expect(listCases().length).toBeGreaterThan(0);
  });

  it('has unique ids', () => {
    const ids = listCases().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every case has a valid product, a non-empty sheet, and at least one turn', () => {
    for (const c of listCases()) {
      expect(PRODUCT_ORDER).toContain(c.product);
      expect(c.sheet.length).toBeGreaterThan(0);
      expect(c.conversation.length).toBeGreaterThan(0);
      expect(c.title.trim()).not.toBe('');
      expect(c.credit.trim()).not.toBe('');
    }
  });

  it('every sheet field has a valid group and non-empty label/value', () => {
    for (const c of listCases()) {
      for (const f of c.sheet) {
        expect(GROUPS).toContain(f.group);
        expect(f.label.trim()).not.toBe('');
        expect(f.value.trim()).not.toBe('');
      }
    }
  });

  it('every turn has a non-empty speaker and line', () => {
    for (const c of listCases()) {
      for (const t of c.conversation) {
        expect(t.speaker.trim()).not.toBe('');
        expect(t.line.trim()).not.toBe('');
      }
    }
  });

  it('getCase returns the matching case and undefined for unknown ids', () => {
    const first = listCases()[0];
    expect(getCase(first.id)).toEqual(first);
    expect(getCase('does-not-exist')).toBeUndefined();
  });

  it('casesByProduct groups in PRODUCT_ORDER and omits empty products', () => {
    const groups = casesByProduct();
    const products = groups.map((g) => g.product);
    // order is a subsequence of PRODUCT_ORDER
    const orderIdx = products.map((p) => PRODUCT_ORDER.indexOf(p));
    expect(orderIdx).toEqual([...orderIdx].sort((a, b) => a - b));
    // no empty groups
    for (const g of groups) expect(g.cases.length).toBeGreaterThan(0);
    // every case appears exactly once
    expect(groups.flatMap((g) => g.cases).length).toBe(listCases().length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/cases/__tests__/cases.test.ts`
Expected: FAIL — cannot find module `../cases`.

- [ ] **Step 3: Write a minimal `cases.json` stub**

Create `src/cases/cases.json` with one throwaway case so the loader has data to satisfy the invariant tests (Task 2 replaces this with real content):

```json
[
  {
    "id": "stub-subline-01",
    "product": "sub-finance",
    "title": "スタブ案件",
    "credit": "『FundsFinanceの教科書』より",
    "sheet": [
      { "label": "金額 / Amount", "value": "コミットメントの30%", "group": "terms" }
    ],
    "conversation": [
      { "speaker": "RM", "line": "本件のサブスクリプション・ラインをご説明します。" }
    ]
  }
]
```

- [ ] **Step 4: Write the loader**

Create `src/cases/cases.ts`:

```ts
import raw from './cases.json';

export type Product = 'sub-finance' | 'nav-finance' | 'hybrid-pref' | 'gp-facility';
export type SheetGroup = 'terms' | 'collateral' | 'investors' | 'legal' | 'risk';

export interface SheetField {
  label: string;
  value: string;
  group: SheetGroup;
}

export interface Turn {
  speaker: string;
  line: string;
  note?: string;
}

export interface LoanCase {
  id: string;
  product: Product;
  title: string;
  credit: string;
  sheet: SheetField[];
  conversation: Turn[];
}

export const PRODUCT_ORDER: Product[] = [
  'sub-finance',
  'nav-finance',
  'hybrid-pref',
  'gp-facility',
];

const CASES = raw as LoanCase[];

export function listCases(): LoanCase[] {
  return CASES;
}

export function getCase(id: string): LoanCase | undefined {
  return CASES.find((c) => c.id === id);
}

export function casesByProduct(): { product: Product; cases: LoanCase[] }[] {
  return PRODUCT_ORDER.map((product) => ({
    product,
    cases: CASES.filter((c) => c.product === product),
  })).filter((g) => g.cases.length > 0);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/cases/__tests__/cases.test.ts`
Expected: PASS (all 7).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/cases/cases.ts src/cases/cases.json src/cases/__tests__/cases.test.ts
git commit -m "feat(cases): loan-case types and content loader"
```

---

## Task 2: Author the real cases (1 subscription, 1 NAV)

**Files:**
- Modify: `src/cases/cases.json` (replace the Task 1 stub)

**Interfaces:**
- Consumes: the `LoanCase` shape from Task 1.
- Produces: real content. No code signatures; the Task 1 invariant tests are the gate.

This task has no new test code — the Task 1 content-invariant tests are the acceptance gate, plus a manual read for quality. Content is drawn from `/mnt/c/Projects/book/Books2/6.FundsFinanceの教科書` (ch.16 case studies, ch.24 exercises; sheet/legal/risk facts from ch.2, ch.3, ch.10–12, ch.18). Author in Japanese.

- [ ] **Step 1: Read the source chapters**

Read enough of the book to author accurately. Minimum:
- `第16章-ケーススタディ(商品別×ファンド別).md` — pick one subscription-line case and one NAV case as conversation backbones.
- `第2章-商品類型の完全整理-Subline-Hybrid-NAV-Asset-backed.md` — product mechanics for the sheets.
- `第18章-投資家(LP)タイプ別...md` — LP mix for the `investors` fields.
- Skim `第10章`/`第11章`/`第12章` for the `collateral`/`legal` fields, `第14章`/`第15章` for `risk`.

- [ ] **Step 2: Write the two cases into `cases.json`**

Replace the stub array with two cases. Each must satisfy the invariants and read as a real desk conversation. Requirements per case:
- `product`: one `sub-finance`, one `nav-finance`.
- `sheet`: at least one field in EACH of the five groups (`terms`, `collateral`, `investors`, `legal`, `risk`) so both the intro card and the peek panel show every section. Subscription `collateral` = security over uncalled commitments / capital-call rights; NAV `collateral` = NAV collateral, LTV, asset coverage.
- `conversation`: 8–14 turns, ordered presentation → questions → CRO approval. Speakers drawn from `RM` / `審査担当` / `リスク` / `法務` / `CRO`. The final turn is the CRO's approval line. Add `note` on 2–4 turns where a short "why this is the natural next move" helps (e.g. "CROはまず返済原資を問う").
- Labels bilingual in the `label` field where natural (e.g. `"金額 / Amount"`); values Japanese.

Illustrative shape (author real content, do not ship this verbatim):

```json
[
  {
    "id": "subline-midmarket-buyout-01",
    "product": "sub-finance",
    "title": "中堅バイアウトファンドへのサブスクリプション・ライン",
    "credit": "『FundsFinanceの教科書』第16章 より",
    "sheet": [
      { "label": "金額 / Amount", "value": "コミットメント総額の20%、上限120億円", "group": "terms" },
      { "label": "期間 / Tenor", "value": "364日ローリング（クリーンダウン条項付き）", "group": "terms" },
      { "label": "プライシング / Pricing", "value": "TIBOR + 1.60%、コミットメントフィー0.35%", "group": "terms" },
      { "label": "担保 / Collateral", "value": "未コールコミットメントおよびキャピタルコール権に対する担保", "group": "collateral" },
      { "label": "ボローイングベース", "value": "適格LPの未コール残高 × アドバンスレート", "group": "collateral" },
      { "label": "投資家 / Investors", "value": "国内年金3、生保2、海外SWF1（適格LP比率85%）", "group": "investors" },
      { "label": "法的構造 / Structure", "value": "ケイマンLP、ブロッカー経由、並行ファンド有り", "group": "legal" },
      { "label": "主要条項 / Terms", "value": "LPAに借入上限・目的条項、サイドレターのMFN確認", "group": "legal" },
      { "label": "リスク特性 / Risk", "value": "適格LP集中、コール遅延、除外事由（LPデフォルト）", "group": "risk" }
    ],
    "conversation": [
      { "speaker": "RM", "line": "中堅バイアウトファンド向けのサブスクリプション・ラインです。コミットメント総額の20%、上限120億円でお諮りします。" },
      { "speaker": "審査担当", "line": "返済原資は未コールコミットメントですね。ボローイングベースの構成を確認させてください。", "note": "審査はまず返済原資とボローイングベースの整合を問う。" },
      { "speaker": "CRO", "line": "承認します。適格LP比率のモニタリングを四半期で入れてください。", "note": "CROの最終承認は条件（モニタリング）を添えて出るのが自然。" }
    ]
  }
]
```

- [ ] **Step 3: Run the content-invariant tests**

Run: `npx jest src/cases/__tests__/cases.test.ts`
Expected: PASS. If a case is missing a group or a turn field, the invariant tests fail — fix the content.

- [ ] **Step 4: Manual quality read**

Re-read both cases end to end. Each conversation must flow naturally from presentation to CRO approval, and each next line must be plausibly *the* natural line given everything above it. Fix wording that reads as a non-sequitur.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/cases/cases.json
git commit -m "content(cases): author subscription and NAV loan cases from the book"
```

---

## Task 3: Game state reducer

**Files:**
- Create: `src/cases/reducer.ts`
- Test: `src/cases/__tests__/reducer.test.ts`

**Interfaces:**
- Consumes: `LoanCase`, `Turn` from `src/cases/cases.ts`.
- Produces:
  - `type Phase = 'sheet' | 'conversation' | 'done'`
  - `interface GameState { phase: Phase; turnIndex: number; revealed: boolean; guess: string }`
  - `function initState(): GameState` → `{ phase: 'sheet', turnIndex: 0, revealed: false, guess: '' }`
  - `function startConversation(s: GameState): GameState` — sheet → conversation.
  - `function setGuess(s: GameState, guess: string): GameState`
  - `function reveal(s: GameState): GameState` — sets `revealed: true` (no-op if already revealed or not in conversation).
  - `function advance(s: GameState, totalTurns: number): GameState` — from a revealed turn: next turn (`revealed: false`, `guess: ''`), or `phase: 'done'` past the last turn.
  - `function replay(): GameState` — same as `initState()`.
  - `function currentTurn(c: LoanCase, s: GameState): Turn | null` — the turn at `turnIndex`, or `null` if not in conversation / out of range.

- [ ] **Step 1: Write the failing test**

Create `src/cases/__tests__/reducer.test.ts`:

```ts
import type { LoanCase } from '../cases';
import {
  advance,
  currentTurn,
  initState,
  reveal,
  replay,
  setGuess,
  startConversation,
} from '../reducer';

const CASE: LoanCase = {
  id: 't',
  product: 'sub-finance',
  title: 'T',
  credit: 'c',
  sheet: [{ label: 'L', value: 'V', group: 'terms' }],
  conversation: [
    { speaker: 'RM', line: 'one' },
    { speaker: 'CRO', line: 'two' },
  ],
};

describe('cases reducer', () => {
  it('starts on the sheet phase', () => {
    expect(initState()).toEqual({ phase: 'sheet', turnIndex: 0, revealed: false, guess: '' });
  });

  it('startConversation moves to the first turn', () => {
    const s = startConversation(initState());
    expect(s.phase).toBe('conversation');
    expect(currentTurn(CASE, s)).toEqual({ speaker: 'RM', line: 'one' });
  });

  it('setGuess stores the typed text', () => {
    const s = setGuess(startConversation(initState()), 'my guess');
    expect(s.guess).toBe('my guess');
  });

  it('reveal flips revealed and keeps the guess', () => {
    let s = setGuess(startConversation(initState()), 'g');
    s = reveal(s);
    expect(s.revealed).toBe(true);
    expect(s.guess).toBe('g');
  });

  it('reveal is a no-op outside the conversation phase', () => {
    expect(reveal(initState()).revealed).toBe(false);
  });

  it('advance from a revealed turn moves to the next, clearing guess and revealed', () => {
    let s = reveal(setGuess(startConversation(initState()), 'g'));
    s = advance(s, CASE.conversation.length);
    expect(s.turnIndex).toBe(1);
    expect(s.revealed).toBe(false);
    expect(s.guess).toBe('');
    expect(currentTurn(CASE, s)).toEqual({ speaker: 'CRO', line: 'two' });
  });

  it('advance past the last turn reaches done', () => {
    let s = startConversation(initState());
    s = advance(reveal(s), CASE.conversation.length); // -> turn 1
    s = advance(reveal(s), CASE.conversation.length); // -> done
    expect(s.phase).toBe('done');
    expect(currentTurn(CASE, s)).toBeNull();
  });

  it('replay returns to the initial state', () => {
    expect(replay()).toEqual(initState());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/cases/__tests__/reducer.test.ts`
Expected: FAIL — cannot find module `../reducer`.

- [ ] **Step 3: Write the reducer**

Create `src/cases/reducer.ts`:

```ts
import type { LoanCase, Turn } from './cases';

export type Phase = 'sheet' | 'conversation' | 'done';

export interface GameState {
  phase: Phase;
  turnIndex: number;
  revealed: boolean;
  guess: string;
}

export function initState(): GameState {
  return { phase: 'sheet', turnIndex: 0, revealed: false, guess: '' };
}

export function startConversation(s: GameState): GameState {
  if (s.phase !== 'sheet') return s;
  return { ...s, phase: 'conversation' };
}

export function setGuess(s: GameState, guess: string): GameState {
  return { ...s, guess };
}

export function reveal(s: GameState): GameState {
  if (s.phase !== 'conversation' || s.revealed) return s;
  return { ...s, revealed: true };
}

export function advance(s: GameState, totalTurns: number): GameState {
  if (s.phase !== 'conversation' || !s.revealed) return s;
  const next = s.turnIndex + 1;
  if (next >= totalTurns) {
    return { ...s, phase: 'done' };
  }
  return { ...s, turnIndex: next, revealed: false, guess: '' };
}

export function replay(): GameState {
  return initState();
}

export function currentTurn(c: LoanCase, s: GameState): Turn | null {
  if (s.phase !== 'conversation') return null;
  return c.conversation[s.turnIndex] ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/cases/__tests__/reducer.test.ts`
Expected: PASS (all 8).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/cases/reducer.ts src/cases/__tests__/reducer.test.ts
git commit -m "feat(cases): pure game-state reducer for the conversation flow"
```

---

## Task 4: Strings for the cases UI

**Files:**
- Modify: `src/strings/index.ts`
- Test: (covered by Task 5/6 screen tests; no separate test here)

**Interfaces:**
- Consumes: nothing.
- Produces: a `cases` block on the `Strings` interface, present in both `ja` and `en`:
  - `cases: { tab: string; start: string; reveal: string; next: string; approved: string; again: string; backToList: string; memo: string; guessPlaceholder: string; yourGuess: string; turnCounter: (i: number, total: number) => string; productLabel: (p: string) => string }`

- [ ] **Step 1: Add the `cases` block to the `Strings` interface**

In `src/strings/index.ts`, inside `export interface Strings { ... }`, add after the existing blocks:

```ts
  cases: {
    tab: string;
    start: string;
    reveal: string;
    next: string;
    approved: string;
    again: string;
    backToList: string;
    memo: string;
    guessPlaceholder: string;
    yourGuess: string;
    turnCounter: (i: number, total: number) => string;
    productLabel: (p: string) => string;
  };
```

- [ ] **Step 2: Add the `ja` values**

Inside `export const ja: Strings = { ... }`, add:

```ts
  cases: {
    tab: '案件',
    start: '会話を始める',
    reveal: 'めくる',
    next: '次へ',
    approved: '承認',
    again: 'もう一度',
    backToList: '案件一覧へ',
    memo: '案件メモ',
    guessPlaceholder: '次のセリフを入力…',
    yourGuess: 'あなたの回答',
    turnCounter: (i, total) => `${i} / ${total}`,
    productLabel: (p) =>
      p === 'sub-finance' ? 'サブスクリプション・ファイナンス'
      : p === 'nav-finance' ? 'NAV ファイナンス'
      : p === 'hybrid-pref' ? 'ハイブリッド & 優先株'
      : p === 'gp-facility' ? 'GP ファシリティ'
      : p,
  },
```

- [ ] **Step 3: Add the `en` values**

Inside `export const en: Strings = { ... }`, add:

```ts
  cases: {
    tab: 'Cases',
    start: 'Start conversation',
    reveal: 'Reveal',
    next: 'Next',
    approved: 'APPROVED',
    again: 'Again',
    backToList: 'Back to cases',
    memo: 'Deal facts',
    guessPlaceholder: 'Type the next line…',
    yourGuess: 'Your guess',
    turnCounter: (i, total) => `${i} / ${total}`,
    productLabel: (p) =>
      p === 'sub-finance' ? 'Subscription Finance'
      : p === 'nav-finance' ? 'NAV Finance'
      : p === 'hybrid-pref' ? 'Hybrid & Preferred'
      : p === 'gp-facility' ? 'GP Facilities'
      : p,
  },
```

- [ ] **Step 4: Typecheck to verify both objects satisfy the interface**

Run: `npx tsc --noEmit`
Expected: no errors. (If either `ja` or `en` is missing a `cases` key, TS errors here — that is the test for this task.)

- [ ] **Step 5: Commit**

```bash
git add src/strings/index.ts
git commit -m "feat(cases): UI strings for the cases tab (ja/en)"
```

---

## Task 5: Cases list screen

**Files:**
- Create: `src/ui/CasesScreen.tsx`
- Test: `src/ui/__tests__/CasesScreen.test.tsx`

**Interfaces:**
- Consumes: `casesByProduct`, `LoanCase`, `Product` from `src/cases/cases.ts`; `useStrings` from `src/strings`; `getTheme` from `src/ui/theme`; `FUNDS_FINANCE_CATEGORIES` from `src/content/series` (for the per-product icon).
- Produces: `export function CasesScreen({ onSelect }: { onSelect: (caseId: string) => void })`. Each case row has `testID={`case-${id}`}`; each turn-count node has `testID={`case-count-${id}`}`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/__tests__/CasesScreen.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { listCases } from '../../cases/cases';
import { CasesScreen } from '../CasesScreen';

describe('CasesScreen', () => {
  it('renders every case with its title', async () => {
    render(<CasesScreen onSelect={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId(`case-${listCases()[0].id}`)).toBeTruthy();
    });
    for (const c of listCases()) {
      expect(screen.getByText(c.title)).toBeTruthy();
    }
  });

  it('shows the turn count for a case', async () => {
    render(<CasesScreen onSelect={jest.fn()} />);
    const first = listCases()[0];
    await waitFor(() => {
      expect(screen.getByTestId(`case-count-${first.id}`)).toHaveTextContent(
        String(first.conversation.length),
      );
    });
  });

  it('calls onSelect with the case id on press', async () => {
    const onSelect = jest.fn();
    render(<CasesScreen onSelect={onSelect} />);
    const first = listCases()[0];
    await waitFor(() => expect(screen.getByTestId(`case-${first.id}`)).toBeTruthy());
    fireEvent.press(screen.getByTestId(`case-${first.id}`));
    expect(onSelect).toHaveBeenCalledWith(first.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/ui/__tests__/CasesScreen.test.tsx`
Expected: FAIL — cannot find module `../CasesScreen`.

- [ ] **Step 3: Write the screen**

Create `src/ui/CasesScreen.tsx`. Group by product, render an icon from `FUNDS_FINANCE_CATEGORIES` (fall back to `💼`), a section header from `strings.cases.productLabel`, then a pressable row per case:

```tsx
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { casesByProduct, type Product } from '../cases/cases';
import { FUNDS_FINANCE_CATEGORIES } from '../content/series';
import { useStrings } from '../strings';
import { getTheme } from './theme';

function iconFor(product: Product): string {
  return FUNDS_FINANCE_CATEGORIES.find((c) => c.id === product)?.icon ?? '💼';
}

export function CasesScreen({ onSelect }: { onSelect: (caseId: string) => void }) {
  const strings = useStrings();
  const theme = getTheme();
  const groups = casesByProduct();

  return (
    <ScrollView style={[styles.root, { backgroundColor: theme.bg }]} contentContainerStyle={styles.content}>
      {groups.map((group) => (
        <View key={group.product} style={styles.group}>
          <Text style={[styles.groupLabel, { color: theme.accentGold }]}>
            {iconFor(group.product)} {strings.cases.productLabel(group.product)}
          </Text>
          {group.cases.map((c) => (
            <Pressable
              key={c.id}
              testID={`case-${c.id}`}
              onPress={() => onSelect(c.id)}
              style={[styles.row, { borderColor: theme.cardBorder }]}
            >
              <Text style={[styles.title, { color: theme.textPrimary }]}>{c.title}</Text>
              <Text style={[styles.credit, { color: theme.textMuted }]}>{c.credit}</Text>
              <Text testID={`case-count-${c.id}`} style={[styles.count, { color: theme.textMuted }]}>
                {strings.cases.turnCounter(c.conversation.length, c.conversation.length)}
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
  title: { fontSize: 16, fontWeight: '600' },
  credit: { fontSize: 12, marginTop: 4 },
  count: { fontSize: 12, marginTop: 6 },
});
```

Note: the `count` testID node renders the raw turn count as its text (the assertion uses `toHaveTextContent(String(length))`, which matches the number inside `"N / N"`). Use `getTheme()` keys that actually exist — before writing, confirm `theme.bg`/`theme.textPrimary`/`theme.textMuted`/`theme.accentGold`/`theme.cardBorder` against `src/ui/theme.ts` (`ThemeColors`), and substitute the real key names if they differ.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/ui/__tests__/CasesScreen.test.tsx`
Expected: PASS (all 3).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/ui/CasesScreen.tsx src/ui/__tests__/CasesScreen.test.tsx
git commit -m "feat(cases): case-list screen grouped by product"
```

---

## Task 6: Case game screen (sheet intro → conversation → approval)

**Files:**
- Create: `src/ui/CaseGameScreen.tsx`
- Test: `src/ui/__tests__/CaseGameScreen.test.tsx`

**Interfaces:**
- Consumes: `getCase`, `LoanCase`, `SheetGroup` from `src/cases/cases.ts`; the reducer functions from `src/cases/reducer.ts`; `useStrings`; `getTheme`.
- Produces: `export function CaseGameScreen({ caseId, onExit }: { caseId: string; onExit: () => void })`.
  - testIDs: `case-start` (start button), `case-guess-input` (TextInput), `case-reveal` (reveal button), `case-next` (advance button), `case-real-line` (the revealed real line), `case-your-guess` (the kept guess), `case-approved` (end stamp), `case-again`, `case-back`, `case-memo-toggle`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/__tests__/CaseGameScreen.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { listCases } from '../../cases/cases';
import { CaseGameScreen } from '../CaseGameScreen';

const CASE = listCases()[0];

function renderGame(onExit = jest.fn()) {
  render(<CaseGameScreen caseId={CASE.id} onExit={onExit} />);
}

describe('CaseGameScreen', () => {
  it('shows the sheet intro first, then starts the conversation', async () => {
    renderGame();
    // a sheet value is visible before starting
    expect(screen.getByText(CASE.sheet[0].value)).toBeTruthy();
    fireEvent.press(screen.getByTestId('case-start'));
    await waitFor(() => expect(screen.getByTestId('case-guess-input')).toBeTruthy());
    // first speaker shown, real line NOT yet shown
    expect(screen.getByText(CASE.conversation[0].speaker)).toBeTruthy();
    expect(screen.queryByTestId('case-real-line')).toBeNull();
  });

  it('reveals the real line and keeps the typed guess', async () => {
    renderGame();
    fireEvent.press(screen.getByTestId('case-start'));
    await waitFor(() => screen.getByTestId('case-guess-input'));
    fireEvent.changeText(screen.getByTestId('case-guess-input'), 'my guess');
    fireEvent.press(screen.getByTestId('case-reveal'));
    expect(screen.getByTestId('case-real-line')).toHaveTextContent(CASE.conversation[0].line);
    expect(screen.getByTestId('case-your-guess')).toHaveTextContent('my guess');
  });

  it('advances to the CRO approval stamp after the last turn', async () => {
    renderGame();
    fireEvent.press(screen.getByTestId('case-start'));
    await waitFor(() => screen.getByTestId('case-guess-input'));
    for (let i = 0; i < CASE.conversation.length; i++) {
      fireEvent.press(screen.getByTestId('case-reveal'));
      fireEvent.press(screen.getByTestId('case-next'));
    }
    await waitFor(() => expect(screen.getByTestId('case-approved')).toBeTruthy());
  });

  it('exits from the end card via back', async () => {
    const onExit = jest.fn();
    renderGame(onExit);
    fireEvent.press(screen.getByTestId('case-start'));
    await waitFor(() => screen.getByTestId('case-guess-input'));
    for (let i = 0; i < CASE.conversation.length; i++) {
      fireEvent.press(screen.getByTestId('case-reveal'));
      fireEvent.press(screen.getByTestId('case-next'));
    }
    await waitFor(() => screen.getByTestId('case-back'));
    fireEvent.press(screen.getByTestId('case-back'));
    expect(onExit).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/ui/__tests__/CaseGameScreen.test.tsx`
Expected: FAIL — cannot find module `../CaseGameScreen`.

- [ ] **Step 3: Write the screen**

Create `src/ui/CaseGameScreen.tsx`. Hold reducer state in `useState<GameState>`, render by phase. Keep the component thin — all transitions go through the reducer.

```tsx
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { getCase, type SheetGroup } from '../cases/cases';
import {
  advance,
  currentTurn,
  initState,
  reveal,
  replay,
  setGuess,
  startConversation,
  type GameState,
} from '../cases/reducer';
import { useStrings } from '../strings';
import { getTheme } from './theme';

const GROUP_ORDER: SheetGroup[] = ['terms', 'collateral', 'investors', 'legal', 'risk'];

export function CaseGameScreen({ caseId, onExit }: { caseId: string; onExit: () => void }) {
  const strings = useStrings();
  const theme = getTheme();
  const loanCase = getCase(caseId);
  const [state, setState] = useState<GameState>(initState());
  const [memoOpen, setMemoOpen] = useState(false);

  if (!loanCase) {
    return (
      <View style={[styles.root, { backgroundColor: theme.bg }]}>
        <Pressable testID="case-back" onPress={onExit}>
          <Text style={{ color: theme.textPrimary }}>{strings.cases.backToList}</Text>
        </Pressable>
      </View>
    );
  }

  const total = loanCase.conversation.length;
  const turn = currentTurn(loanCase, state);
  const priorTurns = loanCase.conversation.slice(0, state.turnIndex);

  const Sheet = () => (
    <View>
      {GROUP_ORDER.map((g) => {
        const fields = loanCase.sheet.filter((f) => f.group === g);
        if (fields.length === 0) return null;
        return (
          <View key={g} style={styles.sheetGroup}>
            <Text style={[styles.sheetGroupLabel, { color: theme.accentGold }]}>{g}</Text>
            {fields.map((f, i) => (
              <View key={i} style={styles.sheetRow}>
                <Text style={[styles.sheetLabel, { color: theme.textMuted }]}>{f.label}</Text>
                <Text style={[styles.sheetValue, { color: theme.textPrimary }]}>{f.value}</Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );

  return (
    <ScrollView style={[styles.root, { backgroundColor: theme.bg }]} contentContainerStyle={styles.content}>
      {state.phase === 'sheet' && (
        <>
          <Text style={[styles.title, { color: theme.textPrimary }]}>{loanCase.title}</Text>
          <Text style={[styles.credit, { color: theme.textMuted }]}>{loanCase.credit}</Text>
          <Sheet />
          <Pressable
            testID="case-start"
            onPress={() => setState(startConversation(state))}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.cases.start}</Text>
          </Pressable>
        </>
      )}

      {state.phase === 'conversation' && turn && (
        <>
          {/* peek panel */}
          <Pressable testID="case-memo-toggle" onPress={() => setMemoOpen((o) => !o)}>
            <Text style={[styles.memoToggle, { color: theme.accentGold }]}>{strings.cases.memo}</Text>
          </Pressable>
          {memoOpen && <Sheet />}

          {/* conversation so far */}
          {priorTurns.map((t, i) => (
            <View key={i} style={styles.priorTurn}>
              <Text style={[styles.speaker, { color: theme.textMuted }]}>{t.speaker}</Text>
              <Text style={[styles.priorLine, { color: theme.textPrimary }]}>{t.line}</Text>
            </View>
          ))}

          {/* current turn */}
          <Text style={[styles.turnCounter, { color: theme.textMuted }]}>
            {strings.cases.turnCounter(state.turnIndex + 1, total)}
          </Text>
          <Text style={[styles.speaker, { color: theme.accentGold }]}>{turn.speaker}</Text>

          <TextInput
            testID="case-guess-input"
            value={state.guess}
            onChangeText={(text) => setState(setGuess(state, text))}
            placeholder={strings.cases.guessPlaceholder}
            placeholderTextColor={theme.textMuted}
            editable={!state.revealed}
            multiline
            style={[styles.input, { color: theme.textPrimary, borderColor: theme.cardBorder }]}
          />

          {!state.revealed ? (
            <Pressable
              testID="case-reveal"
              onPress={() => setState(reveal(state))}
              style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
            >
              <Text style={styles.primaryBtnText}>{strings.cases.reveal}</Text>
            </Pressable>
          ) : (
            <>
              {state.guess.trim() !== '' && (
                <View style={styles.revealBlock}>
                  <Text style={[styles.revealLabel, { color: theme.textMuted }]}>{strings.cases.yourGuess}</Text>
                  <Text testID="case-your-guess" style={[styles.guessLine, { color: theme.textMuted }]}>
                    {state.guess}
                  </Text>
                </View>
              )}
              <View style={styles.revealBlock}>
                <Text testID="case-real-line" style={[styles.realLine, { color: theme.textPrimary }]}>
                  {turn.line}
                </Text>
                {turn.note && <Text style={[styles.note, { color: theme.textMuted }]}>{turn.note}</Text>}
              </View>
              <Pressable
                testID="case-next"
                onPress={() => setState(advance(state, total))}
                style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
              >
                <Text style={styles.primaryBtnText}>{strings.cases.next}</Text>
              </Pressable>
            </>
          )}
        </>
      )}

      {state.phase === 'done' && (
        <View style={styles.endCard}>
          <Text testID="case-approved" style={[styles.approved, { color: theme.accentGold }]}>
            {strings.cases.approved}
          </Text>
          <Pressable
            testID="case-again"
            onPress={() => setState(replay())}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.cases.again}</Text>
          </Pressable>
          <Pressable testID="case-back" onPress={onExit} style={styles.secondaryBtn}>
            <Text style={[styles.secondaryBtnText, { color: theme.textPrimary }]}>{strings.cases.backToList}</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16 },
  title: { fontSize: 18, fontWeight: 'bold' },
  credit: { fontSize: 12, marginTop: 4, marginBottom: 12 },
  sheetGroup: { marginBottom: 14 },
  sheetGroupLabel: { fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 6 },
  sheetRow: { marginBottom: 6 },
  sheetLabel: { fontSize: 11 },
  sheetValue: { fontSize: 14 },
  primaryBtn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { color: '#050810', fontWeight: 'bold', fontSize: 15 },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  secondaryBtnText: { fontSize: 14 },
  memoToggle: { fontSize: 12, fontWeight: '600', marginBottom: 8 },
  priorTurn: { marginBottom: 10, opacity: 0.7 },
  speaker: { fontSize: 12, fontWeight: '600', marginBottom: 2 },
  priorLine: { fontSize: 14 },
  turnCounter: { fontSize: 11, marginTop: 12 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 48, marginTop: 6, fontSize: 14 },
  revealBlock: { marginTop: 12 },
  revealLabel: { fontSize: 11, marginBottom: 2 },
  guessLine: { fontSize: 14, fontStyle: 'italic' },
  realLine: { fontSize: 15, fontWeight: '500' },
  note: { fontSize: 12, marginTop: 6 },
  endCard: { alignItems: 'center', paddingTop: 40 },
  approved: { fontSize: 28, fontWeight: 'bold', letterSpacing: 4 },
});
```

Note: confirm the `ThemeColors` key names in `src/ui/theme.ts` and substitute if `bg`/`text`/`muted`/`accent`/`border` differ. `primaryBtnText` uses the app's root bg color `#050810` for contrast on the accent button — matches `App.tsx`'s root style.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/ui/__tests__/CaseGameScreen.test.tsx`
Expected: PASS (all 4).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/ui/CaseGameScreen.tsx src/ui/__tests__/CaseGameScreen.test.tsx
git commit -m "feat(cases): case game screen — sheet intro, guess/reveal turns, approval"
```

---

## Task 7: Wire the 4th tab into App.tsx

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `CasesScreen` (Task 5), `CaseGameScreen` (Task 6).
- Produces: two new `Screen` states and the 4th nav tab. No exported signatures.

- [ ] **Step 1: Add imports**

In `App.tsx`, add near the other UI imports:

```tsx
import { CasesScreen } from './src/ui/CasesScreen';
import { CaseGameScreen } from './src/ui/CaseGameScreen';
```

- [ ] **Step 2: Extend the `Screen` union**

Add two members:

```tsx
  | { name: 'cases' }
  | { name: 'case-game'; caseId: string }
```

- [ ] **Step 3: Update `activeTab` and `showBottomBar`**

```tsx
  const activeTab =
    screen.name === 'questions' ? 'questions'
    : screen.name === 'settings' ? 'settings'
    : screen.name === 'cases' ? 'cases'
    : 'series';
  const showBottomBar =
    screen.name === 'series' ||
    screen.name === 'questions' ||
    screen.name === 'settings' ||
    screen.name === 'cases';
```

- [ ] **Step 4: Render the two new screens**

Add alongside the other `screen.name === ...` blocks:

```tsx
        {screen.name === 'cases' && (
          <CasesScreen onSelect={(caseId) => setScreen({ name: 'case-game', caseId })} />
        )}

        {screen.name === 'case-game' && (
          <CaseGameScreen
            caseId={screen.caseId}
            onExit={() => setScreen({ name: 'cases' })}
          />
        )}
```

- [ ] **Step 5: Add the 4th nav button**

In the bottom-nav `View`, add a button (before or after 作成 — place it after 教材 so cases sit next to decks):

```tsx
          <Pressable
            onPress={() => setScreen({ name: 'cases' })}
            style={[styles.navBtn, activeTab === 'cases' && styles.navBtnActive]}
          >
            <Text style={styles.navIcon}>💼</Text>
            <Text style={[styles.navLabel, activeTab === 'cases' && styles.navLabelActive]}>
              {strings.cases.tab}
            </Text>
          </Pressable>
```

Note: `App.tsx` currently has no `useStrings()` call. Either add `const strings = useStrings();` inside `App()` (import it: `import { useStrings } from './src/strings';`) and use `strings.cases.tab`, OR hardcode the label `案件` to match the other hardcoded nav labels (教材/作成/設定 are literals today). Match the existing style — the other three labels are hardcoded Japanese literals, so hardcoding `案件` is the consistent choice; skip the `useStrings` wiring in `App.tsx` if so.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all suites pass (the existing ~24 suites plus the 4 new ones).

- [ ] **Step 8: Commit**

```bash
git add App.tsx
git commit -m "feat(cases): add 案件 as the 4th bottom-nav tab"
```

---

## Task 8: Bundle check and manual smoke

**Files:** none (verification only).

- [ ] **Step 1: iOS + web bundle check**

Run: `npm run check:bundle`
Expected: both the iOS and web exports complete. (No new deps were added, so this should pass; per CONTEXT.md, run it once regardless because "tests + types pass but the iOS bundle fails" is a real failure mode.)

- [ ] **Step 2: Browser smoke**

Run: `npx expo start --web`, open the app, tap the 案件 tab. Verify:
- The case list shows both cases grouped by product.
- Opening a case shows the sheet intro with all five group sections.
- Start → type a guess → めくる reveals the real line with your guess kept above it → 次へ advances.
- The 案件メモ toggle re-shows the sheet during turns.
- The last turn leads to the 承認 end card; もう一度 restarts, 案件一覧へ returns to the list.

Since this touches no audio/TTS, the fake-TTS blind spot (CONTEXT.md pitfall #2) does not apply — but confirm visually anyway.

- [ ] **Step 3: Final commit (if any tweaks)**

```bash
git add -A
git commit -m "chore(cases): bundle-check and smoke fixes"
```

---

## Self-Review

**Spec coverage:**
- 4th nav tab 案件 → Task 7. ✓
- Two screens (list, game) → Tasks 5, 6. ✓
- Data model with five groups + four products → Task 1 types, Task 2 content. ✓
- Product-adaptive sheet (flat `{label,value,group}` list) → Task 1 `SheetField`, Task 6 `GROUP_ORDER` sectioning. ✓
- Sheet-first-then-peekable → Task 6 (`sheet` phase card + `case-memo-toggle` panel). ✓
- Every-line-all-speakers, guess each turn → Task 6 renders every `conversation[i]` regardless of `speaker`. ✓
- Reveal + self-compare, no scoring → Task 3 reducer (no score field), Task 6 keeps guess (`case-your-guess`) next to real line (`case-real-line`). ✓
- Two taps (めくる → 次へ) → Task 6 reveal/next buttons; reducer `advance` requires `revealed`. ✓
- CRO approval end card + replay/back → Task 3 `done` phase, Task 6 end card. ✓
- Isolation from engine/judge/speech/store → no task imports them; reducer is pure. ✓
- No new deps → nothing installed; Task 8 confirms via `check:bundle`. ✓
- JA-first content, no en/harness → Task 2 authors JA only; deferred noted in spec. ✓
- Content invariants kept honest by tests → Task 1 tests are the gate for Task 2. ✓

**Placeholder scan:** No TBD/TODO; every code step has real code. The two "confirm theme key names" notes are guardrails against a mismatch with `src/ui/theme.ts`, not placeholders — the code compiles as written if the keys match; the executor substitutes real names otherwise.

**Type consistency:** `LoanCase`/`SheetField`/`Turn`/`Product`/`SheetGroup` defined in Task 1 and reused unchanged in Tasks 2/3/5/6. Reducer signatures in Task 3 (`initState`, `startConversation`, `setGuess`, `reveal`, `advance`, `replay`, `currentTurn`, `GameState`) match their use in Task 6. `strings.cases.*` keys defined in Task 4 match every use in Tasks 5/6/7. testIDs are consistent between each screen and its test.
