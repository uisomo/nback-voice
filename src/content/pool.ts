import { STIMULI_PER_ROUND } from '../engine/sequence';
import type { Question } from '../engine/types';

export type QuestionSource = 'builtin' | 'custom' | 'both';

/** A round draws 9 distinct questions, so a pool below this is unusable. */
export const MIN_QUESTIONS = STIMULI_PER_ROUND;

/**
 * The questions a round may draw from. The difficulty filter applies only to
 * built-ins: custom questions are the owner's own, and the app has no basis
 * for rating their difficulty.
 */
export function resolvePool(
  source: QuestionSource,
  builtin: Question[],
  custom: Question[],
  maxTier: number,
): Question[] {
  const tiered = builtin.filter((q) => q.tier <= maxTier);
  switch (source) {
    case 'builtin':
      return tiered;
    case 'custom':
      return [...custom];
    case 'both':
      return [...tiered, ...custom];
  }
}
