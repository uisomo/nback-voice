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

    // Two-argument then(), not .then().catch(): only the API call's own
    // rejection means 未判定. A throw from onVerdict/onLearn is a bug in the
    // caller and must stay visible rather than masquerading as a dead network.
    const task = this.client
      .judge(answer.question, answer.transcript)
      .then(
        (verdict) => {
          this.callbacks.onVerdict(answer.index, verdict.correct);
          if (verdict.correct) {
            this.callbacks.onLearn(
              answer.question.id,
              verdict.matched ?? answer.transcript,
            );
          }
        },
        () => {
          // 未判定. Deliberately no onVerdict call.
        },
      )
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
