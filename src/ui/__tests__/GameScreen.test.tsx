import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render } from '@testing-library/react-native';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import type { RoundEngine } from '../../engine';
import type { Listener, Speaker } from '../../speech/types';
import { FakeListener, FakeSpeaker, SlowFakeSpeaker } from '../../speech/fakes';
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
  AVAudioSessionCategory: { playAndRecord: 'playAndRecord' },
  AVAudioSessionCategoryOptions: {
    defaultToSpeaker: 'defaultToSpeaker',
    allowBluetooth: 'allowBluetooth',
  },
  AVAudioSessionMode: { default: 'default' },
  ExpoSpeechRecognitionModule: {
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    supportsOnDeviceRecognition: jest.fn(() => false),
    getSupportedLocales: jest.fn(async () => ({
      locales: [],
      installedLocales: [],
    })),
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

function makeDeps<S extends Speaker, L extends Listener>(
  judge: JudgeClient,
  speaker: S,
  listener: L,
) {
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

/** The common case: an instant speaker and a listener that always "hears". */
function makeDefaultDeps(judge: JudgeClient) {
  return makeDeps(judge, new FakeSpeaker(), new CannedListener('ぶぶぶ'));
}

/**
 * The handler GameScreen registered for the recognizer's `result` event. The
 * module is mocked, so this is the only way to drive the real capture chain.
 */
function capturedResultHandler(): (event: {
  results: Array<{ transcript: string }>;
}) => void {
  const mocked = useSpeechRecognitionEvent as unknown as jest.Mock;
  const call = mocked.mock.calls.find(([name]) => name === 'result');
  if (!call) throw new Error('GameScreen never subscribed to the result event');
  return call[1];
}

const alwaysCorrect: JudgeClient = {
  judge: async (): Promise<Verdict> => ({ correct: true, matched: null }),
};

beforeEach(async () => {
  await AsyncStorage.clear();
  (useSpeechRecognitionEvent as unknown as jest.Mock).mockClear();
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
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen onFinished={onFinished} deps={deps} />);
    await runWholeRound();

    expect(speaker.spoken).toHaveLength(9);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('opens the mic once per step, including the trailing recall steps', async () => {
    const { deps, listener } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await runWholeRound();

    expect(listener.sessions).toBe(11); // 9 stimuli + N=2 trailing
  });

  it('grades every answer through the judge and reports a full answer score', async () => {
    const onFinished = jest.fn();
    const { deps } = makeDefaultDeps(alwaysCorrect);
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
    const { deps } = makeDefaultDeps(offline);
    render(<GameScreen onFinished={onFinished} deps={deps} />);
    await runWholeRound();

    const engine: RoundEngine = onFinished.mock.calls[0][0];
    expect(engine.answerScore).toBeNull();
    expect(engine.unresolvedCount).toBe(9);
  });

  it('writes a history record for the round', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await runWholeRound();

    const history = await loadHistory();
    expect(history).toHaveLength(1);
    expect(history[0].n).toBe(2);
  });

  it('lowers N after a round with no taps', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await runWholeRound();

    // Position 0/9, answers 9/9 → round score 0.5 → N drops to 1.
    expect(await loadN()).toBe(1);
  });

  it('stops with a message when permission is refused', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { findByText } = render(
      <GameScreen
        onFinished={jest.fn()}
        deps={{ ...deps, requestPermissions: async () => false }}
      />,
    );
    expect(await findByText(/マイクの許可/)).toBeTruthy();
  });

  it('stops the listener on unmount mid-round', async () => {
    const { deps, listener } = makeDefaultDeps(alwaysCorrect);
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
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await saveSettings({ ...DEFAULT_SETTINGS, maxTier: 0 });
      const { deps } = makeDefaultDeps(alwaysCorrect);
      const { findByText } = render(
        <GameScreen onFinished={jest.fn()} deps={deps} />,
      );
      expect(await findByText(/準備に失敗しました/)).toBeTruthy();
      // The label alone is the owner's only on-device diagnostic otherwise.
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });
});

describe('GameScreen paints during the utterance, not after it', () => {
  it('shows the new step while its question is still being spoken', async () => {
    // The real ExpoSpeaker resolves speak() on the synthesizer's onDone, 2-4s
    // into a Japanese sentence. Nothing on screen may wait for that: spec §4.1
    // puts the flash and the question in the same phase.
    const speaker = new SlowFakeSpeaker();
    const { deps } = makeDeps(alwaysCorrect, speaker, new CannedListener('ぶぶぶ'));
    const { queryByText } = render(
      <GameScreen onFinished={jest.fn()} deps={deps} />,
    );

    // Step 0 phase A, with the first utterance still in flight.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(speaker.pending).toBe(1);
    expect(queryByText(/準備中/)).toBeNull();
    expect(queryByText('1 / 11　2-back　出題中')).toBeTruthy();

    // Cross into step 1 phase A. Still nothing has finished speaking.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_000);
    });
    expect(speaker.pending).toBe(2);
    expect(queryByText('2 / 11　2-back　出題中')).toBeTruthy();
  });

  it('flashes a block and enables the grid while the question is still being spoken', async () => {
    const speaker = new SlowFakeSpeaker();
    const { deps } = makeDeps(alwaysCorrect, speaker, new CannedListener('ぶぶぶ'));
    const { getByTestId } = render(
      <GameScreen onFinished={jest.fn()} deps={deps} />,
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(speaker.pending).toBe(1);
    const cells = Array.from({ length: 9 }, (_, i) => getByTestId(`cell-${i}`));
    expect(
      cells.filter((cell) => cell.props.accessibilityState.selected),
    ).toHaveLength(1);
    // The grid must be tappable from the first frame, not after the utterance.
    expect(cells[0].props.accessibilityState.disabled).toBe(false);
  });
});

describe('GameScreen transcript capture', () => {
  it('routes a recognizer result event through the listener into the judge', async () => {
    const heard: string[] = [];
    const recording: JudgeClient = {
      judge: async (_q, transcript): Promise<Verdict> => {
        heard.push(transcript);
        return { correct: true, matched: null };
      },
    };
    // A real listener, so push()/stop() do their actual work.
    const { deps } = makeDeps(recording, new FakeSpeaker(), new FakeListener());
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);

    // Step 2 is the first scored step at N=2. With a=2000/b=3000 its answer
    // window runs from t=12000 to t=15000.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(12_500);
    });

    const onResult = capturedResultHandler();
    await act(async () => {
      onResult({ results: [{ transcript: 'てすとおんせい' }] });
    });

    await runWholeRound();

    // Only step 2 produced speech, so exactly one answer reached the judge.
    expect(heard).toEqual(['てすとおんせい']);
  });
});
