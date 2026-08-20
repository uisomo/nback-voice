/**
 * A round of typing starts with reading the question and reaching the field.
 * Without a base, 「わん」 would allow two seconds for all of it, which is not
 * enough to tap anything, let alone dictate and check a word.
 */
export const DEFAULT_BUDGET_BASE_MS = 4000;

/**
 * How long the answer window is aimed at. A target, not a deadline: running
 * out is recorded, never enforced (see RoundEngine.onTimeScore).
 *
 * Array.from counts code points, so a surrogate pair costs what a reader
 * thinks it costs — one character.
 */
export function answerBudgetMs(answer: string, baseMs: number): number {
  return baseMs + Array.from(answer).length * 1000;
}
