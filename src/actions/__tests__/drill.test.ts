import type { ActionCard, Sequence } from '../actions';
import { buildSteps, buildUnits, nextStage, STAGE_ORDER, unitKey } from '../drill';

function sub(cardId: string, k: number) {
  return {
    id: `${cardId}-s${k}`,
    purpose: `sp-${cardId}-${k}`,
    action: `sa-${cardId}-${k}`,
    actionAccept: [`aa-${cardId}-${k}`],
  };
}

function card(id: string, order: number, subCount: number, extra: Partial<ActionCard> = {}) {
  return {
    id,
    order,
    title: `title-${id}`,
    purpose: `purpose-${id}`,
    purposeAccept: [`p-${id}`],
    subActions: Array.from({ length: subCount }, (_, k) => sub(id, k + 1)),
    category: 'universal' as const,
    ...extra,
  };
}

/** 4枚。小目的は 2 + 3 + 2 + 0 = 7 個。c4 は具体アクション段でスキップされる。 */
const SEQ: Sequence = {
  id: 's',
  product: 'sub-finance',
  goal: 'g',
  scenario: 'sc',
  credit: 'c',
  cards: [
    card('c1', 1, 2),
    card('c2', 2, 3),
    card('c3', 3, 2),
    card('c4', 4, 0, { layer2Skipped: true }),
  ],
};

const steps = (stage: Parameters<typeof buildSteps>[2], n: number) =>
  buildSteps(buildUnits(SEQ, stage), n, stage, SEQ.cards.length);

describe('stage order', () => {
  it('runs study -> purpose -> action and then ends', () => {
    expect(STAGE_ORDER).toEqual(['study', 'purpose', 'action']);
    expect(nextStage('study')).toBe('purpose');
    expect(nextStage('purpose')).toBe('action');
    expect(nextStage('action')).toBeNull();
  });
});

describe('buildUnits', () => {
  it('walks cards in the study and purpose stages', () => {
    for (const stage of ['study', 'purpose'] as const) {
      expect(buildUnits(SEQ, stage)).toEqual([
        { cardIndex: 0, subIndex: null },
        { cardIndex: 1, subIndex: null },
        { cardIndex: 2, subIndex: null },
        { cardIndex: 3, subIndex: null },
      ]);
    }
  });

  it('flattens subActions in the action stage and drops cards that have none', () => {
    expect(buildUnits(SEQ, 'action')).toEqual([
      { cardIndex: 0, subIndex: 0 },
      { cardIndex: 0, subIndex: 1 },
      { cardIndex: 1, subIndex: 0 },
      { cardIndex: 1, subIndex: 1 },
      { cardIndex: 1, subIndex: 2 },
      { cardIndex: 2, subIndex: 0 },
      { cardIndex: 2, subIndex: 1 },
    ]);
  });

  it('gives every unit a distinct key', () => {
    const keys = buildUnits(SEQ, 'action').map(unitKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(unitKey({ cardIndex: 1, subIndex: null })).not.toBe(unitKey({ cardIndex: 1, subIndex: 0 }));
  });
});

describe('buildSteps', () => {
  it('walks unit count + n steps so every unit is asked exactly once', () => {
    expect(steps('study', 2)).toHaveLength(6);
    expect(steps('purpose', 2)).toHaveLength(6);
    expect(steps('action', 1)).toHaveLength(8);
    const asked = steps('purpose', 2)
      .map((s) => s.targetIndex)
      .filter((t): t is number => t !== null);
    expect(asked).toEqual([0, 1, 2, 3]);
  });

  it('lags the target by n and leaves the first n steps observation-only', () => {
    expect(steps('study', 2).map((s) => s.targetIndex)).toEqual([null, null, 0, 1, 2, 3]);
  });

  it('shows a card to read only in the study stage, and only while cards remain', () => {
    expect(steps('study', 2).map((s) => s.displayIndex)).toEqual([0, 1, 2, 3, null, null]);
    expect(steps('purpose', 2).every((s) => s.displayIndex === null)).toBe(true);
    expect(steps('action', 1).every((s) => s.displayIndex === null)).toBe(true);
  });

  it('numbers the header by the card being asked, falling back to the card being read', () => {
    // 学習段 step0/1 は出題が無いので、読んでいるカードの序数を出す。
    expect(steps('study', 2).map((s) => s.ordinal)).toEqual([1, 2, 1, 2, 3, 4]);
    // 目的段には読む対象が無いので、観察のみの手は序数を持たない。
    expect(steps('purpose', 2).map((s) => s.ordinal)).toEqual([null, null, 1, 2, 3, 4]);
  });

  it('counts the ordinal in cards even when the action stage walks subActions', () => {
    const s = steps('action', 1);
    expect(s.map((x) => x.ordinal)).toEqual([null, 1, 1, 2, 2, 2, 3, 3]);
    expect(s.map((x) => x.subIndex)).toEqual([null, 0, 1, 0, 1, 2, 0, 1]);
    expect(s.every((x) => x.totalCards === 4)).toBe(true);
  });

  it('carries a null subIndex outside the action stage', () => {
    expect(steps('study', 2).every((s) => s.subIndex === null)).toBe(true);
    expect(steps('purpose', 2).every((s) => s.subIndex === null)).toBe(true);
  });

  it('still asks every card when n exceeds the card count', () => {
    const s = steps('purpose', 9);
    expect(s).toHaveLength(13);
    expect(s.slice(0, 9).every((x) => x.targetIndex === null)).toBe(true);
    expect(s.slice(9).map((x) => x.targetIndex)).toEqual([0, 1, 2, 3]);
  });

  it('yields n observation-only steps and nothing else when there are no units', () => {
    const s = buildSteps([], 2, 'action', 4);
    expect(s).toHaveLength(2);
    expect(s.every((x) => x.targetIndex === null && x.ordinal === null)).toBe(true);
  });

  it('numbers step.index from 0 in walk order', () => {
    expect(steps('study', 2).map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
