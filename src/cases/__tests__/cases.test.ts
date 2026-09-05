import { casesByProduct, getCase, listCases, PRODUCT_ORDER } from '../cases';

const GROUPS = ['terms', 'collateral', 'investors', 'legal', 'risk'];

describe('cases content', () => {
  it('loads at least one case', () => {
    expect(listCases().length).toBeGreaterThan(0);
  });

  it('has unique ids', () => {
    const ids = listCases().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every case has a valid product, a non-empty sheet, and at least one turn', () => {
    for (const c of listCases()) {
      expect(PRODUCT_ORDER).toContain(c.product);
      expect(c.sheet.length).toBeGreaterThan(0);
      expect(c.conversation.length).toBeGreaterThan(0);
      expect(c.title.trim()).not.toBe('');
      expect(c.credit.trim()).not.toBe('');
    }
  });

  it('every sheet field has a valid group and non-empty label/value', () => {
    for (const c of listCases()) {
      for (const f of c.sheet) {
        expect(GROUPS).toContain(f.group);
        expect(f.label.trim()).not.toBe('');
        expect(f.value.trim()).not.toBe('');
      }
    }
  });

  it('every turn has a non-empty speaker and line', () => {
    for (const c of listCases()) {
      for (const t of c.conversation) {
        expect(t.speaker.trim()).not.toBe('');
        expect(t.line.trim()).not.toBe('');
      }
    }
  });

  it('getCase returns the matching case and undefined for unknown ids', () => {
    const first = listCases()[0];
    expect(getCase(first.id)).toEqual(first);
    expect(getCase('does-not-exist')).toBeUndefined();
  });

  it('casesByProduct groups in PRODUCT_ORDER and omits empty products', () => {
    const groups = casesByProduct();
    const products = groups.map((g) => g.product);
    // order is a subsequence of PRODUCT_ORDER
    const orderIdx = products.map((p) => PRODUCT_ORDER.indexOf(p));
    expect(orderIdx).toEqual([...orderIdx].sort((a, b) => a - b));
    // no empty groups
    for (const g of groups) expect(g.cases.length).toBeGreaterThan(0);
    // every case appears exactly once
    expect(groups.flatMap((g) => g.cases).length).toBe(listCases().length);
  });
});
