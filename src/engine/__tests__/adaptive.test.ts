import { nextN } from '../adaptive';

describe('nextN', () => {
  it('raises N when both channels are perfect', () => {
    expect(
      nextN(1.0, 2, { positionScore: 1, answerScore: 1 }),
    ).toBe(3);
  });

  it('does not raise N when only the position channel is perfect', () => {
    expect(
      nextN(0.9, 2, { positionScore: 1, answerScore: 0.8 }),
    ).toBe(2);
  });

  it('does not raise N when only the answer channel is perfect', () => {
    expect(
      nextN(0.9, 2, { positionScore: 0.8, answerScore: 1 }),
    ).toBe(2);
  });

  it('raises N from a perfect answer channel alone when position is absent (question mode)', () => {
    expect(
      nextN(1.0, 2, { positionScore: null, answerScore: 1 }),
    ).toBe(3);
  });

  it('raises N from a perfect position channel alone when answers are absent', () => {
    expect(
      nextN(1.0, 2, { positionScore: 1, answerScore: null }),
    ).toBe(3);
  });

  it('does not raise N when both channels are absent', () => {
    expect(
      nextN(1.0, 2, { positionScore: null, answerScore: null }),
    ).toBe(2);
  });

  it('lowers N when the round score is at or below 50%', () => {
    expect(nextN(0.5, 3, { positionScore: 0.5, answerScore: 0.5 })).toBe(2);
    expect(nextN(0.0, 3, { positionScore: 0, answerScore: 0 })).toBe(2);
  });

  it('holds N between the thresholds', () => {
    expect(nextN(0.51, 2, { positionScore: 0.51, answerScore: 0.51 })).toBe(2);
    expect(nextN(0.79, 2, { positionScore: 0.79, answerScore: 0.79 })).toBe(2);
  });

  it('never drops below 1', () => {
    expect(nextN(0.0, 1, { positionScore: 0, answerScore: 0 })).toBe(1);
  });

  it('defaults both channels to absent when none are given', () => {
    // A caller that does not know about channels yet must not accidentally
    // raise N — the default treats nothing as proven perfect.
    expect(nextN(1.0, 2)).toBe(2);
  });
});
