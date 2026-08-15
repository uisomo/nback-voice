import type { Rng } from '../engine/types';

/**
 * A one-tap arithmetic item shown while the round loads. It exists for two
 * reasons: it eases the owner in, and the tap it invites is what unlocks
 * audio — iOS refuses to speak until an utterance originates in a gesture.
 */
export interface Warmup {
  /** Rendered as-is, e.g. `3 + 4`. */
  question: string;
  answer: number;
  /** Three distinct options, the answer among them. */
  choices: number[];
}

function pick(max: number, rng: Rng): number {
  return Math.min(max - 1, Math.floor(rng() * max));
}

/** 1..9, so the sums and products stay doable at a glance. */
function operand(rng: Rng): number {
  return pick(9, rng) + 1;
}

export function makeWarmup(rng: Rng = Math.random): Warmup {
  const multiply = rng() >= 0.5;
  const left = operand(rng);
  const right = operand(rng);
  const answer = multiply ? left * right : left + right;
  const question = `${left} ${multiply ? '×' : '+'} ${right}`;

  // Distractors sit next to the answer, never at or below zero, so the item
  // stays a warm-up rather than a puzzle.
  const near = new Set<number>();
  for (let delta = 1; near.size < 2; delta++) {
    if (answer - delta > 0) near.add(answer - delta);
    if (near.size < 2) near.add(answer + delta);
  }

  const choices = [...near];
  choices.splice(pick(choices.length + 1, rng), 0, answer);
  return { question, answer, choices };
}
