import AsyncStorage from '@react-native-async-storage/async-storage';
import { StyleSheet } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import type { RoundEngine } from '../../engine';
import { SPEAK_TIMEOUT_MS } from '../../engine/runner';
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
  await screen.findByTestId('warmup-question');
  await act(async () => {
    fireEvent.press(screen.getByTestId('warmup-choice-0'));
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
    render(<GameScreen onFinished={onFinished} deps={deps} />);
    await beginRound();
    await runWholeRound();

    expect(speaker.spoken).toHaveLength(9);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('opens the mic once per step, including the trailing recall steps', async () => {
    const { deps, listener } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await runWholeRound();

    expect(listener.sessions).toBe(10); // 9 stimuli + N=1 trailing
  });

  it('grades every answer through the judge and reports a full answer score', async () => {
    const onFinished = jest.fn();
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen onFinished={onFinished} deps={deps} />);
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
    render(<GameScreen onFinished={onFinished} deps={deps} />);
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
    render(<GameScreen onFinished={onFinished} deps={deps} />);
    await beginRound();
    await runWholeRound();

    expect(onFinished).toHaveBeenCalledTimes(1);
    const engine: RoundEngine = onFinished.mock.calls[0][0];
    expect(engine.answerScore).toBeNull();
    expect(engine.unresolvedCount).toBe(9);
  });

  it('writes a history record for the round', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await runWholeRound();

    const history = await loadHistory();
    expect(history).toHaveLength(1);
    expect(history[0].n).toBe(1);
  });

  it('lowers N after a round with no taps', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await runWholeRound();

    // Position 0/9, answers 9/9 → round score 0.5 → N would drop, but 1 is
    // the floor: there is no shorter lag than the question just asked.
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

  it('shows 問題が足りません when the difficulty filter empties the bank', async () => {
    // maxTier: 0 filters out every question in the bank (tiers are 1 and 2).
    // An empty pool is a handled state, not a crash: the owner is told what
    // is wrong rather than being sent to the generic failure message.
    await saveSettings({ ...DEFAULT_SETTINGS, maxTier: 0 });
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { findByText } = render(
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
        <GameScreen onFinished={jest.fn()} deps={deps} />,
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
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
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await beginRound();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(SPEAK_TIMEOUT_MS - 1);
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
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'question' });
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { queryByTestId } = render(
      <GameScreen onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await runWholeRound();
    expect(queryByTestId('cell-0')).toBeNull();
  });

  it('still speaks 9 questions and finishes', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'question' });
    const onFinished = jest.fn();
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen onFinished={onFinished} deps={deps} />);
    await beginRound();
    await runWholeRound();
    expect(speaker.spoken).toHaveLength(9);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('scores on the answer channel alone and adapts N', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'question' });
    const onFinished = jest.fn();
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen onFinished={onFinished} deps={deps} />);
    await beginRound();
    await runWholeRound();
    const engine: RoundEngine = onFinished.mock.calls[0][0];
    expect(engine.positionScore).toBeNull();
    expect(engine.answerScore).toBe(1);
    // Answer channel alone is 1.0, so N rises even with no taps.
    expect(await loadN()).toBe(2);
  });

  it('holds N when the judge is unreachable in question mode', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, mode: 'question' });
    const offline: JudgeClient = {
      judge: async () => {
        throw new Error('network down');
      },
    };
    const { deps } = makeDefaultDeps(offline);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await runWholeRound();
    // Both channels absent: nothing to adapt on, so N must not move.
    expect(await loadN()).toBe(1);
  });
});

describe('GameScreen question source', () => {
  it('draws only from custom questions when told to', async () => {
    for (let i = 0; i < 9; i++) await addCustom(`自作${i}`, `答え${i}`);
    await saveSettings({ ...DEFAULT_SETTINGS, questionSource: 'custom' });
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await runWholeRound();
    expect(speaker.spoken).toHaveLength(9);
    for (const spoken of speaker.spoken) {
      expect(spoken).toMatch(/^自作\d$/);
    }
  });

  it('shows 問題が足りません when the pool is too small', async () => {
    await addCustom('一問だけ', 'あ');
    await saveSettings({ ...DEFAULT_SETTINGS, questionSource: 'custom' });
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { findByText } = render(
      <GameScreen onFinished={jest.fn()} deps={deps} />,
    );
    expect(await findByText(/問題が足りません/)).toBeTruthy();
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await beginRound();
    await runWholeRound();

    expect(heard).toHaveLength(9);
    expect(new Set(heard)).toEqual(new Set(['てすとおんせい']));
  });

  it('forwards the recognizer session end so a silent step cannot stall the round', async () => {
    const listener = new LateFinalListener(null); // never delivers by itself
    const { deps } = makeDeps(alwaysCorrect, new FakeSpeaker(), listener);
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
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
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
      <GameScreen onFinished={jest.fn()} deps={deps} />,
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
    render(<GameScreen onFinished={jest.fn()} deps={deps} />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });

    expect(speaker.spoken).toHaveLength(0);
  });

  it('shows an arithmetic item to tap while the round loads', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { findByTestId, getAllByTestId } = render(
      <GameScreen onFinished={jest.fn()} deps={deps} />,
    );

    expect(await findByTestId('warmup-question')).toBeTruthy();
    expect(getAllByTestId(/^warmup-choice-/)).toHaveLength(3);
  });

  it('unlocks the synthesizer inside the tap', async () => {
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    const { findByTestId, getByTestId } = render(
      <GameScreen onFinished={jest.fn()} deps={deps} />,
    );
    await findByTestId('warmup-question');

    await act(async () => {
      fireEvent.press(getByTestId('warmup-choice-0'));
    });

    expect(speaker.unlocked).toBe(1);
  });

  it('runs the whole round once tapped', async () => {
    const onFinished = jest.fn();
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    const { findByTestId, getByTestId } = render(
      <GameScreen onFinished={onFinished} deps={deps} />,
    );
    await findByTestId('warmup-question');
    await act(async () => {
      fireEvent.press(getByTestId('warmup-choice-0'));
    });
    await runWholeRound();

    expect(speaker.spoken).toHaveLength(9);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('takes a wrong tap as readily as a right one — it is a warm-up', async () => {
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    const { findByTestId, getByTestId } = render(
      <GameScreen onFinished={jest.fn()} deps={deps} />,
    );
    const question = await findByTestId('warmup-question');
    const answer = Number(
      (question.props.children as string[]).join('').match(/= ?(\d+)/)?.[1] ??
        NaN,
    );
    // Whichever slot is tapped, the round begins.
    for (const slot of [0, 1, 2]) {
      const choice = getByTestId(`warmup-choice-${slot}`);
      if (Number(choice.props.children) === answer) continue;
      await act(async () => {
        fireEvent.press(choice);
      });
      break;
    }
    await runWholeRound();

    expect(speaker.spoken).toHaveLength(9);
  });

  it('shows which lag this round is, before it starts', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { findByText } = render(
      <GameScreen onFinished={jest.fn()} deps={deps} />,
    );
    expect(await findByText(/1-back/)).toBeTruthy();
    expect(await findByText(/1つ前の質問/)).toBeTruthy();
  });

  it('keeps the lag on screen during the round', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    const { findByTestId, getByTestId, findByText } = render(
      <GameScreen onFinished={jest.fn()} deps={deps} />,
    );
    await findByTestId('warmup-question');
    await act(async () => {
      fireEvent.press(getByTestId('warmup-choice-0'));
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_500);
    });

    expect(await findByText(/1つ前の質問/)).toBeTruthy();
  });
});
