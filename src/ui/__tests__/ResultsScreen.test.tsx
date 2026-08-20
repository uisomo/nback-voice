import { StyleSheet } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { RoundEngine, buildRound } from '../../engine';
import type { Question } from '../../engine/types';
import { ResultsScreen } from '../ResultsScreen';

const BANK: Question[] = Array.from({ length: 20 }, (_, i) => ({
  id: `q${i}`,
  tier: 1,
  q: `質問${i}`,
  accept: [`答え${i}`],
}));

/** A finished round: all taps correct, `resolved` answers graded correct. */
function finishedEngine(resolved: number): RoundEngine {
  const plan = buildRound(2, BANK, Math.random);
  const engine = new RoundEngine(plan);
  for (const step of plan.steps) {
    engine.submitStep(step.index, {
      tap: step.recallTarget === null ? null : plan.steps[step.recallTarget].position,
      transcript: step.recallTarget === null ? null : 'こたえ',
    });
  }
  const pending = engine.takePending();
  for (let i = 0; i < resolved; i++) engine.resolveAnswer(pending[i].index, true);
  return engine;
}

describe('ResultsScreen', () => {
  it('offers a way back to the series list', () => {
    const onChangeSeries = jest.fn();
    const { getByText } = render(
      <ResultsScreen
        engine={finishedEngine(9)}
        n={2}
        onAgain={() => {}}
        onChangeSeries={onChangeSeries}
      />,
    );
    fireEvent.press(getByText('シリーズを変える'));
    expect(onChangeSeries).toHaveBeenCalled();
  });

  it('shows the N of the round', () => {
    const { getByText } = render(
      <ResultsScreen engine={finishedEngine(9)} n={3} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(getByText(/3-back/)).toBeTruthy();
  });

  it('shows both channel percentages', () => {
    const { getByText } = render(
      <ResultsScreen engine={finishedEngine(9)} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(getByText(/位置.*100%/)).toBeTruthy();
    expect(getByText(/回答.*100%/)).toBeTruthy();
  });

  it('shows an em dash for the answer channel when nothing resolved', () => {
    const { getByText } = render(
      <ResultsScreen engine={finishedEngine(0)} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(getByText(/回答.*—/)).toBeTruthy();
  });

  it('reports the 未判定 count when some answers went ungraded', () => {
    const { getByText } = render(
      <ResultsScreen engine={finishedEngine(4)} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(getByText(/未判定 5 件/)).toBeTruthy();
  });

  it('hides the 未判定 line when everything resolved', () => {
    const { queryByText } = render(
      <ResultsScreen engine={finishedEngine(9)} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(queryByText(/未判定/)).toBeNull();
  });

  it('fires onAgain when the button is pressed', () => {
    const onAgain = jest.fn();
    const { getByText } = render(
      <ResultsScreen engine={finishedEngine(9)} n={2} onAgain={onAgain} onChangeSeries={() => {}} />,
    );
    fireEvent.press(getByText('もう一度'));
    expect(onAgain).toHaveBeenCalled();
  });
});

/** The colour a node actually renders with, whatever the style shape. */
function colorOf(node: { props: { style?: StyleProp<TextStyle> } }): unknown {
  return StyleSheet.flatten(node.props.style)?.color;
}

const CORRECT = '#4caf7d';
const WRONG = '#e5534b';
const NEUTRAL = '#8e8e93';

/**
 * A round the owner would want to review: step 2 heard and correct, step 3
 * heard and wrong, step 4 never heard, the rest heard but ungraded. Taps:
 * step 2 right, step 3 wrong, step 4 none.
 */
function mixedEngine(mode: 'dual' | 'question' = 'dual'): RoundEngine {
  const plan = buildRound(2, BANK, Math.random, mode);
  const engine = new RoundEngine(plan);
  for (const step of plan.steps) {
    if (step.recallTarget === null) {
      engine.submitStep(step.index, { tap: null, transcript: null });
      continue;
    }
    const target = plan.steps[step.recallTarget];
    // Step 3 taps a cell that cannot be the target one, whatever was drawn.
    const tap =
      step.index === 2
        ? target.position
        : step.index === 3
          ? ((target.position ?? 0) + 1) % 9
          : null;
    engine.submitStep(step.index, {
      tap,
      transcript: step.index === 4 ? null : `こたえ${step.index}`,
    });
  }
  engine.takePending();
  engine.resolveAnswer(2, true);
  engine.resolveAnswer(3, false);
  return engine;
}

describe('ResultsScreen answer review', () => {
  it('lists every scored step with the question that was recalled', () => {
    const { getAllByTestId } = render(
      <ResultsScreen engine={mixedEngine()} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(getAllByTestId(/^review-row-/)).toHaveLength(9);
  });

  it('shows a correct answer in green', () => {
    const { getByTestId } = render(
      <ResultsScreen engine={mixedEngine()} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    const heard = getByTestId('review-heard-2');
    expect(heard.props.children).toContain('こたえ2');
    expect(colorOf(heard)).toBe(CORRECT);
  });

  it('shows a wrong answer in red', () => {
    const { getByTestId } = render(
      <ResultsScreen engine={mixedEngine()} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(colorOf(getByTestId('review-heard-3'))).toBe(WRONG);
  });

  it('marks a step nobody was heard on as 聞き取れず, in neutral', () => {
    const { getByTestId } = render(
      <ResultsScreen engine={mixedEngine()} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    const heard = getByTestId('review-heard-4');
    expect(heard.props.children).toBe('（聞き取れず）');
    expect(colorOf(heard)).toBe(NEUTRAL);
  });

  it('marks an ungraded answer 未判定, in neutral', () => {
    const { getByTestId } = render(
      <ResultsScreen engine={mixedEngine()} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(colorOf(getByTestId('review-heard-5'))).toBe(NEUTRAL);
    expect(getByTestId('review-verdict-5').props.children).toBe('未判定');
  });

  it('colours the position mark per step', () => {
    const { getByTestId } = render(
      <ResultsScreen engine={mixedEngine()} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(colorOf(getByTestId('review-position-2'))).toBe(CORRECT);
    expect(colorOf(getByTestId('review-position-3'))).toBe(WRONG);
    expect(colorOf(getByTestId('review-position-4'))).toBe(NEUTRAL);
  });

  it('shows no position marks in question mode', () => {
    const { queryByTestId, getAllByTestId } = render(
      <ResultsScreen engine={mixedEngine('question')} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(getAllByTestId(/^review-row-/)).toHaveLength(9);
    expect(queryByTestId('review-position-2')).toBeNull();
  });
});

describe('ResultsScreen lag', () => {
  it('says what the lag meant, not just its name', () => {
    const { getByText } = render(
      <ResultsScreen engine={mixedEngine()} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(getByText(/2つ前の質問/)).toBeTruthy();
  });
});

/** All the text a node renders, however deeply its Texts are nested. */
function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return textOf((node as { props: { children?: unknown } }).props.children);
  }
  return '';
}

/** A bank whose answers carry synonyms, as the real one does. */
const SYNONYM_BANK: Question[] = Array.from({ length: 20 }, (_, i) => ({
  id: `s${i}`,
  tier: 1,
  q: `質問${i}`,
  accept: [`本命${i}`, `別名${i}`, `略称${i}`],
}));

function engineWith(bank: Question[]): RoundEngine {
  const plan = buildRound(2, bank, Math.random);
  const engine = new RoundEngine(plan);
  for (const step of plan.steps) {
    engine.submitStep(step.index, {
      tap: step.recallTarget === null ? null : plan.steps[step.recallTarget].position,
      transcript: step.recallTarget === null ? null : 'こたえ',
    });
  }
  engine.takePending();
  return engine;
}

describe('ResultsScreen correct answer', () => {
  it('shows the answer on every row — the round is over, nothing is a spoiler', () => {
    const engine = mixedEngine();
    const { getByTestId } = render(
      <ResultsScreen engine={engine} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    expect(engine.review).toHaveLength(9);
    for (const row of engine.review) {
      expect(textOf(getByTestId(`review-answer-${row.index}`))).toContain(
        row.question.accept[0],
      );
    }
  });

  it('shows it on the rows that most need it — 聞き取れず and 未判定', () => {
    const engine = mixedEngine();
    const byIndex = new Map(engine.review.map((row) => [row.index, row]));
    const { getByTestId } = render(
      <ResultsScreen engine={engine} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    // Step 4 was never heard; step 5 was heard but never graded.
    expect(byIndex.get(4)?.transcript).toBeNull();
    expect(byIndex.get(5)?.correct).toBeNull();
    for (const index of [4, 5]) {
      expect(textOf(getByTestId(`review-answer-${index}`))).toContain(
        byIndex.get(index)!.question.accept[0],
      );
    }
  });

  /**
   * The tail of `accept` is recognizer tolerance plus whatever the judge
   * learned at runtime. Those exist so your phrasing passes — they are not
   * the answer, and the list grows as you play.
   */
  it('shows the canonical answer only, never the synonyms', () => {
    const engine = engineWith(SYNONYM_BANK);
    const { getByTestId } = render(
      <ResultsScreen engine={engine} n={2} onAgain={() => {}} onChangeSeries={() => {}} />,
    );
    for (const row of engine.review) {
      const shown = textOf(getByTestId(`review-answer-${row.index}`));
      expect(shown).toContain(row.question.accept[0]);
      expect(shown).not.toContain(row.question.accept[1]);
      expect(shown).not.toContain(row.question.accept[2]);
    }
  });
});
