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
