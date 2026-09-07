import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { listSequences } from '../../actions/actions';
import { ja } from '../../strings';
import { ActionGameScreen } from '../ActionGameScreen';
import { getTheme } from '../theme';

// expo-speech / expo-speech-recognition のモックは無い。この画面はもう
// 音声スタックを import しないので、モック無しで描画できること自体が
// 依存が切れている証拠になる（spec §3・§7）。

const SEQ = listSequences()[0];
const THEME = getTheme();

/**
 * N を 1 に落として学習段を開始する。ラグが短いほど手数が少なくて済む。
 * 抜け道の検査に使えるよう onExit のモックを返す。
 */
function startStudyAtN1() {
  const onExit = jest.fn();
  render(<ActionGameScreen sequenceId={SEQ.id} onExit={onExit} />);
  fireEvent.press(screen.getByTestId('action-n-down')); // 2 -> 1
  fireEvent.press(screen.getByTestId('action-start'));
  return onExit;
}

const bgOf = (testID: string) =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style).backgroundColor;

/** step 0 の読む面を抜け、step 1 でカード1を問われる面まで進む。 */
function reachFirstQuestion() {
  startStudyAtN1();
  fireEvent.press(screen.getByTestId('action-read-next')); // step 0 -> step 1
  fireEvent.press(screen.getByTestId('action-read-next')); // step 1 の読む面 -> 答える面
}

describe('intro', () => {
  it('shows the scenario, the goal and every card title', () => {
    render(<ActionGameScreen sequenceId={SEQ.id} onExit={jest.fn()} />);
    expect(screen.getByTestId('action-intro')).toBeTruthy();
    expect(screen.getByText(SEQ.scenario)).toBeTruthy();
    for (const card of SEQ.cards) expect(screen.getByText(card.title)).toBeTruthy();
  });

  it('shows the three stages in order as a non-interactive nav', () => {
    render(<ActionGameScreen sequenceId={SEQ.id} onExit={jest.fn()} />);
    expect(screen.getByTestId('action-nav-study').props.children).toBe(ja.actions.stageStudy);
    expect(screen.getByTestId('action-nav-purpose').props.children).toBe(ja.actions.stagePurpose);
    expect(screen.getByTestId('action-nav-action').props.children).toBe(ja.actions.stageAction);
  });

  it('picks N, flooring at 1', () => {
    render(<ActionGameScreen sequenceId={SEQ.id} onExit={jest.fn()} />);
    fireEvent.press(screen.getByTestId('action-n-up'));
    expect(screen.getByTestId('action-n-value').props.children).toBe(3);
    for (let i = 0; i < 5; i += 1) fireEvent.press(screen.getByTestId('action-n-down'));
    expect(screen.getByTestId('action-n-value').props.children).toBe(1);
  });

  it('renders a back affordance and exits when the sequence is unknown', () => {
    const onExit = jest.fn();
    render(<ActionGameScreen sequenceId="no-such-sequence" onExit={onExit} />);
    fireEvent.press(screen.getByTestId('action-back'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('the study stage', () => {
  it('opens on a read pane with the card nesting and no input fields', () => {
    startStudyAtN1();
    expect(screen.getByTestId('action-play')).toBeTruthy();
    expect(screen.getByText(SEQ.cards[0].title)).toBeTruthy();
    expect(screen.getByTestId('action-read-purpose').props.children).toBe(SEQ.cards[0].purpose);
    expect(screen.queryByTestId('action-input-purpose')).toBeNull();
  });

  it('keeps the grand purpose and the read cards ordinal in the header of a read pane', () => {
    startStudyAtN1();
    expect(screen.getByTestId('action-header-goal').props.children).toBe(SEQ.goal);
    // step 0 の読む面。カード1を出しているので序数も1。
    expect(screen.getByTestId('action-header-ordinal').props.children).toBe(
      ja.actions.ordinalOf(1, SEQ.cards.length),
    );
    expect(screen.getByTestId('action-header-n').props.children).toEqual([1, '-back']);
  });

  it('numbers a read pane by the card on screen even when another card is being asked', () => {
    startStudyAtN1();
    fireEvent.press(screen.getByTestId('action-read-next')); // step 0 -> step 1
    // step 1 の読む面。出しているのは カード2、この手で問われるのは カード1。
    // 読む面には設問が無いので、名指すべきは画面のカード＝2 である。
    expect(screen.getByTestId('action-read')).toBeTruthy();
    expect(screen.getByTestId('action-header-ordinal').props.children).toBe(
      ja.actions.ordinalOf(2, SEQ.cards.length),
    );
  });

  it('toggles the green check on the read pane', () => {
    startStudyAtN1();
    expect(screen.queryByTestId('action-read-checked')).toBeNull();
    fireEvent.press(screen.getByTestId('action-read'));
    expect(screen.getByTestId('action-read-checked')).toBeTruthy();
    fireEvent.press(screen.getByTestId('action-read'));
    expect(screen.queryByTestId('action-read-checked')).toBeNull();
  });

  it('asks the n-back card, not the one on screen', () => {
    reachFirstQuestion();
    // step 1 の答える面。直前まで読んでいたのは カード2 だが、
    // 設問が乗った面なので序数は問われているカード＝1 を名指す。
    expect(screen.getByTestId('action-header-ordinal').props.children).toBe(
      ja.actions.ordinalOf(1, SEQ.cards.length),
    );
    expect(screen.getByTestId('action-input-purpose')).toBeTruthy();
    expect(screen.getByTestId('action-input-action')).toBeTruthy();
  });

  it('can be left mid-stage — the play phase has its own way out', () => {
    // 段の途中でも抜けられること。タブバーは action-game では隠れるので、
    // ここに戻る導線が無いと段を最後までタップし切るしか出口が無くなる。
    const onExit = startStudyAtN1();
    expect(screen.getByTestId('action-play')).toBeTruthy();
    fireEvent.press(screen.getByTestId('action-back'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('answering and revealing', () => {
  it('reveals both answers and paints the local verdict per field', () => {
    reachFirstQuestion();
    fireEvent.changeText(screen.getByTestId('action-input-purpose'), SEQ.cards[0].purpose);
    fireEvent.changeText(screen.getByTestId('action-input-action'), 'まったく関係のない答えを書いた');
    fireEvent.press(screen.getByTestId('action-next'));

    expect(screen.getByTestId('action-your-purpose').props.children).toBe(SEQ.cards[0].purpose);
    expect(screen.getByTestId('action-model-purpose').props.children).toBe(SEQ.cards[0].purpose);
    expect(bgOf('action-verdict-purpose')).toBe(THEME.accentSuccess);
    expect(bgOf('action-verdict-action')).toBe(THEME.accentWarning);
  });

  it('lets self-grading repaint the verdict in both directions', () => {
    reachFirstQuestion();
    fireEvent.changeText(screen.getByTestId('action-input-purpose'), SEQ.cards[0].purpose);
    fireEvent.press(screen.getByTestId('action-next'));
    expect(bgOf('action-verdict-purpose')).toBe(THEME.accentSuccess);

    fireEvent.press(screen.getByTestId('action-self-wrong-purpose'));
    expect(bgOf('action-verdict-purpose')).toBe(THEME.accentWarning);
    fireEvent.press(screen.getByTestId('action-self-correct-purpose'));
    expect(bgOf('action-verdict-purpose')).toBe(THEME.accentSuccess);
  });

  it('moves to the next step from the reveal pane', () => {
    reachFirstQuestion();
    fireEvent.press(screen.getByTestId('action-next'));
    fireEvent.press(screen.getByTestId('action-next-question'));
    // step 2 の読む面。画面に出るのは カード3 なので、序数もそれを名指す
    //（この手で問われるのは カード2 だが、それは答える面に移ってから）。
    expect(screen.getByTestId('action-read')).toBeTruthy();
    expect(screen.getByTestId('action-header-ordinal').props.children).toBe(
      ja.actions.ordinalOf(3, SEQ.cards.length),
    );
  });
});

describe('stage transitions', () => {
  /** 現在の面がどれであれ、1ステップ分だけ最短で進める。 */
  function stepThrough() {
    if (screen.queryByTestId('action-read-next')) fireEvent.press(screen.getByTestId('action-read-next'));
    if (screen.queryByTestId('action-observe-next')) fireEvent.press(screen.getByTestId('action-observe-next'));
    if (screen.queryByTestId('action-next')) fireEvent.press(screen.getByTestId('action-next'));
    if (screen.queryByTestId('action-next-question')) fireEvent.press(screen.getByTestId('action-next-question'));
  }

  it('ends the study stage on a results screen and leads into the purpose stage', () => {
    startStudyAtN1();
    // 学習段は カード枚数 + N 手。
    for (let i = 0; i < SEQ.cards.length + 1; i += 1) stepThrough();

    expect(screen.getByTestId('action-results')).toBeTruthy();
    expect(screen.getByTestId('action-results-stage').props.children).toBe(ja.actions.stageStudy);
    // 何も入力しなかったので全問不正解。
    expect(screen.getByTestId('action-results-score').props.children).toEqual([
      ja.actions.stageScoreLabel, ': ', '0%',
    ]);

    fireEvent.press(screen.getByTestId('action-next-stage'));
    expect(screen.getByTestId('action-play')).toBeTruthy();
    // 目的段には読む面が無く、先頭N手は観察のみになる。
    expect(screen.queryByTestId('action-read')).toBeNull();
    expect(screen.getByTestId('action-observe-next')).toBeTruthy();
    expect(screen.getByTestId('action-header-ordinal').props.children).toBe('—');
  });
});
