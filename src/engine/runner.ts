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
 * fired and forgotten so that it overlaps phase A instead of preceding it —
 * spec §4.1 puts the flash and the question in the same phase. Being
 * synchronous also makes overlapping ticks structurally impossible.
 */
export class RoundRunner {
  private readonly deps: RoundRunnerDeps;
  private stepIndex = 0;
  private phase: Phase = 'A';
  private tap: Position | null = null;
  private speaking: Promise<void> = Promise.resolve();

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
   * SPEAK_TIMEOUT_MS. Never rejects. The step machine does not await it — it
   * exists so tests and teardown have a handle on the speech in flight.
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

  /** Called by the UI when the current phase's timer expires. */
  tick(): void {
    if (this.phase === 'done') return;

    if (this.phase === 'A') {
      this.phase = 'B';
      // Silence the synthesizer before the mic opens: a long question must not
      // bleed into the answer window (spec §4.1).
      this.deps.speaker.stop();
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
