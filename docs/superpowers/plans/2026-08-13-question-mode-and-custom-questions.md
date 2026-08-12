# Question-Only Mode and Custom Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a question-only mode (no grid, verbal N-back alone) and let the owner author their own questions, choosing per round whether to draw from the built-in bank, their own, or both.

**Architecture:** Question-only mode is not a new code path — it makes `RoundEngine.positionScore` nullable, mirroring `answerScore`, so the existing null-channel fallback in `roundScore` handles it with no branch. Custom questions are a second `Question[]` in storage, merged with the built-ins by one pure `resolvePool` function that owns the "fewer than 9" problem in a single testable place.

**Tech Stack:** Expo (React Native) + TypeScript, Jest via `jest-expo`, `@testing-library/react-native`, AsyncStorage.

**Spec:** `docs/superpowers/specs/2026-08-13-question-mode-and-custom-questions-design.md`

## Global Constraints

- **`src/engine/`, `src/judge/`, `src/content/` must not import React, React Native, or any `expo-*` package.** `src/__tests__/boundaries.test.ts` enforces this — it will fail the build if violated.
- Language is `ja-JP`; all user-facing strings are Japanese.
- **未判定 answers are never counted wrong** — excluded from both numerator and denominator of the answer score.
- Round shape is unchanged: 9 stimuli + N trailing recall-only steps, exactly 9 scored responses, in both modes.
- Adaptive N: start 2, floor 1, no ceiling. **When there is no round score at all, N is left unchanged.**
- `tier: 0` marks a custom question. **The `maxTier` difficulty filter applies only to built-ins**; custom questions are never tier-filtered.
- A round needs **9** distinct questions (`STIMULI_PER_ROUND`).
- `npx tsc --noEmit` must exit 0 repo-wide, and the existing 140 tests must keep passing.
- Every task ends with a passing test run and a commit. Commit with explicit paths, never `git add -A`.

---

### Task 1: Nullable score channels and round mode

Makes `positionScore` symmetric with `answerScore` so question-only mode needs no special case in scoring.

**Files:**
- Modify: `src/engine/types.ts`
- Modify: `src/engine/sequence.ts`
- Modify: `src/engine/round.ts`
- Test: `src/engine/__tests__/round.test.ts`
- Test: `src/engine/__tests__/sequence.test.ts`

**Interfaces:**
- Consumes: `nextN(roundScore: number, currentN: number): number` from `src/engine/adaptive.ts`; `STIMULI_PER_ROUND` from `src/engine/sequence.ts`
- Produces:
  - `type RoundMode = 'dual' | 'question'`
  - `RoundPlan` gains `mode: RoundMode`
  - `buildRound(n, bank, rng?, mode?)` — `mode` defaults to `'dual'`
  - `RoundEngine.positionScore: number | null`
  - `RoundEngine.roundScore: number | null`
  - `RoundEngine.nextN(currentN)` returns `currentN` unchanged when `roundScore` is null

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/__tests__/round.test.ts`:

```ts
describe('RoundEngine in question mode', () => {
  function questionPlan(n = 2) {
    return buildRound(n, BANK, Math.random, 'question');
  }

  it('reports no position channel', () => {
    const p = questionPlan();
    const engine = new RoundEngine(p);
    for (const step of p.steps) {
      engine.submitStep(step.index, { tap: null, transcript: 'こたえ' });
    }
    expect(engine.positionScore).toBeNull();
  });

  it('scores the round on the answer channel alone', () => {
    const p = questionPlan();
    const engine = new RoundEngine(p);
    for (const step of p.steps) {
      engine.submitStep(step.index, { tap: null, transcript: 'こたえ' });
    }
    const pending = engine.takePending();
    pending.forEach((a, i) => engine.resolveAnswer(a.index, i < 6));
    // 6 of 9 correct; the position channel must not dilute it.
    expect(engine.answerScore).toBeCloseTo(6 / 9);
    expect(engine.roundScore).toBeCloseTo(6 / 9);
  });

  it('ignores taps entirely', () => {
    const p = questionPlan();
    const engine = new RoundEngine(p);
    for (const step of p.steps) {
      engine.submitStep(step.index, { tap: 4, transcript: null });
    }
    expect(engine.positionScore).toBeNull();
    expect(engine.roundScore).toBeNull();
  });

  it('has no round score when both channels are absent', () => {
    const p = questionPlan();
    const engine = new RoundEngine(p);
    for (const step of p.steps) {
      engine.submitStep(step.index, { tap: null, transcript: 'こたえ' });
    }
    // Nothing resolved: answers all 未判定, position absent by mode.
    expect(engine.roundScore).toBeNull();
    expect(engine.unresolvedCount).toBe(9);
  });

  it('leaves N unchanged when there is no round score', () => {
    const p = questionPlan();
    const engine = new RoundEngine(p);
    expect(engine.nextN(3)).toBe(3);
  });

  it('still adapts N from the answer channel alone', () => {
    const p = questionPlan();
    const engine = new RoundEngine(p);
    for (const step of p.steps) {
      engine.submitStep(step.index, { tap: null, transcript: 'こたえ' });
    }
    for (const a of engine.takePending()) engine.resolveAnswer(a.index, true);
    expect(engine.roundScore).toBe(1);
    expect(engine.nextN(2)).toBe(3);
  });
});

describe('RoundEngine in dual mode (unchanged)', () => {
  it('still returns a number for the position channel', () => {
    const p = buildRound(2, BANK, Math.random);
    const engine = new RoundEngine(p);
    expect(engine.positionScore).toBe(0);
    expect(p.mode).toBe('dual');
  });
});
```

Append to `src/engine/__tests__/sequence.test.ts`:

```ts
describe('buildRound mode', () => {
  it('defaults to dual and emits positions', () => {
    const { mode, steps } = buildRound(2, BANK, Math.random);
    expect(mode).toBe('dual');
    expect(steps[0].position).not.toBeNull();
  });

  it('emits no positions at all in question mode', () => {
    const { mode, steps } = buildRound(2, BANK, Math.random, 'question');
    expect(mode).toBe('question');
    for (const step of steps) expect(step.position).toBeNull();
  });

  it('keeps the round shape and question sampling in question mode', () => {
    const { steps } = buildRound(3, BANK, Math.random, 'question');
    expect(steps).toHaveLength(12);
    expect(steps.filter((s) => s.recallTarget !== null)).toHaveLength(9);
    const ids = steps.slice(0, 9).map((s) => s.question!.id);
    expect(new Set(ids).size).toBe(9);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- round sequence`
Expected: FAIL — `buildRound` takes no 4th argument, `mode` is not on `RoundPlan`, `positionScore` is not null.

- [ ] **Step 3: Add the mode type**

In `src/engine/types.ts`, add above `RoundPlan`:

```ts
/** 'dual' scores position and answer; 'question' drops the visual channel. */
export type RoundMode = 'dual' | 'question';
```

and add the field to `RoundPlan`:

```ts
export interface RoundPlan {
  n: number;
  mode: RoundMode;
  steps: StepPlan[];
}
```

- [ ] **Step 4: Thread the mode through `buildRound`**

In `src/engine/sequence.ts`, change the import to include `RoundMode`, then:

```ts
export function buildRound(
  n: number,
  bank: Question[],
  rng: Rng = Math.random,
  mode: RoundMode = 'dual',
): RoundPlan {
```

Inside the stimulus branch, gate the position draw:

```ts
    if (isStimulus) {
      // In question mode the grid does not exist, so no position is drawn —
      // this also means the rng is consumed differently between modes.
      position = mode === 'dual' ? pickIndex(GRID_SIZE, rng) : null;
      question = pool.splice(pickIndex(pool.length, rng), 1)[0];
    }
```

and return the mode:

```ts
  return { n, mode, steps };
```

- [ ] **Step 5: Make the channels nullable in `RoundEngine`**

In `src/engine/round.ts`, replace `positionScore`, `roundScore`, and `nextN`:

```ts
  /** null in question mode — the visual channel is absent, not zero. */
  get positionScore(): number | null {
    if (this.plan.mode === 'question') return null;
    return this.correctTaps / STIMULI_PER_ROUND;
  }
```

```ts
  /** null when no channel has data — nothing to score, so nothing to adapt on. */
  get roundScore(): number | null {
    const channels = [this.positionScore, this.answerScore].filter(
      (channel): channel is number => channel !== null,
    );
    if (channels.length === 0) return null;
    return channels.reduce((sum, channel) => sum + channel, 0) / channels.length;
  }

  nextN(currentN: number): number {
    const score = this.roundScore;
    if (score === null) return currentN;
    return adaptiveNextN(score, currentN);
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- round sequence`
Expected: PASS. The pre-existing dual-mode tests must still pass unchanged — dual mode returns numbers exactly as before.

- [ ] **Step 7: Run the whole suite and typecheck**

```bash
cd /mnt/c/Projects/nback-voice
npm test
npx tsc --noEmit
```

Expected: all tests pass. Typecheck may now flag `RoundRecord.positionScore` in `src/ui/GameScreen.tsx` — that field widens in Task 3. If it does, note it and continue; do not widen `RoundRecord` here, and do not paper over it with a cast.

- [ ] **Step 8: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add src/engine/types.ts src/engine/sequence.ts src/engine/round.ts src/engine/__tests__/round.test.ts src/engine/__tests__/sequence.test.ts
git commit -m "feat(engine): 質問のみモード — positionScoreをanswerScoreと対称にnullableへ"
```

---

### Task 2: `resolvePool` and learned-synonym merging

One pure function owns pool selection and the fewer-than-9 problem.

**Files:**
- Create: `src/content/pool.ts`
- Modify: `src/content/bank.ts`
- Test: `src/content/__tests__/pool.test.ts`

**Interfaces:**
- Consumes: `Question` from `src/engine/types`; `STIMULI_PER_ROUND` from `src/engine/sequence`
- Produces:
  - `type QuestionSource = 'builtin' | 'custom' | 'both'`
  - `const MIN_QUESTIONS: number` (= 9)
  - `resolvePool(source, builtin, custom, maxTier): Question[]`
  - `mergeLearned(questions: Question[], learned: Record<string, string[]>): Question[]` exported from `src/content/bank.ts`

- [ ] **Step 1: Write the failing test**

Create `src/content/__tests__/pool.test.ts`:

```ts
import { MIN_QUESTIONS, resolvePool } from '../pool';
import type { Question } from '../../engine/types';

const BUILTIN: Question[] = [
  { id: 'b1', tier: 1, q: 'やさしい1', accept: ['a'] },
  { id: 'b2', tier: 1, q: 'やさしい2', accept: ['a'] },
  { id: 'b3', tier: 2, q: 'ふつう1', accept: ['a'] },
];

const CUSTOM: Question[] = [
  { id: 'user_1', tier: 0, q: '自作1', accept: ['a'] },
  { id: 'user_2', tier: 0, q: '自作2', accept: ['a'] },
];

describe('resolvePool', () => {
  it('returns tier-filtered built-ins for "builtin"', () => {
    expect(resolvePool('builtin', BUILTIN, CUSTOM, 1).map((q) => q.id)).toEqual([
      'b1',
      'b2',
    ]);
  });

  it('includes higher tiers when maxTier allows', () => {
    expect(resolvePool('builtin', BUILTIN, CUSTOM, 2)).toHaveLength(3);
  });

  it('returns only custom questions for "custom"', () => {
    expect(resolvePool('custom', BUILTIN, CUSTOM, 2).map((q) => q.id)).toEqual([
      'user_1',
      'user_2',
    ]);
  });

  it('never tier-filters custom questions, even at the lowest tier', () => {
    // Custom questions carry tier 0 and must survive any maxTier setting.
    expect(resolvePool('custom', BUILTIN, CUSTOM, 1)).toHaveLength(2);
  });

  it('merges both, with built-ins still tier-filtered', () => {
    const ids = resolvePool('both', BUILTIN, CUSTOM, 1).map((q) => q.id);
    expect(ids).toEqual(['b1', 'b2', 'user_1', 'user_2']);
  });

  it('returns an empty pool rather than throwing when there are no custom questions', () => {
    expect(resolvePool('custom', BUILTIN, [], 2)).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const custom = [...CUSTOM];
    resolvePool('both', BUILTIN, custom, 2).push({
      id: 'x',
      tier: 0,
      q: 'x',
      accept: [],
    });
    expect(custom).toHaveLength(2);
    expect(BUILTIN).toHaveLength(3);
  });
});

describe('MIN_QUESTIONS', () => {
  it('is the number of stimuli in a round', () => {
    // Both the settings guard and GameScreen's re-check compare against this,
    // so it must track STIMULI_PER_ROUND rather than being its own literal.
    expect(MIN_QUESTIONS).toBe(9);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- pool`
Expected: FAIL — `Cannot find module '../pool'`

- [ ] **Step 3: Write the pool module**

Create `src/content/pool.ts`:

```ts
import { STIMULI_PER_ROUND } from '../engine/sequence';
import type { Question } from '../engine/types';

export type QuestionSource = 'builtin' | 'custom' | 'both';

/** A round draws 9 distinct questions, so a pool below this is unusable. */
export const MIN_QUESTIONS = STIMULI_PER_ROUND;

/**
 * The questions a round may draw from. The difficulty filter applies only to
 * built-ins: custom questions are the owner's own, and the app has no basis
 * for rating their difficulty.
 */
export function resolvePool(
  source: QuestionSource,
  builtin: Question[],
  custom: Question[],
  maxTier: number,
): Question[] {
  const tiered = builtin.filter((q) => q.tier <= maxTier);
  switch (source) {
    case 'builtin':
      return tiered;
    case 'custom':
      return [...custom];
    case 'both':
      return [...tiered, ...custom];
  }
}

```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- pool`
Expected: PASS, 8 tests

- [ ] **Step 5: Extract `mergeLearned` so custom questions learn too**

`loadBank` currently merges learned synonyms into the built-ins only. Custom questions need the same treatment, so extract the merge. Replace `src/content/bank.ts` with:

```ts
import type { Question } from '../engine/types';
import raw from './bank.json';

const SHIPPED = raw as Question[];

/**
 * Overlay runtime-learned synonyms onto a question list. Learning is stored
 * separately and keyed by question id, so a bank update never discards it and
 * custom questions accumulate synonyms the same way built-ins do.
 */
export function mergeLearned(
  questions: Question[],
  learned: Record<string, string[]> = {},
): Question[] {
  return questions.map((q) => {
    const extra = learned[q.id];
    if (!extra || extra.length === 0) return q;
    return { ...q, accept: [...new Set([...q.accept, ...extra])] };
  });
}

/** The shipped bank with learned synonyms merged over it. */
export function loadBank(learned: Record<string, string[]> = {}): Question[] {
  return mergeLearned(SHIPPED, learned);
}
```

- [ ] **Step 6: Run the whole suite and typecheck**

```bash
cd /mnt/c/Projects/nback-voice
npm test
npx tsc --noEmit
```

Expected: all tests pass — the existing `loadBank` tests exercise the same behaviour through the new helper. The boundaries test must still pass: `pool.ts` imports only from `src/engine/`.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add src/content/pool.ts src/content/bank.ts src/content/__tests__/pool.test.ts
git commit -m "feat(content): 出題プールの解決 (内蔵/自作/両方) と学習同義語のマージ共通化"
```

---

### Task 3: Storage — new settings and custom-question CRUD

**Files:**
- Modify: `src/store/storage.ts`
- Test: `src/store/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: `RoundMode` from `src/engine/types`; `QuestionSource` from `src/content/pool`; `Question` from `src/engine/types`
- Produces:
  - `Settings` gains `mode: RoundMode` (default `'dual'`) and `questionSource: QuestionSource` (default `'builtin'`)
  - `RoundRecord.positionScore: number | null`
  - `loadCustom(): Promise<Question[]>`
  - `addCustom(q: string, answer: string): Promise<Question>`
  - `updateCustom(id: string, q: string, answer: string): Promise<void>`
  - `deleteCustom(id: string): Promise<void>`
  - `clearLearned(questionId: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/storage.test.ts`:

```ts
import {
  addCustom,
  addLearned,
  clearLearned,
  deleteCustom,
  loadCustom,
  updateCustom,
} from '../storage';

describe('settings defaults for the new fields', () => {
  it('defaults to dual mode and the built-in bank', async () => {
    const s = await loadSettings();
    expect(s.mode).toBe('dual');
    expect(s.questionSource).toBe('builtin');
  });

  it('still fills missing new keys from an older stored shape', async () => {
    await AsyncStorage.setItem(
      'nback.settings',
      JSON.stringify({ stepDurationMs: 4000 }),
    );
    const s = await loadSettings();
    expect(s.stepDurationMs).toBe(4000);
    expect(s.mode).toBe('dual');
    expect(s.questionSource).toBe('builtin');
  });
});

describe('custom questions', () => {
  it('starts empty', async () => {
    expect(await loadCustom()).toEqual([]);
  });

  it('adds a question with tier 0 and the single answer', async () => {
    const created = await addCustom('犬の鳴き声は？', 'わん');
    expect(created).toMatchObject({
      tier: 0,
      q: '犬の鳴き声は？',
      accept: ['わん'],
    });
    expect(await loadCustom()).toHaveLength(1);
  });

  it('never reuses an id, even after a delete', async () => {
    const first = await addCustom('一問目', 'あ');
    await deleteCustom(first.id);
    const second = await addCustom('二問目', 'い');
    expect(second.id).not.toBe(first.id);
  });

  it('updates both fields in place', async () => {
    const created = await addCustom('元の問題', 'もと');
    await updateCustom(created.id, '新しい問題', 'あたらしい');
    const [stored] = await loadCustom();
    expect(stored).toMatchObject({
      id: created.id,
      q: '新しい問題',
      accept: ['あたらしい'],
    });
  });

  it('deletes only the named question', async () => {
    const a = await addCustom('残る', 'あ');
    const b = await addCustom('消える', 'い');
    await deleteCustom(b.id);
    expect((await loadCustom()).map((q) => q.id)).toEqual([a.id]);
  });
});

describe('learned synonyms follow the question', () => {
  it('drops learned synonyms when a question is edited', async () => {
    const created = await addCustom('犬の鳴き声は？', 'わん');
    await addLearned(created.id, 'ワンワン');
    await updateCustom(created.id, '猫の鳴き声は？', 'にゃー');
    expect(await loadLearned()).toEqual({});
  });

  it('drops learned synonyms when a question is deleted', async () => {
    const created = await addCustom('犬の鳴き声は？', 'わん');
    await addLearned(created.id, 'ワンワン');
    await deleteCustom(created.id);
    expect(await loadLearned()).toEqual({});
  });

  it('leaves other questions untouched', async () => {
    const a = await addCustom('一問目', 'あ');
    const b = await addCustom('二問目', 'い');
    await addLearned(a.id, 'えー');
    await addLearned(b.id, 'びー');
    await deleteCustom(a.id);
    expect(await loadLearned()).toEqual({ [b.id]: ['びー'] });
  });

  it('serializes against concurrent learning so a clear cannot be undone', async () => {
    const created = await addCustom('問題', 'こたえ');
    // Both writes touch the same key; without the shared chain the add could
    // land after the clear and resurrect the synonym.
    await Promise.all([
      addLearned(created.id, 'べつかい'),
      clearLearned(created.id),
    ]);
    const learned = await loadLearned();
    expect(learned[created.id] ?? []).toEqual([]);
  });
});
```

Add the import of `loadLearned` to the existing import block at the top of the file if it is not already there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- storage`
Expected: FAIL — `addCustom` and the other new functions are not exported.

- [ ] **Step 3: Widen the types and add the new settings**

In `src/store/storage.ts`, add the imports at the top:

```ts
import type { QuestionSource } from '../content/pool';
import type { Question, RoundMode } from '../engine/types';
```

Extend `Settings`:

```ts
export interface Settings {
  /** Total step length in ms; split 40% phase A / 60% phase B. */
  stepDurationMs: number;
  adaptive: boolean;
  /** Used only when adaptive is false. */
  fixedN: number;
  /** Highest question tier to draw from. Built-ins only. */
  maxTier: number;
  /** 'dual' scores position and answer; 'question' drops the visual channel. */
  mode: RoundMode;
  /** Which questions a round draws from. */
  questionSource: QuestionSource;
}
```

Extend `DEFAULT_SETTINGS`:

```ts
export const DEFAULT_SETTINGS: Settings = {
  stepDurationMs: 5000,
  adaptive: true,
  fixedN: 2,
  maxTier: 2,
  mode: 'dual',
  questionSource: 'builtin',
};
```

Widen `RoundRecord` — null means the channel was absent, which is different from scoring zero:

```ts
export interface RoundRecord {
  date: string;
  n: number;
  /** null in question mode: the channel was absent, not scored zero. */
  positionScore: number | null;
  answerScore: number | null;
  unresolved: number;
}
```

- [ ] **Step 4: Add the custom-question store**

Add the keys alongside the existing ones:

```ts
const KEY_CUSTOM = 'nback.custom';
const KEY_CUSTOM_SEQ = 'nback.customSeq';
```

Then add, after `addLearned`:

```ts
async function clearLearnedNow(questionId: string): Promise<void> {
  const learned = await loadLearned();
  if (!(questionId in learned)) return;
  delete learned[questionId];
  await AsyncStorage.setItem(KEY_LEARNED, JSON.stringify(learned));
}

/**
 * Forget everything learned for one question. Goes through the same write
 * chain as addLearned — otherwise an in-flight learn could land afterwards
 * and resurrect a synonym the owner just invalidated.
 */
export function clearLearned(questionId: string): Promise<void> {
  const next = learnedWrites.then(() => clearLearnedNow(questionId));
  learnedWrites = next.catch(() => undefined);
  return next;
}

export async function loadCustom(): Promise<Question[]> {
  return readJson<Question[]>(KEY_CUSTOM, []);
}

/**
 * Ids come from a monotonic counter rather than the array length, so deleting
 * a question can never cause a later one to reuse its id — and with it, its
 * learned synonyms.
 */
export async function addCustom(q: string, answer: string): Promise<Question> {
  const seq = (await readJson<number>(KEY_CUSTOM_SEQ, 0)) + 1;
  const question: Question = {
    id: `user_${seq}`,
    tier: 0,
    q,
    accept: [answer],
  };
  const custom = await loadCustom();
  await AsyncStorage.setItem(KEY_CUSTOM, JSON.stringify([...custom, question]));
  await AsyncStorage.setItem(KEY_CUSTOM_SEQ, JSON.stringify(seq));
  return question;
}

/**
 * Editing either field invalidates phrasings Claude accepted against the old
 * pair, so the learned list is cleared and rebuilds itself from the next answer.
 */
export async function updateCustom(
  id: string,
  q: string,
  answer: string,
): Promise<void> {
  const custom = await loadCustom();
  const next = custom.map((item) =>
    item.id === id ? { ...item, q, accept: [answer] } : item,
  );
  await AsyncStorage.setItem(KEY_CUSTOM, JSON.stringify(next));
  await clearLearned(id);
}

export async function deleteCustom(id: string): Promise<void> {
  const custom = await loadCustom();
  await AsyncStorage.setItem(
    KEY_CUSTOM,
    JSON.stringify(custom.filter((item) => item.id !== id)),
  );
  await clearLearned(id);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- storage`
Expected: PASS, all storage tests including the 10 pre-existing ones

- [ ] **Step 6: Run the whole suite and typecheck**

```bash
cd /mnt/c/Projects/nback-voice
npm test
npx tsc --noEmit
```

Expected: both clean. `RoundRecord.positionScore` now accepts the nullable value `GameScreen` passes it, resolving anything Task 1 flagged.

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add src/store/storage.ts src/store/__tests__/storage.test.ts
git commit -m "feat(store): モード/出題元の設定と自作問題のCRUD (編集・削除で学習をクリア)"
```

---

### Task 4: Questions editor screen

**Files:**
- Create: `src/ui/QuestionsScreen.tsx`
- Test: `src/ui/__tests__/QuestionsScreen.test.tsx`

**Interfaces:**
- Consumes: `loadCustom`, `addCustom`, `updateCustom`, `deleteCustom` from `src/store/storage`
- Produces: `<QuestionsScreen onClose={() => void} />`

- [ ] **Step 1: Write the failing test**

Create `src/ui/__tests__/QuestionsScreen.test.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { addCustom, loadCustom } from '../../store/storage';
import { QuestionsScreen } from '../QuestionsScreen';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('QuestionsScreen', () => {
  it('shows a count of zero when there are no questions', async () => {
    const { findByText } = render(<QuestionsScreen onClose={() => {}} />);
    expect(await findByText(/0 問/)).toBeTruthy();
  });

  it('lists existing questions', async () => {
    await addCustom('犬の鳴き声は？', 'わん');
    const { findByText } = render(<QuestionsScreen onClose={() => {}} />);
    expect(await findByText('犬の鳴き声は？')).toBeTruthy();
  });

  it('adds a question and persists it', async () => {
    const { getByPlaceholderText, getByText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.changeText(getByPlaceholderText('問題'), '猫の鳴き声は？');
    fireEvent.changeText(getByPlaceholderText('答え'), 'にゃー');
    fireEvent.press(getByText('追加'));
    await waitFor(async () => {
      const stored = await loadCustom();
      expect(stored).toHaveLength(1);
      expect(stored[0].q).toBe('猫の鳴き声は？');
      expect(stored[0].accept).toEqual(['にゃー']);
    });
  });

  it('refuses to add when either field is empty', async () => {
    const { getByPlaceholderText, getByText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.changeText(getByPlaceholderText('問題'), '問題だけ');
    fireEvent.press(getByText('追加'));
    await waitFor(() => {});
    expect(await loadCustom()).toHaveLength(0);
  });

  it('clears the form after a successful add', async () => {
    const { getByPlaceholderText, getByText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.changeText(getByPlaceholderText('問題'), '猫の鳴き声は？');
    fireEvent.changeText(getByPlaceholderText('答え'), 'にゃー');
    fireEvent.press(getByText('追加'));
    await waitFor(() => {
      expect(getByPlaceholderText('問題').props.value).toBe('');
    });
  });

  it('edits an existing question', async () => {
    const created = await addCustom('元の問題', 'もと');
    const { findByText, getByPlaceholderText, getByText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    fireEvent.press(await findByText('元の問題'));
    fireEvent.changeText(getByPlaceholderText('問題'), '直した問題');
    fireEvent.changeText(getByPlaceholderText('答え'), 'なおした');
    fireEvent.press(getByText('保存'));
    await waitFor(async () => {
      const [stored] = await loadCustom();
      expect(stored.id).toBe(created.id);
      expect(stored.q).toBe('直した問題');
    });
  });

  it('deletes a question', async () => {
    await addCustom('消える問題', 'あ');
    const { findByText, getByText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    fireEvent.press(await findByText('消える問題'));
    fireEvent.press(getByText('削除'));
    await waitFor(async () => {
      expect(await loadCustom()).toHaveLength(0);
    });
  });

  it('fires onClose', async () => {
    const onClose = jest.fn();
    const { getByText } = render(<QuestionsScreen onClose={onClose} />);
    await waitFor(() => {});
    fireEvent.press(getByText('閉じる'));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- QuestionsScreen`
Expected: FAIL — `Cannot find module '../QuestionsScreen'`

- [ ] **Step 3: Write the screen**

Create `src/ui/QuestionsScreen.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Question } from '../engine/types';
import {
  addCustom,
  deleteCustom,
  loadCustom,
  updateCustom,
} from '../store/storage';

interface Props {
  onClose: () => void;
}

export function QuestionsScreen({ onClose }: Props) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftQ, setDraftQ] = useState('');
  const [draftAnswer, setDraftAnswer] = useState('');

  const refresh = useCallback(async () => {
    setQuestions(await loadCustom());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetForm = () => {
    setEditingId(null);
    setDraftQ('');
    setDraftAnswer('');
  };

  const submit = async () => {
    const q = draftQ.trim();
    const answer = draftAnswer.trim();
    if (!q || !answer) return;
    if (editingId) {
      await updateCustom(editingId, q, answer);
    } else {
      await addCustom(q, answer);
    }
    resetForm();
    await refresh();
  };

  const startEditing = (question: Question) => {
    setEditingId(question.id);
    setDraftQ(question.q);
    setDraftAnswer(question.accept[0] ?? '');
  };

  const remove = async () => {
    if (!editingId) return;
    await deleteCustom(editingId);
    resetForm();
    await refresh();
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>自分の問題</Text>
      <Text style={styles.count}>{questions.length} 問</Text>

      <TextInput
        style={styles.input}
        placeholder="問題"
        placeholderTextColor="#8e8e93"
        value={draftQ}
        onChangeText={setDraftQ}
      />
      <TextInput
        style={styles.input}
        placeholder="答え"
        placeholderTextColor="#8e8e93"
        value={draftAnswer}
        onChangeText={setDraftAnswer}
      />

      <View style={styles.formRow}>
        <Pressable style={styles.primary} onPress={() => void submit()}>
          <Text style={styles.label}>{editingId ? '保存' : '追加'}</Text>
        </Pressable>
        {editingId && (
          <>
            <Pressable style={styles.secondary} onPress={() => void remove()}>
              <Text style={styles.label}>削除</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={resetForm}>
              <Text style={styles.label}>取消</Text>
            </Pressable>
          </>
        )}
      </View>

      <ScrollView style={styles.list}>
        {questions.map((question) => (
          <Pressable
            key={question.id}
            style={styles.item}
            onPress={() => startEditing(question)}
          >
            <Text style={styles.itemQ}>{question.q}</Text>
            <Text style={styles.itemA}>{question.accept[0]}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Pressable style={styles.secondary} onPress={onClose}>
        <Text style={styles.label}>閉じる</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, paddingTop: 80, backgroundColor: '#000' },
  heading: { color: '#f4f1ea', fontSize: 28, marginBottom: 4 },
  count: { color: '#8e8e93', fontSize: 14, marginBottom: 20 },
  input: {
    backgroundColor: '#1c1c1e',
    color: '#f4f1ea',
    fontSize: 16,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  formRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  primary: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#c96f4a',
  },
  secondary: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#1c1c1e',
    alignItems: 'center',
  },
  label: { color: '#f4f1ea', fontSize: 16 },
  list: { flex: 1, marginBottom: 16 },
  item: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  itemQ: { color: '#f4f1ea', fontSize: 16 },
  itemA: { color: '#8e8e93', fontSize: 14, marginTop: 2 },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- QuestionsScreen`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add src/ui/QuestionsScreen.tsx src/ui/__tests__/QuestionsScreen.test.tsx
git commit -m "feat(ui): 自作問題の編集画面 (追加・編集・削除)"
```

---

### Task 5: Settings — mode and source selectors

**Files:**
- Modify: `src/ui/SettingsScreen.tsx`
- Test: `src/ui/__tests__/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `loadCustom`, `loadSettings`, `saveSettings`, `DEFAULT_SETTINGS`, `Settings` from `src/store/storage`; `MIN_QUESTIONS` and `QuestionSource` from `src/content/pool`; `RoundMode` from `src/engine/types`
- Produces: `<SettingsScreen onClose={() => void} onEditQuestions={() => void} />` — the second prop is new and required

- [ ] **Step 1: Write the failing test**

Append to `src/ui/__tests__/SettingsScreen.test.tsx`:

```tsx
import { addCustom } from '../../store/storage';

describe('SettingsScreen mode selector', () => {
  it('persists question-only mode', async () => {
    const { getByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.press(getByText('質問のみ'));
    await waitFor(async () => {
      expect((await loadSettings()).mode).toBe('question');
    });
  });

  it('persists a return to dual mode', async () => {
    const { getByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.press(getByText('質問のみ'));
    fireEvent.press(getByText('位置＋質問'));
    await waitFor(async () => {
      expect((await loadSettings()).mode).toBe('dual');
    });
  });
});

describe('SettingsScreen question source', () => {
  it('shows the shortfall and refuses "自分の問題" below nine', async () => {
    await addCustom('一問だけ', 'あ');
    const { findByText, getByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    expect(await findByText(/あと 8 問/)).toBeTruthy();
    fireEvent.press(getByText(/自分の問題/));
    await waitFor(() => {});
    // Still the default — the disabled option must not have been applied.
    expect((await loadSettings()).questionSource).toBe('builtin');
  });

  it('allows "自分の問題" once there are nine', async () => {
    for (let i = 0; i < 9; i++) await addCustom(`問題${i}`, `答え${i}`);
    const { findByText, getByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    await findByText(/自分の問題/);
    fireEvent.press(getByText(/自分の問題/));
    await waitFor(async () => {
      expect((await loadSettings()).questionSource).toBe('custom');
    });
  });

  it('always allows "両方"', async () => {
    const { getByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.press(getByText(/両方/));
    await waitFor(async () => {
      expect((await loadSettings()).questionSource).toBe('both');
    });
  });

  it('opens the question editor', async () => {
    const onEditQuestions = jest.fn();
    const { getByText } = render(
      <SettingsScreen onClose={() => {}} onEditQuestions={onEditQuestions} />,
    );
    await waitFor(() => {});
    fireEvent.press(getByText('自分の問題を編集'));
    expect(onEditQuestions).toHaveBeenCalled();
  });
});
```

Update every pre-existing `render(<SettingsScreen onClose={...} />)` call in this file to pass `onEditQuestions={() => {}}` as well, or they will not typecheck.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- SettingsScreen`
Expected: FAIL — `onEditQuestions` is not a prop; the mode and source controls do not exist.

- [ ] **Step 3: Extend the screen**

In `src/ui/SettingsScreen.tsx`, replace the imports and the component (keep the existing `styles` block, adding the three new entries shown at the end):

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { MIN_QUESTIONS, type QuestionSource } from '../content/pool';
import type { RoundMode } from '../engine/types';
import {
  DEFAULT_SETTINGS,
  loadCustom,
  loadSettings,
  saveSettings,
  type Settings,
} from '../store/storage';

interface Props {
  onClose: () => void;
  onEditQuestions: () => void;
}

const STEP_CHOICES = [3000, 4000, 5000, 6000, 8000];
const TIER_CHOICES = [
  { tier: 1, label: 'やさしい' },
  { tier: 2, label: 'ふつう' },
];
const MODE_CHOICES: { mode: RoundMode; label: string }[] = [
  { mode: 'dual', label: '位置＋質問' },
  { mode: 'question', label: '質問のみ' },
];
const SOURCE_CHOICES: { source: QuestionSource; label: string }[] = [
  { source: 'builtin', label: '内蔵' },
  { source: 'custom', label: '自分の問題' },
  { source: 'both', label: '両方' },
];

export function SettingsScreen({ onClose, onEditQuestions }: Props) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [customCount, setCustomCount] = useState(0);

  useEffect(() => {
    void loadSettings().then(setSettings);
    void loadCustom().then((custom) => setCustomCount(custom.length));
  }, []);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((current) => {
        const next = { ...current, ...patch };
        void saveSettings(next);
        return next;
      });
    },
    [],
  );

  // 'custom' draws from the owner's questions alone, so it is only usable once
  // there are enough for a full round. 'both' always has the built-ins behind it.
  const customShortfall = Math.max(0, MIN_QUESTIONS - customCount);
  const customUsable = customShortfall === 0;

  const isSourceUsable = (source: QuestionSource) =>
    source === 'custom' ? customUsable : true;

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>設定</Text>

      <Text style={styles.label}>モード</Text>
      <View style={styles.row}>
        {MODE_CHOICES.map(({ mode, label }) => (
          <Pressable
            key={mode}
            onPress={() => update({ mode })}
            style={[styles.chip, settings.mode === mode && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>問題の出どころ</Text>
      <View style={styles.row}>
        {SOURCE_CHOICES.map(({ source, label }) => {
          const usable = isSourceUsable(source);
          return (
            <Pressable
              key={source}
              onPress={() => usable && update({ questionSource: source })}
              style={[
                styles.chip,
                settings.questionSource === source && styles.chipOn,
                !usable && styles.chipOff,
              ]}
            >
              <Text style={styles.chipLabel}>
                {source === 'custom' && !usable
                  ? `${label} (あと ${customShortfall} 問)`
                  : label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable style={styles.link} onPress={onEditQuestions}>
        <Text style={styles.linkLabel}>自分の問題を編集</Text>
      </Pressable>

      <Text style={styles.label}>1ステップの長さ</Text>
      <View style={styles.row}>
        {STEP_CHOICES.map((ms) => (
          <Pressable
            key={ms}
            onPress={() => update({ stepDurationMs: ms })}
            style={[styles.chip, settings.stepDurationMs === ms && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>{ms / 1000}秒</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Nを自動調整</Text>
        <Switch
          value={settings.adaptive}
          onValueChange={(adaptive) => update({ adaptive })}
        />
      </View>

      {!settings.adaptive && (
        <View style={styles.row}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              onPress={() => update({ fixedN: n })}
              style={[styles.chip, settings.fixedN === n && styles.chipOn]}
            >
              <Text style={styles.chipLabel}>{n}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.label}>問題の難易度 (内蔵のみ)</Text>
      <View style={styles.row}>
        {TIER_CHOICES.map(({ tier, label }) => (
          <Pressable
            key={tier}
            onPress={() => update({ maxTier: tier })}
            style={[styles.chip, settings.maxTier === tier && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.button} onPress={onClose}>
        <Text style={styles.chipLabel}>閉じる</Text>
      </Pressable>
    </View>
  );
}
```

Note the `update` callback now uses the functional form of `setSettings`. The previous version closed over `settings`, so two rapid taps could each build their patch from the same stale object and the second would discard the first.

Add to the existing `styles` object:

```ts
  chipOff: { opacity: 0.4 },
  link: { marginBottom: 24 },
  linkLabel: { color: '#c96f4a', fontSize: 16 },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- SettingsScreen`
Expected: PASS — the 5 pre-existing tests plus the 5 new ones

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add src/ui/SettingsScreen.tsx src/ui/__tests__/SettingsScreen.test.tsx
git commit -m "feat(ui): 設定にモード選択と出題元選択を追加 (9問未満は自作を選べない)"
```

---

### Task 6: Wire the game and app together

**Files:**
- Modify: `src/ui/GameScreen.tsx`
- Modify: `App.tsx`
- Test: `src/ui/__tests__/GameScreen.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–5
- Produces: `GameScreen` honouring `mode` and `questionSource`; `App` routing to `QuestionsScreen`

- [ ] **Step 1: Write the failing test**

Append to `src/ui/__tests__/GameScreen.test.tsx`:

```tsx
import { addCustom, saveSettings, DEFAULT_SETTINGS } from '../../store/storage';

describe('GameScreen question-only mode', () => {
  it('renders no grid', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'question' });
    const { deps } = makeDeps(alwaysCorrect);
    const { queryByTestId } = render(
      <GameScreen onFinished={jest.fn()} deps={deps} />,
    );
    await runWholeRound();
    expect(queryByTestId('cell-0')).toBeNull();
  });

  it('still speaks 9 questions and finishes', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'question' });
    const onFinished = jest.fn();
    const { deps, speaker } = makeDeps(alwaysCorrect);
    render(<GameScreen onFinished={onFinished} deps={deps} />);
    await runWholeRound();
    expect(speaker.spoken).toHaveLength(9);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('scores on the answer channel alone and adapts N', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'question' });
    const onFinished = jest.fn();
    const { deps } = makeDeps(alwaysCorrect);
    render(<GameScreen onFinished={onFinished} deps={deps} />);
    await runWholeRound();
    const engine: RoundEngine = onFinished.mock.calls[0][0];
    expect(engine.positionScore).toBeNull();
    expect(engine.answerScore).toBe(1);
    // Answer channel alone is 1.0, so N rises even with no taps.
    expect(await loadN()).toBe(3);
  });

  it('holds N when the judge is unreachable in question mode', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'question' });
    const offline: JudgeClient = {
      judge: async () => {
        throw new Error('network down');
      },
    };
    const { deps } = makeDeps(offline);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await runWholeRound();
    // Both channels absent: nothing to adapt on, so N must not move.
    expect(await loadN()).toBe(2);
  });
});

describe('GameScreen question source', () => {
  it('draws only from custom questions when told to', async () => {
    for (let i = 0; i < 9; i++) await addCustom(`自作${i}`, `答え${i}`);
    await saveSettings({ ...DEFAULT_SETTINGS, questionSource: 'custom' });
    const { deps, speaker } = makeDeps(alwaysCorrect);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await runWholeRound();
    expect(speaker.spoken).toHaveLength(9);
    for (const spoken of speaker.spoken) {
      expect(spoken).toMatch(/^自作\d$/);
    }
  });

  it('shows 問題が足りません when the pool is too small', async () => {
    await addCustom('一問だけ', 'あ');
    await saveSettings({ ...DEFAULT_SETTINGS, questionSource: 'custom' });
    const { deps } = makeDeps(alwaysCorrect);
    const { findByText } = render(
      <GameScreen onFinished={jest.fn()} deps={deps} />,
    );
    expect(await findByText(/問題が足りません/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- GameScreen`
Expected: FAIL — the grid still renders in question mode; the source setting is ignored.

- [ ] **Step 3: Resolve the pool and honour the mode in `GameScreen`**

Add to the imports:

```tsx
import { loadBank, mergeLearned } from '../content/bank';
import { MIN_QUESTIONS, resolvePool } from '../content/pool';
import type { RoundMode } from '../engine/types';
import { loadCustom } from '../store/storage';
```

Add a mode state alongside the existing state hooks:

```tsx
  const [mode, setMode] = useState<RoundMode>('dual');
```

In the setup block, replace the settings load and bank construction:

```tsx
        const [settings, storedN, learned, custom] = await Promise.all([
          loadSettings(),
          loadN(),
          loadLearned(),
          loadCustom(),
        ]);
        if (cancelled) return;

        const n = settings.adaptive ? storedN : settings.fixedN;
        const pool = resolvePool(
          settings.questionSource,
          loadBank(learned),
          mergeLearned(custom, learned),
          settings.maxTier,
        );

        // Questions can be deleted after the source was chosen, so re-check
        // here rather than trusting the settings screen's guard alone.
        if (pool.length < MIN_QUESTIONS) {
          setLabel('問題が足りません');
          return;
        }

        setMode(settings.mode);
        const plan = buildRound(n, pool, Math.random, settings.mode);
```

- [ ] **Step 4: Render the grid only in dual mode**

Replace the returned JSX's grid with a conditional:

```tsx
  return (
    <View style={styles.screen}>
      <Text style={styles.label}>{label}</Text>
      {mode === 'dual' && (
        <Grid
          flashPosition={flash}
          selected={selected}
          onTap={handleTap}
          disabled={!ready}
        />
      )}
    </View>
  );
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- GameScreen`
Expected: PASS — the 9 pre-existing tests plus the 6 new ones

- [ ] **Step 6: Route to the editor in `App.tsx`**

Add `'questions'` to the screen union and render it:

```tsx
type Screen =
  | { name: 'game'; key: number }
  | { name: 'results'; engine: RoundEngine; plan: RoundPlan }
  | { name: 'settings' }
  | { name: 'questions' };
```

Add the import:

```tsx
import { QuestionsScreen } from './src/ui/QuestionsScreen';
```

Pass the new prop to `SettingsScreen` and add the new branch:

```tsx
      {screen.name === 'settings' && (
        <SettingsScreen
          onClose={() => setScreen({ name: 'game', key: Date.now() })}
          onEditQuestions={() => setScreen({ name: 'questions' })}
        />
      )}

      {screen.name === 'questions' && (
        <QuestionsScreen onClose={() => setScreen({ name: 'settings' })} />
      )}
```

Closing the editor returns to Settings rather than starting a round, so the owner can add several questions and then pick the source without a round beginning underneath them.

- [ ] **Step 7: Run the whole suite and typecheck**

```bash
cd /mnt/c/Projects/nback-voice
npm test
npx tsc --noEmit
```

Expected: both clean, with no `console.error` or act() warnings in the output.

- [ ] **Step 8: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add src/ui/GameScreen.tsx App.tsx src/ui/__tests__/GameScreen.test.tsx
git commit -m "feat(ui): モードと出題元をゲームに反映し、問題編集画面へ導線を追加"
```

---

### Task 7: Update the docs

**Files:**
- Modify: `docs/RUNBOOK.md`

- [ ] **Step 1: Add the new settings to the runbook**

In `docs/RUNBOOK.md`, add this section immediately before `## 進捗をリセットする`:

```markdown
## モードと出題元

設定画面で切り替える。

- **モード** — `位置＋質問` (既定) はグリッドのタップと口頭回答の両方を
  Nステップ遅延で行うデュアルN-back。`質問のみ` はグリッドを出さず、
  口頭回答だけのN-back。採点は回答チャネル単独になる。
- **問題の出どころ** — `内蔵` (30問) / `自分の問題` / `両方`。
  自作問題が9問に満たないうちは `自分の問題` を選べず、あと何問必要かを表示する。
- **自分の問題を編集** — 問題文と答えを1つずつ入力する。別の言い方をしても
  Claudeが正解と判断すれば、以後はその言い方も無料で通るようになる。
  問題を編集・削除すると、その問題について学習した別解は破棄される。

出題順は内蔵・自作を問わずラウンドごとにシャッフルされる。入力した順には出ない。

質問のみモードでオフラインだと、位置・回答のどちらのチャネルも得点が出ない。
このときNは据え置かれる (情報ゼロで難易度を動かさないため)。
```

- [ ] **Step 2: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add docs/RUNBOOK.md
git commit -m "docs: モードと出題元の説明を手順書に追加"
```

---

## Deferred (not in this plan)

- **Import/export of question sets.** Not requested.
- **Position-only mode.** Not requested, and the visual N-back without the verbal load is a materially easier exercise.
- **Per-question statistics.** History stays one row per round.
- **Serializing custom-question CRUD.** `addCustom`/`updateCustom`/`deleteCustom` are read-modify-write like `addLearned` was, but they are driven by discrete taps in a single editor screen, not by concurrent judge promises — there is no path that fires two at once. `clearLearned` *is* serialized, because it races real concurrent learning.
