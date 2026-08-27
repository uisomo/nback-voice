/**
 * Adaptive difficulty rule. Applied once at the end of each round.
 *
 * Raising N is a strict gate, not a threshold on the average: a round that
 * misses every position but nails every answer (or the reverse) used to
 * still average to a passing roundScore and raise N, which let one channel
 * carry the other into a harder round it was not actually ready for. Now
 * every channel that is present for this round's mode must be perfect.
 * positionScore is null in question mode (spec: the visual channel is
 * absent there, not zero), so that mode raises on a perfect answerScore
 * alone.
 *
 * Lowering N is unchanged: the combined roundScore at or below 50% still
 * drops it, one channel struggling being enough reason to ease off.
 */
export function nextN(
  roundScore: number,
  currentN: number,
  channels: { positionScore: number | null; answerScore: number | null } = {
    positionScore: null,
    answerScore: null,
  },
): number {
  const perfect =
    (channels.positionScore === null || channels.positionScore === 1) &&
    (channels.answerScore === null || channels.answerScore === 1) &&
    (channels.positionScore === 1 || channels.answerScore === 1);
  if (perfect) return currentN + 1;
  if (roundScore <= 0.5) return Math.max(1, currentN - 1);
  return currentN;
}
