import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { listCases } from '../../cases/cases';
import { CaseGameScreen } from '../CaseGameScreen';

const CASE = listCases()[0];

function renderGame(onExit = jest.fn()) {
  render(<CaseGameScreen caseId={CASE.id} onExit={onExit} />);
}

describe('CaseGameScreen', () => {
  it('shows the sheet intro first, then starts the conversation', async () => {
    renderGame();
    // a sheet value is visible before starting
    expect(screen.getByText(CASE.sheet[0].value)).toBeTruthy();
    fireEvent.press(screen.getByTestId('case-start'));
    await waitFor(() => expect(screen.getByTestId('case-guess-input')).toBeTruthy());
    // first speaker shown, real line NOT yet shown
    expect(screen.getByText(CASE.conversation[0].speaker)).toBeTruthy();
    expect(screen.queryByTestId('case-real-line')).toBeNull();
  });

  it('reveals the real line and keeps the typed guess', async () => {
    renderGame();
    fireEvent.press(screen.getByTestId('case-start'));
    await waitFor(() => screen.getByTestId('case-guess-input'));
    fireEvent.changeText(screen.getByTestId('case-guess-input'), 'my guess');
    fireEvent.press(screen.getByTestId('case-reveal'));
    expect(screen.getByTestId('case-real-line')).toHaveTextContent(CASE.conversation[0].line);
    expect(screen.getByTestId('case-your-guess')).toHaveTextContent('my guess');
  });

  it('advances to the CRO approval stamp after the last turn', async () => {
    renderGame();
    fireEvent.press(screen.getByTestId('case-start'));
    await waitFor(() => screen.getByTestId('case-guess-input'));
    for (let i = 0; i < CASE.conversation.length; i++) {
      fireEvent.press(screen.getByTestId('case-reveal'));
      fireEvent.press(screen.getByTestId('case-next'));
    }
    await waitFor(() => expect(screen.getByTestId('case-approved')).toBeTruthy());
  });

  it('exits from the end card via back', async () => {
    const onExit = jest.fn();
    renderGame(onExit);
    fireEvent.press(screen.getByTestId('case-start'));
    await waitFor(() => screen.getByTestId('case-guess-input'));
    for (let i = 0; i < CASE.conversation.length; i++) {
      fireEvent.press(screen.getByTestId('case-reveal'));
      fireEvent.press(screen.getByTestId('case-next'));
    }
    await waitFor(() => screen.getByTestId('case-back'));
    fireEvent.press(screen.getByTestId('case-back'));
    expect(onExit).toHaveBeenCalled();
  });
});
