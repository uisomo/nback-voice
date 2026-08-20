import { DEFAULT_BUDGET_BASE_MS, answerBudgetMs } from '../budget';

describe('answerBudgetMs', () => {
  it('gives a second per character on top of the base', () => {
    expect(answerBudgetMs('わん', 4000)).toBe(6000);
    expect(answerBudgetMs('キャピタルコール', 4000)).toBe(12000);
    expect(answerBudgetMs('未コールコミットメント', 4000)).toBe(15000);
  });

  it('honours a different base', () => {
    expect(answerBudgetMs('わん', 0)).toBe(2000);
    expect(answerBudgetMs('わん', 10000)).toBe(12000);
  });

  /** Counted in code points: a surrogate pair is one character to a reader. */
  it('counts code points, not UTF-16 units', () => {
    expect(answerBudgetMs('𠮟', 0)).toBe(1000);
  });

  it('gives the base alone for an empty answer', () => {
    expect(answerBudgetMs('', 4000)).toBe(4000);
  });

  it('ships a base of 4 seconds', () => {
    expect(DEFAULT_BUDGET_BASE_MS).toBe(4000);
  });
});
