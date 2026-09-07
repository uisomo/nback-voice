import type { ActionCard, Sequence } from '../actions';
import {
  actionAnswer,
  advance,
  answerFor,
  buildSteps,
  buildUnits,
  createDrill,
  currentStep,
  fieldsFor,
  isFinished,
  nextStage,
  purposeAnswer,
  setSelfGrade,
  stageScore,
  STAGE_ORDER,
  submitAnswer,
  toggleChecked,
  unitContent,
  unitKey,
  updatedN,
} from '../drill';

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

  it('numbers the read card and the asked card independently', () => {
    // 学習段では両方が同時に非 null になる。読む面はいま出しているカードを、
    // 答える面と開示面は問われているカードを名指す必要がある。
    const study = steps('study', 2);
    expect(study.map((s) => s.displayOrdinal)).toEqual([1, 2, 3, 4, null, null]);
    expect(study.map((s) => s.targetOrdinal)).toEqual([null, null, 1, 2, 3, 4]);
    // 目的段には読む対象が無いので、観察のみの手はどちらの序数も持たない。
    const purpose = steps('purpose', 2);
    expect(purpose.every((s) => s.displayOrdinal === null)).toBe(true);
    expect(purpose.map((s) => s.targetOrdinal)).toEqual([null, null, 1, 2, 3, 4]);
  });

  it('counts the ordinal in cards even when the action stage walks subActions', () => {
    const s = steps('action', 1);
    expect(s.map((x) => x.targetOrdinal)).toEqual([null, 1, 1, 2, 2, 2, 3, 3]);
    expect(s.every((x) => x.displayOrdinal === null)).toBe(true);
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
    expect(
      s.every((x) => x.targetIndex === null && x.targetOrdinal === null && x.displayOrdinal === null),
    ).toBe(true);
  });

  it('numbers step.index from 0 in walk order', () => {
    expect(steps('study', 2).map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

const CORRECT = 'purpose-c1';
const WRONG = 'まったく関係のない答えを書いた';

describe('drill cursor', () => {
  it('starts at step 0 with no answers and nothing checked', () => {
    const d = createDrill(SEQ, 'study', 2);
    expect(d.stage).toBe('study');
    expect(d.n).toBe(2);
    expect(d.cursor).toBe(0);
    expect(d.answers).toEqual([]);
    expect(d.checked.size).toBe(0);
    expect(d.steps).toHaveLength(6);
    expect(currentStep(d)).toBe(d.steps[0]);
    expect(isFinished(d)).toBe(false);
  });

  it('advances one step at a time and finishes past the last step', () => {
    let d = createDrill(SEQ, 'study', 2);
    for (let i = 0; i < 6; i += 1) {
      expect(isFinished(d)).toBe(false);
      expect(currentStep(d)?.index).toBe(i);
      d = advance(d);
    }
    expect(isFinished(d)).toBe(true);
    expect(currentStep(d)).toBeNull();
  });

  it('does not mutate the state it is given', () => {
    const d = createDrill(SEQ, 'study', 2);
    advance(d);
    expect(d.cursor).toBe(0);
  });
});

describe('step content and fields', () => {
  it('resolves a unit to its card, and to its subAction in the action stage', () => {
    const study = createDrill(SEQ, 'study', 2);
    expect(unitContent(SEQ, study.units[1])).toEqual({ card: SEQ.cards[1], subAction: null });
    const action = createDrill(SEQ, 'action', 1);
    // units[3] は c2 の2つ目の小目的。
    expect(unitContent(SEQ, action.units[3])).toEqual({
      card: SEQ.cards[1],
      subAction: SEQ.cards[1].subActions[1],
    });
  });

  it('shows both fields in the study stage and one field in the others', () => {
    expect(fieldsFor('study', SEQ.cards[0])).toEqual(['purpose', 'action']);
    expect(fieldsFor('purpose', SEQ.cards[0])).toEqual(['purpose']);
    expect(fieldsFor('action', SEQ.cards[0])).toEqual(['action']);
  });

  it('drops the action field in the study stage for a card with no subActions', () => {
    expect(fieldsFor('study', SEQ.cards[3])).toEqual(['purpose']);
  });
});

describe('model answers', () => {
  it('puts the model answer itself at the head of the accept set', () => {
    const spec = purposeAnswer(SEQ.cards[0]);
    expect(spec.model).toBe('purpose-c1');
    expect(spec.accept[0]).toBe('purpose-c1');
    expect(spec.accept).toContain('p-c1');
  });

  it('targets one subAction when the action stage names it', () => {
    const spec = actionAnswer(SEQ.cards[1], 2)!;
    expect(spec.model).toBe('sa-c2-3');
    expect(spec.accept).toEqual(['sa-c2-3', 'aa-c2-3']);
  });

  it('merges every subAction when the study stage asks the card as a whole', () => {
    const spec = actionAnswer(SEQ.cards[0], null)!;
    // 開示は全列挙、照合は合併集合。一手順でも言い当てれば正解（spec §6.2）。
    expect(spec.model).toBe('sa-c1-1\nsa-c1-2');
    expect(spec.accept).toEqual(['sa-c1-1', 'aa-c1-1', 'sa-c1-2', 'aa-c1-2']);
  });

  it('has no action answer at all for a card with no subActions', () => {
    expect(actionAnswer(SEQ.cards[3], null)).toBeNull();
  });
});

describe('answers, self-grading and adaptive N', () => {
  const atStep = (stage: Parameters<typeof createDrill>[1], n: number, step: number) => {
    let d = createDrill(SEQ, stage, n);
    while (d.cursor < step) d = advance(d);
    return d;
  };

  it('grades a submitted answer locally and records the raw input', () => {
    const d = submitAnswer(atStep('study', 2, 2), 'purpose', CORRECT, purposeAnswer(SEQ.cards[0]));
    const rec = answerFor(d, 2, 'purpose')!;
    expect(rec).toEqual({ stepIndex: 2, field: 'purpose', input: CORRECT, correct: true });
    expect(stageScore(d)).toBe(1);
  });

  it('marks an unrelated answer wrong', () => {
    const d = submitAnswer(atStep('study', 2, 2), 'purpose', WRONG, purposeAnswer(SEQ.cards[0]));
    expect(answerFor(d, 2, 'purpose')!.correct).toBe(false);
    expect(stageScore(d)).toBe(0);
  });

  it('keeps one record per step and field, replacing a resubmission', () => {
    let d = submitAnswer(atStep('study', 2, 2), 'purpose', WRONG, purposeAnswer(SEQ.cards[0]));
    d = submitAnswer(d, 'purpose', CORRECT, purposeAnswer(SEQ.cards[0]));
    expect(d.answers).toHaveLength(1);
    expect(answerFor(d, 2, 'purpose')!.correct).toBe(true);
  });

  it('keeps the two study-stage fields as separate records', () => {
    let d = submitAnswer(atStep('study', 2, 2), 'purpose', CORRECT, purposeAnswer(SEQ.cards[0]));
    d = submitAnswer(d, 'action', WRONG, actionAnswer(SEQ.cards[0], null)!);
    expect(d.answers).toHaveLength(2);
    expect(stageScore(d)).toBe(0.5);
  });

  it('lets self-grading overwrite the local verdict in both directions', () => {
    let d = submitAnswer(atStep('study', 2, 2), 'purpose', WRONG, purposeAnswer(SEQ.cards[0]));
    d = setSelfGrade(d, 2, 'purpose', true);
    expect(answerFor(d, 2, 'purpose')!.correct).toBe(true);
    expect(stageScore(d)).toBe(1);
    d = setSelfGrade(d, 2, 'purpose', false);
    expect(stageScore(d)).toBe(0);
  });

  it('ignores a self-grade for a step and field that was never answered', () => {
    const d = setSelfGrade(createDrill(SEQ, 'study', 2), 4, 'action', true);
    expect(d.answers).toEqual([]);
    expect(stageScore(d)).toBeNull();
  });

  it('raises N only on a perfect stage', () => {
    const d = submitAnswer(atStep('purpose', 2, 2), 'purpose', CORRECT, purposeAnswer(SEQ.cards[0]));
    expect(stageScore(d)).toBe(1);
    expect(updatedN(d)).toBe(3);
  });

  it('lowers N at or below half, and floors it at 1', () => {
    let d = submitAnswer(atStep('purpose', 2, 2), 'purpose', CORRECT, purposeAnswer(SEQ.cards[0]));
    d = submitAnswer(advance(d), 'purpose', WRONG, purposeAnswer(SEQ.cards[1]));
    expect(stageScore(d)).toBe(0.5);
    expect(updatedN(d)).toBe(1);

    const bottom = submitAnswer(atStep('purpose', 1, 1), 'purpose', WRONG, purposeAnswer(SEQ.cards[0]));
    expect(updatedN(bottom)).toBe(1);
  });

  it('holds N steady between half and perfect', () => {
    let d = submitAnswer(atStep('purpose', 2, 2), 'purpose', CORRECT, purposeAnswer(SEQ.cards[0]));
    d = submitAnswer(advance(d), 'purpose', CORRECT, purposeAnswer(SEQ.cards[1]));
    d = submitAnswer(advance(d), 'purpose', WRONG, purposeAnswer(SEQ.cards[2]));
    expect(stageScore(d)).toBeCloseTo(2 / 3);
    expect(updatedN(d)).toBe(2);
  });

  it('leaves N alone when nothing was judged', () => {
    // 単位が0件なら全ステップが観察のみ。判定済み0件なので N は動かない。
    const d = createDrill({ ...SEQ, cards: [SEQ.cards[3]] }, 'action', 3);
    expect(d.steps).toHaveLength(3);
    expect(stageScore(d)).toBeNull();
    expect(updatedN(d)).toBe(3);
  });
});

describe('study-stage green checks', () => {
  it('toggles on and off and never touches the score', () => {
    const key = unitKey({ cardIndex: 0, subIndex: null });
    let d = toggleChecked(createDrill(SEQ, 'study', 2), key);
    expect(d.checked.has(key)).toBe(true);
    expect(stageScore(d)).toBeNull();
    d = toggleChecked(d, key);
    expect(d.checked.has(key)).toBe(false);
  });

  it('does not mutate the state it is given', () => {
    const d = createDrill(SEQ, 'study', 2);
    toggleChecked(d, unitKey({ cardIndex: 0, subIndex: null }));
    expect(d.checked.size).toBe(0);
  });
});
