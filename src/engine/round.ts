import { nextN as adaptiveNextN } from './adaptive';
import { DEFAULT_BUDGET_BASE_MS, answerBudgetMs } from './budget';
import { STIMULI_PER_ROUND } from './sequence';
import type { Position, Question, RoundPlan } from './types';

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

export interface PendingAnswer {
  index: number;
  question: Question;
  transcript: string;
}

/** 'none' = the step went by without a tap. null in question mode. */
export type PositionOutcome = 'correct' | 'wrong' | 'none';

interface AnswerRecord {
  question: Question;
  /** null = 聞き取れず — the recognizer returned nothing for this step. */
  transcript: string | null;
  /** null = 未判定 (never counted wrong). */
  correct: boolean | null;
  position: PositionOutcome | null;
  /** Derived from the recalled answer's length; see answerBudgetMs. */
  budgetMs: number;
  /** null = untimed. Late is recorded, never punished. */
  onTime: boolean | null;
}

/** One scored step, as the owner reviews it after the round. */
export interface AnswerReview extends AnswerRecord {
  index: number;
}

export interface RoundEngineOptions {
  budgetBaseMs?: number;
}

/**
 * Scores one round. Fed in two stages because grading is asynchronous:
 * submitStep() scores the position channel immediately, resolveAnswer()
 * arrives later — possibly after the round has ended.
 */
export class RoundEngine {
  private readonly plan: RoundPlan;
  private readonly submitted = new Set<number>();
  private readonly answers = new Map<number, AnswerRecord>();
  private pendingBuffer: PendingAnswer[] = [];
  private readonly budgetBaseMs: number;

  constructor(plan: RoundPlan, options: RoundEngineOptions = {}) {
    this.plan = plan;
    this.budgetBaseMs = options.budgetBaseMs ?? DEFAULT_BUDGET_BASE_MS;
  }

  submitStep(index: number, input: StepSubmission): void {
    if (this.submitted.has(index)) {
      throw new Error(`step ${index} already submitted`);
    }
    this.submitted.add(index);

    const step = this.plan.steps[index];
    if (!step || step.recallTarget === null) return; // observe-only step

    const target = this.plan.steps[step.recallTarget];
    if (!target.question) return;

    const transcript = input.transcript?.trim() || null;

    // Recorded for every scored step, heard or not, so the round can be
    // reviewed afterwards. A step nobody was heard on is 聞き取れず, which is
    // not 未判定: it never reaches the judge, so it is never awaiting a verdict.
    const budgetMs = answerBudgetMs(target.question.accept[0] ?? '', this.budgetBaseMs);

    this.answers.set(index, {
      question: target.question,
      transcript,
      correct: null,
      position: this.positionOutcome(input.tap, target.position),
      budgetMs,
      onTime: input.elapsedMs === undefined ? null : input.elapsedMs <= budgetMs,
    });

    if (transcript) {
      this.pendingBuffer.push({ index, question: target.question, transcript });
    }
  }

  private positionOutcome(
    tap: Position | null,
    target: Position | null,
  ): PositionOutcome | null {
    if (this.plan.mode === 'question') return null;
    if (tap === null) return 'none';
    return tap === target ? 'correct' : 'wrong';
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

  /** Every scored step in step order, heard or not. */
  get review(): AnswerReview[] {
    return [...this.answers.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, record]) => ({ ...record, index }));
  }

  /** null in question mode — the visual channel is absent, not zero. */
  get positionScore(): number | null {
    if (this.plan.mode === 'question') return null;
    const correct = [...this.answers.values()].filter(
      (a) => a.position === 'correct',
    ).length;
    return correct / STIMULI_PER_ROUND;
  }

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

  /** null when no answer has been resolved — the channel is simply absent. */
  get answerScore(): number | null {
    const resolved = [...this.answers.values()].filter(
      (a) => a.correct !== null,
    );
    if (resolved.length === 0) return null;
    return resolved.filter((a) => a.correct).length / resolved.length;
  }

  /** Heard, sent to the judge, still without a verdict. 聞き取れず is not this. */
  get unresolvedCount(): number {
    return [...this.answers.values()].filter(
      (a) => a.transcript !== null && a.correct === null,
    ).length;
  }

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
    return adaptiveNextN(score, currentN, {
      positionScore: this.positionScore,
      // A perfect answerScore over only the answers judged so far still
      // leaves the round incomplete while one is stuck at 未判定 — not
      // proven wrong, but not proven right either, so it must not carry a
      // level-up on the rest of the round's behalf.
      answerScore: this.unresolvedCount > 0 ? 0 : this.answerScore,
    });
  }
}
