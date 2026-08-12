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
  it('shows the N of the round', () => {
    const { getByText } = render(
      <ResultsScreen engine={finishedEngine(9)} n={3} onAgain={() => {}} />,
    );
    expect(getByText(/3-back/)).toBeTruthy();
  });

  it('shows both channel percentages', () => {
    const { getByText } = render(
      <ResultsScreen engine={finishedEngine(9)} n={2} onAgain={() => {}} />,
    );
    expect(getByText(/位置.*100%/)).toBeTruthy();
    expect(getByText(/回答.*100%/)).toBeTruthy();
  });

  it('shows an em dash for the answer channel when nothing resolved', () => {
    const { getByText } = render(
      <ResultsScreen engine={finishedEngine(0)} n={2} onAgain={() => {}} />,
    );
    expect(getByText(/回答.*—/)).toBeTruthy();
  });

  it('reports the 未判定 count when some answers went ungraded', () => {
    const { getByText } = render(
      <ResultsScreen engine={finishedEngine(4)} n={2} onAgain={() => {}} />,
    );
    expect(getByText(/未判定 5 件/)).toBeTruthy();
  });

  it('hides the 未判定 line when everything resolved', () => {
    const { queryByText } = render(
      <ResultsScreen engine={finishedEngine(9)} n={2} onAgain={() => {}} />,
    );
    expect(queryByText(/未判定/)).toBeNull();
  });

  it('fires onAgain when the button is pressed', () => {
    const onAgain = jest.fn();
    const { getByText } = render(
      <ResultsScreen engine={finishedEngine(9)} n={2} onAgain={onAgain} />,
    );
    fireEvent.press(getByText('もう一度'));
    expect(onAgain).toHaveBeenCalled();
  });
});
