import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render } from '@testing-library/react-native';
import type { RoundEngine } from '../../engine';
import type { Listener } from '../../speech/types';
import { FakeSpeaker } from '../../speech/fakes';
import type { JudgeClient, Verdict } from '../../judge/types';
import {
  DEFAULT_SETTINGS,
  loadHistory,
  loadN,
  saveSettings,
} from '../../store/storage';
import { GameScreen } from '../GameScreen';

jest.mock('expo-speech-recognition', () => ({
  useSpeechRecognitionEvent: jest.fn(),
  ExpoSpeechRecognitionModule: {
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    start: jest.fn(),
    stop: jest.fn(),
  },
}));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));

/** Always returns the same transcript, so every step produces an answer. */
class CannedListener implements Listener {
  sessions = 0;
  stopped = 0;
  constructor(private readonly canned: string) {}
  start(): void {
    this.sessions++;
  }
  stop(): string {
    this.stopped++;
    return this.canned;
  }
  push(): void {}
}

function makeDeps(judge: JudgeClient) {
  const speaker = new FakeSpeaker();
  const listener = new CannedListener('ぶぶぶ');
  return {
    deps: {
      speaker,
      listener,
      judgeClient: judge,
      requestPermissions: async () => true,
    },
    speaker,
    listener,
  };
}

const alwaysCorrect: JudgeClient = {
  judge: async (): Promise<Verdict> => ({ correct: true, matched: null }),
};

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

/** Run long enough for all 9 + N steps at the default 5s pacing. */
async function runWholeRound() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(120_000);
  });
}

describe('GameScreen', () => {
  it('speaks 9 questions and finishes the round', async () => {
    const onFinished = jest.fn();
    const { deps, speaker } = makeDeps(alwaysCorrect);
    render(<GameScreen onFinished={onFinished} deps={deps} />);
    await runWholeRound();

    expect(speaker.spoken).toHaveLength(9);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('opens the mic once per step, including the trailing recall steps', async () => {
    const { deps, listener } = makeDeps(alwaysCorrect);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await runWholeRound();

    expect(listener.sessions).toBe(11); // 9 stimuli + N=2 trailing
  });

  it('grades every answer through the judge and reports a full answer score', async () => {
    const onFinished = jest.fn();
    const { deps } = makeDeps(alwaysCorrect);
    render(<GameScreen onFinished={onFinished} deps={deps} />);
    await runWholeRound();

    const engine: RoundEngine = onFinished.mock.calls[0][0];
    expect(engine.answerScore).toBe(1);
    expect(engine.unresolvedCount).toBe(0);
  });

  it('leaves answers 未判定 when the judge is unreachable', async () => {
    const offline: JudgeClient = {
      judge: async () => {
        throw new Error('network down');
      },
    };
    const onFinished = jest.fn();
    const { deps } = makeDeps(offline);
    render(<GameScreen onFinished={onFinished} deps={deps} />);
    await runWholeRound();

    const engine: RoundEngine = onFinished.mock.calls[0][0];
    expect(engine.answerScore).toBeNull();
    expect(engine.unresolvedCount).toBe(9);
  });

  it('writes a history record for the round', async () => {
    const { deps } = makeDeps(alwaysCorrect);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await runWholeRound();

    const history = await loadHistory();
    expect(history).toHaveLength(1);
    expect(history[0].n).toBe(2);
  });

  it('lowers N after a round with no taps', async () => {
    const { deps } = makeDeps(alwaysCorrect);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await runWholeRound();

    // Position 0/9, answers 9/9 → round score 0.5 → N drops to 1.
    expect(await loadN()).toBe(1);
  });

  it('stops with a message when permission is refused', async () => {
    const { deps } = makeDeps(alwaysCorrect);
    const { findByText } = render(
      <GameScreen
        onFinished={jest.fn()}
        deps={{ ...deps, requestPermissions: async () => false }}
      />,
    );
    expect(await findByText(/マイクの許可/)).toBeTruthy();
  });

  it('stops the listener on unmount mid-round', async () => {
    const { deps, listener } = makeDeps(alwaysCorrect);
    const { unmount } = render(<GameScreen onFinished={jest.fn()} deps={deps} />);

    // Land inside phase B of the first step (A=2000ms, B=3000ms at the
    // default 5000ms pacing) — the mic is open and has not yet been
    // stopped by the step's own tick().
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3000);
    });
    expect(listener.sessions).toBe(1);
    expect(listener.stopped).toBe(0);

    unmount();

    expect(listener.stopped).toBe(1);
  });

  it('shows an error message when the round cannot be set up', async () => {
    // maxTier: 0 filters out every question in the bank (tiers are 1 and 2),
    // so buildRound() throws for want of 9 questions — a genuine setup
    // failure, not a contrived one.
    await saveSettings({ ...DEFAULT_SETTINGS, maxTier: 0 });
    const { deps } = makeDeps(alwaysCorrect);
    const { findByText } = render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    expect(await findByText(/準備に失敗しました/)).toBeTruthy();
  });
});
