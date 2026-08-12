import { buildRound } from '../sequence';
import type { Question } from '../types';

const BANK: Question[] = Array.from({ length: 20 }, (_, i) => ({
  id: `q${i}`,
  tier: 1,
  q: `質問${i}`,
  accept: [`答え${i}`],
}));

/** Deterministic rng: always returns 0, so every random pick is index 0. */
const zeroRng = () => 0;

describe('buildRound', () => {
  it('produces 9 + N steps', () => {
    expect(buildRound(2, BANK, zeroRng).steps).toHaveLength(11);
    expect(buildRound(4, BANK, zeroRng).steps).toHaveLength(13);
  });

  it('gives the first 9 steps a stimulus and the trailing N steps none', () => {
    const { steps } = buildRound(2, BANK, zeroRng);
    for (let i = 0; i < 9; i++) {
      expect(steps[i].position).not.toBeNull();
      expect(steps[i].question).not.toBeNull();
    }
    for (let i = 9; i < 11; i++) {
      expect(steps[i].position).toBeNull();
      expect(steps[i].question).toBeNull();
    }
  });

  it('gives the first N steps no recall target and every later step index - N', () => {
    const { steps } = buildRound(2, BANK, zeroRng);
    expect(steps[0].recallTarget).toBeNull();
    expect(steps[1].recallTarget).toBeNull();
    expect(steps[2].recallTarget).toBe(0);
    expect(steps[10].recallTarget).toBe(8);
  });

  it('produces exactly 9 scored responses regardless of N', () => {
    for (const n of [1, 2, 3, 5]) {
      const scored = buildRound(n, BANK, zeroRng).steps.filter(
        (s) => s.recallTarget !== null,
      );
      expect(scored).toHaveLength(9);
    }
  });

  it('keeps every position within 0..8', () => {
    const { steps } = buildRound(3, BANK, Math.random);
    for (const s of steps.slice(0, 9)) {
      expect(s.position).toBeGreaterThanOrEqual(0);
      expect(s.position).toBeLessThanOrEqual(8);
    }
  });

  it('never repeats a question within a round', () => {
    const { steps } = buildRound(2, BANK, Math.random);
    const ids = steps.slice(0, 9).map((s) => s.question!.id);
    expect(new Set(ids).size).toBe(9);
  });

  it('throws when the bank has fewer than 9 questions', () => {
    expect(() => buildRound(2, BANK.slice(0, 8), zeroRng)).toThrow(
      /at least 9 questions/,
    );
  });

  it('rejects an N below 1 rather than building a malformed plan', () => {
    // N=0 would make every step its own recall target; N<0 indexes backwards.
    for (const n of [0, -1, 1.5, Number.NaN]) {
      expect(() => buildRound(n, BANK, zeroRng)).toThrow(/at least 1/);
    }
  });

  it('accepts the adaptive floor of 1', () => {
    expect(buildRound(1, BANK, zeroRng).steps).toHaveLength(10);
  });
});
