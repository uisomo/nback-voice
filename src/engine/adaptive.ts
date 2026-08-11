/** Adaptive difficulty rule. Applied once at the end of each round. */
export function nextN(roundScore: number, currentN: number): number {
  if (roundScore >= 0.8) return currentN + 1;
  if (roundScore <= 0.5) return Math.max(1, currentN - 1);
  return currentN;
}
