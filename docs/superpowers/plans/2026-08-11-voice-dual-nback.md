# Voice Dual N-Back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an iPhone dual N-back app where the user taps the grid position from N steps back and speaks the answer to the question from N steps back, with answers graded by Apple's on-device Japanese recognizer plus Claude.

**Architecture:** All game rules live in `src/engine/` and `src/judge/` as plain TypeScript classes with injected dependencies and no React Native imports, so the entire game is exercised by Jest with no device, mic, or network. Device concerns (`speech/`, `store/`, `ui/`) are thin adapters behind narrow interfaces. Answer grading is asynchronous and never blocks the step timer — the N-step lag hides the latency.

**Tech Stack:** Expo SDK (React Native) + TypeScript, `expo-speech` (TTS), `expo-speech-recognition` (STT), `@anthropic-ai/sdk`, `@react-native-async-storage/async-storage`, Jest via `jest-expo`.

**Spec:** `docs/superpowers/specs/2026-08-11-voice-dual-nback-design.md`

## Global Constraints

- **Language is `ja-JP` everywhere** — TTS `language: 'ja-JP'`, STT `lang: 'ja-JP'`. Never hardcode any other locale.
- **`src/engine/`, `src/judge/`, `src/content/` must not import React, React Native, or any `expo-*` package.** This is what keeps them testable. A test that needs a device has been written wrong.
- **Model id is `claude-opus-5`**, declared once as a constant in `src/judge/claude.ts`. No other file names a model.
- **Round shape: 9 stimuli + N trailing recall-only steps = `9 + N` total steps, always exactly 9 scored responses.**
- **未判定 (unresolved) answers are never counted wrong** — excluded from both numerator and denominator of the answer score.
- **Grid positions are `0..8`, row-major** (0 = top-left, 4 = center, 8 = bottom-right).
- **Default step timing:** 5000ms total — phase A 2000ms (speak, mic off), phase B 3000ms (answer, mic on). Configurable total 3000–8000ms, split 40%/60%.
- **Adaptive N:** start 2, floor 1, no ceiling.
- Every task ends with a passing test run and a commit.

---

### Task 1: Project scaffold, Jest, and the adaptive-N rule

Scaffolds the Expo app and proves the pure-TypeScript test cycle works by implementing the smallest engine unit.

**Files:**
- Create: `package.json`, `tsconfig.json`, `App.tsx`, `app.json` (from the Expo template)
- Create: `src/engine/adaptive.ts`
- Test: `src/engine/__tests__/adaptive.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `nextN(roundScore: number, currentN: number): number`

- [ ] **Step 1: Scaffold the Expo app into the existing repo**

The repo already contains `.git` and `docs/`, so scaffold into a temp directory and move the files in.

`create-expo-app` runs `git init` in the directory it creates. Its `.git` **must** be removed before copying, or it overwrites this repo's history.

```bash
cd /mnt/c/Projects/nback-voice
npx create-expo-app@latest .tmp-scaffold --template blank-typescript
rm -rf .tmp-scaffold/.git
cp -r .tmp-scaffold/. .
rm -rf .tmp-scaffold
git log --oneline | head -3   # must still show the design and plan commits
```

- [ ] **Step 2: Install Jest**

```bash
cd /mnt/c/Projects/nback-voice
npx expo install jest-expo jest --dev
npm install --save-dev @types/jest
```

- [ ] **Step 3: Add the Jest config and test script to `package.json`**

Add these two top-level keys to `package.json` (merge into the existing `scripts` object):

```json
{
  "scripts": {
    "test": "jest"
  },
  "jest": {
    "preset": "jest-expo",
    "testMatch": ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"]
  }
}
```

- [ ] **Step 4: Write the failing test**

Create `src/engine/__tests__/adaptive.test.ts`:

```ts
import { nextN } from '../adaptive';

describe('nextN', () => {
  it('raises N when the round score is at or above 80%', () => {
    expect(nextN(0.8, 2)).toBe(3);
    expect(nextN(1.0, 2)).toBe(3);
  });

  it('lowers N when the round score is at or below 50%', () => {
    expect(nextN(0.5, 3)).toBe(2);
    expect(nextN(0.0, 3)).toBe(2);
  });

  it('holds N between the thresholds', () => {
    expect(nextN(0.51, 2)).toBe(2);
    expect(nextN(0.79, 2)).toBe(2);
  });

  it('never drops below 1', () => {
    expect(nextN(0.0, 1)).toBe(1);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npm test -- adaptive`
Expected: FAIL — `Cannot find module '../adaptive'`

- [ ] **Step 6: Write the implementation**

Create `src/engine/adaptive.ts`:

```ts
/** Adaptive difficulty rule. Applied once at the end of each round. */
export function nextN(roundScore: number, currentN: number): number {
  if (roundScore >= 0.8) return currentN + 1;
  if (roundScore <= 0.5) return Math.max(1, currentN - 1);
  return currentN;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- adaptive`
Expected: PASS, 4 tests

- [ ] **Step 8: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add -A
git commit -m "feat(engine): Expoプロジェクト雛形 + Jest + 適応的N規則"
```

---

### Task 2: Round sequence generation

Builds the `9 + N` step plan, including which earlier step each step recalls.

**Files:**
- Create: `src/engine/types.ts`
- Create: `src/engine/sequence.ts`
- Test: `src/engine/__tests__/sequence.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Position = number` (0..8)
  - `interface Question { id: string; tier: number; q: string; accept: string[] }`
  - `interface StepPlan { index: number; position: Position | null; question: Question | null; recallTarget: number | null }`
  - `interface RoundPlan { n: number; steps: StepPlan[] }`
  - `type Rng = () => number`
  - `buildRound(n: number, bank: Question[], rng?: Rng): RoundPlan`

- [ ] **Step 1: Write the failing test**

Create `src/engine/__tests__/sequence.test.ts`:

```ts
import { buildRound } from '../sequence';
import type { Question } from '../types';

const BANK: Question[] = Array.from({ length: 20 }, (_, i) => ({
  id: `q${i}`,
  tier: 1,
  q: `質問${i}`,
  accept: [`答え${i}`],
}));

/** Deterministic rng: always returns 0, so every random pick is index 0. */
const zeroRng = () => 0;

describe('buildRound', () => {
  it('produces 9 + N steps', () => {
    expect(buildRound(2, BANK, zeroRng).steps).toHaveLength(11);
    expect(buildRound(4, BANK, zeroRng).steps).toHaveLength(13);
  });

  it('gives the first 9 steps a stimulus and the trailing N steps none', () => {
    const { steps } = buildRound(2, BANK, zeroRng);
    for (let i = 0; i < 9; i++) {
      expect(steps[i].position).not.toBeNull();
      expect(steps[i].question).not.toBeNull();
    }
    for (let i = 9; i < 11; i++) {
      expect(steps[i].position).toBeNull();
      expect(steps[i].question).toBeNull();
    }
  });

  it('gives the first N steps no recall target and every later step index - N', () => {
    const { steps } = buildRound(2, BANK, zeroRng);
    expect(steps[0].recallTarget).toBeNull();
    expect(steps[1].recallTarget).toBeNull();
    expect(steps[2].recallTarget).toBe(0);
    expect(steps[10].recallTarget).toBe(8);
  });

  it('produces exactly 9 scored responses regardless of N', () => {
    for (const n of [1, 2, 3, 5]) {
      const scored = buildRound(n, BANK, zeroRng).steps.filter(
        (s) => s.recallTarget !== null,
      );
      expect(scored).toHaveLength(9);
    }
  });

  it('keeps every position within 0..8', () => {
    const { steps } = buildRound(3, BANK, Math.random);
    for (const s of steps.slice(0, 9)) {
      expect(s.position).toBeGreaterThanOrEqual(0);
      expect(s.position).toBeLessThanOrEqual(8);
    }
  });

  it('never repeats a question within a round', () => {
    const { steps } = buildRound(2, BANK, Math.random);
    const ids = steps.slice(0, 9).map((s) => s.question!.id);
    expect(new Set(ids).size).toBe(9);
  });

  it('throws when the bank has fewer than 9 questions', () => {
    expect(() => buildRound(2, BANK.slice(0, 8), zeroRng)).toThrow(
      /at least 9 questions/,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- sequence`
Expected: FAIL — `Cannot find module '../sequence'`

- [ ] **Step 3: Write the types**

Create `src/engine/types.ts`:

```ts
/** Grid position, 0..8, row-major (0 = top-left, 4 = center, 8 = bottom-right). */
export type Position = number;

export interface Question {
  id: string;
  /** 1 = trivially known, 2 = general knowledge, 3 = one-step inference. */
  tier: number;
  q: string;
  /** Accepted answers, including synonyms. Grown at runtime by the judge. */
  accept: string[];
}

export interface StepPlan {
  index: number;
  /** Where the block flashes. null on trailing recall-only steps. */
  position: Position | null;
  /** The question spoken. null on trailing recall-only steps. */
  question: Question | null;
  /** Index of the step this one recalls. null for the first N steps. */
  recallTarget: number | null;
}

export interface RoundPlan {
  n: number;
  steps: StepPlan[];
}

export type Rng = () => number;
```

- [ ] **Step 4: Write the implementation**

Create `src/engine/sequence.ts`:

```ts
import type { Position, Question, RoundPlan, Rng, StepPlan } from './types';

export const STIMULI_PER_ROUND = 9;
const GRID_SIZE = 9;

function pickIndex(length: number, rng: Rng): number {
  return Math.min(length - 1, Math.floor(rng() * length));
}

/**
 * Build a round: 9 stimuli followed by N recall-only steps, so all 9 questions
 * get answered. Exactly 9 steps carry a recallTarget regardless of N.
 */
export function buildRound(
  n: number,
  bank: Question[],
  rng: Rng = Math.random,
): RoundPlan {
  if (bank.length < STIMULI_PER_ROUND) {
    throw new Error(
      `bank must contain at least 9 questions, got ${bank.length}`,
    );
  }

  const pool = [...bank];
  const steps: StepPlan[] = [];

  for (let i = 0; i < STIMULI_PER_ROUND + n; i++) {
    const isStimulus = i < STIMULI_PER_ROUND;
    let position: Position | null = null;
    let question: Question | null = null;

    if (isStimulus) {
      position = pickIndex(GRID_SIZE, rng);
      question = pool.splice(pickIndex(pool.length, rng), 1)[0];
    }

    steps.push({
      index: i,
      position,
      question,
      recallTarget: i >= n ? i - n : null,
    });
  }

  return { n, steps };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- sequence`
Expected: PASS, 7 tests

- [ ] **Step 6: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add -A
git commit -m "feat(engine): 9+Nステップのラウンド生成"
```

---

### Task 3: RoundEngine — two-stage scoring

The core. Position scores synchronously at step close; answer verdicts arrive later, possibly after the round ends.

**Files:**
- Create: `src/engine/round.ts`
- Create: `src/engine/index.ts`
- Test: `src/engine/__tests__/round.test.ts`

**Interfaces:**
- Consumes: `buildRound`, `nextN`, types from Task 2
- Produces:
  - `interface StepSubmission { tap: Position | null; transcript: string | null }`
  - `interface PendingAnswer { index: number; question: Question; transcript: string }`
  - `class RoundEngine` with:
    - `constructor(plan: RoundPlan)`
    - `submitStep(index: number, input: StepSubmission): void`
    - `resolveAnswer(index: number, correct: boolean): void`
    - `takePending(): PendingAnswer[]` — returns answers awaiting a verdict and clears the buffer
    - `get positionScore(): number`
    - `get answerScore(): number | null`
    - `get roundScore(): number`
    - `get unresolvedCount(): number`
    - `nextN(currentN: number): number`
- `src/engine/index.ts` re-exports everything from `types`, `sequence`, `adaptive`, `round`.

- [ ] **Step 1: Write the failing test**

Create `src/engine/__tests__/round.test.ts`:

```ts
import { RoundEngine } from '../round';
import { buildRound } from '../sequence';
import type { Question, RoundPlan } from '../types';

const BANK: Question[] = Array.from({ length: 20 }, (_, i) => ({
  id: `q${i}`,
  tier: 1,
  q: `質問${i}`,
  accept: [`答え${i}`],
}));

function plan(n = 2): RoundPlan {
  return buildRound(n, BANK, Math.random);
}

/** Submit every scored step with a correct tap and some transcript. */
function submitAllCorrectTaps(engine: RoundEngine, p: RoundPlan) {
  for (const step of p.steps) {
    if (step.recallTarget === null) {
      engine.submitStep(step.index, { tap: null, transcript: null });
      continue;
    }
    engine.submitStep(step.index, {
      tap: p.steps[step.recallTarget].position,
      transcript: 'こたえ',
    });
  }
}

describe('RoundEngine position scoring', () => {
  it('scores a tap against the stimulus N steps back, not the current one', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    expect(engine.positionScore).toBe(1);
  });

  it('marks a tap wrong when it matches the current step instead of the lagged one', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    // Step 2 recalls step 0. Tap step 2's own position instead.
    engine.submitStep(2, { tap: p.steps[2].position, transcript: null });
    // Guard: only meaningful if the two positions actually differ.
    if (p.steps[2].position !== p.steps[0].position) {
      expect(engine.positionScore).toBe(0);
    }
  });

  it('divides by 9 scored steps, not by total steps', () => {
    const p = plan(3); // 12 total steps, 9 scored
    const engine = new RoundEngine(p);
    let done = 0;
    for (const step of p.steps) {
      if (step.recallTarget === null) continue;
      if (done++ >= 3) break;
      engine.submitStep(step.index, {
        tap: p.steps[step.recallTarget].position,
        transcript: null,
      });
    }
    expect(engine.positionScore).toBeCloseTo(3 / 9);
  });

  it('counts a null tap as wrong', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    engine.submitStep(2, { tap: null, transcript: null });
    expect(engine.positionScore).toBe(0);
  });

  it('rejects submitting the same step twice', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    engine.submitStep(2, { tap: 0, transcript: null });
    expect(() => engine.submitStep(2, { tap: 0, transcript: null })).toThrow(
      /already submitted/,
    );
  });
});

describe('RoundEngine answer scoring', () => {
  it('reports pending answers for scored steps that produced a transcript', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    const pending = engine.takePending();
    expect(pending).toHaveLength(9);
    expect(pending[0].question).toBe(p.steps[p.steps[2].recallTarget!].question);
    expect(engine.takePending()).toHaveLength(0); // buffer cleared
  });

  it('does not queue an answer when the user said nothing', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    engine.submitStep(2, { tap: 0, transcript: null });
    expect(engine.takePending()).toHaveLength(0);
  });

  it('returns null for the answer score before anything resolves', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    expect(engine.answerScore).toBeNull();
  });

  it('divides by resolved answers only, excluding 未判定', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    const pending = engine.takePending();
    engine.resolveAnswer(pending[0].index, true);
    engine.resolveAnswer(pending[1].index, true);
    engine.resolveAnswer(pending[2].index, false);
    // 3 resolved, 2 correct. The other 6 are 未判定 and must not count.
    expect(engine.answerScore).toBeCloseTo(2 / 3);
    expect(engine.unresolvedCount).toBe(6);
  });

  it('accepts verdicts in any order and after the round has ended', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    const pending = engine.takePending();
    engine.resolveAnswer(pending[8].index, true);
    engine.resolveAnswer(pending[0].index, true);
    expect(engine.answerScore).toBe(1);
  });

  it('ignores a verdict for a step that was never queued', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    engine.resolveAnswer(5, true);
    expect(engine.answerScore).toBeNull();
  });
});

describe('RoundEngine round score', () => {
  it('averages both channels when answers resolved', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p); // position 1.0
    const pending = engine.takePending();
    for (const a of pending) engine.resolveAnswer(a.index, false); // answers 0.0
    expect(engine.roundScore).toBeCloseTo(0.5);
  });

  it('falls back to the position score alone when nothing resolved', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    expect(engine.roundScore).toBe(1);
  });

  it('feeds the round score into the adaptive rule', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    expect(engine.nextN(2)).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- round`
Expected: FAIL — `Cannot find module '../round'`

- [ ] **Step 3: Write the implementation**

Create `src/engine/round.ts`:

```ts
import { nextN as adaptiveNextN } from './adaptive';
import { STIMULI_PER_ROUND } from './sequence';
import type { Position, Question, RoundPlan } from './types';

export interface StepSubmission {
  tap: Position | null;
  transcript: string | null;
}

export interface PendingAnswer {
  index: number;
  question: Question;
  transcript: string;
}

interface AnswerRecord {
  question: Question;
  transcript: string;
  /** null = 未判定 (never counted wrong). */
  correct: boolean | null;
}

/**
 * Scores one round. Fed in two stages because grading is asynchronous:
 * submitStep() scores the position channel immediately, resolveAnswer()
 * arrives later — possibly after the round has ended.
 */
export class RoundEngine {
  private readonly plan: RoundPlan;
  private readonly submitted = new Set<number>();
  private correctTaps = 0;
  private readonly answers = new Map<number, AnswerRecord>();
  private pendingBuffer: PendingAnswer[] = [];

  constructor(plan: RoundPlan) {
    this.plan = plan;
  }

  submitStep(index: number, input: StepSubmission): void {
    if (this.submitted.has(index)) {
      throw new Error(`step ${index} already submitted`);
    }
    this.submitted.add(index);

    const step = this.plan.steps[index];
    if (!step || step.recallTarget === null) return; // observe-only step

    const target = this.plan.steps[step.recallTarget];

    if (input.tap !== null && input.tap === target.position) {
      this.correctTaps++;
    }

    const transcript = input.transcript?.trim();
    if (transcript && target.question) {
      this.answers.set(index, {
        question: target.question,
        transcript,
        correct: null,
      });
      this.pendingBuffer.push({ index, question: target.question, transcript });
    }
  }

  resolveAnswer(index: number, correct: boolean): void {
    const record = this.answers.get(index);
    if (!record) return; // verdict for a step that was never queued
    record.correct = correct;
  }

  /** Answers awaiting a verdict. Clears the buffer so each is dispatched once. */
  takePending(): PendingAnswer[] {
    const out = this.pendingBuffer;
    this.pendingBuffer = [];
    return out;
  }

  get positionScore(): number {
    return this.correctTaps / STIMULI_PER_ROUND;
  }

  /** null when no answer has been resolved — the channel is simply absent. */
  get answerScore(): number | null {
    const resolved = [...this.answers.values()].filter(
      (a) => a.correct !== null,
    );
    if (resolved.length === 0) return null;
    return resolved.filter((a) => a.correct).length / resolved.length;
  }

  get unresolvedCount(): number {
    return [...this.answers.values()].filter((a) => a.correct === null).length;
  }

  get roundScore(): number {
    const answer = this.answerScore;
    if (answer === null) return this.positionScore;
    return (this.positionScore + answer) / 2;
  }

  nextN(currentN: number): number {
    return adaptiveNextN(this.roundScore, currentN);
  }
}
```

- [ ] **Step 4: Create the engine barrel export**

Create `src/engine/index.ts`:

```ts
export * from './types';
export * from './sequence';
export * from './adaptive';
export * from './round';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- round`
Expected: PASS, 13 tests

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, all tests from Tasks 1–3

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add -A
git commit -m "feat(engine): 位置は同期・回答は非同期の二段採点 (未判定は除外)"
```

---

### Task 4: Question bank, transcript normalization, local matching

Free, instant grading for the common case.

**Files:**
- Create: `src/content/bank.json`
- Create: `src/content/bank.ts`
- Create: `src/content/normalize.ts`
- Create: `src/judge/local.ts`
- Test: `src/content/__tests__/normalize.test.ts`
- Test: `src/judge/__tests__/local.test.ts`

**Interfaces:**
- Consumes: `Question` from `src/engine/types`
- Produces:
  - `normalizeTranscript(raw: string): string`
  - `loadBank(learned?: Record<string, string[]>): Question[]`
  - `localMatch(question: Question, transcript: string): boolean`

- [ ] **Step 1: Write the failing normalization test**

Create `src/content/__tests__/normalize.test.ts`:

```ts
import { normalizeTranscript } from '../normalize';

describe('normalizeTranscript', () => {
  it('folds katakana to hiragana', () => {
    expect(normalizeTranscript('ワンワン')).toBe('わんわん');
    expect(normalizeTranscript('トウキョウ')).toBe('とうきょう');
  });

  it('strips whitespace including full-width spaces', () => {
    expect(normalizeTranscript(' わん わん　')).toBe('わんわん');
  });

  it('strips Japanese punctuation', () => {
    expect(normalizeTranscript('わん、わん。')).toBe('わんわん');
    expect(normalizeTranscript('東京！')).toBe('東京');
  });

  it('strips polite and hedging suffixes', () => {
    expect(normalizeTranscript('東京です')).toBe('東京');
    expect(normalizeTranscript('東京だと思う')).toBe('東京');
    expect(normalizeTranscript('東京かな')).toBe('東京');
    expect(normalizeTranscript('東京ですね')).toBe('東京');
  });

  it('leaves kanji untouched', () => {
    expect(normalizeTranscript('東京都')).toBe('東京都');
  });

  it('handles an empty string', () => {
    expect(normalizeTranscript('')).toBe('');
  });

  it('does not strip a suffix that is the entire answer', () => {
    expect(normalizeTranscript('です')).toBe('です');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- normalize`
Expected: FAIL — `Cannot find module '../normalize'`

- [ ] **Step 3: Write the normalizer**

Create `src/content/normalize.ts`:

```ts
/** Suffixes users append that carry no answer content. Longest first. */
const SUFFIXES = ['だと思います', 'だと思う', 'ですね', 'かな', 'だよ', 'です', 'かも'];

const PUNCTUATION = /[、。！？!?,.　\s]/g;

function katakanaToHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60),
  );
}

/**
 * Canonicalize a spoken answer for comparison: fold katakana, drop whitespace
 * and punctuation, strip polite/hedging suffixes.
 */
export function normalizeTranscript(raw: string): string {
  let s = katakanaToHiragana(raw).replace(PUNCTUATION, '');

  for (const suffix of SUFFIXES) {
    // Never strip down to nothing — the suffix may BE the answer.
    if (s.length > suffix.length && s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }

  return s;
}
```

- [ ] **Step 4: Run the normalization test to verify it passes**

Run: `npm test -- normalize`
Expected: PASS, 7 tests

- [ ] **Step 5: Write the failing local-match test**

Create `src/judge/__tests__/local.test.ts`:

```ts
import { localMatch } from '../local';
import type { Question } from '../../engine/types';

const DOG: Question = {
  id: 'q042',
  tier: 2,
  q: '犬の鳴き声は？',
  accept: ['わん', 'わんわん'],
};

describe('localMatch', () => {
  it('matches an exact accepted answer', () => {
    expect(localMatch(DOG, 'わん')).toBe(true);
  });

  it('matches across katakana and hiragana', () => {
    expect(localMatch(DOG, 'ワンワン')).toBe(true);
  });

  it('matches through a polite suffix', () => {
    expect(localMatch(DOG, 'わんです')).toBe(true);
  });

  it('rejects an unlisted answer', () => {
    expect(localMatch(DOG, 'にゃー')).toBe(false);
  });

  it('rejects an empty transcript', () => {
    expect(localMatch(DOG, '')).toBe(false);
    expect(localMatch(DOG, '　')).toBe(false);
  });

  it('normalizes the accept list too, so a katakana entry matches hiragana speech', () => {
    const q: Question = { ...DOG, accept: ['ワン'] };
    expect(localMatch(q, 'わん')).toBe(true);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- local`
Expected: FAIL — `Cannot find module '../local'`

- [ ] **Step 7: Write the local matcher**

Create `src/judge/local.ts`:

```ts
import { normalizeTranscript } from '../content/normalize';
import type { Question } from '../engine/types';

/** Free, instant grading. Both sides are normalized before comparison. */
export function localMatch(question: Question, transcript: string): boolean {
  const said = normalizeTranscript(transcript);
  if (said.length === 0) return false;
  return question.accept.some((a) => normalizeTranscript(a) === said);
}
```

- [ ] **Step 8: Create the question bank**

A round consumes 9 questions without repeats, so a small bank makes every round feel identical. Create `src/content/bank.json` with exactly this content:

```json
[
  { "id": "q001", "tier": 1, "q": "犬の鳴き声は？", "accept": ["わん", "わんわん", "ばうばう"] },
  { "id": "q002", "tier": 1, "q": "猫の鳴き声は？", "accept": ["にゃー", "にゃん", "にゃーにゃー"] },
  { "id": "q003", "tier": 1, "q": "牛の鳴き声は？", "accept": ["もー", "もーもー"] },
  { "id": "q004", "tier": 1, "q": "空の色は？", "accept": ["青", "あお", "水色"] },
  { "id": "q005", "tier": 1, "q": "雪の色は？", "accept": ["白", "しろ"] },
  { "id": "q006", "tier": 1, "q": "トマトの色は？", "accept": ["赤", "あか"] },
  { "id": "q007", "tier": 1, "q": "信号で止まれの色は？", "accept": ["赤", "あか"] },
  { "id": "q008", "tier": 1, "q": "魚が住むところは？", "accept": ["水", "水中", "海", "川"] },
  { "id": "q009", "tier": 1, "q": "鳥が飛ぶところは？", "accept": ["空", "そら"] },
  { "id": "q010", "tier": 1, "q": "一週間は何日？", "accept": ["7", "七", "なな", "しち", "なのか", "ななにち"] },
  { "id": "q011", "tier": 1, "q": "一年は何ヶ月？", "accept": ["12", "十二", "じゅうに"] },
  { "id": "q012", "tier": 1, "q": "手の指は何本？", "accept": ["5", "五", "ご", "ごほん", "10", "十", "じゅう"] },
  { "id": "q013", "tier": 1, "q": "氷は冷たい？熱い？", "accept": ["冷たい", "つめたい"] },
  { "id": "q014", "tier": 1, "q": "砂糖は甘い？辛い？", "accept": ["甘い", "あまい"] },
  { "id": "q015", "tier": 1, "q": "夜に空に見えるのは？", "accept": ["月", "つき", "星", "ほし"] },
  { "id": "q016", "tier": 2, "q": "日本の首都は？", "accept": ["東京", "東京都", "とうきょう"] },
  { "id": "q017", "tier": 2, "q": "富士山がある国は？", "accept": ["日本", "にほん", "にっぽん"] },
  { "id": "q018", "tier": 2, "q": "太陽が昇る方角は？", "accept": ["東", "ひがし"] },
  { "id": "q019", "tier": 2, "q": "太陽が沈む方角は？", "accept": ["西", "にし"] },
  { "id": "q020", "tier": 2, "q": "水は何度で凍る？", "accept": ["0", "零", "ゼロ", "れい", "0度", "零度"] },
  { "id": "q021", "tier": 2, "q": "地球で一番大きい海は？", "accept": ["太平洋", "たいへいよう"] },
  { "id": "q022", "tier": 2, "q": "虹は何色といわれる？", "accept": ["7", "七", "なな", "しち", "ななしょく", "なないろ"] },
  { "id": "q023", "tier": 2, "q": "冬の次の季節は？", "accept": ["春", "はる"] },
  { "id": "q024", "tier": 2, "q": "パンを作る主な材料は？", "accept": ["小麦", "小麦粉", "こむぎ", "こむぎこ"] },
  { "id": "q025", "tier": 2, "q": "光と音、速いのはどっち？", "accept": ["光", "ひかり"] },
  { "id": "q026", "tier": 2, "q": "血液を送り出す臓器は？", "accept": ["心臓", "しんぞう"] },
  { "id": "q027", "tier": 2, "q": "オリンピックは何年ごと？", "accept": ["4", "四", "よん", "よねん", "4年"] },
  { "id": "q028", "tier": 2, "q": "日本で一番高い山は？", "accept": ["富士山", "ふじさん"] },
  { "id": "q029", "tier": 2, "q": "1時間は何分？", "accept": ["60", "六十", "ろくじゅう", "ろくじっぷん"] },
  { "id": "q030", "tier": 2, "q": "植物が育つのに必要な、空から降るものは？", "accept": ["雨", "あめ", "水", "みず"] }
]
```

- [ ] **Step 9: Write the bank loader**

Create `src/content/bank.ts`:

```ts
import type { Question } from '../engine/types';
import raw from './bank.json';

const SHIPPED = raw as Question[];

/**
 * The shipped bank with runtime-learned synonyms merged over it. Learning is
 * stored separately so a bank update never discards it.
 */
export function loadBank(learned: Record<string, string[]> = {}): Question[] {
  return SHIPPED.map((q) => {
    const extra = learned[q.id];
    if (!extra || extra.length === 0) return q;
    return { ...q, accept: [...new Set([...q.accept, ...extra])] };
  });
}
```

- [ ] **Step 10: Enable JSON imports in `tsconfig.json`**

Add to `compilerOptions`:

```json
{
  "compilerOptions": {
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 11: Run the whole suite**

Run: `npm test`
Expected: PASS, all tests

- [ ] **Step 12: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add -A
git commit -m "feat(content): 問題バンク・表記ゆれ正規化・ローカル同義語照合"
```

---

### Task 5: Claude judge client

**Files:**
- Create: `src/judge/types.ts`
- Create: `src/judge/claude.ts`
- Test: `src/judge/__tests__/claude.test.ts`

**Interfaces:**
- Consumes: `Question` from `src/engine/types`
- Produces:
  - `interface Verdict { correct: boolean; matched: string | null }`
  - `interface JudgeClient { judge(question: Question, transcript: string): Promise<Verdict> }`
  - `class ClaudeJudgeClient implements JudgeClient` — `constructor(apiKey: string)`
  - `parseVerdict(text: string): Verdict` (exported for testing)
  - `const JUDGE_MODEL = 'claude-opus-5'`

- [ ] **Step 1: Install the SDK**

```bash
cd /mnt/c/Projects/nback-voice
npm install @anthropic-ai/sdk
```

- [ ] **Step 2: Write the failing test**

`parseVerdict` is the part worth testing — the network call itself is exercised on-device. Create `src/judge/__tests__/claude.test.ts`:

```ts
import { parseVerdict } from '../claude';

describe('parseVerdict', () => {
  it('parses a correct verdict', () => {
    expect(parseVerdict('{"correct":true,"matched":"ワンコ"}')).toEqual({
      correct: true,
      matched: 'ワンコ',
    });
  });

  it('parses an incorrect verdict with a null match', () => {
    expect(parseVerdict('{"correct":false,"matched":null}')).toEqual({
      correct: false,
      matched: null,
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseVerdict('  {"correct":true,"matched":null}\n').correct).toBe(true);
  });

  it('throws on malformed JSON rather than guessing', () => {
    expect(() => parseVerdict('not json')).toThrow(/verdict/i);
  });

  it('throws when correct is missing', () => {
    expect(() => parseVerdict('{"matched":"x"}')).toThrow(/verdict/i);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- claude`
Expected: FAIL — `Cannot find module '../claude'`

- [ ] **Step 4: Write the judge types**

Create `src/judge/types.ts`:

```ts
import type { Question } from '../engine/types';

export interface Verdict {
  correct: boolean;
  /** The accepted phrasing Claude matched, to be learned into the bank. */
  matched: string | null;
}

export interface JudgeClient {
  judge(question: Question, transcript: string): Promise<Verdict>;
}
```

- [ ] **Step 5: Write the Claude client**

Create `src/judge/claude.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { Question } from '../engine/types';
import type { JudgeClient, Verdict } from './types';

export const JUDGE_MODEL = 'claude-opus-5';

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    correct: { type: 'boolean' },
    matched: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['correct', 'matched'],
  additionalProperties: false,
};

const SYSTEM = [
  'あなたは日本語の一問一答クイズの採点者です。',
  '出題と、想定される正答例と、利用者が音声で答えた内容が与えられます。',
  '音声認識の誤りや言い回しの違いは許容し、意味が合っていれば正解としてください。',
  'correct には正誤を、matched には正解と判断した場合にその答えの標準的な表記を入れてください。',
  '不正解の場合 matched は null にしてください。',
].join('\n');

export function parseVerdict(text: string): Verdict {
  let data: unknown;
  try {
    data = JSON.parse(text.trim());
  } catch {
    throw new Error(`could not parse verdict: ${text.slice(0, 120)}`);
  }
  const v = data as Partial<Verdict>;
  if (typeof v.correct !== 'boolean') {
    throw new Error(`verdict missing "correct": ${text.slice(0, 120)}`);
  }
  return { correct: v.correct, matched: v.matched ?? null };
}

export class ClaudeJudgeClient implements JudgeClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({
      apiKey,
      // React Native's fetch environment is detected as browser-like by the
      // SDK's guard. This is a private development build, not a web page.
      dangerouslyAllowBrowser: true,
    });
  }

  async judge(question: Question, transcript: string): Promise<Verdict> {
    const response = await this.client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 1024,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: VERDICT_SCHEMA },
      },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            `問題: ${question.q}`,
            `正答例: ${question.accept.join(' / ')}`,
            `利用者の回答: ${transcript}`,
          ].join('\n'),
        },
      ],
    } as Anthropic.MessageCreateParamsNonStreaming);

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      throw new Error('judge response contained no text block');
    }
    return parseVerdict(block.text);
  }
}
```

If TypeScript rejects `output_config` because the installed SDK version's types lag the API, change only the cast — `as unknown as Anthropic.MessageCreateParamsNonStreaming` — and leave every field of the request body exactly as written.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- claude`
Expected: PASS, 5 tests

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add -A
git commit -m "feat(judge): Claude採点クライアント (構造化出力・effort low)"
```

---

### Task 6: Judge queue with offline degradation

**Files:**
- Create: `src/judge/queue.ts`
- Test: `src/judge/__tests__/queue.test.ts`

**Interfaces:**
- Consumes: `JudgeClient`, `Verdict`, `localMatch`, `PendingAnswer`
- Produces:
  - `interface JudgeQueueCallbacks { onVerdict(index: number, correct: boolean): void; onLearn(questionId: string, answer: string): void }`
  - `class JudgeQueue` — `constructor(client: JudgeClient, callbacks: JudgeQueueCallbacks)`, `enqueue(answer: PendingAnswer): void`, `drain(): Promise<void>` (resolves when all in-flight judgements settle)

- [ ] **Step 1: Write the failing test**

Create `src/judge/__tests__/queue.test.ts`:

```ts
import { JudgeQueue } from '../queue';
import type { JudgeClient, Verdict } from '../types';
import type { Question } from '../../engine/types';

const DOG: Question = {
  id: 'q042',
  tier: 2,
  q: '犬の鳴き声は？',
  accept: ['わん', 'わんわん'],
};

function makeQueue(client: JudgeClient) {
  const verdicts: Array<[number, boolean]> = [];
  const learned: Array<[string, string]> = [];
  const queue = new JudgeQueue(client, {
    onVerdict: (i, c) => verdicts.push([i, c]),
    onLearn: (id, a) => learned.push([id, a]),
  });
  return { queue, verdicts, learned };
}

const neverCalled: JudgeClient = {
  judge: async () => {
    throw new Error('should not have called the API');
  },
};

describe('JudgeQueue', () => {
  it('resolves a locally matched answer without calling the API', async () => {
    const { queue, verdicts } = makeQueue(neverCalled);
    queue.enqueue({ index: 2, question: DOG, transcript: 'ワンワン' });
    await queue.drain();
    expect(verdicts).toEqual([[2, true]]);
  });

  it('calls the API only when the local match misses', async () => {
    const calls: string[] = [];
    const client: JudgeClient = {
      judge: async (_q, t): Promise<Verdict> => {
        calls.push(t);
        return { correct: true, matched: 'わんこ' };
      },
    };
    const { queue, verdicts } = makeQueue(client);
    queue.enqueue({ index: 3, question: DOG, transcript: 'わんこ' });
    await queue.drain();
    expect(calls).toEqual(['わんこ']);
    expect(verdicts).toEqual([[3, true]]);
  });

  it('learns an accepted answer that was not in the bank', async () => {
    const client: JudgeClient = {
      judge: async (): Promise<Verdict> => ({ correct: true, matched: 'わんこ' }),
    };
    const { queue, learned } = makeQueue(client);
    queue.enqueue({ index: 3, question: DOG, transcript: 'わんこ' });
    await queue.drain();
    expect(learned).toEqual([['q042', 'わんこ']]);
  });

  it('does not learn from a rejected answer', async () => {
    const client: JudgeClient = {
      judge: async (): Promise<Verdict> => ({ correct: false, matched: null }),
    };
    const { queue, learned, verdicts } = makeQueue(client);
    queue.enqueue({ index: 3, question: DOG, transcript: 'にゃー' });
    await queue.drain();
    expect(learned).toEqual([]);
    expect(verdicts).toEqual([[3, false]]);
  });

  it('leaves the answer 未判定 when the API fails — never marks it wrong', async () => {
    const client: JudgeClient = {
      judge: async () => {
        throw new Error('network down');
      },
    };
    const { queue, verdicts } = makeQueue(client);
    queue.enqueue({ index: 3, question: DOG, transcript: 'わんこ' });
    await queue.drain();
    expect(verdicts).toEqual([]);
  });

  it('keeps grading later answers after one fails', async () => {
    let call = 0;
    const client: JudgeClient = {
      judge: async (): Promise<Verdict> => {
        call++;
        if (call === 1) throw new Error('network blip');
        return { correct: true, matched: null };
      },
    };
    const { queue, verdicts } = makeQueue(client);
    queue.enqueue({ index: 3, question: DOG, transcript: 'あ' });
    queue.enqueue({ index: 4, question: DOG, transcript: 'い' });
    await queue.drain();
    expect(verdicts).toEqual([[4, true]]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- queue`
Expected: FAIL — `Cannot find module '../queue'`

- [ ] **Step 3: Write the implementation**

Create `src/judge/queue.ts`:

```ts
import type { PendingAnswer } from '../engine/round';
import { localMatch } from './local';
import type { JudgeClient } from './types';

export interface JudgeQueueCallbacks {
  onVerdict(index: number, correct: boolean): void;
  onLearn(questionId: string, answer: string): void;
}

/**
 * Grades answers off the critical path. Local synonym match first (free,
 * instant); Claude only on a miss. A failed call leaves the answer 未判定 —
 * the engine excludes it from scoring rather than counting it wrong.
 */
export class JudgeQueue {
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly client: JudgeClient,
    private readonly callbacks: JudgeQueueCallbacks,
  ) {}

  enqueue(answer: PendingAnswer): void {
    if (localMatch(answer.question, answer.transcript)) {
      this.callbacks.onVerdict(answer.index, true);
      return;
    }

    const task = this.client
      .judge(answer.question, answer.transcript)
      .then((verdict) => {
        this.callbacks.onVerdict(answer.index, verdict.correct);
        if (verdict.correct) {
          this.callbacks.onLearn(
            answer.question.id,
            verdict.matched ?? answer.transcript,
          );
        }
      })
      .catch(() => {
        // 未判定. Deliberately no onVerdict call.
      })
      .finally(() => {
        this.inFlight.delete(task);
      });

    this.inFlight.add(task);
  }

  /** Resolves once every enqueued judgement has settled. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- queue`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add -A
git commit -m "feat(judge): 採点キュー — ローカル優先・失敗時は未判定・同義語学習"
```

---

### Task 7: Speech layer

Interfaces plus fakes for tests, and the Expo adapters. The listener deliberately does **not** subscribe to native events itself — the UI's React hook feeds it — so nothing outside `ui/` depends on the native event API.

**Files:**
- Create: `src/speech/types.ts`
- Create: `src/speech/fakes.ts`
- Create: `src/speech/speaker.ts`
- Create: `src/speech/listener.ts`
- Test: `src/speech/__tests__/fakes.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface Speaker { speak(text: string): Promise<void>; stop(): void }`
  - `interface Listener { start(): void; stop(): string; push(transcript: string): void }`
  - `class FakeSpeaker implements Speaker` — `spoken: string[]`
  - `class FakeListener implements Listener` — `push()` simulates recognition
  - `class ExpoSpeaker implements Speaker`
  - `class ExpoListener implements Listener`

- [ ] **Step 1: Install the native modules**

```bash
cd /mnt/c/Projects/nback-voice
npx expo install expo-speech expo-speech-recognition
```

- [ ] **Step 2: Configure the speech-recognition plugin**

Add to the `expo` object in `app.json`:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-speech-recognition",
        {
          "microphonePermission": "N-backの音声回答にマイクを使用します。",
          "speechRecognitionPermission": "回答の聞き取りに音声認識を使用します。"
        }
      ]
    ]
  }
}
```

- [ ] **Step 3: Write the failing test**

Create `src/speech/__tests__/fakes.test.ts`:

```ts
import { FakeListener, FakeSpeaker } from '../fakes';

describe('FakeSpeaker', () => {
  it('records what was spoken', async () => {
    const speaker = new FakeSpeaker();
    await speaker.speak('犬の鳴き声は？');
    expect(speaker.spoken).toEqual(['犬の鳴き声は？']);
  });
});

describe('FakeListener', () => {
  it('returns the pushed transcript on stop', () => {
    const listener = new FakeListener();
    listener.start();
    listener.push('わん');
    expect(listener.stop()).toBe('わん');
  });

  it('keeps the latest transcript when recognition revises itself', () => {
    const listener = new FakeListener();
    listener.start();
    listener.push('わ');
    listener.push('わん');
    expect(listener.stop()).toBe('わん');
  });

  // No start() in between: with one, start()'s own reset would mask the guard
  // and this test would pass even if push() ignored `listening` entirely.
  it('ignores pushes while not listening', () => {
    const listener = new FakeListener();
    listener.push('わん');
    expect(listener.stop()).toBe('');
  });

  it('resets between sessions', () => {
    const listener = new FakeListener();
    listener.start();
    listener.push('わん');
    listener.stop();
    listener.start();
    expect(listener.stop()).toBe('');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- fakes`
Expected: FAIL — `Cannot find module '../fakes'`

- [ ] **Step 5: Write the interfaces**

Create `src/speech/types.ts`:

```ts
export interface Speaker {
  /** Resolves when the utterance finishes, so phase A can end on speech end. */
  speak(text: string): Promise<void>;
  stop(): void;
}

export interface Listener {
  start(): void;
  /** Stops listening and returns the final transcript ('' if nothing heard). */
  stop(): string;
  /** Feeds a recognition result in. Called by the UI's event subscription. */
  push(transcript: string): void;
}
```

- [ ] **Step 6: Write the fakes**

Create `src/speech/fakes.ts`:

```ts
import type { Listener, Speaker } from './types';

export class FakeSpeaker implements Speaker {
  spoken: string[] = [];
  stopped = 0;

  async speak(text: string): Promise<void> {
    this.spoken.push(text);
  }

  stop(): void {
    this.stopped++;
  }
}

export class FakeListener implements Listener {
  private listening = false;
  private transcript = '';
  sessions = 0;

  start(): void {
    this.listening = true;
    this.transcript = '';
    this.sessions++;
  }

  stop(): string {
    this.listening = false;
    return this.transcript;
  }

  push(transcript: string): void {
    if (this.listening) this.transcript = transcript;
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- fakes`
Expected: PASS, 5 tests

- [ ] **Step 8: Write the Expo speaker**

Create `src/speech/speaker.ts`:

```ts
import * as Speech from 'expo-speech';
import type { Speaker } from './types';

export class ExpoSpeaker implements Speaker {
  speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      Speech.speak(text, {
        language: 'ja-JP',
        rate: 1.0,
        pitch: 1.0,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(), // never strand the round on a TTS failure
      });
    });
  }

  stop(): void {
    Speech.stop();
  }
}
```

- [ ] **Step 9: Write the Expo listener**

Create `src/speech/listener.ts`:

```ts
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type { Listener } from './types';

/**
 * Owns the recognizer's lifecycle but not its events — the UI subscribes with
 * useSpeechRecognitionEvent and calls push(). That keeps the native event API
 * confined to ui/.
 */
export class ExpoListener implements Listener {
  private listening = false;
  private transcript = '';

  static async requestPermissions(): Promise<boolean> {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return result.granted;
  }

  start(): void {
    this.transcript = '';
    this.listening = true;
    ExpoSpeechRecognitionModule.start({
      lang: 'ja-JP',
      interimResults: true,
      continuous: false,
      requiresOnDeviceRecognition: false,
      maxAlternatives: 1,
    });
  }

  stop(): string {
    this.listening = false;
    ExpoSpeechRecognitionModule.stop();
    return this.transcript;
  }

  push(transcript: string): void {
    if (this.listening) this.transcript = transcript;
  }
}
```

- [ ] **Step 10: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add -A
git commit -m "feat(speech): Speaker/Listener抽象 + Expo実装 + テスト用フェイク"
```

---

### Task 8: RoundRunner — the two-phase state machine

Drives the round. Deliberately has **no timers of its own**: the UI calls `tick()` when a phase expires, so tests step it deterministically.

**Files:**
- Create: `src/engine/runner.ts`
- Test: `src/engine/__tests__/runner.test.ts`

**Interfaces:**
- Consumes: `RoundEngine`, `RoundPlan`, `Speaker`, `Listener`, `JudgeQueue`
- Produces:
  - `type Phase = 'A' | 'B' | 'done'`
  - `interface RunnerState { stepIndex: number; phase: Phase; flashPosition: Position | null }`
  - `class RoundRunner` — `constructor(deps: { plan, engine, speaker, listener, onJudge(a: PendingAnswer): void })`, `start(): Promise<void>`, `tick(): Promise<void>`, `onTap(p: Position): void`, `get state(): RunnerState`, `get finished(): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/engine/__tests__/runner.test.ts`:

```ts
import { RoundEngine } from '../round';
import { RoundRunner } from '../runner';
import { buildRound } from '../sequence';
import { FakeListener, FakeSpeaker } from '../../speech/fakes';
import type { PendingAnswer } from '../round';
import type { Question } from '../types';

const BANK: Question[] = Array.from({ length: 20 }, (_, i) => ({
  id: `q${i}`,
  tier: 1,
  q: `質問${i}`,
  accept: [`答え${i}`],
}));

function setup(n = 2) {
  const plan = buildRound(n, BANK, Math.random);
  const engine = new RoundEngine(plan);
  const speaker = new FakeSpeaker();
  const listener = new FakeListener();
  const judged: PendingAnswer[] = [];
  const runner = new RoundRunner({
    plan,
    engine,
    speaker,
    listener,
    onJudge: (a) => judged.push(a),
  });
  return { plan, engine, speaker, listener, runner, judged };
}

describe('RoundRunner phases', () => {
  it('starts in phase A of step 0 and speaks the first question', async () => {
    const { runner, speaker, plan } = setup();
    await runner.start();
    expect(runner.state).toMatchObject({ stepIndex: 0, phase: 'A' });
    expect(speaker.spoken).toEqual([plan.steps[0].question!.q]);
  });

  it('exposes the flash position during phase A', async () => {
    const { runner, plan } = setup();
    await runner.start();
    expect(runner.state.flashPosition).toBe(plan.steps[0].position);
  });

  it('does not open the mic during phase A', async () => {
    const { runner, listener } = setup();
    await runner.start();
    expect(listener.sessions).toBe(0);
  });

  it('opens the mic on the first tick, entering phase B', async () => {
    const { runner, listener } = setup();
    await runner.start();
    await runner.tick();
    expect(runner.state.phase).toBe('B');
    expect(listener.sessions).toBe(1);
  });

  it('closes the mic and advances to the next step on the second tick', async () => {
    const { runner, plan, speaker } = setup();
    await runner.start();
    await runner.tick(); // A -> B
    await runner.tick(); // B -> next step A
    expect(runner.state).toMatchObject({ stepIndex: 1, phase: 'A' });
    expect(speaker.spoken).toEqual([
      plan.steps[0].question!.q,
      plan.steps[1].question!.q,
    ]);
  });

  it('speaks nothing on trailing recall-only steps', async () => {
    const { runner, speaker, plan } = setup(2);
    await runner.start();
    // Advance through all 9 stimulus steps (2 ticks each).
    for (let i = 0; i < 9 * 2; i++) await runner.tick();
    expect(runner.state.stepIndex).toBe(9);
    expect(speaker.spoken).toHaveLength(9);
    expect(runner.state.flashPosition).toBeNull();
    expect(plan.steps[9].question).toBeNull();
  });

  it('finishes after 9 + N steps', async () => {
    const { runner } = setup(2);
    await runner.start();
    for (let i = 0; i < 11 * 2; i++) await runner.tick();
    expect(runner.finished).toBe(true);
    expect(runner.state.phase).toBe('done');
  });
});

describe('RoundRunner scoring integration', () => {
  it('submits the tap taken during the step to the engine', async () => {
    const { runner, engine, plan } = setup(2);
    await runner.start();
    await runner.tick(); // step 0 B
    await runner.tick(); // step 1 A
    await runner.tick(); // step 1 B
    await runner.tick(); // step 2 A  (first scored step)
    runner.onTap(plan.steps[0].position!);
    await runner.tick(); // step 2 B
    await runner.tick(); // step 2 closes
    expect(engine.positionScore).toBeCloseTo(1 / 9);
  });

  it('accepts a tap during phase B as well as phase A', async () => {
    const { runner, engine, plan } = setup(2);
    await runner.start();
    for (let i = 0; i < 4; i++) await runner.tick(); // into step 2 phase A
    await runner.tick(); // step 2 phase B
    runner.onTap(plan.steps[0].position!);
    await runner.tick(); // step 2 closes
    expect(engine.positionScore).toBeCloseTo(1 / 9);
  });

  it('sends the heard transcript for judging when a step closes', async () => {
    const { runner, listener, judged, plan } = setup(2);
    await runner.start();
    for (let i = 0; i < 5; i++) await runner.tick(); // into step 2 phase B
    listener.push('わん');
    await runner.tick(); // step 2 closes
    expect(judged).toHaveLength(1);
    expect(judged[0].index).toBe(2);
    expect(judged[0].transcript).toBe('わん');
    expect(judged[0].question).toBe(plan.steps[0].question);
  });

  it('queues nothing for judging when the user said nothing', async () => {
    const { runner, judged } = setup(2);
    await runner.start();
    for (let i = 0; i < 6; i++) await runner.tick();
    expect(judged).toHaveLength(0);
  });

  it('clears the tap between steps', async () => {
    const { runner, engine, plan } = setup(2);
    await runner.start();
    for (let i = 0; i < 4; i++) await runner.tick(); // step 2 phase A
    runner.onTap(plan.steps[0].position!);
    await runner.tick();
    await runner.tick(); // step 2 closes, correct
    await runner.tick(); // step 3 phase B, no tap this time
    await runner.tick(); // step 3 closes
    expect(engine.positionScore).toBeCloseTo(1 / 9);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- runner`
Expected: FAIL — `Cannot find module '../runner'`

- [ ] **Step 3: Write the implementation**

Create `src/engine/runner.ts`:

```ts
import type { Listener, Speaker } from '../speech/types';
import type { PendingAnswer, RoundEngine } from './round';
import type { Position, RoundPlan } from './types';

export type Phase = 'A' | 'B' | 'done';

export interface RunnerState {
  stepIndex: number;
  phase: Phase;
  /** Position to light up, or null on recall-only steps and in phase B. */
  flashPosition: Position | null;
}

export interface RoundRunnerDeps {
  plan: RoundPlan;
  engine: RoundEngine;
  speaker: Speaker;
  listener: Listener;
  onJudge(answer: PendingAnswer): void;
}

/**
 * Two-phase step machine. Phase A speaks the question with the mic closed;
 * phase B opens the mic. Holds no timers — the UI calls tick() when the
 * current phase expires, which makes the whole sequence deterministic in tests.
 */
export class RoundRunner {
  private readonly deps: RoundRunnerDeps;
  private stepIndex = 0;
  private phase: Phase = 'A';
  private tap: Position | null = null;

  constructor(deps: RoundRunnerDeps) {
    this.deps = deps;
  }

  get state(): RunnerState {
    const step = this.deps.plan.steps[this.stepIndex];
    return {
      stepIndex: this.stepIndex,
      phase: this.phase,
      flashPosition: this.phase === 'A' ? (step?.position ?? null) : null,
    };
  }

  get finished(): boolean {
    return this.phase === 'done';
  }

  async start(): Promise<void> {
    this.stepIndex = 0;
    this.phase = 'A';
    this.tap = null;
    await this.enterPhaseA();
  }

  onTap(position: Position): void {
    if (this.phase === 'done') return;
    this.tap = position;
  }

  /** Called by the UI when the current phase's timer expires. */
  async tick(): Promise<void> {
    if (this.phase === 'done') return;

    if (this.phase === 'A') {
      this.phase = 'B';
      this.deps.listener.start();
      return;
    }

    // Phase B closing: collect, score, dispatch, advance.
    const transcript = this.deps.listener.stop();
    this.deps.engine.submitStep(this.stepIndex, {
      tap: this.tap,
      transcript: transcript.length > 0 ? transcript : null,
    });
    for (const answer of this.deps.engine.takePending()) {
      this.deps.onJudge(answer);
    }

    this.tap = null;
    this.stepIndex++;

    if (this.stepIndex >= this.deps.plan.steps.length) {
      this.phase = 'done';
      return;
    }

    this.phase = 'A';
    await this.enterPhaseA();
  }

  private async enterPhaseA(): Promise<void> {
    const question = this.deps.plan.steps[this.stepIndex]?.question;
    if (question) await this.deps.speaker.speak(question.q);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- runner`
Expected: PASS, 12 tests

- [ ] **Step 5: Export the runner from the engine barrel**

Add to `src/engine/index.ts`:

```ts
export * from './runner';
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, all tests from Tasks 1–8

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add -A
git commit -m "feat(engine): 2相ステップ駆動のRoundRunner (タイマーはUI側)"
```

---

### Task 9: Persistence

**Files:**
- Create: `src/store/storage.ts`
- Test: `src/store/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface Settings { stepDurationMs: number; adaptive: boolean; fixedN: number; maxTier: number }`
  - `interface RoundRecord { date: string; n: number; positionScore: number; answerScore: number | null; unresolved: number }`
  - `const DEFAULT_SETTINGS: Settings`
  - `loadSettings(): Promise<Settings>` / `saveSettings(s: Settings): Promise<void>`
  - `loadN(): Promise<number>` / `saveN(n: number): Promise<void>`
  - `loadHistory(): Promise<RoundRecord[]>` / `appendHistory(r: RoundRecord): Promise<void>`
  - `loadLearned(): Promise<Record<string, string[]>>` / `addLearned(questionId: string, answer: string): Promise<void>`
  - `phaseDurations(s: Settings): { a: number; b: number }`

- [ ] **Step 1: Install AsyncStorage**

```bash
cd /mnt/c/Projects/nback-voice
npx expo install @react-native-async-storage/async-storage
```

- [ ] **Step 2: Register the AsyncStorage mock in the Jest config**

Add to the `jest` object in `package.json`:

```json
{
  "jest": {
    "setupFiles": ["./jest.setup.js"]
  }
}
```

Create `jest.setup.js`:

```js
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
```

- [ ] **Step 3: Write the failing test**

Create `src/store/__tests__/storage.test.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_SETTINGS,
  addLearned,
  appendHistory,
  loadHistory,
  loadLearned,
  loadN,
  loadSettings,
  phaseDurations,
  saveN,
  saveSettings,
} from '../storage';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('settings', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips saved settings', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, stepDurationMs: 7000 });
    expect((await loadSettings()).stepDurationMs).toBe(7000);
  });

  it('fills in missing keys from defaults when the stored shape is older', async () => {
    await AsyncStorage.setItem('nback.settings', JSON.stringify({ stepDurationMs: 4000 }));
    const s = await loadSettings();
    expect(s.stepDurationMs).toBe(4000);
    expect(s.adaptive).toBe(DEFAULT_SETTINGS.adaptive);
  });
});

describe('adaptive N', () => {
  it('starts at 2', async () => {
    expect(await loadN()).toBe(2);
  });

  it('round-trips', async () => {
    await saveN(4);
    expect(await loadN()).toBe(4);
  });
});

describe('history', () => {
  it('starts empty', async () => {
    expect(await loadHistory()).toEqual([]);
  });

  it('appends newest last', async () => {
    await appendHistory({ date: '2026-08-11', n: 2, positionScore: 1, answerScore: 0.5, unresolved: 1 });
    await appendHistory({ date: '2026-08-12', n: 3, positionScore: 0.5, answerScore: null, unresolved: 9 });
    const history = await loadHistory();
    expect(history).toHaveLength(2);
    expect(history[1].n).toBe(3);
  });
});

describe('learned synonyms', () => {
  it('starts empty', async () => {
    expect(await loadLearned()).toEqual({});
  });

  it('accumulates per question without duplicating', async () => {
    await addLearned('q042', 'わんこ');
    await addLearned('q042', 'わんこ');
    await addLearned('q042', 'ばうわう');
    expect(await loadLearned()).toEqual({ q042: ['わんこ', 'ばうわう'] });
  });
});

describe('phaseDurations', () => {
  it('splits the step 40 / 60', () => {
    expect(phaseDurations({ ...DEFAULT_SETTINGS, stepDurationMs: 5000 })).toEqual({
      a: 2000,
      b: 3000,
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- storage`
Expected: FAIL — `Cannot find module '../storage'`

- [ ] **Step 5: Write the implementation**

Create `src/store/storage.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Settings {
  /** Total step length in ms; split 40% phase A / 60% phase B. */
  stepDurationMs: number;
  adaptive: boolean;
  /** Used only when adaptive is false. */
  fixedN: number;
  /** Highest question tier to draw from. */
  maxTier: number;
}

export interface RoundRecord {
  date: string;
  n: number;
  positionScore: number;
  answerScore: number | null;
  unresolved: number;
}

export const DEFAULT_SETTINGS: Settings = {
  stepDurationMs: 5000,
  adaptive: true,
  fixedN: 2,
  maxTier: 2,
};

const KEY_SETTINGS = 'nback.settings';
const KEY_N = 'nback.n';
const KEY_HISTORY = 'nback.history';
const KEY_LEARNED = 'nback.learned';

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function loadSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings>>(KEY_SETTINGS, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(KEY_SETTINGS, JSON.stringify(settings));
}

export async function loadN(): Promise<number> {
  return readJson<number>(KEY_N, 2);
}

export async function saveN(n: number): Promise<void> {
  await AsyncStorage.setItem(KEY_N, JSON.stringify(n));
}

export async function loadHistory(): Promise<RoundRecord[]> {
  return readJson<RoundRecord[]>(KEY_HISTORY, []);
}

export async function appendHistory(record: RoundRecord): Promise<void> {
  const history = await loadHistory();
  history.push(record);
  await AsyncStorage.setItem(KEY_HISTORY, JSON.stringify(history));
}

export async function loadLearned(): Promise<Record<string, string[]>> {
  return readJson<Record<string, string[]>>(KEY_LEARNED, {});
}

export async function addLearned(
  questionId: string,
  answer: string,
): Promise<void> {
  const learned = await loadLearned();
  const existing = learned[questionId] ?? [];
  if (existing.includes(answer)) return;
  learned[questionId] = [...existing, answer];
  await AsyncStorage.setItem(KEY_LEARNED, JSON.stringify(learned));
}

export function phaseDurations(settings: Settings): { a: number; b: number } {
  const a = Math.round(settings.stepDurationMs * 0.4);
  return { a, b: settings.stepDurationMs - a };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- storage`
Expected: PASS, 10 tests

- [ ] **Step 7: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add -A
git commit -m "feat(store): 設定・履歴・適応N・学習済み同義語の永続化"
```

---

### Task 10: Presentational screens

The three screens with no device dependencies, each test-driven. `GameScreen` and the app wiring are Task 11.

**Files:**
- Create: `src/ui/Grid.tsx`
- Create: `src/ui/ResultsScreen.tsx`
- Create: `src/ui/SettingsScreen.tsx`
- Test: `src/ui/__tests__/Grid.test.tsx`
- Test: `src/ui/__tests__/ResultsScreen.test.tsx`
- Test: `src/ui/__tests__/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `Position` (Task 2), `RoundEngine` (Task 3), storage functions (Task 9)
- Produces:
  - `<Grid flashPosition selected onTap disabled />` — cells carry `testID={`cell-${i}`}`
  - `<ResultsScreen engine n onAgain />`
  - `<SettingsScreen onClose />`

- [ ] **Step 1: Install the testing library**

```bash
cd /mnt/c/Projects/nback-voice
npm install --save-dev @testing-library/react-native react-test-renderer
```

- [ ] **Step 2: Write the failing Grid test**

Create `src/ui/__tests__/Grid.test.tsx`:

```tsx
import { fireEvent, render } from '@testing-library/react-native';
import { Grid } from '../Grid';

describe('Grid', () => {
  it('renders 9 cells', () => {
    const { getByTestId } = render(
      <Grid flashPosition={null} selected={null} onTap={() => {}} />,
    );
    for (let i = 0; i < 9; i++) {
      expect(getByTestId(`cell-${i}`)).toBeTruthy();
    }
  });

  it('reports the tapped position', () => {
    const onTap = jest.fn();
    const { getByTestId } = render(
      <Grid flashPosition={null} selected={null} onTap={onTap} />,
    );
    fireEvent.press(getByTestId('cell-4'));
    expect(onTap).toHaveBeenCalledWith(4);
  });

  it('does not report taps while disabled', () => {
    const onTap = jest.fn();
    const { getByTestId } = render(
      <Grid flashPosition={null} selected={null} onTap={onTap} disabled />,
    );
    fireEvent.press(getByTestId('cell-4'));
    expect(onTap).not.toHaveBeenCalled();
  });

  it('marks the flashing cell', () => {
    const { getByTestId } = render(
      <Grid flashPosition={3} selected={null} onTap={() => {}} />,
    );
    expect(getByTestId('cell-3').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('cell-2').props.accessibilityState.selected).toBe(false);
  });

  it('marks the selected cell distinctly from the flashing one', () => {
    const { getByTestId } = render(
      <Grid flashPosition={null} selected={7} onTap={() => {}} />,
    );
    expect(getByTestId('cell-7').props.accessibilityLabel).toContain('選択');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- Grid`
Expected: FAIL — `Cannot find module '../Grid'`

- [ ] **Step 4: Write the grid component**

Create `src/ui/Grid.tsx`:

```tsx
import { Pressable, StyleSheet, View } from 'react-native';
import type { Position } from '../engine/types';

interface Props {
  flashPosition: Position | null;
  selected: Position | null;
  onTap: (position: Position) => void;
  disabled?: boolean;
}

export function Grid({ flashPosition, selected, onTap, disabled }: Props) {
  return (
    <View style={styles.grid}>
      {Array.from({ length: 9 }, (_, i) => (
        <Pressable
          key={i}
          testID={`cell-${i}`}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityState={{ selected: flashPosition === i, disabled }}
          accessibilityLabel={
            selected === i ? `マス${i + 1} 選択中` : `マス${i + 1}`
          }
          onPress={() => onTap(i)}
          style={[
            styles.cell,
            flashPosition === i && styles.flash,
            selected === i && styles.selected,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    width: 300,
    height: 300,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignSelf: 'center',
  },
  cell: {
    width: 96,
    height: 96,
    margin: 2,
    backgroundColor: '#1c1c1e',
    borderRadius: 8,
  },
  flash: { backgroundColor: '#f4f1ea' },
  selected: { borderWidth: 3, borderColor: '#c96f4a' },
});
```

- [ ] **Step 5: Run the Grid test to verify it passes**

Run: `npm test -- Grid`
Expected: PASS, 5 tests

- [ ] **Step 6: Write the failing ResultsScreen test**

Create `src/ui/__tests__/ResultsScreen.test.tsx`:

```tsx
import { fireEvent, render } from '@testing-library/react-native';
import { RoundEngine, buildRound } from '../../engine';
import type { Question } from '../../engine/types';
import { ResultsScreen } from '../ResultsScreen';

const BANK: Question[] = Array.from({ length: 20 }, (_, i) => ({
  id: `q${i}`,
  tier: 1,
  q: `質問${i}`,
  accept: [`答え${i}`],
}));

/** A finished round: all taps correct, `resolved` answers graded correct. */
function finishedEngine(resolved: number): RoundEngine {
  const plan = buildRound(2, BANK, Math.random);
  const engine = new RoundEngine(plan);
  for (const step of plan.steps) {
    engine.submitStep(step.index, {
      tap: step.recallTarget === null ? null : plan.steps[step.recallTarget].position,
      transcript: step.recallTarget === null ? null : 'こたえ',
    });
  }
  const pending = engine.takePending();
  for (let i = 0; i < resolved; i++) engine.resolveAnswer(pending[i].index, true);
  return engine;
}

describe('ResultsScreen', () => {
  it('shows the N of the round', () => {
    const { getByText } = render(
      <ResultsScreen engine={finishedEngine(9)} n={3} onAgain={() => {}} />,
    );
    expect(getByText(/3-back/)).toBeTruthy();
  });

  it('shows both channel percentages', () => {
    const { getByText } = render(
      <ResultsScreen engine={finishedEngine(9)} n={2} onAgain={() => {}} />,
    );
    expect(getByText(/位置.*100%/)).toBeTruthy();
    expect(getByText(/回答.*100%/)).toBeTruthy();
  });

  it('shows an em dash for the answer channel when nothing resolved', () => {
    const { getByText } = render(
      <ResultsScreen engine={finishedEngine(0)} n={2} onAgain={() => {}} />,
    );
    expect(getByText(/回答.*—/)).toBeTruthy();
  });

  it('reports the 未判定 count when some answers went ungraded', () => {
    const { getByText } = render(
      <ResultsScreen engine={finishedEngine(4)} n={2} onAgain={() => {}} />,
    );
    expect(getByText(/未判定 5 件/)).toBeTruthy();
  });

  it('hides the 未判定 line when everything resolved', () => {
    const { queryByText } = render(
      <ResultsScreen engine={finishedEngine(9)} n={2} onAgain={() => {}} />,
    );
    expect(queryByText(/未判定/)).toBeNull();
  });

  it('fires onAgain when the button is pressed', () => {
    const onAgain = jest.fn();
    const { getByText } = render(
      <ResultsScreen engine={finishedEngine(9)} n={2} onAgain={onAgain} />,
    );
    fireEvent.press(getByText('もう一度'));
    expect(onAgain).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm test -- ResultsScreen`
Expected: FAIL — `Cannot find module '../ResultsScreen'`

- [ ] **Step 8: Write the results screen**

Create `src/ui/ResultsScreen.tsx`:

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RoundEngine } from '../engine';

interface Props {
  engine: RoundEngine;
  n: number;
  onAgain: () => void;
}

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

export function ResultsScreen({ engine, n, onAgain }: Props) {
  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>{n}-back の結果</Text>
      <Text style={styles.row}>位置　{pct(engine.positionScore)}</Text>
      <Text style={styles.row}>回答　{pct(engine.answerScore)}</Text>
      {engine.unresolvedCount > 0 && (
        <Text style={styles.note}>未判定 {engine.unresolvedCount} 件</Text>
      )}
      <Text style={styles.row}>総合　{pct(engine.roundScore)}</Text>
      <Pressable style={styles.button} onPress={onAgain}>
        <Text style={styles.buttonLabel}>もう一度</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 32, backgroundColor: '#000' },
  heading: { color: '#f4f1ea', fontSize: 28, marginBottom: 24 },
  row: { color: '#f4f1ea', fontSize: 20, marginBottom: 8 },
  note: { color: '#c96f4a', fontSize: 16, marginBottom: 8 },
  button: {
    marginTop: 32,
    padding: 16,
    backgroundColor: '#c96f4a',
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonLabel: { color: '#fff', fontSize: 18 },
});
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test -- ResultsScreen`
Expected: PASS, 6 tests

- [ ] **Step 10: Write the failing SettingsScreen test**

Create `src/ui/__tests__/SettingsScreen.test.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { loadSettings } from '../../store/storage';
import { SettingsScreen } from '../SettingsScreen';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('SettingsScreen', () => {
  it('persists a new step duration', async () => {
    const { getByText } = render(<SettingsScreen onClose={() => {}} />);
    fireEvent.press(getByText('8秒'));
    await waitFor(async () => {
      expect((await loadSettings()).stepDurationMs).toBe(8000);
    });
  });

  it('persists the difficulty tier', async () => {
    const { getByText } = render(<SettingsScreen onClose={() => {}} />);
    fireEvent.press(getByText('やさしい'));
    await waitFor(async () => {
      expect((await loadSettings()).maxTier).toBe(1);
    });
  });

  it('hides the fixed-N picker while adaptive is on', () => {
    const { queryByText } = render(<SettingsScreen onClose={() => {}} />);
    expect(queryByText('Nを自動調整')).toBeTruthy();
    expect(queryByText('5')).toBeNull();
  });

  it('reveals the fixed-N picker when adaptive is turned off', async () => {
    const { getByRole, findByText } = render(<SettingsScreen onClose={() => {}} />);
    fireEvent(getByRole('switch'), 'valueChange', false);
    expect(await findByText('5')).toBeTruthy();
  });

  it('fires onClose', () => {
    const onClose = jest.fn();
    const { getByText } = render(<SettingsScreen onClose={onClose} />);
    fireEvent.press(getByText('閉じる'));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 11: Run the test to verify it fails**

Run: `npm test -- SettingsScreen`
Expected: FAIL — `Cannot find module '../SettingsScreen'`

- [ ] **Step 12: Write the settings screen**

Create `src/ui/SettingsScreen.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
} from '../store/storage';

interface Props {
  onClose: () => void;
}

const STEP_CHOICES = [3000, 4000, 5000, 6000, 8000];
const TIER_CHOICES = [
  { tier: 1, label: 'やさしい' },
  { tier: 2, label: 'ふつう' },
];

export function SettingsScreen({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void saveSettings(next);
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>設定</Text>

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

      <Text style={styles.label}>問題の難易度</Text>
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

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 32, paddingTop: 80, backgroundColor: '#000' },
  heading: { color: '#f4f1ea', fontSize: 28, marginBottom: 24 },
  label: { color: '#f4f1ea', fontSize: 16, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#1c1c1e' },
  chipOn: { backgroundColor: '#c96f4a' },
  chipLabel: { color: '#f4f1ea', fontSize: 16 },
  button: { marginTop: 'auto', padding: 16, backgroundColor: '#1c1c1e', borderRadius: 12, alignItems: 'center' },
});
```

- [ ] **Step 13: Run the whole suite**

Run: `npm test`
Expected: PASS, all tests from Tasks 1–10

- [ ] **Step 14: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add -A
git commit -m "feat(ui): グリッド・結果画面・設定画面 (テスト付き)"
```

---

### Task 11: GameScreen and app wiring

Drives the round on real timers. Its device dependencies are injected so the whole loop can be exercised in Jest with fakes.

**Files:**
- Create: `src/ui/GameScreen.tsx`
- Test: `src/ui/__tests__/GameScreen.test.tsx`
- Modify: `App.tsx`
- Create: `.env`

**Interfaces:**
- Consumes: `RoundRunner`, `RoundEngine`, `buildRound` (Tasks 2–3, 8), `loadBank` (Task 4), `ClaudeJudgeClient` (Task 5), `JudgeQueue` (Task 6), `ExpoSpeaker`/`ExpoListener` (Task 7), storage (Task 9), `Grid` (Task 10)
- Produces:
  - `interface GameScreenDeps { speaker: Speaker; listener: Listener; judgeClient: JudgeClient; requestPermissions(): Promise<boolean> }`
  - `<GameScreen onFinished deps? />` — `deps` defaults to the real Expo/Claude implementations, and is overridden in tests
  - `<App />` rendering game → results → settings

- [ ] **Step 1: Write the failing integration test**

This drives a whole round through the component with fakes: 9 questions spoken, every answer judged, history written, `onFinished` called.

Create `src/ui/__tests__/GameScreen.test.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render } from '@testing-library/react-native';
import type { RoundEngine } from '../../engine';
import type { Listener } from '../../speech/types';
import { FakeSpeaker } from '../../speech/fakes';
import type { JudgeClient, Verdict } from '../../judge/types';
import { loadHistory, loadN } from '../../store/storage';
import { GameScreen } from '../GameScreen';

jest.mock('expo-speech-recognition', () => ({
  useSpeechRecognitionEvent: jest.fn(),
  ExpoSpeechRecognitionModule: {
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    start: jest.fn(),
    stop: jest.fn(),
  },
}));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));

/** Always returns the same transcript, so every step produces an answer. */
class CannedListener implements Listener {
  sessions = 0;
  constructor(private readonly canned: string) {}
  start(): void {
    this.sessions++;
  }
  stop(): string {
    return this.canned;
  }
  push(): void {}
}

function makeDeps(judge: JudgeClient) {
  const speaker = new FakeSpeaker();
  const listener = new CannedListener('ぶぶぶ');
  return {
    deps: {
      speaker,
      listener,
      judgeClient: judge,
      requestPermissions: async () => true,
    },
    speaker,
    listener,
  };
}

const alwaysCorrect: JudgeClient = {
  judge: async (): Promise<Verdict> => ({ correct: true, matched: null }),
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

/** Run long enough for all 9 + N steps at the default 5s pacing. */
async function runWholeRound() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(120_000);
  });
}

describe('GameScreen', () => {
  it('speaks 9 questions and finishes the round', async () => {
    const onFinished = jest.fn();
    const { deps, speaker } = makeDeps(alwaysCorrect);
    render(<GameScreen onFinished={onFinished} deps={deps} />);
    await runWholeRound();

    expect(speaker.spoken).toHaveLength(9);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('opens the mic once per step, including the trailing recall steps', async () => {
    const { deps, listener } = makeDeps(alwaysCorrect);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await runWholeRound();

    expect(listener.sessions).toBe(11); // 9 stimuli + N=2 trailing
  });

  it('grades every answer through the judge and reports a full answer score', async () => {
    const onFinished = jest.fn();
    const { deps } = makeDeps(alwaysCorrect);
    render(<GameScreen onFinished={onFinished} deps={deps} />);
    await runWholeRound();

    const engine: RoundEngine = onFinished.mock.calls[0][0];
    expect(engine.answerScore).toBe(1);
    expect(engine.unresolvedCount).toBe(0);
  });

  it('leaves answers 未判定 when the judge is unreachable', async () => {
    const offline: JudgeClient = {
      judge: async () => {
        throw new Error('network down');
      },
    };
    const onFinished = jest.fn();
    const { deps } = makeDeps(offline);
    render(<GameScreen onFinished={onFinished} deps={deps} />);
    await runWholeRound();

    const engine: RoundEngine = onFinished.mock.calls[0][0];
    expect(engine.answerScore).toBeNull();
    expect(engine.unresolvedCount).toBe(9);
  });

  it('writes a history record for the round', async () => {
    const { deps } = makeDeps(alwaysCorrect);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await runWholeRound();

    const history = await loadHistory();
    expect(history).toHaveLength(1);
    expect(history[0].n).toBe(2);
  });

  it('lowers N after a round with no taps', async () => {
    const { deps } = makeDeps(alwaysCorrect);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await runWholeRound();

    // Position 0/9, answers 9/9 → round score 0.5 → N drops to 1.
    expect(await loadN()).toBe(1);
  });

  it('stops with a message when permission is refused', async () => {
    const { deps } = makeDeps(alwaysCorrect);
    const { findByText } = render(
      <GameScreen
        onFinished={jest.fn()}
        deps={{ ...deps, requestPermissions: async () => false }}
      />,
    );
    expect(await findByText(/マイクの許可/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- GameScreen`
Expected: FAIL — `Cannot find module '../GameScreen'`

- [ ] **Step 3: Write the game screen**

Create `src/ui/GameScreen.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { RoundEngine, RoundRunner, buildRound } from '../engine';
import type { Position, RoundPlan } from '../engine/types';
import { loadBank } from '../content/bank';
import { ClaudeJudgeClient } from '../judge/claude';
import { JudgeQueue } from '../judge/queue';
import type { JudgeClient } from '../judge/types';
import { ExpoListener } from '../speech/listener';
import { ExpoSpeaker } from '../speech/speaker';
import type { Listener, Speaker } from '../speech/types';
import {
  addLearned,
  appendHistory,
  loadLearned,
  loadN,
  loadSettings,
  phaseDurations,
  saveN,
} from '../store/storage';
import { Grid } from './Grid';

const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';

export interface GameScreenDeps {
  speaker: Speaker;
  listener: Listener;
  judgeClient: JudgeClient;
  requestPermissions(): Promise<boolean>;
}

function realDeps(): GameScreenDeps {
  return {
    speaker: new ExpoSpeaker(),
    listener: new ExpoListener(),
    judgeClient: new ClaudeJudgeClient(API_KEY),
    requestPermissions: ExpoListener.requestPermissions,
  };
}

interface Props {
  onFinished: (engine: RoundEngine, plan: RoundPlan) => void;
  /** Overridden in tests; defaults to the real Expo and Claude implementations. */
  deps?: GameScreenDeps;
}

export function GameScreen({ onFinished, deps }: Props) {
  const resolved = useMemo(() => deps ?? realDeps(), [deps]);
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState<Position | null>(null);
  const [selected, setSelected] = useState<Position | null>(null);
  const [label, setLabel] = useState('準備中…');

  const runnerRef = useRef<RoundRunner | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript;
    if (transcript) resolved.listener.push(transcript);
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const granted = await resolved.requestPermissions();
      if (cancelled) return;
      if (!granted) {
        setLabel('マイクの許可が必要です');
        return;
      }

      const [settings, storedN, learned] = await Promise.all([
        loadSettings(),
        loadN(),
        loadLearned(),
      ]);
      if (cancelled) return;

      const n = settings.adaptive ? storedN : settings.fixedN;
      const bank = loadBank(learned).filter((q) => q.tier <= settings.maxTier);
      const plan = buildRound(n, bank);
      const engine = new RoundEngine(plan);
      const queue = new JudgeQueue(resolved.judgeClient, {
        onVerdict: (index, correct) => engine.resolveAnswer(index, correct),
        onLearn: (questionId, answer) => {
          void addLearned(questionId, answer);
        },
      });

      const runner = new RoundRunner({
        plan,
        engine,
        speaker: resolved.speaker,
        listener: resolved.listener,
        onJudge: (answer) => queue.enqueue(answer),
      });
      runnerRef.current = runner;

      const { a, b } = phaseDurations(settings);

      const finish = async () => {
        await queue.drain();
        if (cancelled) return;
        if (settings.adaptive) await saveN(engine.nextN(n));
        await appendHistory({
          date: new Date().toISOString().slice(0, 10),
          n,
          positionScore: engine.positionScore,
          answerScore: engine.answerScore,
          unresolved: engine.unresolvedCount,
        });
        if (!cancelled) onFinished(engine, plan);
      };

      const schedule = () => {
        if (cancelled) return;
        const { phase, stepIndex, flashPosition } = runner.state;

        if (phase === 'done') {
          void finish();
          return;
        }

        setFlash(flashPosition);
        if (phase === 'A') setSelected(null);
        setLabel(
          `${stepIndex + 1} / ${plan.steps.length}　${n}-back　` +
            (phase === 'A' ? '出題中' : 'どうぞ'),
        );

        timerRef.current = setTimeout(
          () => {
            void runner.tick().then(schedule);
          },
          phase === 'A' ? a : b,
        );
      };

      await runner.start();
      if (cancelled) return;
      setReady(true);
      schedule();
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resolved, onFinished]);

  const handleTap = useCallback((position: Position) => {
    runnerRef.current?.onTap(position);
    setSelected(position);
  }, []);

  return (
    <View style={styles.screen}>
      <Text style={styles.label}>{label}</Text>
      <Grid
        flashPosition={flash}
        selected={selected}
        onTap={handleTap}
        disabled={!ready}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', backgroundColor: '#000' },
  label: {
    color: '#f4f1ea',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 24,
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- GameScreen`
Expected: PASS, 7 tests

- [ ] **Step 5: Wire the screens together**

Replace `App.tsx` with:

```tsx
import { useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import type { RoundEngine } from './src/engine';
import type { RoundPlan } from './src/engine/types';
import { GameScreen } from './src/ui/GameScreen';
import { ResultsScreen } from './src/ui/ResultsScreen';
import { SettingsScreen } from './src/ui/SettingsScreen';

type Screen =
  | { name: 'game'; key: number }
  | { name: 'results'; engine: RoundEngine; plan: RoundPlan }
  | { name: 'settings' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'game', key: 0 });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      {screen.name === 'game' && (
        <>
          <GameScreen
            key={screen.key}
            onFinished={(engine, plan) =>
              setScreen({ name: 'results', engine, plan })
            }
          />
          <Pressable
            style={styles.settingsButton}
            onPress={() => setScreen({ name: 'settings' })}
          >
            <Text style={styles.settingsLabel}>設定</Text>
          </Pressable>
        </>
      )}

      {screen.name === 'results' && (
        <ResultsScreen
          engine={screen.engine}
          n={screen.plan.n}
          onAgain={() => setScreen({ name: 'game', key: Date.now() })}
        />
      )}

      {screen.name === 'settings' && (
        <SettingsScreen
          onClose={() => setScreen({ name: 'game', key: Date.now() })}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  settingsButton: { position: 'absolute', top: 60, right: 24 },
  settingsLabel: { color: '#8e8e93', fontSize: 16 },
});
```

- [ ] **Step 6: Add the API key to the environment**

Confirm `.env` is listed in `.gitignore` (the Expo template includes it; add the line if absent), then create `.env`:

```
EXPO_PUBLIC_ANTHROPIC_API_KEY=sk-ant-...
```

Verify it is not tracked: `git check-ignore -v .env` must print a match.

- [ ] **Step 7: Typecheck and run the suite**

```bash
cd /mnt/c/Projects/nback-voice
npx tsc --noEmit
npm test
```

Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add -A
git commit -m "feat(ui): ゲーム画面と画面遷移の配線 (依存注入で1ラウンド統合テスト)"
```

---

### Task 12: Device build and smoke test

The only verification that cannot be automated from Windows.

**Files:**
- Create: `eas.json`
- Create: `docs/RUNBOOK.md`

- [ ] **Step 1: Create the development build profile**

```bash
cd /mnt/c/Projects/nback-voice
npm install --global eas-cli
eas login
eas build:configure
```

Ensure `eas.json` contains a `development` profile:

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": { "simulator": false }
    }
  }
}
```

- [ ] **Step 2: Build and install**

```bash
cd /mnt/c/Projects/nback-voice
eas build --profile development --platform ios
```

Scan the resulting QR code on the iPhone to install. This is a one-time step; JS changes afterward stream over `npx expo start --dev-client`.

- [ ] **Step 3: Run the smoke checklist on the device**

Start the dev server (`npx expo start --dev-client`), open the app, and verify each item:

- [ ] Microphone and speech-recognition permission prompts appear on first launch
- [ ] Questions are spoken in Japanese and are intelligible
- [ ] **No TTS bleed:** the transcript for a step never contains words from the question the app just spoke
- [ ] Tapping a cell highlights it, and the highlight clears at the next step
- [ ] The first N steps flash and speak but expect no response
- [ ] The trailing N steps are silent with no flash
- [ ] **Trailing words are not dropped:** speak a two-or-three word answer near the end of the answer window and confirm the transcript contains the whole thing. `Listener.stop()` returns synchronously, so it may capture the last *interim* result rather than the recognizer's true final one — if answers are consistently truncated, that is the cause.
- [ ] The results screen shows position and answer percentages, plus a 未判定 count when the network is off
- [ ] With airplane mode on, a round still completes and unmatched answers show as 未判定 rather than wrong
- [ ] Scoring ≥80% raises N on the next round; ≤50% lowers it
- [ ] Changing the step length in settings visibly changes the pacing

- [ ] **Step 4: Write the runbook**

Create `docs/RUNBOOK.md` with exactly these sections:

```markdown
# Runbook

## 毎日使う
1. `cd /mnt/c/Projects/nback-voice && npx expo start --dev-client`
2. iPhoneでdev buildアプリを開き、表示されたQRを読む

## 開発ビルドを作り直す (ネイティブ依存を足したときだけ)
`eas build --profile development --platform ios` → QRから再インストール。
JSだけの変更に再ビルドは不要。

## APIキー
`.env` の `EXPO_PUBLIC_ANTHROPIC_API_KEY`。gitignore済み。
キーを変えたら `npx expo start --dev-client --clear` でバンドルを作り直す。

## 進捗をリセットする
アプリを削除して再インストールすると AsyncStorage ごと消える
(適応N・履歴・学習済み同義語すべて)。

## ロールバック
`git revert <commit>` の後、JSのみの変更なら再ビルド不要 —
`npx expo start --dev-client --clear` で戻る。

## 実機スモークテスト
(Task 12 Step 3 のチェックリストをここに転記)
```

- [ ] **Step 5: Commit**

```bash
cd /mnt/c/Projects/nback-voice
git add -A
git commit -m "chore(build): EAS開発ビルド設定と実機スモークテスト手順"
```

---

## Deferred to v2 (not in this plan)

- **API-key proxy.** The key currently ships in the bundle — acceptable for a private dev build, not for the App Store. `JudgeClient` is the seam; v2 swaps the implementation.
- **Apple Developer account and TestFlight.**
- **Tier-3 questions** and difficulty scaling beyond `maxTier`.
- **Android.** Nothing here precludes it; nothing here tests it.
