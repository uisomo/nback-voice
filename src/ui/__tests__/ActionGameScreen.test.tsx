import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { listSequences } from '../../actions/actions';
import { eligibleCards } from '../../actions/plan';
import { ActionGameScreen } from '../ActionGameScreen';

// The screen constructs the real ExpoSpeaker/ExpoListener via realDeps, which
// pull in expo-speech and expo-speech-recognition at module load. Neither has
// a native backend under Jest, so both are faked — exactly as GameScreen.test
// does — to let the deterministic shell render without a TTS/recognizer.
jest.mock('expo-speech-recognition', () => ({
  useSpeechRecognitionEvent: jest.fn(),
  AVAudioSessionCategory: { playAndRecord: 'playAndRecord' },
  AVAudioSessionCategoryOptions: {
    defaultToSpeaker: 'defaultToSpeaker',
    allowBluetooth: 'allowBluetooth',
  },
  AVAudioSessionMode: { default: 'default' },
  ExpoSpeechRecognitionModule: {
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    supportsOnDeviceRecognition: jest.fn(() => false),
    getSupportedLocales: jest.fn(async () => ({ locales: [], installedLocales: [] })),
    start: jest.fn(),
    stop: jest.fn(),
  },
}));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));

const SEQ = listSequences()[0];

describe('ActionGameScreen', () => {
  it('shows the intro with the goal and the card-title preview', () => {
    render(<ActionGameScreen sequenceId={SEQ.id} onExit={jest.fn()} />);
    expect(screen.getByTestId('action-intro')).toBeTruthy();
    // The goal text is shown.
    expect(screen.getByText(new RegExp(SEQ.goal))).toBeTruthy();
    // Every eligible Layer-1 card's title is previewed.
    for (const card of eligibleCards(SEQ, 'purpose')) {
      expect(screen.getByText(card.title)).toBeTruthy();
    }
  });

  it('the N picker updates the shown N', () => {
    render(<ActionGameScreen sequenceId={SEQ.id} onExit={jest.fn()} />);
    const before = screen.getByTestId('action-n-value').props.children;
    fireEvent.press(screen.getByTestId('action-n-up'));
    const after = screen.getByTestId('action-n-value').props.children;
    expect(after).not.toBe(before);
  });

  it('the N picker floors at 1', () => {
    render(<ActionGameScreen sequenceId={SEQ.id} onExit={jest.fn()} />);
    // Default is 2; two down presses would reach 0 without a floor.
    fireEvent.press(screen.getByTestId('action-n-down'));
    fireEvent.press(screen.getByTestId('action-n-down'));
    fireEvent.press(screen.getByTestId('action-n-down'));
    expect(screen.getByTestId('action-n-value').props.children).toBe(1);
  });

  it('start moves from intro to the play phase with a prompt', async () => {
    render(<ActionGameScreen sequenceId={SEQ.id} onExit={jest.fn()} />);
    fireEvent.press(screen.getByTestId('action-start'));
    await waitFor(() => expect(screen.getByTestId('action-prompt')).toBeTruthy());
    expect(screen.queryByTestId('action-intro')).toBeNull();
  });

  it('renders a back affordance and exits when the sequence is unknown', () => {
    const onExit = jest.fn();
    render(<ActionGameScreen sequenceId="no-such-sequence" onExit={onExit} />);
    fireEvent.press(screen.getByTestId('action-back'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
