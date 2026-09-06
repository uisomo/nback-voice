import type { Sequence } from '../actions';
import { buildActionRound, cardToQuestion, eligibleCards } from '../plan';

function card(id: string, order: number, extra: Partial<Sequence['cards'][number]> = {}) {
  return {
    id,
    order,
    title: `title-${id}`,
    purpose: `purpose-${id}`,
    purposeAccept: [`p-${id}`],
    subActions: [
      { id: `${id}-s1`, purpose: `sp-${id}`, action: `action-${id}`, actionAccept: [`a-${id}`] },
    ],
    category: 'universal' as const,
    ...extra,
  };
}

const SEQ: Sequence = {
  id: 's',
  product: 'sub-finance',
  goal: 'g',
  scenario: 'sc',
  credit: 'c',
  cards: [card('c1', 1), card('c2', 2), card('c3', 3), card('c4', 4)],
};

describe('action round builder', () => {
  it('cardToQuestion maps title to q and the layer field to accept', () => {
    const c = SEQ.cards[0];
    expect(cardToQuestion(c, 'purpose')).toEqual({
      id: 'c1',
      tier: 2,
      q: 'title-c1',
      accept: ['p-c1'],
    });
    expect(cardToQuestion(c, 'action').accept).toEqual(['a-c1']);
  });

  it('recallTarget is i - n, null for the first n steps', () => {
    const plan = buildActionRound(SEQ, { n: 2, layer: 'purpose', mode: 'question' });
    expect(plan.steps.map((s) => s.recallTarget)).toEqual([null, null, 0, 1]);
  });

  it('question mode has null positions; dual mode assigns positions', () => {
    const q = buildActionRound(SEQ, { n: 1, layer: 'purpose', mode: 'question' });
    expect(q.steps.every((s) => s.position === null)).toBe(true);
    const d = buildActionRound(SEQ, { n: 1, layer: 'purpose', mode: 'dual' });
    expect(d.steps.every((s) => s.position !== null)).toBe(true);
  });

  it('each step primes card i and targets the accept-set of card i-n', () => {
    const plan = buildActionRound(SEQ, { n: 1, layer: 'purpose', mode: 'question' });
    // step 1 primes c2, recalls c1
    expect(plan.steps[1].question?.q).toBe('title-c2');
    const target = plan.steps[plan.steps[1].recallTarget!];
    expect(target.question?.accept).toEqual(['p-c1']);
  });

  it('Layer 2 drops layer2Skipped cards from the walk', () => {
    const seq: Sequence = {
      ...SEQ,
      cards: [
        card('c1', 1),
        card('c2', 2, { layer2Skipped: true, subActions: [] }),
        card('c3', 3),
      ],
    };
    expect(eligibleCards(seq, 'purpose').map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(eligibleCards(seq, 'action').map((c) => c.id)).toEqual(['c1', 'c3']);
    const plan = buildActionRound(seq, { n: 1, layer: 'action', mode: 'question' });
    expect(plan.steps.map((s) => s.question?.id)).toEqual(['c1', 'c3']);
  });

  it('n >= card count yields all prime-only steps (every recallTarget null)', () => {
    const plan = buildActionRound(SEQ, { n: 9, layer: 'purpose', mode: 'question' });
    expect(plan.steps.every((s) => s.recallTarget === null)).toBe(true);
  });
});
