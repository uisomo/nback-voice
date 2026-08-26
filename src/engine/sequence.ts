import type {
  Position,
  Question,
  RoundMode,
  RoundPlan,
  Rng,
  StepPlan,
} from './types';

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
  mode: RoundMode = 'dual',
): RoundPlan {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`n must be an integer of at least 1, got ${n}`);
  }
  if (bank.length < 1) {
    throw new Error(`bank must contain at least 1 question, got ${bank.length}`);
  }

  // Draw without replacement until the pool runs dry, then refill it — this
  // way a bank smaller than 9 still fills a full round, repeating questions
  // only once every other question has appeared.
  let pool: Question[] = [];
  const steps: StepPlan[] = [];

  for (let i = 0; i < STIMULI_PER_ROUND + n; i++) {
    const isStimulus = i < STIMULI_PER_ROUND;
    let position: Position | null = null;
    let question: Question | null = null;

    if (isStimulus) {
      // In question mode the grid does not exist, so no position is drawn —
      // this also means the rng is consumed differently between modes.
      position = mode === 'dual' ? pickIndex(GRID_SIZE, rng) : null;
      if (pool.length === 0) pool = [...bank];
      question = pool.splice(pickIndex(pool.length, rng), 1)[0];
    }

    steps.push({
      index: i,
      position,
      question,
      recallTarget: i >= n ? i - n : null,
    });
  }

  return { n, mode, steps };
}
