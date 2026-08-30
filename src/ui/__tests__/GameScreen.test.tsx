import AsyncStorage from '@react-native-async-storage/async-storage';
import { StyleSheet } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import type { RoundEngine } from '../../engine';
import { speakTimeoutMs } from '../../engine/runner';
import type { Listener, Speaker } from '../../speech/types';
import {
  FakeListener,
  FakeSpeaker,
  LateFinalListener,
  SlowFakeSpeaker,
} from '../../speech/fakes';
import type { JudgeClient, Verdict } from '../../judge/types';
import {
  addCustom,
  appendHistory,
  DEFAULT_SETTINGS,
  loadHistory,
  loadN,
  localDate,
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
  settle(): Promise<void> {
    return Promise.resolve();
  }
  stop(): string {
    this.stopped++;
    return this.canned;
  }
  push(): void {}
  sessionEnded(): void {}
}

/** A synthesizer that cannot be started at all. */
class BrokenSpeaker implements Speaker {
  speak(): Promise<void> {
    throw new Error('synthesizer unavailable');
  }
  unlock(): void {}
  stop(): void {}
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
  // Every pre-existing test here describes voice behaviour (CannedListener,
  // FakeListener, taps and timers alone advancing the round). DEFAULT_SETTINGS
  // defaults to typed, so voice has to be opted into explicitly, exactly as
  // real settings would require — the 'GameScreen typed mode' describe below
  // opts back into typed for its own tests.
  await saveSettings({ ...DEFAULT_SETTINGS, answerInput: 'voice' });
});

afterEach(() => {
  jest.useRealTimers();
});


/**
 * Clears the warm-up gate. The round no longer starts on its own: iOS only
 * lets a page speak once an utterance has come out of a gesture, so the tap
 * is load-bearing rather than decorative.
 */
async function beginRound() {
  await screen.findByTestId('warmup-start');
  await act(async () => {
    fireEvent.press(screen.getByTestId('warmup-start'));
  });
}

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
    render(<GameScreen seriesId="capital-call" onFinished={onFinished} deps={deps} />);
    await beginRound();
    await runWholeRound();

    expect(speaker.spoken).toHaveLength(9);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  /**
   * Voice mode must render exactly as it did before typed mode existed: no
   * flex wrapper around the grid, no explicit size prop, so Grid falls back
   * to its own 300px default (96px cells) regardless of onLayout.
   */
  it('renders the grid at its original size, unaffected by the typed layout', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { getByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    expect(styleOf(getByTestId('cell-0'))?.width).toBe(96);
  });

  it('opens the mic once per step, including the trailing recall steps', async () => {
    const { deps, listener } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await runWholeRound();

    expect(listener.sessions).toBe(10); // 9 stimuli + N=1 trailing
  });

  it('grades every answer through the judge and reports a full answer score', async () => {
    const onFinished = jest.fn();
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={onFinished} deps={deps} />);
    await beginRound();
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
    render(<GameScreen seriesId="capital-call" onFinished={onFinished} deps={deps} />);
    await beginRound();
    await runWholeRound();

    const engine: RoundEngine = onFinished.mock.calls[0][0];
    expect(engine.answerScore).toBeNull();
    expect(engine.unresolvedCount).toBe(9);
  });

  it('reaches the results screen even if a grading call never returns', async () => {
    // A stalled connection must not hold the results screen: answers still in
    // flight are already handled as 未判定.
    const stalled: JudgeClient = {
      judge: () => new Promise<Verdict>(() => {}),
    };
    const onFinished = jest.fn();
    const { deps } = makeDefaultDeps(stalled);
    render(<GameScreen seriesId="capital-call" onFinished={onFinished} deps={deps} />);
    await beginRound();
    await runWholeRound();

    expect(onFinished).toHaveBeenCalledTimes(1);
    const engine: RoundEngine = onFinished.mock.calls[0][0];
    expect(engine.answerScore).toBeNull();
    expect(engine.unresolvedCount).toBe(9);
  });

  it('writes a history record for the round', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await runWholeRound();

    const history = await loadHistory();
    expect(history).toHaveLength(1);
    expect(history[0].n).toBe(1);
  });

  it('lowers N after a round with no taps', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await runWholeRound();

    // Position 0/9, answers 9/9 → round score 0.5 → N would drop, but 1 is
    // the floor: there is no shorter lag than the question just asked.
    expect(await loadN('capital-call')).toBe(1);
  });

  it('stops with a message when permission is refused', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { findByText } = render(
      <GameScreen
        seriesId="capital-call"
        onFinished={jest.fn()}
        deps={{ ...deps, requestPermissions: async () => false }}
      />,
    );
    expect(await findByText(/マイクの許可/)).toBeTruthy();
  });

  it('stops the listener on unmount mid-round', async () => {
    const { deps, listener } = makeDefaultDeps(alwaysCorrect);
    const { unmount } = render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();

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

  it('shows 問題が足りません when the chosen series has no questions', async () => {
    // The custom series starts empty until the owner adds a question. An
    // empty pool is a handled state, not a crash: the owner is told what is
    // wrong rather than being sent to the generic failure message.
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { findByText } = render(
      <GameScreen seriesId="custom" onFinished={jest.fn()} deps={deps} />,
    );
    expect(await findByText(/問題が足りません/)).toBeTruthy();
  });

  it('shows an error message when the round cannot be set up', async () => {
    // A synthesizer that cannot start is a genuine setup failure: the round
    // never begins, so the owner must be told rather than left on 準備中….
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { deps } = makeDeps(
        alwaysCorrect,
        new BrokenSpeaker(),
        new CannedListener('ぶぶぶ'),
      );
      const { findByText } = render(
        <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
      );
      await beginRound();
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
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();

    // Step 0 phase A, with the first utterance still in flight.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(speaker.pending).toBe(1);
    expect(queryByText(/準備中/)).toBeNull();
    expect(queryByText('1 / 10　1-back　出題中')).toBeTruthy();

    // Let step 0's question finish and cross into step 1, whose question is
    // then in flight. The new step is painted at the transition, not when its
    // speech ends.
    await act(async () => {
      speaker.resolveSpeak();
      await jest.advanceTimersByTimeAsync(5_000);
    });
    expect(speaker.pending).toBe(1);
    expect(queryByText('2 / 10　1-back　出題中')).toBeTruthy();
  });

  it('flashes a block and enables the grid while the question is still being spoken', async () => {
    const speaker = new SlowFakeSpeaker();
    const { deps } = makeDeps(alwaysCorrect, speaker, new CannedListener('ぶぶぶ'));
    const { getByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();

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

describe('GameScreen phase A pacing', () => {
  it('keeps the mic shut past the configured phase A until the question ends', async () => {
    // Bank median is 9 chars; at ja-JP default TTS rate that is ~2.2-2.6s,
    // longer than the 2000ms phase A at the 5s default. The question is
    // spoken once and answered N steps later, so clipping it would silently
    // make that item unanswerable.
    const speaker = new SlowFakeSpeaker();
    const listener = new CannedListener('ぶぶぶ');
    const { deps } = makeDeps(alwaysCorrect, speaker, listener);
    const { queryByText } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();

    // Well past the 2000ms phase A, with the question still being spoken.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4_000);
    });
    expect(listener.sessions).toBe(0); // mic never opened
    expect(speaker.stopped).toBe(0); // the question was not cut off
    expect(queryByText('1 / 10　1-back　出題中')).toBeTruthy();

    // The synthesizer finishes: the mic opens now, not before.
    await act(async () => {
      speaker.resolveSpeak();
    });
    expect(listener.sessions).toBe(1);
    expect(queryByText('1 / 10　1-back　どうぞ')).toBeTruthy();
  });

  it('does not let a fast question shorten the step', async () => {
    // Phase A is a floor as well as a target: a 1-char answer bank must not
    // turn the round into a rush.
    const speaker = new SlowFakeSpeaker();
    const listener = new CannedListener('ぶぶぶ');
    const { deps } = makeDeps(alwaysCorrect, speaker, listener);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
      speaker.resolveSpeak(); // question over almost immediately
      await jest.advanceTimersByTimeAsync(1_900); // t = 1910ms
    });
    expect(listener.sessions).toBe(0); // still inside the configured phase A

    await act(async () => {
      await jest.advanceTimersByTimeAsync(200); // t = 2110ms
    });
    expect(listener.sessions).toBe(1);
  });

  it('opens the mic anyway when the synthesizer never calls back', async () => {
    const speaker = new SlowFakeSpeaker();
    const listener = new CannedListener('ぶぶぶ');
    const { deps } = makeDeps(alwaysCorrect, speaker, listener);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();

    // The watchdog scales with the question's own length (see
    // speakTimeoutMs), so its exact bound depends on which question this
    // round happened to draw.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    const timeout = speakTimeoutMs(speaker.spoken[0]);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(timeout - 1);
    });
    expect(listener.sessions).toBe(0);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2);
    });
    expect(listener.sessions).toBe(1);
    expect(speaker.stopped).toBe(1);
  });
});

describe('GameScreen question-only mode', () => {
  it('renders no grid', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'question', answerInput: 'voice' });
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { queryByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await runWholeRound();
    expect(queryByTestId('cell-0')).toBeNull();
  });

  it('still speaks 9 questions and finishes', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'question', answerInput: 'voice' });
    const onFinished = jest.fn();
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={onFinished} deps={deps} />);
    await beginRound();
    await runWholeRound();
    expect(speaker.spoken).toHaveLength(9);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('scores on the answer channel alone and adapts N', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'question', answerInput: 'voice' });
    const onFinished = jest.fn();
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={onFinished} deps={deps} />);
    await beginRound();
    await runWholeRound();
    const engine: RoundEngine = onFinished.mock.calls[0][0];
    expect(engine.positionScore).toBeNull();
    expect(engine.answerScore).toBe(1);
    // Answer channel alone is 1.0, so N rises even with no taps.
    expect(await loadN('capital-call')).toBe(2);
  });

  it('holds N when the judge is unreachable in question mode', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'question', answerInput: 'voice' });
    const offline: JudgeClient = {
      judge: async () => {
        throw new Error('network down');
      },
    };
    const { deps } = makeDefaultDeps(offline);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await runWholeRound();
    // Both channels absent: nothing to adapt on, so N must not move.
    expect(await loadN('capital-call')).toBe(1);
  });
});

describe('GameScreen series', () => {
  it('draws only from the chosen series', async () => {
    for (let i = 0; i < 9; i++) await addCustom(`自作${i}`, `答え${i}`);
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="custom" onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await runWholeRound();
    expect(speaker.spoken).toHaveLength(9);
    for (const spoken of speaker.spoken) {
      expect(spoken).toMatch(/^自作\d$/);
    }
  });

  it('draws from an authored series without any settings change', async () => {
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await runWholeRound();
    expect(speaker.spoken).toHaveLength(9);
    for (const spoken of speaker.spoken) {
      expect(spoken).toMatch(/？$/);
    }
  });

  it('repeats the sole question to fill a round when the series has just one', async () => {
    await addCustom('一問だけ', 'あ');
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="custom" onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await runWholeRound();
    expect(speaker.spoken).toHaveLength(9);
    for (const spoken of speaker.spoken) {
      expect(spoken).toBe('一問だけ');
    }
  });

  it('falls back to the custom series for an unknown id', async () => {
    await addCustom('一問だけ', 'あ');
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    render(
      <GameScreen seriesId="deleted-series" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await runWholeRound();
    expect(speaker.spoken).toHaveLength(9);
  });

  it('names the series on the warm-up screen before the mic opens', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    expect(await screen.findByTestId('warmup-series')).toHaveTextContent(
      'コミットメントとキャピタルコール ／ 14問',
    );
  });

  it('saves the raised lag under the series that earned it', async () => {
    // question mode, like the other adaptive-N cases: the answer channel
    // alone scores 1.0, so N rises without the round needing grid taps.
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'question', answerInput: 'voice' });
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await runWholeRound();
    expect(await loadN('capital-call')).toBe(2);
    // The standard series must not inherit a lag earned elsewhere.
    expect(await loadN('standard')).toBe(1);
  });

  it('stamps the series onto the history record', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await runWholeRound();
    expect((await loadHistory())[0].seriesId).toBe('capital-call');
  });
});

describe('GameScreen daily round limit', () => {
  it('blocks a free-tier player after three rounds today', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, subscriptionTier: 'free' });
    const today = localDate();
    for (let i = 0; i < 3; i++) {
      await appendHistory({
        date: today,
        n: 1,
        positionScore: 1,
        answerScore: 1,
        unresolved: 0,
      });
    }
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    expect(await screen.findByText(/上限|limit/)).toBeTruthy();
  });

  it('does not block a pro-tier player regardless of rounds played today', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, subscriptionTier: 'pro' });
    const today = localDate();
    for (let i = 0; i < 5; i++) {
      await appendHistory({
        date: today,
        n: 1,
        positionScore: 1,
        answerScore: 1,
        unresolved: 0,
      });
    }
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    expect(await screen.findByTestId('warmup-series')).toBeTruthy();
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
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();

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

describe('GameScreen live transcript', () => {
  it('shows what the recognizer is hearing while the mic is open', async () => {
    const { deps } = makeDeps(alwaysCorrect, new FakeSpeaker(), new FakeListener());
    const { getByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    // Step 0 phase B (a=2000, b=3000 at the 5s default).
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_500);
    });

    const onResult = capturedResultHandler();
    await act(async () => {
      onResult({ results: [{ transcript: 'ねこ' }] });
    });

    expect(getByTestId('live-transcript').props.children).toContain('ねこ');
  });

  it('keeps the answer on screen through the next question', async () => {
    // The verdict lands about a second after the step closes, so the answer
    // has to still be there to be coloured.
    const { deps } = makeDeps(alwaysCorrect, new FakeSpeaker(), new FakeListener());
    const { queryByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_500);
    });
    const onResult = capturedResultHandler();
    await act(async () => {
      onResult({ results: [{ transcript: 'ねこ' }] });
    });

    // Into step 1's phase A, while the next question is being asked.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });
    expect(queryByTestId('live-transcript')).not.toBeNull();
  });

  it('clears the answer when the mic opens for the next step', async () => {
    const { deps } = makeDeps(alwaysCorrect, new FakeSpeaker(), new FakeListener());
    const { queryByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_500);
    });
    const onResult = capturedResultHandler();
    await act(async () => {
      onResult({ results: [{ transcript: 'ねこ' }] });
    });

    // Step 1's phase B: it is the owner's turn again, so the slate is clean.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_000);
    });
    expect(queryByTestId('live-transcript')).toBeNull();
  });

  it('keeps the live text neutral — the verdict is not known yet', async () => {
    const { deps } = makeDeps(alwaysCorrect, new FakeSpeaker(), new FakeListener());
    const { getByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_500);
    });
    const onResult = capturedResultHandler();
    await act(async () => {
      onResult({ results: [{ transcript: 'ねこ' }] });
    });

    const style = StyleSheet.flatten(
      getByTestId('live-transcript').props.style as StyleProp<TextStyle>,
    );
    expect(style?.color).toBe('#8e8e93');
  });
});

/** The handler GameScreen registered for a given recognizer event. */
function capturedHandler(name: string): (payload?: unknown) => void {
  const mocked = useSpeechRecognitionEvent as unknown as jest.Mock;
  const call = mocked.mock.calls.find(([event]) => event === name);
  if (!call) throw new Error(`GameScreen never subscribed to ${name}`);
  return call[1];
}

describe('GameScreen late final results', () => {
  it('grades the answer the recognizer only delivers after the mic is asked to close', async () => {
    // The reported bug: the transcript showed on screen but the step was
    // recorded as 聞き取れず, because the final result lands after stop().
    const heard: string[] = [];
    const recording: JudgeClient = {
      judge: async (_q, transcript): Promise<Verdict> => {
        heard.push(transcript);
        return { correct: true, matched: null };
      },
    };
    const { deps } = makeDeps(
      recording,
      new FakeSpeaker(),
      // A transcript no question in the bank accepts: a local synonym match
      // would resolve the answer without ever calling the judge.
      new LateFinalListener('てすとおんせい'),
    );
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await runWholeRound();

    expect(heard).toHaveLength(9);
    expect(new Set(heard)).toEqual(new Set(['てすとおんせい']));
  });

  it('forwards the recognizer session end so a silent step cannot stall the round', async () => {
    const listener = new LateFinalListener(null); // never delivers by itself
    const { deps } = makeDeps(alwaysCorrect, new FakeSpeaker(), listener);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(6_000);
    });
    // Phase B of step 0 is over by the clock, but the recognizer has not
    // spoken, so the round is waiting on it.
    expect(listener.settles).toBe(1);
    expect(listener.sessions).toBe(1);

    await act(async () => {
      capturedHandler('end')();
      await jest.advanceTimersByTimeAsync(6_000);
    });
    expect(listener.sessions).toBe(2);
  });

  it('marks a result final so the wait ends with the last word, not the bound', async () => {
    const listener = new LateFinalListener(null);
    const { deps } = makeDeps(alwaysCorrect, new FakeSpeaker(), listener);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_500);
    });
    const onResult = capturedHandler('result') as (event: {
      results: Array<{ transcript: string }>;
      isFinal?: boolean;
    }) => void;
    await act(async () => {
      onResult({ results: [{ transcript: 'わんわん' }], isFinal: true });
      await jest.advanceTimersByTimeAsync(6_000);
    });

    // The final push released the settle wait: the round moved on.
    expect(listener.sessions).toBe(2);
  });
});

const CORRECT_COLOR = '#4caf7d';
const WRONG_COLOR = '#e5534b';
const NEUTRAL_COLOR = '#8e8e93';

function styleOf(node: {
  props: { style?: StyleProp<TextStyle | ViewStyle> };
}): (TextStyle & ViewStyle) | undefined {
  return StyleSheet.flatten(node.props.style) as
    | (TextStyle & ViewStyle)
    | undefined;
}

/** The cell flashing right now — step 0's stimulus, recalled at step 2. */
function flashedCell(getByTestId: (id: string) => { props: never }): number {
  for (let i = 0; i < 9; i++) {
    const cell = getByTestId(`cell-${i}`) as unknown as {
      props: { accessibilityState: { selected: boolean } };
    };
    if (cell.props.accessibilityState.selected) return i;
  }
  throw new Error('no cell is flashing');
}

describe('GameScreen live tap colour', () => {
  it('rings the tapped square green when it matches the step N back', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { getByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    const target = flashedCell(getByTestId as never);

    // Step 1 phase B recalls step 0 at N=1.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(7_500);
    });
    await act(async () => {
      fireEvent.press(getByTestId(`cell-${target}`));
    });

    expect(styleOf(getByTestId(`cell-${target}`))?.borderColor).toBe(
      CORRECT_COLOR,
    );
  });

  it('rings it red when it does not', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { getByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    const wrong = (flashedCell(getByTestId as never) + 1) % 9;

    await act(async () => {
      await jest.advanceTimersByTimeAsync(7_500);
    });
    await act(async () => {
      fireEvent.press(getByTestId(`cell-${wrong}`));
    });

    expect(styleOf(getByTestId(`cell-${wrong}`))?.borderColor).toBe(WRONG_COLOR);
  });

  it('drops the colour when the next step starts', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { getByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    const target = flashedCell(getByTestId as never);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(7_500);
    });
    await act(async () => {
      fireEvent.press(getByTestId(`cell-${target}`));
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5_000);
    });

    expect(styleOf(getByTestId(`cell-${target}`))?.borderColor).toBeUndefined();
  });
});

describe('GameScreen live answer colour', () => {
  it('is neutral while the verdict is still out', async () => {
    const { deps } = makeDeps(alwaysCorrect, new FakeSpeaker(), new FakeListener());
    const { getByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_500);
    });
    await act(async () => {
      capturedResultHandler()({ results: [{ transcript: 'ねこ' }] });
    });

    expect(styleOf(getByTestId('live-transcript'))?.color).toBe(NEUTRAL_COLOR);
  });

  it('turns green when the judge accepts the answer', async () => {
    const { deps } = makeDeps(alwaysCorrect, new FakeSpeaker(), new FakeListener());
    const { getByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    // Step 2 is the first scored step at N=2.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(12_500);
    });
    await act(async () => {
      capturedResultHandler()({ results: [{ transcript: 'ねこ' }] });
    });
    // The step closes at t=15000 and the verdict comes back during the next
    // question — the answer is still the one on screen.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });

    expect(styleOf(getByTestId('live-transcript'))?.color).toBe(CORRECT_COLOR);
  });

  it('turns red when the judge rejects it', async () => {
    const rejecting: JudgeClient = {
      judge: async (): Promise<Verdict> => ({ correct: false, matched: null }),
    };
    const { deps } = makeDeps(rejecting, new FakeSpeaker(), new FakeListener());
    const { getByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(12_500);
    });
    await act(async () => {
      capturedResultHandler()({ results: [{ transcript: 'ねこ' }] });
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3_000);
    });

    expect(styleOf(getByTestId('live-transcript'))?.color).toBe(WRONG_COLOR);
  });
});

describe('GameScreen recognizer failures', () => {
  it('shows the error the recognizer reports instead of swallowing it', async () => {
    // Without this the round looks alive but hears nothing, and the owner has
    // no way to tell a refused microphone from their own silence.
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { findByText } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_500);
    });

    await act(async () => {
      capturedHandler('error')({
        error: 'not-allowed',
        message: 'permission denied',
      });
    });

    expect(await findByText(/認識エラー/)).toBeTruthy();
    expect(await findByText(/not-allowed/)).toBeTruthy();
  });

  it('clears the error once the recognizer produces a result again', async () => {
    const { deps } = makeDeps(alwaysCorrect, new FakeSpeaker(), new FakeListener());
    const { queryByText } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_500);
    });
    await act(async () => {
      capturedHandler('error')({ error: 'no-speech', message: '' });
    });
    await act(async () => {
      capturedResultHandler()({ results: [{ transcript: 'ねこ' }] });
    });

    expect(queryByText(/認識エラー/)).toBeNull();
  });

  it('does not treat a bare no-speech as a failure worth reporting', async () => {
    // Saying nothing on one step is ordinary; it is 聞き取れず, not an error.
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { queryByText } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_500);
    });
    await act(async () => {
      capturedHandler('error')({ error: 'no-speech', message: '' });
    });

    expect(queryByText(/認識エラー/)).toBeNull();
  });
});

describe('GameScreen warm-up gate', () => {
  it('says nothing until the owner has tapped', async () => {
    // iOS drops utterances that did not come from a gesture, so a round that
    // starts on its own is silent for its first questions.
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });

    expect(speaker.spoken).toHaveLength(0);
  });

  it('shows an arithmetic item to tap while the round loads', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { findByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );

    expect(await findByTestId('warmup-n-select')).toBeTruthy();
    expect(await findByTestId('warmup-start')).toBeTruthy();
  });

  it('unlocks the synthesizer inside the tap', async () => {
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    const { findByTestId, getByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await findByTestId('warmup-start');

    await act(async () => {
      fireEvent.press(getByTestId('warmup-start'));
    });

    expect(speaker.unlocked).toBe(1);
  });

  it('runs the whole round once tapped', async () => {
    const onFinished = jest.fn();
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    const { findByTestId, getByTestId } = render(
      <GameScreen seriesId="capital-call" onFinished={onFinished} deps={deps} />,
    );
    await findByTestId('warmup-start');
    await act(async () => {
      fireEvent.press(getByTestId('warmup-start'));
    });
    await runWholeRound();

    expect(speaker.spoken).toHaveLength(9);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('starts the round at the N chosen in the dropdown', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { findByTestId, getByTestId, findAllByText } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await findByTestId('warmup-start');
    await act(async () => {
      fireEvent.press(getByTestId('warmup-n-choice-3'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('warmup-start'));
    });

    expect((await findAllByText(/3-back/)).length).toBeGreaterThan(0);
  });

  it('shows which lag this round is, before it starts', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { findByText } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    expect(await findByText(/1-back/)).toBeTruthy();
    expect(await findByText(/1つ前の質問/)).toBeTruthy();
  });

  it('keeps the lag on screen during the round', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { findByTestId, getByTestId, findByText } = render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />,
    );
    await findByTestId('warmup-start');
    await act(async () => {
      fireEvent.press(getByTestId('warmup-start'));
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_500);
    });

    expect(await findByText(/1つ前の質問/)).toBeTruthy();
  });
});

describe('GameScreen typed mode', () => {
  beforeEach(async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, answerInput: 'typed' });
  });

  it('shows a field and never opens the mic', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const listener = new FakeListener();
    render(
      <GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={{ ...deps, listener }} />,
    );
    await beginRound();
    expect(screen.getByTestId('typed-answer-input')).toBeTruthy();
    expect(listener.sessions).toBe(0);
  });

  /**
   * The clock is a target, not a deadline. With nothing submitted, no amount
   * of elapsed time may carry the round forward — this is the whole of
   * "submit-driven", asserted at the only place it can be observed.
   */
  it('never finishes on its own, however long it waits', async () => {
    const onFinished = jest.fn();
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={onFinished} deps={deps} />);
    await beginRound();
    await runWholeRound();
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('finishes once every answer is submitted', async () => {
    const onFinished = jest.fn();
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={onFinished} deps={deps} />);
    await beginRound();

    // 9 scored steps plus the observe-only ones; each pass advances phase A
    // on its timer, then submits if an answer is being asked for.
    for (let i = 0; i < 24; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(3000);
      });
      const submit = screen.queryByTestId('typed-submit');
      if (!submit) continue;
      await act(async () => {
        fireEvent.changeText(screen.getByTestId('typed-answer-input'), 'こたえ');
        fireEvent.press(submit);
      });
    }

    await act(async () => {
      await jest.advanceTimersByTimeAsync(20_000);
    });
    expect(onFinished).toHaveBeenCalled();
  });

  /** Nothing is owed on the first N steps, so nothing should be asked for. */
  it('does not ask for an answer on steps with nothing to recall', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    expect(screen.getByTestId('typed-answer-input').props.editable).toBe(false);

    // A merged step opens its window at once — but nothing is owed on step 0,
    // so the field must stay closed for the whole of it and no countdown
    // appears.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByTestId('typed-answer-input').props.editable).toBe(false);
    expect(screen.queryByTestId('answer-clock')).toBeNull();

    // Nothing is ever submitted on this step. If it only advanced on
    // submission it would hang here forever; it must self-close on its
    // normal timer instead — a merged step's own length, A + B.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByText('2 / 10　1-back　どうぞ')).toBeTruthy();
  });

  /**
   * Pins the central mechanic against regression. readyToClose() gates
   * advance() on settle() regardless of how advance() was invoked, so a
   * reinstated `setTimeout(advance, b)` on this branch would leave every
   * other test in this file green — the only place the timer's absence is
   * observable is a submit that moves the round with zero timer advance.
   */
  it('advances an answer window on submit with no timer advance', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();

    // Step 0 (observe-only) self-closes after its own 5000; step 1 is the
    // first real answer window, and 7000 lands inside it, still open.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(7000);
    });
    expect(screen.queryByText('2 / 10　1-back　どうぞ')).toBeTruthy();
    expect(screen.getByTestId('typed-answer-input').props.editable).toBe(true);

    // No timer advance at all here — only the submit may move the round.
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('typed-answer-input'), 'こたえ');
      fireEvent.press(screen.getByTestId('typed-submit'));
    });

    expect(screen.queryByText('3 / 10　1-back　どうぞ')).toBeTruthy();
  });

  it('leaves voice mode exactly as it was', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, answerInput: 'voice' });
    const onFinished = jest.fn();
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const listener = new CannedListener('こたえ');
    render(
      <GameScreen seriesId="capital-call" onFinished={onFinished} deps={{ ...deps, listener }} />,
    );
    await beginRound();
    await runWholeRound();
    expect(screen.queryByTestId('typed-answer-input')).toBeNull();
    expect(listener.sessions).toBeGreaterThan(0);
    expect(onFinished).toHaveBeenCalled();
  });
});

describe('GameScreen typed answer feedback', () => {
  beforeEach(async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, answerInput: 'typed' });
  });

  /**
   * The typed listener used to be held in a ref, which reconciliation cannot
   * see: the first paint of a typed round showed voice mode's fixed 300 grid
   * and only swapped once some later setState happened to run.
   */
  it('paints neither layout until the settings say which one', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);

    expect(screen.queryByTestId('cell-0')).toBeNull();

    await beginRound();
    expect(screen.getByTestId('cell-0')).toBeTruthy();
  });

  /**
   * With the keyboard up there is only a few hundred points of height left,
   * and the grid is what has to fit inside it — a grid sized off the full
   * window renders its bottom row behind the keyboard, where it can be
   * neither seen nor tapped.
   */
  it('sizes the grid from the room the keyboard actually left', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();

    act(() => {
      screen.getByTestId('grid-box').props.onLayout({
        nativeEvent: { layout: { width: 390, height: 180 } },
      });
    });
    // 180 is the constraint, not 390: min(width, height) / 3, less the 2px
    // margin each cell carries on both sides.
    expect(
      StyleSheet.flatten(screen.getByTestId('cell-0').props.style)?.width,
    ).toBe(56);
  });

  /** A layout pass mid keyboard animation reports nothing; -4 is not a width. */
  it('never asks the grid for a negative cell', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();

    act(() => {
      screen.getByTestId('grid-box').props.onLayout({
        nativeEvent: { layout: { width: 390, height: 0 } },
      });
    });
    expect(
      StyleSheet.flatten(screen.getByTestId('cell-0').props.style)?.width,
    ).toBe(0);
  });

  /**
   * Voice mode shows every answer and marks it ○/× as the judge replies; the
   * recognizer's result event is what puts it there. Nothing fires that event
   * in typed mode, so the submit has to do it — otherwise the default mode
   * gives no feedback at all until the results screen.
   */
  it('shows the sent answer, and marks it once the judge has spoken', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();

    // Step 1 is the first window that owes an answer at N=1; step 0 is a
    // merged step of its own, so it takes A + B to go by.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('typed-answer-input'), 'こたえ');
      fireEvent.press(screen.getByTestId('typed-submit'));
    });

    // What was sent is on screen, tagged to the step that sent it.
    expect(screen.getByTestId('live-transcript')).toHaveTextContent(/こたえ/);

    // The verdict lands while it is still up, and marks it.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByTestId('live-transcript')).toHaveTextContent(/○/);
    expect(styleOf(screen.getByTestId('live-transcript'))?.color).toBe(
      CORRECT_COLOR,
    );
  });

  /**
   * TypedListener.stop() deliberately leaves the transcript in `text` for the
   * UI to read (see typed.ts) — only start() blanks it, and that does not
   * happen until the next answer window opens. Once the round is over no
   * window ever opens again, so the answer the player last sent is still
   * sitting in `typed.text` while 送る stays on screen through the grading
   * drain. A tap there must be inert: it must not repaint that answer under a
   * new index, which would knock out the ○/× the judge has already landed.
   */
  it('ignores a 送る tap once the answer window has closed', async () => {
    const onFinished = jest.fn();
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={onFinished} deps={deps} />);
    await beginRound();

    for (let i = 0; i < 24; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });
      await act(async () => {
        fireEvent.changeText(screen.getByTestId('typed-answer-input'), 'こたえ');
        fireEvent.press(screen.getByTestId('typed-submit'));
      });
    }
    await act(async () => {
      await jest.advanceTimersByTimeAsync(20_000);
    });
    expect(onFinished).toHaveBeenCalled();

    // The window is shut, and the by-now-cleared verdict does not reappear.
    expect(screen.getByTestId('typed-answer-input').props.editable).toBe(false);
    expect(screen.queryByTestId('live-transcript')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('typed-submit'));
    });
    expect(screen.queryByTestId('live-transcript')).toBeNull();
  });

  /**
   * The whole point of the merged step: the question being memorised and the
   * field it is answered in are on screen, live, at the same moment. Showing
   * one and then the other is what this replaced.
   */
  it('opens the field at the same moment as the question', async () => {
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();

    // Step 1 is the first step that owes an answer at N=1. Its window opens
    // with the step, so no timer advance beyond step 0's own length is needed.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByTestId('current-question')).toHaveTextContent(
      speaker.spoken[1],
    );
    expect(screen.getByTestId('typed-answer-input').props.editable).toBe(true);
    expect(screen.getByTestId('answer-clock')).toBeTruthy();
  });

  /**
   * The verdict for the answer just sent arrives after the step has closed.
   * With no phase A to hold it, briefly showing it into the following step
   * is what gives the default mode any ○/× feedback at all mid-round — see
   * VERDICT_DISPLAY_MS. It self-clears after that (below), rather than
   * staying up through the whole of the next question.
   */
  it('keeps the previous verdict on screen briefly into the next step', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('typed-answer-input'), 'こたえ');
      fireEvent.press(screen.getByTestId('typed-submit'));
    });

    // Step 2 is open and typable, and step 1's ○ is still readable beside it.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByTestId('typed-answer-input').props.editable).toBe(true);
    expect(screen.getByTestId('live-transcript')).toHaveTextContent(/○/);
  });

  /**
   * The bug this guards: a solved answer used to stay on screen through the
   * whole of the following question, which read as stuck rather than
   * helpful. A brief flash of the colour is enough — it clears on its own
   * shortly after the verdict lands, without waiting for the next mic-open.
   */
  it('clears the verdict on its own a short while after it lands', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('typed-answer-input'), 'こたえ');
      fireEvent.press(screen.getByTestId('typed-submit'));
    });
    expect(screen.getByTestId('live-transcript')).toHaveTextContent(/○/);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1500);
    });
    expect(screen.queryByTestId('live-transcript')).toBeNull();
  });

  /** Sending nothing is 聞き取れず, not the previous step's verdict again. */
  it('takes the previous verdict down when nothing is sent', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('typed-answer-input'), 'こたえ');
      fireEvent.press(screen.getByTestId('typed-submit'));
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByTestId('live-transcript')).toHaveTextContent(/○/);

    await act(async () => {
      fireEvent.press(screen.getByTestId('typed-submit'));
    });
    expect(screen.queryByTestId('live-transcript')).toBeNull();
  });

  it('shows the question being memorised, never the one being answered', async () => {
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('current-question')).toHaveTextContent(
      speaker.spoken[0],
    );

    // Step 1's answer window: what is owed is step 0's question, but what is
    // on screen is step 1's — showing the recalled one deletes the N-back.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(speaker.spoken[1]).not.toBe(speaker.spoken[0]);
    expect(screen.getByTestId('current-question')).toHaveTextContent(
      speaker.spoken[1],
    );
  });

  it('empties the question block on the trailing steps', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    expect(screen.getByTestId('current-question').props.children).not.toBe('');

    // Walk to the last step: at N=1 it asks nothing and only collects the
    // answer owed to step 9.
    for (let i = 0; i < 24; i++) {
      if (screen.queryByText('10 / 10　1-back　どうぞ')) break;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(3000);
      });
      await act(async () => {
        fireEvent.changeText(screen.getByTestId('typed-answer-input'), 'こたえ');
        fireEvent.press(screen.getByTestId('typed-submit'));
      });
    }

    expect(screen.queryByText('10 / 10　1-back　どうぞ')).toBeTruthy();
    expect(screen.getByTestId('current-question').props.children).toBe('');
  });
});

/**
 * A custom series whose every answer is the same 5 characters, so the budget
 * the clock shows is knowable from outside: base + phase A + 5 × 1s. The
 * phase-A share is in there because a merged step starts its clock while the
 * question is still being read — see GameScreen's budgetBaseMs.
 */
async function fiveCharacterSeries() {
  for (let i = 0; i < 9; i++) await addCustom(`自作${i}`, 'あいうえお');
}

describe('GameScreen answer clock', () => {
  beforeEach(async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, answerInput: 'typed' });
  });

  it('sizes the countdown from the base plus a second per character', async () => {
    await fiveCharacterSeries();
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="custom" onFinished={jest.fn()} deps={deps} />);
    await beginRound();

    // Step 1's window opens with the step itself, once step 0's own 5000 is
    // out: base 4000 + phase A 2000 + 5 characters.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId('answer-clock')).toHaveTextContent('11.0s');

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByTestId('answer-clock')).toHaveTextContent('10.0s');
  });

  it('follows the base set in the settings', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      answerInput: 'typed',
      budgetBaseMs: 1000,
    });
    await fiveCharacterSeries();
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="custom" onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });

    // base 1000 + phase A 2000 + 5 characters.
    expect(screen.getByTestId('answer-clock')).toHaveTextContent('8.0s');
  });

  it('stops at zero without closing the window', async () => {
    await fiveCharacterSeries();
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="custom" onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(jest.getTimerCount()).toBeGreaterThan(0); // the countdown is running

    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(screen.getByTestId('answer-clock')).toHaveTextContent('0.0s');
    expect(styleOf(screen.getByTestId('answer-clock'))?.color).toBe(WRONG_COLOR);
    // A target, not a deadline: the window is still open long past zero.
    expect(screen.getByTestId('typed-answer-input').props.editable).toBe(true);
    // And nothing is left re-rendering the whole screen every 200ms.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('is gone once the round is over', async () => {
    const onFinished = jest.fn();
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={onFinished} deps={deps} />);
    await beginRound();

    for (let i = 0; i < 24; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(3000);
      });
      await act(async () => {
        fireEvent.changeText(screen.getByTestId('typed-answer-input'), 'こたえ');
        fireEvent.press(screen.getByTestId('typed-submit'));
      });
    }
    await act(async () => {
      await jest.advanceTimersByTimeAsync(20_000);
    });
    expect(onFinished).toHaveBeenCalled();

    // The last submit ends the round: the countdown must not freeze on screen
    // at its final value, and the field must not stay typable through the
    // grading drain.
    expect(screen.queryByTestId('answer-clock')).toBeNull();
    expect(screen.getByTestId('typed-answer-input').props.editable).toBe(false);
  });
});

describe('language-driven locale', () => {
  it('constructs the real ExpoSpeaker/ExpoListener with the settings locale, not the ja-JP default', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, language: 'en' });
    const Speech = require('expo-speech');
    render(<GameScreen seriesId="capital-call" onFinished={() => {}} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // The warm-up tap calls speaker.unlock(), which is the first observable
    // Speech.speak() call and proves which locale the constructed ExpoSpeaker holds.
    const warmupStart = await screen.findByTestId('warmup-start');
    fireEvent.press(warmupStart);
    expect(Speech.speak).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ language: 'en-US' }),
    );
  });
});

describe('GameScreen double-press guard', () => {
  beforeEach(async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, answerInput: 'typed' });
  });

  /**
   * A stale second press of one double-tap and a fast player's genuine
   * answer to the very next question look identical at this layer: both are
   * a press on whatever window is open right now, moments after the last
   * submit. A cooldown was tried here and reverted (see handleTypedSubmit)
   * because it could not tell the two apart — it fixed the rare double-tap
   * skip by routinely swallowing fast, genuine play instead, which read as
   * the round having frozen. This test pins the traded-off behaviour: a
   * press on a freshly opened window is always accepted, never delayed or
   * dropped, however soon after the previous submit it lands.
   */
  it('accepts a fast genuine answer to the next question without delay', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    await beginRound();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('typed-answer-input'), 'こたえ');
      fireEvent.press(screen.getByTestId('typed-submit'));
    });
    expect(screen.queryByText('3 / 10　1-back　どうぞ')).toBeTruthy();

    // Answers step 3 immediately — no timer advance at all between the two
    // submits, the fastest a real player's second answer could ever land.
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('typed-answer-input'), 'こたえ');
      fireEvent.press(screen.getByTestId('typed-submit'));
    });

    expect(screen.queryByText('4 / 10　1-back　どうぞ')).toBeTruthy();
  });

  /** Once a step's window has actually closed, a further press is inert. */
  it('still ignores a press once the round is over', async () => {
    const onFinished = jest.fn();
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={onFinished} deps={deps} />);
    await beginRound();

    for (let i = 0; i < 24; i++) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });
      await act(async () => {
        fireEvent.changeText(screen.getByTestId('typed-answer-input'), 'こたえ');
        fireEvent.press(screen.getByTestId('typed-submit'));
      });
    }
    await act(async () => {
      await jest.advanceTimersByTimeAsync(20_000);
    });
    expect(onFinished).toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByTestId('typed-submit'));
    });
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});
