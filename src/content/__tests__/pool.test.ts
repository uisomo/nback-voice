import { MIN_QUESTIONS, resolvePool } from '../pool';
import type { Question } from '../../engine/types';

const BUILTIN: Question[] = [
  { id: 'b1', tier: 1, q: 'やさしい1', accept: ['a'] },
  { id: 'b2', tier: 1, q: 'やさしい2', accept: ['a'] },
  { id: 'b3', tier: 2, q: 'ふつう1', accept: ['a'] },
];

const CUSTOM: Question[] = [
  { id: 'user_1', tier: 0, q: '自作1', accept: ['a'] },
  { id: 'user_2', tier: 0, q: '自作2', accept: ['a'] },
];

describe('resolvePool', () => {
  it('returns tier-filtered built-ins for "builtin"', () => {
    expect(resolvePool('builtin', BUILTIN, CUSTOM, 1).map((q) => q.id)).toEqual([
      'b1',
      'b2',
    ]);
  });

  it('includes higher tiers when maxTier allows', () => {
    expect(resolvePool('builtin', BUILTIN, CUSTOM, 2)).toHaveLength(3);
  });

  it('returns only custom questions for "custom"', () => {
    expect(resolvePool('custom', BUILTIN, CUSTOM, 2).map((q) => q.id)).toEqual([
      'user_1',
      'user_2',
    ]);
  });

  it('never tier-filters custom questions, even at the lowest tier', () => {
    // Custom questions carry tier 0 and must survive any maxTier setting.
    expect(resolvePool('custom', BUILTIN, CUSTOM, 1)).toHaveLength(2);
  });

  it('merges both, with built-ins still tier-filtered', () => {
    const ids = resolvePool('both', BUILTIN, CUSTOM, 1).map((q) => q.id);
    expect(ids).toEqual(['b1', 'b2', 'user_1', 'user_2']);
  });

  it('returns an empty pool rather than throwing when there are no custom questions', () => {
    expect(resolvePool('custom', BUILTIN, [], 2)).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const custom = [...CUSTOM];
    resolvePool('both', BUILTIN, custom, 2).push({
      id: 'x',
      tier: 0,
      q: 'x',
      accept: [],
    });
    expect(custom).toHaveLength(2);
    expect(BUILTIN).toHaveLength(3);
  });
});

describe('MIN_QUESTIONS', () => {
  it('is the number of stimuli in a round', () => {
    // Both the settings guard and GameScreen's re-check compare against this,
    // so it must track STIMULI_PER_ROUND rather than being its own literal.
    expect(MIN_QUESTIONS).toBe(9);
  });
});
