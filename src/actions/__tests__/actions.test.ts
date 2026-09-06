import {
  getSequence,
  listSequences,
  PRODUCT_ORDER,
  sequencesByProduct,
} from '../actions';

const CATEGORIES = ['universal', 'conditional', 'arbitrary'];

describe('sequences content', () => {
  it('loads at least one sequence', () => {
    expect(listSequences().length).toBeGreaterThan(0);
  });

  it('has unique sequence ids and unique card ids across everything', () => {
    const seqIds = listSequences().map((s) => s.id);
    expect(new Set(seqIds).size).toBe(seqIds.length);
    const cardIds = listSequences().flatMap((s) => s.cards.map((c) => c.id));
    expect(new Set(cardIds).size).toBe(cardIds.length);
  });

  it('every sequence has a valid product, non-empty goal/scenario/credit, and cards', () => {
    for (const s of listSequences()) {
      expect(PRODUCT_ORDER).toContain(s.product);
      expect(s.goal.trim()).not.toBe('');
      expect(s.scenario.trim()).not.toBe('');
      expect(s.credit.trim()).not.toBe('');
      expect(s.cards.length).toBeGreaterThan(0);
    }
  });

  it('card orders are contiguous from 1', () => {
    for (const s of listSequences()) {
      const orders = s.cards.map((c) => c.order);
      expect(orders).toEqual(orders.map((_, i) => i + 1));
    }
  });

  it('every card has a valid category, non-empty title/purpose, and a non-empty purposeAccept', () => {
    for (const s of listSequences()) {
      for (const c of s.cards) {
        expect(CATEGORIES).toContain(c.category);
        expect(c.title.trim()).not.toBe('');
        expect(c.purpose.trim()).not.toBe('');
        expect(c.purposeAccept.length).toBeGreaterThan(0);
        for (const a of c.purposeAccept) expect(a.trim()).not.toBe('');
      }
    }
  });

  it('a card is either Layer-2 playable (non-empty action + actionAccept) or explicitly layer2Skipped', () => {
    for (const s of listSequences()) {
      for (const c of s.cards) {
        if (c.layer2Skipped) {
          continue;
        }
        expect(c.action.trim()).not.toBe('');
        expect(c.actionAccept.length).toBeGreaterThan(0);
        for (const a of c.actionAccept) expect(a.trim()).not.toBe('');
      }
    }
  });

  it('getSequence returns the matching sequence and undefined for unknown ids', () => {
    const first = listSequences()[0];
    expect(getSequence(first.id)).toEqual(first);
    expect(getSequence('nope')).toBeUndefined();
  });

  it('sequencesByProduct groups in PRODUCT_ORDER and omits empty products', () => {
    const groups = sequencesByProduct();
    const products = groups.map((g) => g.product);
    const orderIdx = products.map((p) => PRODUCT_ORDER.indexOf(p));
    expect(orderIdx).toEqual([...orderIdx].sort((a, b) => a - b));
    for (const g of groups) expect(g.sequences.length).toBeGreaterThan(0);
    expect(groups.flatMap((g) => g.sequences).length).toBe(listSequences().length);
  });
});
