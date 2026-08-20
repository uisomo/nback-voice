# Typed Answer Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player answer by typing into a text field — filled by the phone keyboard's own dictation and correctable before submitting — instead of by the app's speech recognizer.

**Architecture:** `RoundRunner` holds no timers; the UI ticks it when a phase should close. So typed mode needs no new state machine, only a different answer to "when may phase B close?". A `TypedListener` implements the existing `Listener` interface whose `settle()` resolves on submit rather than on a recognizer result. The engine gains a time budget derived from the answer's length, reported but never fed into adaptive N.

**Tech Stack:** TypeScript, React Native (Expo SDK 57), Jest + @testing-library/react-native, AsyncStorage.

**Spec:** `docs/superpowers/specs/2026-08-20-typed-answer-mode-design.md`

## Global Constraints

- **Two independent mode axes.** `RoundMode` (`'dual' | 'question'`) stays as-is. `AnswerInput` (`'voice' | 'typed'`) is new. Never collapse them into one enum.
- **`nextN` must not change.** N rises and falls on correctness only. The on-time metric is reported, never adaptive input.
- **The engine must not learn about input modes.** Absence of `elapsedMs` is the only signal that there was no clock.
- **The answered question is never displayed.** The question at the top of the screen is the one being memorised; the one being answered stays off-screen.
- **Budget formula:** `baseMs + Array.from(answer).length * 1000`, `baseMs` default `4000`. Counted in code points, from `accept[0]` of the recalled question.
- **`src/engine/` and `src/content/` must not import React, React Native, or Expo** — enforced by `src/__tests__/boundaries.test.ts`.
- **Full suite must stay green:** `npm test` and `npx tsc --noEmit`. Currently 22 suites / 307 tests.
- **UI copy is Japanese.**

---

### Task 1: Time budget function

**Files:**
- Create: `src/engine/budget.ts`
- Modify: `src/engine/index.ts`
- Test: `src/engine/__tests__/budget.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `answerBudgetMs(answer: string, baseMs: number): number` and `DEFAULT_BUDGET_BASE_MS: number` (= 4000), both re-exported from `src/engine`.

- [ ] **Step 1: Write the failing test**

Create `src/engine/__tests__/budget.test.ts`:

```ts
import { DEFAULT_BUDGET_BASE_MS, answerBudgetMs } from '../budget';

describe('answerBudgetMs', () => {
  it('gives a second per character on top of the base', () => {
    expect(answerBudgetMs('わん', 4000)).toBe(6000);
    expect(answerBudgetMs('キャピタルコール', 4000)).toBe(12000);
    expect(answerBudgetMs('未コールコミットメント', 4000)).toBe(15000);
  });

  it('honours a different base', () => {
    expect(answerBudgetMs('わん', 0)).toBe(2000);
    expect(answerBudgetMs('わん', 10000)).toBe(12000);
  });

  /** Counted in code points: a surrogate pair is one character to a reader. */
  it('counts code points, not UTF-16 units', () => {
    expect(answerBudgetMs('𠮟', 0)).toBe(1000);
  });

  it('gives the base alone for an empty answer', () => {
    expect(answerBudgetMs('', 4000)).toBe(4000);
  });

  it('ships a base of 4 seconds', () => {
    expect(DEFAULT_BUDGET_BASE_MS).toBe(4000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/engine/__tests__/budget.test.ts`
Expected: FAIL — `Cannot find module '../budget'`

- [ ] **Step 3: Write minimal implementation**

Create `src/engine/budget.ts`:

```ts
/**
 * A round of typing starts with reading the question and reaching the field.
 * Without a base, 「わん」 would allow two seconds for all of it, which is not
 * enough to tap anything, let alone dictate and check a word.
 */
export const DEFAULT_BUDGET_BASE_MS = 4000;

/**
 * How long the answer window is aimed at. A target, not a deadline: running
 * out is recorded, never enforced (see RoundEngine.onTimeScore).
 *
 * Array.from counts code points, so a surrogate pair costs what a reader
 * thinks it costs — one character.
 */
export function answerBudgetMs(answer: string, baseMs: number): number {
  return baseMs + Array.from(answer).length * 1000;
}
```

Add to `src/engine/index.ts`, after the `./adaptive` line:

```ts
export * from './budget';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/engine/__tests__/budget.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/engine/budget.ts src/engine/index.ts src/engine/__tests__/budget.test.ts
git commit -m "feat(engine): 回答の時間予算を字数から出す"
```

---

### Task 2: TypedListener

**Files:**
- Create: `src/speech/typed.ts`
- Test: `src/speech/__tests__/typed.test.ts`

**Interfaces:**
- Consumes: `Listener` from `src/speech/types.ts` — `start(): void`, `settle(): Promise<void>`, `stop(): string`, `push(transcript: string, isFinal?: boolean): void`, `sessionEnded(): void`.
- Produces: `class TypedListener implements Listener` with one extra method `submit(): void`.

- [ ] **Step 1: Write the failing test**

Create `src/speech/__tests__/typed.test.ts`:

```ts
import { TypedListener } from '../typed';

/** Resolved-ness of a promise, without hanging the test on a pending one. */
function isResolved(promise: Promise<void>): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    Promise.resolve().then(() => false),
  ]);
}

describe('TypedListener', () => {
  it('does not settle until the answer is submitted', async () => {
    const listener = new TypedListener();
    listener.start();
    const settled = listener.settle();

    expect(await isResolved(settled)).toBe(false);

    listener.push('キャピタルコール');
    expect(await isResolved(settled)).toBe(false);

    listener.submit();
    expect(await isResolved(settled)).toBe(true);
  });

  it('returns what was typed', () => {
    const listener = new TypedListener();
    listener.start();
    listener.push('キャピタル');
    listener.push('キャピタルコール');
    listener.submit();
    expect(listener.stop()).toBe('キャピタルコール');
  });

  it('clears the field for each new answer window', () => {
    const listener = new TypedListener();
    listener.start();
    listener.push('ひとつめ');
    listener.submit();
    expect(listener.stop()).toBe('ひとつめ');

    listener.start();
    expect(listener.text).toBe('');
    listener.submit();
    expect(listener.stop()).toBe('');
  });

  /** Empty is 未回答, never a wrong answer — the engine decides that. */
  it('submits empty text as empty', async () => {
    const listener = new TypedListener();
    listener.start();
    const settled = listener.settle();
    listener.submit();
    expect(await isResolved(settled)).toBe(true);
    expect(listener.stop()).toBe('');
  });

  it('ignores a second submit for the same window', async () => {
    const listener = new TypedListener();
    listener.start();
    const settled = listener.settle();
    listener.submit();
    listener.push('あとから');
    listener.submit();
    expect(await isResolved(settled)).toBe(true);
    expect(listener.stop()).toBe('あとから');
  });

  /** A stray keyboard event before the window opens must not advance a step. */
  it('ignores submit before start', async () => {
    const listener = new TypedListener();
    listener.submit();
    listener.start();
    const settled = listener.settle();
    expect(await isResolved(settled)).toBe(false);
  });

  it('settles immediately when the window is already closed', async () => {
    const listener = new TypedListener();
    listener.start();
    listener.submit();
    expect(await isResolved(listener.settle())).toBe(true);
  });

  it('has no session to end', () => {
    const listener = new TypedListener();
    listener.start();
    expect(() => listener.sessionEnded()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/speech/__tests__/typed.test.ts`
Expected: FAIL — `Cannot find module '../typed'`

- [ ] **Step 3: Write minimal implementation**

Create `src/speech/typed.ts`:

```ts
import type { Listener } from './types';

/**
 * A Listener backed by a text field instead of a recognizer.
 *
 * The app's own recognizer hands its result straight to scoring, so a
 * misheard word is final and lands as a wrong answer with nothing on screen
 * to say so. Typing — usually filled by the keyboard's dictation key — makes
 * the transcript editable before it counts.
 *
 * Phase B closes on settle(); here that means the player pressed send. The
 * UI passes no phase-B timer in this mode, which is what makes the round
 * submit-driven. It knows nothing about steps: whether a step even wants an
 * answer is the UI's business (see the plan's Task 7).
 */
export class TypedListener implements Listener {
  private value = '';
  private open = false;
  private release: (() => void) | null = null;
  private settled: Promise<void> = Promise.resolve();

  /** What is currently in the field. For the UI to render. */
  get text(): string {
    return this.value;
  }

  start(): void {
    this.value = '';
    this.open = true;
    this.settled = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  push(transcript: string): void {
    this.value = transcript;
  }

  settle(): Promise<void> {
    return this.settled;
  }

  stop(): string {
    this.open = false;
    return this.value;
  }

  /** The send button, or the keyboard's return key. */
  submit(): void {
    if (!this.open) return;
    this.open = false;
    this.release?.();
    this.release = null;
  }

  /** No session exists to end. */
  sessionEnded(): void {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/speech/__tests__/typed.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/speech/typed.ts src/speech/__tests__/typed.test.ts
git commit -m "feat(speech): 提出で閉じる Listener を足す"
```

---

### Task 3: Engine records timing and reports on-time

**Files:**
- Modify: `src/engine/round.ts`
- Test: `src/engine/__tests__/round.test.ts`

**Interfaces:**
- Consumes: `answerBudgetMs`, `DEFAULT_BUDGET_BASE_MS` from Task 1.
- Produces:
  - `StepSubmission` gains `elapsedMs?: number`
  - `AnswerReview` gains `budgetMs: number` and `onTime: boolean | null`
  - `new RoundEngine(plan)` and `new RoundEngine(plan, { budgetBaseMs })` both valid
  - `engine.onTimeScore: number | null`

- [ ] **Step 1: Write the failing test**

Append to `src/engine/__tests__/round.test.ts`. Use the file's existing helpers for building a plan; if it builds plans with `buildRound(n, BANK, rng)`, follow that. This block assumes a local helper that submits every step:

```ts
import { DEFAULT_BUDGET_BASE_MS } from '../budget';

describe('RoundEngine timing', () => {
  /** A plan whose every answer is 4 characters, so the budget is 8000ms. */
  const TIMED_BANK: Question[] = Array.from({ length: 12 }, (_, i) => ({
    id: `t${i}`,
    tier: 1,
    q: `質問${i}`,
    accept: ['よんもじ'],
  }));

  function timedEngine(elapsed: (index: number) => number | undefined) {
    const plan = buildRound(1, TIMED_BANK, () => 0);
    const engine = new RoundEngine(plan, { budgetBaseMs: 4000 });
    for (const step of plan.steps) {
      if (step.recallTarget === null) {
        engine.submitStep(step.index, { tap: null, transcript: null });
        continue;
      }
      engine.submitStep(step.index, {
        tap: plan.steps[step.recallTarget].position,
        transcript: 'よんもじ',
        elapsedMs: elapsed(step.index),
      });
    }
    return engine;
  }

  it('derives the budget from the recalled answer, not the shown question', () => {
    const engine = timedEngine(() => 1000);
    for (const row of engine.review) expect(row.budgetMs).toBe(8000);
  });

  it('marks an answer inside its budget as on time', () => {
    const engine = timedEngine(() => 7999);
    expect(engine.review.every((row) => row.onTime === true)).toBe(true);
    expect(engine.onTimeScore).toBe(1);
  });

  it('counts the boundary as on time', () => {
    const engine = timedEngine(() => 8000);
    expect(engine.review.every((row) => row.onTime === true)).toBe(true);
  });

  it('marks an answer past its budget as late, without failing it', () => {
    const engine = timedEngine(() => 8001);
    expect(engine.review.every((row) => row.onTime === false)).toBe(true);
    expect(engine.onTimeScore).toBe(0);
    // Late is late, not wrong: the answer channel is untouched.
    for (const row of engine.review) engine.resolveAnswer(row.index, true);
    expect(engine.answerScore).toBe(1);
  });

  /** No elapsed time means no clock, which means nothing to say — not zero. */
  it('reports null when no step was timed', () => {
    const engine = timedEngine(() => undefined);
    expect(engine.review.every((row) => row.onTime === null)).toBe(true);
    expect(engine.onTimeScore).toBeNull();
  });

  it('scores on time out of every scored step, like position does', () => {
    // 9 scored steps; the first 5 land on time, the rest are late.
    const engine = timedEngine((index) => (index < 5 ? 1000 : 99999));
    expect(engine.onTimeScore).toBeCloseTo(5 / 9);
  });

  it('defaults the base to 4 seconds when none is given', () => {
    const plan = buildRound(1, TIMED_BANK, () => 0);
    const engine = new RoundEngine(plan);
    engine.submitStep(0, { tap: null, transcript: null });
    engine.submitStep(1, { tap: null, transcript: 'よんもじ', elapsedMs: 1 });
    expect(engine.review[0].budgetMs).toBe(DEFAULT_BUDGET_BASE_MS + 4000);
  });

  /** The promise of §6: time is reported, never adaptive input. */
  it('does not let lateness move roundScore or N', () => {
    const onTime = timedEngine(() => 1000);
    const late = timedEngine(() => 99999);
    for (const row of onTime.review) onTime.resolveAnswer(row.index, true);
    for (const row of late.review) late.resolveAnswer(row.index, true);

    expect(late.roundScore).toBe(onTime.roundScore);
    expect(late.nextN(2)).toBe(onTime.nextN(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/engine/__tests__/round.test.ts`
Expected: FAIL — `budgetMs` undefined, `onTimeScore` not a function

- [ ] **Step 3: Write minimal implementation**

In `src/engine/round.ts`:

Add the import beside the existing `adaptive` import:

```ts
import { DEFAULT_BUDGET_BASE_MS, answerBudgetMs } from './budget';
```

Extend `StepSubmission`:

```ts
export interface StepSubmission {
  tap: Position | null;
  transcript: string | null;
  /**
   * How long the answer window took, when it was timed. Absent in voice mode:
   * there is no clock there, so there is nothing to be on time for. Absence,
   * not a flag, is how the engine avoids knowing about input modes.
   */
  elapsedMs?: number;
}
```

Extend `AnswerRecord`:

```ts
interface AnswerRecord {
  question: Question;
  transcript: string | null;
  correct: boolean | null;
  position: PositionOutcome | null;
  /** Derived from the recalled answer's length; see answerBudgetMs. */
  budgetMs: number;
  /** null = untimed. Late is recorded, never punished. */
  onTime: boolean | null;
}
```

Add options and the constructor:

```ts
export interface RoundEngineOptions {
  budgetBaseMs?: number;
}
```

```ts
  private readonly budgetBaseMs: number;

  constructor(plan: RoundPlan, options: RoundEngineOptions = {}) {
    this.plan = plan;
    this.budgetBaseMs = options.budgetBaseMs ?? DEFAULT_BUDGET_BASE_MS;
  }
```

In `submitStep`, replace the `this.answers.set(index, {...})` call with:

```ts
    const budgetMs = answerBudgetMs(target.question.accept[0] ?? '', this.budgetBaseMs);

    this.answers.set(index, {
      question: target.question,
      transcript,
      correct: null,
      position: this.positionOutcome(input.tap, target.position),
      budgetMs,
      onTime: input.elapsedMs === undefined ? null : input.elapsedMs <= budgetMs,
    });
```

Add the getter beside `positionScore`:

```ts
  /**
   * null when nothing was timed — the channel is absent, not zero, exactly as
   * positionScore is null in question mode. Reported only: roundScore and
   * nextN never see it, so speed is a goal without being a difficulty knob.
   */
  get onTimeScore(): number | null {
    const timed = [...this.answers.values()].filter((a) => a.onTime !== null);
    if (timed.length === 0) return null;
    return timed.filter((a) => a.onTime).length / STIMULI_PER_ROUND;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/engine/__tests__/round.test.ts`
Expected: PASS — all existing tests plus 8 new

- [ ] **Step 5: Run the whole suite — nothing else may move**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. `roundScore`, `nextN`, `answerScore` untouched.

- [ ] **Step 6: Commit**

```bash
git add src/engine/round.ts src/engine/__tests__/round.test.ts
git commit -m "feat(engine): 回答にかかった時間を記録し、時間内を集計する"
```

---

### Task 4: Runner measures the answer window

**Files:**
- Modify: `src/engine/runner.ts`
- Test: `src/engine/__tests__/runner.test.ts`

**Interfaces:**
- Consumes: `StepSubmission.elapsedMs` from Task 3.
- Produces: `RoundRunnerDeps` gains `clock?: () => number`. When supplied, `tick()` closing phase B passes `elapsedMs` to `submitStep`.

- [ ] **Step 1: Write the failing test**

Append to `src/engine/__tests__/runner.test.ts`, matching the file's existing setup helpers:

```ts
describe('RoundRunner answer window timing', () => {
  it('reports how long phase B took when given a clock', () => {
    let now = 0;
    const plan = buildRound(1, BANK, () => 0);
    const engine = new RoundEngine(plan);
    const runner = new RoundRunner({
      plan,
      engine,
      speaker: new FakeSpeaker(),
      listener: new FakeListener(),
      onJudge: () => {},
      clock: () => now,
    });

    runner.start();
    now = 1000;
    runner.tick();   // A -> B, window opens at 1000
    now = 4500;
    runner.tick();   // B closes at 4500
    now = 5000;
    runner.tick();   // A -> B for step 1, opens at 5000
    now = 6000;
    runner.tick();

    const rows = engine.review;
    expect(rows[0].index).toBe(1);
    // Step 1 is the first scored step at n=1; its window ran 5000 -> 6000.
    expect(rows[0].onTime).not.toBeNull();
  });

  /** Without a clock the engine must see no elapsed time at all. */
  it('leaves the window untimed when no clock is given', () => {
    const plan = buildRound(1, BANK, () => 0);
    const engine = new RoundEngine(plan);
    const runner = new RoundRunner({
      plan,
      engine,
      speaker: new FakeSpeaker(),
      listener: new FakeListener(),
      onJudge: () => {},
    });

    runner.start();
    runner.tick();
    runner.tick();
    runner.tick();
    runner.tick();

    expect(engine.review.every((row) => row.onTime === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/engine/__tests__/runner.test.ts`
Expected: FAIL — `clock` is not a known property, `onTime` is null in the first test

- [ ] **Step 3: Write minimal implementation**

In `src/engine/runner.ts`, extend the deps:

```ts
export interface RoundRunnerDeps {
  plan: RoundPlan;
  engine: RoundEngine;
  speaker: Speaker;
  listener: Listener;
  onJudge(answer: PendingAnswer): void;
  /**
   * Supplied only when the answer window is timed — typed mode. Voice mode
   * has no clock to be on time against, and passing none is how the engine
   * learns that without being told which mode is running.
   */
  clock?: () => number;
}
```

Add the field:

```ts
  private windowOpenedAt: number | null = null;
```

In `tick()`, in the `phase === 'A'` branch, after `this.deps.listener.start();`:

```ts
      this.windowOpenedAt = this.deps.clock?.() ?? null;
```

In the phase B closing branch, replace the `submitStep` call with:

```ts
    const transcript = this.deps.listener.stop();
    const openedAt = this.windowOpenedAt;
    const elapsedMs =
      openedAt === null ? undefined : (this.deps.clock?.() ?? openedAt) - openedAt;
    this.windowOpenedAt = null;
    this.deps.engine.submitStep(this.stepIndex, {
      tap: this.tap,
      transcript: transcript.length > 0 ? transcript : null,
      elapsedMs,
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/engine/__tests__/runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/engine/runner.ts src/engine/__tests__/runner.test.ts
git commit -m "feat(engine): 回答窓の長さを計る (時計を渡されたときだけ)"
```

---

### Task 5: Settings gain the input axis

**Files:**
- Modify: `src/store/storage.ts:5-40`
- Test: `src/store/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_BUDGET_BASE_MS` from Task 1.
- Produces: `AnswerInput` type exported from `src/store/storage.ts`; `Settings.answerInput: AnswerInput`; `Settings.budgetBaseMs: number`; `DEFAULT_SETTINGS.answerInput === 'typed'`.

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/storage.test.ts`:

```ts
describe('answer input settings', () => {
  it('defaults to typed — voice is the mode you opt into', () => {
    expect(DEFAULT_SETTINGS.answerInput).toBe('typed');
    expect(DEFAULT_SETTINGS.budgetBaseMs).toBe(4000);
  });

  it('fills both in for settings stored before they existed', async () => {
    await AsyncStorage.setItem(
      'nback.settings',
      JSON.stringify({ stepDurationMs: 7000, mode: 'question' }),
    );
    const settings = await loadSettings();
    expect(settings.stepDurationMs).toBe(7000);
    expect(settings.mode).toBe('question');
    expect(settings.answerInput).toBe('typed');
    expect(settings.budgetBaseMs).toBe(4000);
  });

  it('round-trips a stored choice', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      answerInput: 'voice',
      budgetBaseMs: 6000,
    });
    const settings = await loadSettings();
    expect(settings.answerInput).toBe('voice');
    expect(settings.budgetBaseMs).toBe(6000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/storage.test.ts`
Expected: FAIL — `DEFAULT_SETTINGS.answerInput` is undefined

- [ ] **Step 3: Write minimal implementation**

In `src/store/storage.ts`, add the import:

```ts
import { DEFAULT_BUDGET_BASE_MS } from '../engine/budget';
```

Add the type above `Settings`:

```ts
/**
 * How the answer is given. Independent of RoundMode, which says what gets
 * scored: all four combinations are meaningful.
 */
export type AnswerInput = 'voice' | 'typed';
```

Add to `Settings`:

```ts
  /** How answers are entered. Typed is the default; voice is opted into. */
  answerInput: AnswerInput;
  /** Base of the answer time budget, before the per-character part. */
  budgetBaseMs: number;
```

Add to `DEFAULT_SETTINGS`:

```ts
  answerInput: 'typed',
  budgetBaseMs: DEFAULT_BUDGET_BASE_MS,
```

`loadSettings` already spreads `DEFAULT_SETTINGS` first, so stored settings that predate these keys pick up the defaults with no migration code.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/storage.test.ts`
Expected: PASS

- [ ] **Step 5: Check the boundary rule still holds**

Run: `npx jest src/__tests__/boundaries.test.ts && npx tsc --noEmit`
Expected: PASS — `storage.ts` importing from `src/engine/` is fine; the rule constrains what `engine/` and `content/` import, not who imports them.

- [ ] **Step 6: Commit**

```bash
git add src/store/storage.ts src/store/__tests__/storage.test.ts
git commit -m "feat(store): 入力方式と時間予算の基準値を設定に足す"
```

---

### Task 6: Settings screen exposes the choice

**Files:**
- Modify: `src/ui/SettingsScreen.tsx:59-135`
- Test: `src/ui/__tests__/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `AnswerInput`, `Settings.answerInput`, `Settings.budgetBaseMs` from Task 5.
- Produces: chips with `testID="answer-input-typed"` and `testID="answer-input-voice"`; a numeric field `testID="budget-base-input"`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/__tests__/SettingsScreen.test.tsx`, following the file's existing render helper:

```ts
describe('SettingsScreen answer input', () => {
  it('switches to voice and saves it', async () => {
    const { getByTestId } = render(<SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />);
    await waitFor(() => getByTestId('answer-input-voice'));
    fireEvent.press(getByTestId('answer-input-voice'));
    await waitFor(async () => {
      expect((await loadSettings()).answerInput).toBe('voice');
    });
  });

  it('switches back to typed', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, answerInput: 'voice' });
    const { getByTestId } = render(<SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />);
    await waitFor(() => getByTestId('answer-input-typed'));
    fireEvent.press(getByTestId('answer-input-typed'));
    await waitFor(async () => {
      expect((await loadSettings()).answerInput).toBe('typed');
    });
  });

  it('edits the time budget base', async () => {
    const { getByTestId } = render(<SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />);
    await waitFor(() => getByTestId('budget-base-input'));
    fireEvent.changeText(getByTestId('budget-base-input'), '6');
    await waitFor(async () => {
      expect((await loadSettings()).budgetBaseMs).toBe(6000);
    });
  });

  /** A blank or nonsense entry must not persist NaN into storage. */
  it('ignores an unparseable budget base', async () => {
    const { getByTestId } = render(<SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />);
    await waitFor(() => getByTestId('budget-base-input'));
    fireEvent.changeText(getByTestId('budget-base-input'), 'あ');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await loadSettings()).budgetBaseMs).toBe(4000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/ui/__tests__/SettingsScreen.test.tsx`
Expected: FAIL — `Unable to find an element with testID: answer-input-voice`

- [ ] **Step 3: Write minimal implementation**

In `src/ui/SettingsScreen.tsx`, add beside `MODE_CHOICES`:

```ts
const INPUT_CHOICES: { input: AnswerInput; label: string }[] = [
  { input: 'typed', label: '入力' },
  { input: 'voice', label: '音声' },
];
```

Import `AnswerInput` from `../store/storage`.

After the mode chips block, add:

```tsx
      <Text style={styles.label}>回答のしかた</Text>
      <View style={styles.row}>
        {INPUT_CHOICES.map(({ input, label }) => (
          <Pressable
            key={input}
            testID={`answer-input-${input}`}
            onPress={() => update({ answerInput: input })}
            style={[styles.chip, settings.answerInput === input && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>
        入力にすると、キーボードのマイクで喋った文字を、送る前に直せる。
      </Text>

      <Text style={styles.label}>考える時間の基準 (秒)</Text>
      <TextInput
        testID="budget-base-input"
        style={styles.input}
        keyboardType="number-pad"
        defaultValue={String(settings.budgetBaseMs / 1000)}
        onChangeText={(text) => {
          const seconds = Number(text);
          if (!Number.isFinite(seconds) || text.trim() === '') return;
          update({ budgetBaseMs: Math.round(seconds * 1000) });
        }}
      />
      <Text style={styles.note}>
        答え1文字につき1秒が、この基準に足される。時計が0になっても先へは進まない。
      </Text>
```

Reuse the existing `styles.label` / `styles.row` / `styles.chip` / `styles.chipOn` / `styles.chipLabel` / `styles.note` / `styles.input`; if any is absent, copy the API-key field's styles.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/ui/__tests__/SettingsScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/SettingsScreen.tsx src/ui/__tests__/SettingsScreen.test.tsx
git commit -m "feat(ui): 設定で回答のしかたと時間の基準を選べるようにする"
```

---

### Task 7: Grid sizes itself to the space it is given

**Files:**
- Modify: `src/ui/Grid.tsx:48-62`
- Test: `src/ui/__tests__/Grid.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `Grid` gains `size?: number` (default 300). Cells become `Math.floor(size / 3) - 4` square, keeping the existing 2px margin on each side.

The grid is currently a fixed 300x300 with 96px cells. With a keyboard on
screen there is roughly 260pt of height left on an iPhone 15 and about 197pt
on an SE, so a fixed 300 overflows instead of shrinking. Cells must come from
whichever of width or height is scarcer.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/__tests__/Grid.test.tsx`:

```tsx
describe('Grid sizing', () => {
  /** The flattened width of one cell, whatever the style shape. */
  function cellWidth(node: { props: { style?: StyleProp<ViewStyle> } }): unknown {
    return StyleSheet.flatten(node.props.style)?.width;
  }

  it('keeps its 96px cells when no size is given', () => {
    const { getByTestId } = render(
      <Grid flashPosition={null} selected={null} onTap={() => {}} />,
    );
    expect(cellWidth(getByTestId('cell-0'))).toBe(96);
  });

  it('shrinks its cells to the size it is handed', () => {
    const { getByTestId } = render(
      <Grid flashPosition={null} selected={null} onTap={() => {}} size={200} />,
    );
    // 200 / 3 = 66, less the 2px margin on each side.
    expect(cellWidth(getByTestId('cell-0'))).toBe(62);
  });

  it('stays square, so the grid never stretches', () => {
    const { getByTestId } = render(
      <Grid flashPosition={null} selected={null} onTap={() => {}} size={197} />,
    );
    const style = StyleSheet.flatten(getByTestId('cell-4').props.style);
    expect(style?.width).toBe(style?.height);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/ui/__tests__/Grid.test.tsx`
Expected: FAIL — the cell is 96 wide regardless of `size`

- [ ] **Step 3: Write minimal implementation**

In `src/ui/Grid.tsx`, add to `Props`:

```ts
  /**
   * The square the grid must fit inside. Defaults to the original 300. With a
   * keyboard up there is far less height than width, so the caller passes
   * min(width, height) and the cells follow.
   */
  size?: number;
```

Destructure `size = 300` in the component, and replace the fixed styles at the
render site:

```tsx
  const cell = Math.floor(size / 3) - 4;
  return (
    <View style={[styles.grid, { width: size, height: size }]}>
      {Array.from({ length: 9 }, (_, i) => (
        <Pressable
          key={i}
          testID={`cell-${i}`}
          ...
          style={[
            styles.cell,
            { width: cell, height: cell },
            flashPosition === i && styles.flash,
            selected === i && styles.selected,
            selected === i && ring,
          ]}
        />
      ))}
    </View>
  );
```

Remove `width: 300, height: 300` from `styles.grid` and `width: 96, height: 96`
from `styles.cell`, leaving the margin, colour and radius in place.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/ui/__tests__/Grid.test.tsx`
Expected: PASS. The default-size test proves nothing changed for voice mode.

- [ ] **Step 5: Commit**

```bash
git add src/ui/Grid.tsx src/ui/__tests__/Grid.test.tsx
git commit -m "feat(ui): グリッドを与えられた大きさに合わせる"
```

---

### Task 8: GameScreen typed branch

**Files:**
- Modify: `src/ui/GameScreen.tsx` — deps (`:52-66`), the `schedule()` closure (`:280-318`), and the render tree
- Test: `src/ui/__tests__/GameScreen.test.tsx`

**Interfaces:**
- Consumes: `TypedListener` (Task 2), `answerBudgetMs` (Task 1), `clock` dep (Task 4), `Settings.answerInput` / `budgetBaseMs` (Task 5), `Grid`'s `size` prop (Task 7).
- Produces: `testID="typed-answer-input"`, `testID="typed-submit"`, `testID="answer-clock"`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/__tests__/GameScreen.test.tsx`, following the file's existing deps-injection helper:

```ts
describe('GameScreen typed mode', () => {
  beforeEach(async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, answerInput: 'typed' });
  });

  it('shows a field instead of opening the mic', async () => {
    const listener = new FakeListener();
    const { getByTestId, queryByTestId } = renderGame({ listener });
    await startRound(getByTestId);
    expect(getByTestId('typed-answer-input')).toBeTruthy();
    expect(listener.sessions).toBe(0);
  });

  /** The clock is a target. Running it out must not advance anything. */
  it('does not advance when the clock runs out', async () => {
    const { getByTestId } = renderGame({});
    await startRound(getByTestId);
    const before = getByTestId('step-label').props.children;
    act(() => {
      jest.advanceTimersByTime(60_000);
    });
    expect(getByTestId('step-label').props.children).toEqual(before);
  });

  it('advances when the answer is submitted', async () => {
    const { getByTestId } = renderGame({});
    await startRound(getByTestId);
    const before = getByTestId('step-label').props.children;
    fireEvent.changeText(getByTestId('typed-answer-input'), 'こたえ');
    fireEvent.press(getByTestId('typed-submit'));
    await waitFor(() => {
      expect(getByTestId('step-label').props.children).not.toEqual(before);
    });
  });

  /** Nothing is owed on the first N steps, so nothing should be asked for. */
  it('disables the field on steps with nothing to recall', async () => {
    const { getByTestId } = renderGame({});
    await startRound(getByTestId);
    expect(getByTestId('typed-answer-input').props.editable).toBe(false);
  });

  it('leaves voice mode alone', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, answerInput: 'voice' });
    const listener = new FakeListener();
    const { getByTestId, queryByTestId } = renderGame({ listener });
    await startRound(getByTestId);
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(queryByTestId('typed-answer-input')).toBeNull();
    expect(listener.sessions).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/ui/__tests__/GameScreen.test.tsx`
Expected: FAIL — `typed-answer-input` not found

- [ ] **Step 3: Write minimal implementation**

Imports:

```ts
import { TextInput } from 'react-native';
import { answerBudgetMs } from '../engine/budget';
import { TypedListener } from '../speech/typed';
```

In `realDeps()`, keep `listener: new ExpoListener()`. The typed listener is chosen after settings load, so add state near the other refs:

```ts
  const typedRef = useRef<TypedListener | null>(null);
  const [typedText, setTypedText] = useState('');
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
```

Inside the setup block, after `settings` is loaded and before `new RoundRunner(...)`:

```ts
        const typed = settings.answerInput === 'typed' ? new TypedListener() : null;
        typedRef.current = typed;
```

Pass it to the runner and give the runner a clock only in typed mode:

```ts
        const runner = new RoundRunner({
          plan,
          engine,
          speaker: resolved.speaker,
          listener: typed ?? resolved.listener,
          onJudge: (answer) => queue.enqueue(answer),
          clock: typed ? () => Date.now() : undefined,
        });
```

Construct the engine with the configured base:

```ts
        const engine = new RoundEngine(plan, { budgetBaseMs: settings.budgetBaseMs });
```

In `schedule()`, replace the single `setTimeout` with:

```ts
          const step = plan.steps[stepIndex];
          const owesAnswer = step.recallTarget !== null;

          if (phase === 'B' && typed && owesAnswer) {
            const target = plan.steps[step.recallTarget!];
            const budget = answerBudgetMs(
              target.question?.accept[0] ?? '',
              settings.budgetBaseMs,
            );
            setTypedText('');
            setRemainingMs(budget);
            const startedAt = Date.now();
            clockRef.current = setInterval(() => {
              setRemainingMs(budget - (Date.now() - startedAt));
            }, 200);
          } else {
            setRemainingMs(null);
          }

          const advance = () => {
            void runner.readyToClose().then(() => {
              if (cancelled) return;
              if (clockRef.current) {
                clearInterval(clockRef.current);
                clockRef.current = null;
              }
              runner.tick();
              schedule();
            });
          };

          // Typed answer windows close on submit, not on a timer: that is what
          // makes the round submit-driven. Everything else keeps its timer,
          // including typed steps that owe no answer.
          if (phase === 'B' && typed && owesAnswer) {
            advance();
          } else {
            timerRef.current = setTimeout(advance, phase === 'A' ? a : b);
          }
```

Add `const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);` beside `timerRef`, and clear it in the same cleanup that clears `timerRef`.

Render, below the grid:

```tsx
      {typedRef.current && (
        <View style={styles.typedBlock}>
          {remainingMs !== null && (
            <Text
              testID="answer-clock"
              style={[styles.clock, remainingMs <= 0 && styles.clockOut]}
            >
              {Math.max(0, remainingMs / 1000).toFixed(1)}s
            </Text>
          )}
          <View style={styles.typedRow}>
            <TextInput
              testID="typed-answer-input"
              style={styles.typedInput}
              value={typedText}
              editable={remainingMs !== null}
              autoCorrect={false}
              placeholder={remainingMs === null ? 'まだ答えません' : '答えを入力'}
              onChangeText={(text) => {
                setTypedText(text);
                typedRef.current?.push(text);
              }}
              onSubmitEditing={() => typedRef.current?.submit()}
              returnKeyType="send"
            />
            <Pressable testID="typed-submit" onPress={() => typedRef.current?.submit()}>
              <Text style={styles.typedSend}>送る</Text>
            </Pressable>
          </View>
        </View>
      )}
```

Styles: `clock` green `#4caf7d`, `clockOut` red `#e5534b`.

Size the grid from the space actually left over, using the `size` prop from
Task 7. Measure the container the grid sits in:

```tsx
const [gridBox, setGridBox] = useState(300);
...
<View
  style={styles.gridBox}
  onLayout={(event) => {
    const { width, height } = event.nativeEvent.layout;
    setGridBox(Math.min(width, height));
  }}
>
  <Grid ... size={gridBox} />
</View>
```

`styles.gridBox` is `{ flex: 1, alignItems: 'center', justifyContent: 'center' }`,
so the grid takes whatever the question, clock, field and keyboard leave behind
and no more.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/ui/__tests__/GameScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the whole suite**

Run: `npm test && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui/GameScreen.tsx src/ui/__tests__/GameScreen.test.tsx
git commit -m "feat(ui): タイプ回答 — 提出でステップを進め、時計を出す"
```

---

### Task 9: Results screen reports on-time

**Files:**
- Modify: `src/ui/ResultsScreen.tsx:44-95`
- Test: `src/ui/__tests__/ResultsScreen.test.tsx`

**Interfaces:**
- Consumes: `engine.onTimeScore`, `AnswerReview.onTime`, `AnswerReview.budgetMs` from Task 3.
- Produces: `testID="review-late-{index}"` per late row.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/__tests__/ResultsScreen.test.tsx`:

```ts
describe('ResultsScreen on-time reporting', () => {
  function timedEngine(elapsedMs: number): RoundEngine {
    const plan = buildRound(2, BANK, Math.random);
    const engine = new RoundEngine(plan, { budgetBaseMs: 4000 });
    for (const step of plan.steps) {
      if (step.recallTarget === null) {
        engine.submitStep(step.index, { tap: null, transcript: null });
        continue;
      }
      engine.submitStep(step.index, {
        tap: plan.steps[step.recallTarget].position,
        transcript: 'こたえ',
        elapsedMs,
      });
    }
    engine.takePending();
    return engine;
  }

  it('shows the 時間内 percentage', () => {
    const { getByText } = render(
      <ResultsScreen engine={timedEngine(1000)} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(getByText(/時間内.*100%/)).toBeTruthy();
  });

  it('marks the rows that ran over', () => {
    const { getAllByTestId } = render(
      <ResultsScreen engine={timedEngine(99999)} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(getAllByTestId(/^review-late-/)).toHaveLength(9);
  });

  it('marks nothing late when everything was in time', () => {
    const { queryByTestId } = render(
      <ResultsScreen engine={timedEngine(1000)} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(queryByTestId('review-late-2')).toBeNull();
  });

  /** Voice mode has no clock, so the line must not appear at all. */
  it('says nothing about time in voice mode', () => {
    const { queryByText, queryByTestId } = render(
      <ResultsScreen engine={mixedEngine()} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(queryByText(/時間内/)).toBeNull();
    expect(queryByTestId('review-late-2')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/ui/__tests__/ResultsScreen.test.tsx`
Expected: FAIL — no `時間内` text

- [ ] **Step 3: Write minimal implementation**

In `src/ui/ResultsScreen.tsx`, after the `回答` row:

```tsx
      {engine.onTimeScore !== null && (
        <Text style={styles.row}>時間内　{pct(engine.onTimeScore)}</Text>
      )}
```

Inside the review row, after the `答え:` line:

```tsx
              {item.onTime === false && (
                <Text testID={`review-late-${item.index}`} style={styles.late}>
                  時間超過（目安 {(item.budgetMs / 1000).toFixed(0)}s）
                </Text>
              )}
```

Add the style: `late: { color: '#e5534b', fontSize: 13, marginTop: 2 }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/ui/__tests__/ResultsScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/ResultsScreen.tsx src/ui/__tests__/ResultsScreen.test.tsx
git commit -m "feat(results): 時間内の割合と、時間を超えた行を出す"
```

---

### Task 10: History, docs, and deploy

**Files:**
- Modify: `src/store/storage.ts` (`RoundRecord`), `src/ui/GameScreen.tsx` (`appendHistory` call), `docs/RUNBOOK.md`, `start-app.bat`
- Test: `src/store/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: `engine.onTimeScore` from Task 3.
- Produces: `RoundRecord.onTimeScore?: number | null`.

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/storage.test.ts`:

```ts
it('records the on-time score, and reads rounds saved before it existed', async () => {
  await AsyncStorage.setItem(
    'nback.history',
    JSON.stringify([{ date: '2026-08-01', n: 2, positionScore: 1, answerScore: 1, unresolved: 0 }]),
  );
  await appendHistory({
    date: '2026-08-20',
    n: 2,
    positionScore: 1,
    answerScore: 1,
    unresolved: 0,
    seriesId: 'standard',
    onTimeScore: 0.5,
  });
  const history = await loadHistory();
  expect(history[0].onTimeScore).toBeUndefined();
  expect(history[history.length - 1].onTimeScore).toBe(0.5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/storage.test.ts`
Expected: FAIL — `onTimeScore` not assignable to `RoundRecord`

- [ ] **Step 3: Write minimal implementation**

In `src/store/storage.ts`, add to `RoundRecord`:

```ts
  /** Absent on rounds recorded before typed mode, and null in voice mode. */
  onTimeScore?: number | null;
```

In `src/ui/GameScreen.tsx`, add to the `appendHistory({...})` call:

```ts
                onTimeScore: engine.onTimeScore,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/storage.test.ts`
Expected: PASS

- [ ] **Step 5: Update the runbook**

In `docs/RUNBOOK.md`, under 「設定画面で切り替えるのは…」, add:

```markdown
- **回答のしかた** — `入力` (既定) は画面の入力欄に打って答える。キーボードの
  マイクキーで喋れば端末のディクテーションが文字にするので、**誤認識を送る前に
  直せる**。`音声` はアプリ自身の認識器を使う従来の形で、直す機会がない。
- **考える時間の基準** — 入力モードの時計の長さ。`基準 + 答え1文字につき1秒`。
  緑のバーが0になると赤くなるが、**そこでラウンドは進まない** — 締切ではなく的で、
  超過は結果画面に出るだけ。Nは正答率だけで上下する。
```

Update the test count line at the top to the actual number from `npm test`.

- [ ] **Step 6: Run everything and update the launcher count**

Run: `npm test && npx tsc --noEmit`
Then set the count in `start-app.bat:19` to the number the suite reports.

- [ ] **Step 7: Commit**

```bash
git add src/store/storage.ts src/store/__tests__/storage.test.ts src/ui/GameScreen.tsx docs/RUNBOOK.md start-app.bat
git commit -m "feat(store): 時間内の割合を履歴に残し、RUNBOOK を追従させる"
```

- [ ] **Step 8: Verify the native bundle still builds**

Run: `npm run check:bundle`
Expected: both ios and web export successfully. `TextInput` is core React Native, so nothing new is pulled in — but this is exactly the class of change the check exists for.

- [ ] **Step 9: Deploy**

```bash
export CLOUDFLARE_API_TOKEN=$(tr -d ' \t\r\n' < ~/.cf-token)
export CLOUDFLARE_ACCOUNT_ID=9edaf3109e6d9633c45b02c2af547648
rm -rf dist/web
EXPO_PUBLIC_ANTHROPIC_API_KEY= npx expo export --platform web --output-dir dist/web
npx wrangler pages deploy dist/web --project-name nback-voice --branch main --commit-dirty=true
```

Then verify with a cache-buster, since a stale error page can be served with HTTP 200 right after a deploy:

```bash
curl -s --compressed "https://nback-voice.pages.dev/?cb=$$" | grep -o '<title>[^<]*</title>'
```

Expected: `<title>音声N-back</title>`

---

## Manual verification (device only)

Neither Jest nor the browser can show these. Run them on the iPhone against
`https://nback-voice.pages.dev`:

- [ ] The keyboard's mic key dictates into the field
- [ ] A misheard word can be corrected before sending
- [ ] The keyboard stays up for the whole round
- [ ] The grid is comfortably tappable above the keyboard
- [ ] The question is still spoken and is never clipped
- [ ] The clock turns red without the round advancing
- [ ] 時間内 appears on the results screen with per-row 時間超過 marks
