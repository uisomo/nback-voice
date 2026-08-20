import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { RoundEngine, RoundRunner, buildRound } from '../engine';
import { answerBudgetMs } from '../engine/budget';
import type { PositionOutcome } from '../engine/round';
import type { Position, RoundMode, RoundPlan } from '../engine/types';
import { MIN_QUESTIONS } from '../content/pool';
import { findSeries, listSeries } from '../content/series';
import { makeWarmup, type Warmup } from '../content/warmup';
import { ClaudeJudgeClient } from '../judge/claude';
import { JudgeQueue } from '../judge/queue';
import type { JudgeClient } from '../judge/types';
import { ExpoListener } from '../speech/listener';
import { ExpoSpeaker } from '../speech/speaker';
import { TypedListener } from '../speech/typed';
import type { Listener, Speaker } from '../speech/types';
import {
  addLearned,
  appendHistory,
  loadApiKey,
  loadCustom,
  loadLearned,
  loadN,
  loadSettings,
  localDate,
  phaseDurations,
  saveN,
} from '../store/storage';
import { Grid } from './Grid';

/**
 * Hard cap on waiting for background grading at round end. Answers still in
 * flight are handled as 未判定 (spec §4.2), so the results screen must never be
 * held hostage by a stalled request.
 */
const DRAIN_TIMEOUT_MS = 15_000;

function within<T>(promise: Promise<T>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    void promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface GameScreenDeps {
  speaker: Speaker;
  listener: Listener;
  judgeClient: JudgeClient;
  requestPermissions(): Promise<boolean>;
}

function realDeps(): GameScreenDeps {
  return {
    speaker: new ExpoSpeaker(),
    listener: new ExpoListener(),
    judgeClient: new ClaudeJudgeClient(loadApiKey),
    requestPermissions: ExpoListener.requestPermissions,
  };
}

interface LiveAnswer {
  /** The step whose mic window produced this, so a late verdict lands right. */
  index: number;
  text: string;
  /** null until the judge answers — 判定待ち is not 不正解. */
  correct: boolean | null;
}

const CORRECT = '#4caf7d';
const WRONG = '#e5534b';
const NEUTRAL = '#8e8e93';

interface Props {
  /** Which series this round draws from. */
  seriesId: string;
  onFinished: (engine: RoundEngine, plan: RoundPlan) => void;
  /** Overridden in tests; defaults to the real Expo and Claude implementations. */
  deps?: GameScreenDeps;
}

/**
 * How a tap scores against the stimulus N steps back — known the moment it
 * lands, unlike the spoken answer, which has to go to the judge first. null on
 * the first N steps, which recall nothing.
 */
function scoreTap(
  plan: RoundPlan | null,
  runner: RoundRunner | null,
  tap: Position,
): PositionOutcome | null {
  if (!plan || !runner || plan.mode === 'question') return null;
  const step = plan.steps[runner.state.stepIndex];
  if (!step || step.recallTarget === null) return null;
  return tap === plan.steps[step.recallTarget].position ? 'correct' : 'wrong';
}

function answerColor(answer: LiveAnswer): string {
  if (answer.correct === null) return NEUTRAL;
  return answer.correct ? CORRECT : WRONG;
}

function verdictMark(answer: LiveAnswer): string {
  if (answer.correct === null) return '';
  return answer.correct ? '　○' : '　×';
}

/**
 * Which lag this round runs at, in both the name and the instruction — the
 * label alone ("2-back") does not say whether that means the question just
 * asked or the one before it, and getting it wrong costs a whole round.
 */
function LagHeader({ n }: { n: number | null }) {
  if (n === null) return null;
  return (
    <Text style={styles.lag}>
      {n}-back ・ {n}つ前の質問に答える
    </Text>
  );
}

export function GameScreen({ seriesId, onFinished, deps }: Props) {
  const resolved = useMemo(() => deps ?? realDeps(), [deps]);
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState<Position | null>(null);
  const [selected, setSelected] = useState<Position | null>(null);
  const [label, setLabel] = useState('準備中…');
  const [mode, setMode] = useState<RoundMode>('dual');
  const [tapVerdict, setTapVerdict] = useState<PositionOutcome | null>(null);
  /** The answer on screen: what was heard, and how it was judged once known. */
  const [answer, setAnswer] = useState<LiveAnswer | null>(null);
  const [recogError, setRecogError] = useState<string | null>(null);
  const [seriesLabel, setSeriesLabel] = useState('');
  const [warmup, setWarmup] = useState<Warmup | null>(null);
  const [warmupTapped, setWarmupTapped] = useState<number | null>(null);
  /** The round's N, known before it starts so the owner can be told. */
  const [lag, setLag] = useState<number | null>(null);
  /** Non-null only in typed mode; set once settings load, ahead of render. */
  const typedRef = useRef<TypedListener | null>(null);
  const [typedText, setTypedText] = useState('');
  /** null when the field is closed for this step; the countdown otherwise. */
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [gridBox, setGridBox] = useState(300);

  const runnerRef = useRef<RoundRunner | null>(null);
  const planRef = useRef<RoundPlan | null>(null);
  /** Starts the prepared round; set once setup finishes, called by the tap. */
  const beginRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Drives the on-screen countdown during a timed typed answer window. */
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript;
    if (!transcript) return;
    // isFinal marks the recognizer's last word for this session; the step
    // closes on it rather than waiting out the settle bound.
    resolved.listener.push(transcript, event.isFinal);
    // Hearing anything at all means whatever went wrong is over.
    setRecogError(null);
    // Shown as-is, and tagged with the step it belongs to: the owner needs to
    // see a mis-hear as a mis-hear, before the judge has said anything.
    setAnswer({
      index: runnerRef.current?.state.stepIndex ?? -1,
      text: transcript,
      correct: null,
    });
  });

  // A session can end with nothing said at all. Without this the step would
  // sit out the whole settle bound waiting for a result that is not coming.
  useSpeechRecognitionEvent('end', () => {
    resolved.listener.sessionEnded();
  });

  // A refused microphone, an unsupported language or a dead network look
  // exactly like silence from inside the round. Say which it was, on screen:
  // by the time the owner notices, the console is long gone.
  useSpeechRecognitionEvent('error', (event) => {
    // Saying nothing on one step is ordinary — that is 聞き取れず, not a fault.
    if (event.error === 'no-speech') return;
    console.log(`[nback] 認識エラー ${event.error}: ${event.message}`);
    setRecogError(event.error);
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const granted = await resolved.requestPermissions();
      if (cancelled) return;
      if (!granted) {
        setLabel('マイクの許可が必要です');
        return;
      }

      try {
        const [settings, learned, custom] = await Promise.all([
          loadSettings(),
          loadLearned(),
          loadCustom(),
        ]);
        if (cancelled) return;

        const series = findSeries(
          listSeries({ custom, learned, maxTier: settings.maxTier }),
          seriesId,
        );
        const storedN = await loadN(series.id);
        if (cancelled) return;

        const n = settings.adaptive ? storedN : settings.fixedN;
        const pool = series.questions;

        // Named before the mic opens: the lag alone does not say which set of
        // questions is about to be asked, and picking the wrong one costs a
        // whole round.
        setSeriesLabel(`${series.title} ／ ${pool.length}問`);

        // Questions can be deleted after the source was chosen, so re-check
        // here rather than trusting the settings screen's guard alone.
        if (pool.length < MIN_QUESTIONS) {
          setLabel('問題が足りません');
          return;
        }

        setMode(settings.mode);
        const plan = buildRound(n, pool, Math.random, settings.mode);
        planRef.current = plan;
        const engine = new RoundEngine(plan, { budgetBaseMs: settings.budgetBaseMs });
        const typed = settings.answerInput === 'typed' ? new TypedListener() : null;
        typedRef.current = typed;
        const queue = new JudgeQueue(resolved.judgeClient, {
          onVerdict: (index, correct) => {
            engine.resolveAnswer(index, correct);
            // Colours the answer only while it is still the one on screen —
            // a verdict that arrives after the owner has spoken again belongs
            // to a step they are no longer looking at.
            setAnswer((current) =>
              current && current.index === index ? { ...current, correct } : current,
            );
          },
          onLearn: (questionId, answer) => {
            void addLearned(questionId, answer);
          },
        });

        const runner = new RoundRunner({
          plan,
          engine,
          speaker: resolved.speaker,
          listener: typed ?? resolved.listener,
          onJudge: (answer) => queue.enqueue(answer),
          clock: typed ? () => Date.now() : undefined,
        });
        runnerRef.current = runner;

        const { a, b } = phaseDurations(settings);

        // Invoked from schedule(), long after this setup block has returned, so
        // it owns its error handling — and always reaches the results screen.
        const finish = async () => {
          try {
            await within(queue.drain(), DRAIN_TIMEOUT_MS);
            if (!cancelled) {
              if (settings.adaptive) await saveN(series.id, engine.nextN(n));
              await appendHistory({
                date: localDate(),
                n,
                positionScore: engine.positionScore,
                answerScore: engine.answerScore,
                unresolved: engine.unresolvedCount,
                seriesId: series.id,
              });
            }
          } catch (error) {
            console.error('[nback] ラウンド終了処理に失敗しました', error);
          }
          if (!cancelled) onFinished(engine, plan);
        };

        const schedule = () => {
          if (cancelled) return;
          const { phase, stepIndex, flashPosition } = runner.state;

          if (phase === 'done') {
            void finish();
            return;
          }

          setFlash(flashPosition);
          if (phase === 'A') {
            setSelected(null);
            setTapVerdict(null);
          }
          // The mic reopening is the owner's turn again, so the previous
          // answer clears here rather than at the step boundary — it stays up
          // through the next question, which is when its verdict arrives.
          if (phase === 'B') setAnswer(null);
          setLabel(
            `${stepIndex + 1} / ${plan.steps.length}　${n}-back　` +
              (phase === 'A' ? '出題中' : 'どうぞ'),
          );

          const step = plan.steps[stepIndex];
          const owesAnswer = step.recallTarget !== null;

          if (phase === 'B' && typed && owesAnswer) {
            const target = plan.steps[step.recallTarget!];
            const budget = answerBudgetMs(
              target.question?.accept[0] ?? '',
              settings.budgetBaseMs,
            );
            setTypedText('');
            setRemainingMs(budget);
            const startedAt = Date.now();
            clockRef.current = setInterval(() => {
              setRemainingMs(budget - (Date.now() - startedAt));
            }, 200);
          } else {
            setRemainingMs(null);
            // RoundRunner always opens the TypedListener on phase B and
            // readyToClose() always waits on settle(), even on a step that
            // owes no answer — the runner does not know about steps. Nothing
            // is shown to submit here, so the UI submits on the step's
            // behalf: the outer timer below still paces the step normally,
            // this just keeps readyToClose() from waiting on input nobody
            // will ever give.
            if (phase === 'B' && typed) {
              typed.submit();
            }
          }

          const advance = () => {
            void runner.readyToClose().then(() => {
              if (cancelled) return;
              if (clockRef.current) {
                clearInterval(clockRef.current);
                clockRef.current = null;
              }
              // tick() transitions synchronously, so the repaint lands with
              // the transition rather than chaining off another promise.
              runner.tick();
              schedule();
            });
          };

          // Typed answer windows close on submit, not on a timer: that is what
          // makes the round submit-driven. Everything else keeps its timer,
          // including typed steps that owe no answer.
          if (phase === 'B' && typed && owesAnswer) {
            advance();
          } else {
            timerRef.current = setTimeout(advance, phase === 'A' ? a : b);
          }
        };

        // Prepared but not started: the round waits for the warm-up tap,
        // which is what lets iOS speak at all.
        beginRef.current = () => {
          // Runs from the tap handler, outside this block's try, so it owns
          // its failures — a synthesizer that cannot start must not leave the
          // owner on a screen that looks ready.
          try {
            runner.start();
            setReady(true);
            schedule();
          } catch (error) {
            console.error('[nback] ラウンドの開始に失敗しました', error);
            setLabel('準備に失敗しました。アプリを再起動してください');
          }
        };
        if (cancelled) return;
        setLag(n);
        setWarmup(makeWarmup());
      } catch (error) {
        console.error('[nback] ラウンドの準備に失敗しました', error);
        if (!cancelled) setLabel('準備に失敗しました。アプリを再起動してください');
      }
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (clockRef.current) clearInterval(clockRef.current);
      resolved.listener.stop();
      typedRef.current?.stop();
      resolved.speaker.stop();
    };
  }, [resolved, onFinished, seriesId]);

  /**
   * The warm-up tap. The unlock has to happen here, synchronously: it is the
   * gesture itself that permits speech, and anything awaited first lands
   * outside it. Right or wrong answer, the round begins — this is a warm-up,
   * not a gate.
   */
  const handleWarmupTap = useCallback(
    (choice: number) => {
      resolved.speaker.unlock();
      setWarmupTapped(choice);
      setWarmup(null);
      beginRef.current?.();
    },
    [resolved],
  );

  const handleTap = useCallback((position: Position) => {
    runnerRef.current?.onTap(position);
    setSelected(position);
    setTapVerdict(scoreTap(planRef.current, runnerRef.current, position));
  }, []);

  if (warmup) {
    return (
      <View style={styles.screen}>
        <LagHeader n={lag} />
        <Text testID="warmup-series" style={styles.warmupSeries}>
          {seriesLabel}
        </Text>
        <Text style={styles.warmupCaption}>ウォームアップ</Text>
        <Text testID="warmup-question" style={styles.warmupQuestion}>
          {warmup.question} = ?
        </Text>
        <View style={styles.warmupRow}>
          {warmup.choices.map((choice, slot) => (
            <Pressable
              key={choice}
              testID={`warmup-choice-${slot}`}
              style={styles.warmupChoice}
              onPress={() => handleWarmupTap(choice)}
            >
              <Text style={styles.warmupChoiceLabel}>{choice}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.warmupHint}>タップすると始まります</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <LagHeader n={lag} />
      {warmupTapped !== null && !ready && (
        <Text style={styles.warmupCaption}>準備中…</Text>
      )}
      <Text style={styles.label}>{label}</Text>
      {recogError && (
        <Text testID="recog-error" style={styles.error}>
          認識エラー: {recogError}
        </Text>
      )}
      {answer && (
        <Text
          testID="live-transcript"
          style={[styles.heard, { color: answerColor(answer) }]}
        >
          「{answer.text}」{verdictMark(answer)}
        </Text>
      )}
      {mode === 'dual' && typedRef.current && (
        // Typed mode only: the keyboard eats space a fixed 300 grid does not
        // account for, so size it from what onLayout finds actually left.
        <View
          style={styles.gridBox}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setGridBox(Math.min(width, height));
          }}
        >
          <Grid
            flashPosition={flash}
            selected={selected}
            tapVerdict={tapVerdict}
            onTap={handleTap}
            disabled={!ready}
            size={gridBox}
          />
        </View>
      )}
      {mode === 'dual' && !typedRef.current && (
        // Voice mode: unchanged from before this task — no flex wrapper, no
        // explicit size, so Grid renders at its original intrinsic default.
        <Grid
          flashPosition={flash}
          selected={selected}
          tapVerdict={tapVerdict}
          onTap={handleTap}
          disabled={!ready}
        />
      )}
      {typedRef.current && (
        <View style={styles.typedBlock}>
          {remainingMs !== null && (
            <Text
              testID="answer-clock"
              style={[styles.clock, remainingMs <= 0 && styles.clockOut]}
            >
              {Math.max(0, remainingMs / 1000).toFixed(1)}s
            </Text>
          )}
          <View style={styles.typedRow}>
            <TextInput
              testID="typed-answer-input"
              style={styles.typedInput}
              value={typedText}
              editable={remainingMs !== null}
              autoCorrect={false}
              placeholder={remainingMs === null ? 'まだ答えません' : '答えを入力'}
              onChangeText={(text) => {
                setTypedText(text);
                typedRef.current?.push(text);
              }}
              onSubmitEditing={() => typedRef.current?.submit()}
              returnKeyType="send"
            />
            <Pressable testID="typed-submit" onPress={() => typedRef.current?.submit()}>
              <Text style={styles.typedSend}>送る</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', backgroundColor: '#000' },
  label: {
    color: '#f4f1ea',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 24,
  },
  /* The colour is applied inline: neutral until this step's verdict lands,
     because 判定待ち is not 不正解. */
  lag: {
    color: '#c96f4a',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 16,
  },
  warmupCaption: {
    color: '#8e8e93',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  warmupQuestion: {
    color: '#f4f1ea',
    fontSize: 40,
    textAlign: 'center',
    marginBottom: 32,
  },
  warmupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 24,
  },
  warmupChoice: {
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: 12,
    backgroundColor: '#1c1c1e',
  },
  warmupSeries: {
    color: '#f4f1ea',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 4,
  },
  warmupChoiceLabel: { color: '#f4f1ea', fontSize: 28 },
  warmupHint: { color: '#8e8e93', fontSize: 14, textAlign: 'center' },
  error: {
    color: '#e5534b',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 12,
  },
  heard: {
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  gridBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  typedBlock: { marginTop: 16, alignItems: 'center' },
  clock: {
    color: '#4caf7d',
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 8,
  },
  clockOut: { color: '#e5534b' },
  typedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  typedInput: {
    backgroundColor: '#1c1c1e',
    color: '#f4f1ea',
    fontSize: 18,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    minWidth: 200,
  },
  typedSend: {
    color: '#c96f4a',
    fontSize: 18,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
});
