import type { Listener, Speaker } from '../speech/types';
import type { PendingAnswer, RoundEngine } from './round';
import type { Position, RoundPlan } from './types';

/**
 * 'A' / 'B' are the two-phase step: question with the mic shut, then the mic.
 * 'AB' is the merged step used when the answer is typed — see `merged`.
 */
export type Phase = 'A' | 'B' | 'AB' | 'done';

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
  /**
   * Run each step as a single phase: the question is spoken *while* the
   * answer window is open, instead of after it. Only safe when the listener
   * is not a microphone — a real recognizer would hear the synthesizer. Typed
   * mode passes true, which is what puts the question and the field on screen
   * together (spec §7).
   */
  merged?: boolean;
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
 *
 * With `merged`, the two phases become one ('AB'): the answer window opens
 * together with the question rather than after it. The split exists to keep
 * the synthesizer out of the microphone, and a text field cannot hear.
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
      // Lit for the whole of a merged step: there is no phase B to darken.
      flashPosition: this.phase === 'B' ? null : (step?.position ?? null),
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
    this.tap = null;
    this.enterStep();
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
    if (this.phase === 'A') return this.speaking;
    if (this.phase === 'B') return this.deps.listener.settle();
    // A merged step drives both at once, so it waits out both: answering
    // early must not cut the question short any more than it does in phase A.
    return Promise.all([this.speaking, this.deps.listener.settle()]).then(
      () => undefined,
    );
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
      this.openWindow();
      return;
    }

    // Phase B — or the whole of a merged step — closing: collect, score,
    // dispatch, advance.
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

    // What the A -> B transition does for a two-phase step, done here
    // instead: only bites when the speak watchdog fired, and never on
    // start(), where it would cancel the gesture's unlock utterance.
    if (this.deps.merged) this.deps.speaker.stop();
    this.enterStep();
  }

  /**
   * Opens the step: speak, and — when merged — open the answer window in the
   * same breath rather than a phase later.
   */
  private enterStep(): void {
    this.phase = this.deps.merged ? 'AB' : 'A';
    const question = this.deps.plan.steps[this.stepIndex]?.question;
    this.speaking = question
      ? settleWithin(this.deps.speaker.speak(question.q), SPEAK_TIMEOUT_MS)
      : Promise.resolve();
    if (this.deps.merged) this.openWindow();
  }

  private openWindow(): void {
    this.deps.listener.start();
    this.windowOpenedAt = this.deps.clock?.() ?? null;
  }
}
