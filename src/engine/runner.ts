import type { Listener, Speaker } from '../speech/types';
import type { PendingAnswer, RoundEngine } from './round';
import type { Position, RoundPlan } from './types';

export type Phase = 'A' | 'B' | 'done';

/**
 * Hard ceiling on one utterance. iOS can interrupt AVSpeechSynthesizer via an
 * audio-session change (the recognizer causes one every step) without firing
 * onDone/onStopped/onError, which would otherwise leave `utterance` pending
 * forever. Nothing in the step machine waits on it, but callers may.
 */
export const SPEAK_TIMEOUT_MS = 10_000;

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
  /**
   * Supplied only when the answer window is timed — typed mode. Voice mode
   * has no clock to be on time against, and passing none is how the engine
   * learns that without being told which mode is running.
   */
  clock?: () => number;
}

/** Never rejects; resolves when `promise` settles or `ms` elapses. */
function settleWithin(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    void promise.then(done, done);
  });
}

/**
 * Two-phase step machine. Phase A flashes the block and speaks the question
 * with the mic closed; phase B opens the mic. Holds no timers — the UI calls
 * tick() when the current phase expires, which makes the whole sequence
 * deterministic in tests.
 *
 * start() and tick() are **synchronous**: the state transition lands before
 * they return, so the UI can paint the new step immediately. The utterance is
 * started, not awaited, so that it overlaps phase A instead of preceding it —
 * spec §4.1 puts the flash and the question in the same phase. Being
 * synchronous also makes overlapping ticks structurally impossible.
 *
 * Only the *closing* of phase A waits for the speech: see readyToClose().
 * The paint happens at once; the mic simply does not open until the question
 * has been said.
 */
export class RoundRunner {
  private readonly deps: RoundRunnerDeps;
  private stepIndex = 0;
  private phase: Phase = 'A';
  private tap: Position | null = null;
  private speaking: Promise<void> = Promise.resolve();
  private windowOpenedAt: number | null = null;

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

  /**
   * Resolves when the current utterance finishes, errors, or hits
   * SPEAK_TIMEOUT_MS. Never rejects. Nothing about the *paint* waits on it;
   * readyToClose() uses it to hold phase A open until the question has been
   * said.
   */
  get utterance(): Promise<void> {
    return this.speaking;
  }

  start(): void {
    this.stepIndex = 0;
    this.phase = 'A';
    this.tap = null;
    this.enterPhaseA();
  }

  onTap(position: Position): void {
    if (this.phase === 'done') return;
    this.tap = position;
  }

  /**
   * Resolves when the current phase may close — i.e. when it is safe for the
   * UI to call tick(). Both phases wait out the hardware they drive:
   *
   * - Phase A waits out the utterance, so its real length is
   *   `max(configured phase A, utterance)`: the question is spoken exactly
   *   once, and clipping 「〜は？」 makes that item unanswerable N steps later.
   *   Bounded by SPEAK_TIMEOUT_MS.
   * - Phase B waits out the recognizer, which hands over its final result
   *   only after being asked to stop. Reading the transcript on the timer
   *   alone loses the last thing the owner said — it lands as 聞き取れず, or
   *   worse, against the next step's question. Bounded inside the listener.
   *
   * The wait lives here rather than in the UI so that the rule travels with
   * the state machine, and the runner still owns no timers.
   */
  readyToClose(): Promise<void> {
    if (this.phase === 'done') return Promise.resolve();
    return this.phase === 'A' ? this.speaking : this.deps.listener.settle();
  }

  /**
   * Called by the UI once the phase's timer has expired *and* readyToClose()
   * has resolved. Synchronous: the transition lands before it returns, so the
   * caller repaints immediately rather than chaining off a promise.
   */
  tick(): void {
    if (this.phase === 'done') return;

    if (this.phase === 'A') {
      this.phase = 'B';
      // The utterance has normally already finished (readyToClose waited for
      // it); this only bites when the watchdog fired, and then silencing the
      // synthesizer before the mic opens is exactly right (spec §4.1).
      this.deps.speaker.stop();
      this.deps.listener.start();
      this.windowOpenedAt = this.deps.clock?.() ?? null;
      return;
    }

    // Phase B closing: collect, score, dispatch, advance.
    const transcript = this.deps.listener.stop();
    const openedAt = this.windowOpenedAt;
    // openedAt is non-null only when a clock was passed, so clock! is safe —
    // and if that ever stopped being true, a crash says so. A fallback would
    // report elapsedMs = 0: "answered instantly, on time", the exact opposite.
    const elapsedMs =
      openedAt === null ? undefined : this.deps.clock!() - openedAt;
    this.windowOpenedAt = null;
    this.deps.engine.submitStep(this.stepIndex, {
      tap: this.tap,
      transcript: transcript.length > 0 ? transcript : null,
      elapsedMs,
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
    this.enterPhaseA();
  }

  private enterPhaseA(): void {
    const question = this.deps.plan.steps[this.stepIndex]?.question;
    if (!question) {
      this.speaking = Promise.resolve();
      return;
    }
    this.speaking = settleWithin(
      this.deps.speaker.speak(question.q),
      SPEAK_TIMEOUT_MS,
    );
  }
}
