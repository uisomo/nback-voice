import { makeWarmup } from '../warmup';
import type { Rng } from '../../engine/types';

/** Feeds pickIndex-style draws in order, cycling if the list runs out. */
function scriptedRng(values: number[]): Rng {
  let call = 0;
  return () => values[call++ % values.length];
}

describe('makeWarmup', () => {
  it('poses an addition when the first draw picks it', () => {
    const warmup = makeWarmup(scriptedRng([0, 2 / 9, 3 / 9, 0]));
    expect(warmup.question).toMatch(/^\d+ \+ \d+$/);
  });

  it('poses a multiplication when the first draw picks it', () => {
    const warmup = makeWarmup(scriptedRng([0.9, 2 / 9, 3 / 9, 0]));
    expect(warmup.question).toMatch(/^\d+ × \d+$/);
  });

  it('states an answer that matches the question it asked', () => {
    for (let seed = 0; seed < 20; seed++) {
      const warmup = makeWarmup(scriptedRng([seed / 20, 0.3, 0.7, 0.5]));
      const [, left, op, right] = warmup.question.match(
        /^(\d+) ([+×]) (\d+)$/,
      ) as RegExpMatchArray;
      const expected =
        op === '+' ? Number(left) + Number(right) : Number(left) * Number(right);
      expect(warmup.answer).toBe(expected);
    }
  });

  it('offers three distinct choices, one of them right', () => {
    for (let seed = 0; seed < 20; seed++) {
      const warmup = makeWarmup(scriptedRng([seed / 20, 0.3, 0.7, 0.1]));
      expect(warmup.choices).toHaveLength(3);
      expect(new Set(warmup.choices).size).toBe(3);
      expect(warmup.choices).toContain(warmup.answer);
    }
  });

  it('never offers a negative choice', () => {
    // 1 + 1 has no room below it, so the distractors have to go upward.
    for (let seed = 0; seed < 30; seed++) {
      const warmup = makeWarmup(scriptedRng([0, 0, 0, seed / 30]));
      for (const choice of warmup.choices) expect(choice).toBeGreaterThan(0);
    }
  });

  it('keeps the numbers small enough to do in one breath', () => {
    for (let seed = 0; seed < 30; seed++) {
      const warmup = makeWarmup(scriptedRng([seed / 30, seed / 31, seed / 29, 0]));
      expect(warmup.answer).toBeLessThanOrEqual(81);
    }
  });

  it('puts the answer in a different slot as the draw changes', () => {
    const slots = new Set(
      Array.from({ length: 12 }, (_, i) =>
        makeWarmup(scriptedRng([0, 0.3, 0.4, i / 12])).choices.indexOf(
          makeWarmup(scriptedRng([0, 0.3, 0.4, i / 12])).answer,
        ),
      ),
    );
    expect(slots.size).toBeGreaterThan(1);
  });
});
