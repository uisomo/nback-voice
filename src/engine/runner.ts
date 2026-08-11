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
