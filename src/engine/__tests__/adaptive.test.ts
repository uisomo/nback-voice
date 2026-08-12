import { nextN } from '../adaptive';

describe('nextN', () => {
  it('raises N when the round score is at or above 80%', () => {
    expect(nextN(0.8, 2)).toBe(3);
    expect(nextN(1.0, 2)).toBe(3);
  });

  it('lowers N when the round score is at or below 50%', () => {
    expect(nextN(0.5, 3)).toBe(2);
    expect(nextN(0.0, 3)).toBe(2);
  });

  it('holds N between the thresholds', () => {
    expect(nextN(0.51, 2)).toBe(2);
    expect(nextN(0.79, 2)).toBe(2);
  });

  it('never drops below 1', () => {
    expect(nextN(0.0, 1)).toBe(1);
  });
});
