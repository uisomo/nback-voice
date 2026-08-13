import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { RoundEngine, RoundRunner, buildRound } from '../engine';
import type { PositionOutcome } from '../engine/round';
import type { Position, RoundMode, RoundPlan } from '../engine/types';
import { loadBank, mergeLearned } from '../content/bank';
import { MIN_QUESTIONS, resolvePool } from '../content/pool';
import { ClaudeJudgeClient } from '../judge/claude';
import { JudgeQueue } from '../judge/queue';
import type { JudgeClient } from '../judge/types';
import { ExpoListener } from '../speech/listener';
import { ExpoSpeaker } from '../speech/speaker';
import type { Listener, Speaker } from '../speech/types';
import {
  addLearned,
  appendHistory,
  loadCustom,
  loadLearned,
  loadN,
  loadSettings,
  localDate,
  phaseDurations,
  saveN,
} from '../store/storage';
import { Grid } from './Grid';

const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';

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
    judgeClient: new ClaudeJudgeClient(API_KEY),
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

export function GameScreen({ onFinished, deps }: Props) {
  const resolved = useMemo(() => deps ?? realDeps(), [deps]);
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState<Position | null>(null);
  const [selected, setSelected] = useState<Position | null>(null);
  const [label, setLabel] = useState('準備中…');
  const [mode, setMode] = useState<RoundMode>('dual');
  const [tapVerdict, setTapVerdict] = useState<PositionOutcome | null>(null);
  /** The answer on screen: what was heard, and how it was judged once known. */
  const [answer, setAnswer] = useState<LiveAnswer | null>(null);

  const runnerRef = useRef<RoundRunner | null>(null);
  const planRef = useRef<RoundPlan | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript;
    if (!transcript) return;
    // isFinal marks the recognizer's last word for this session; the step
    // closes on it rather than waiting out the settle bound.
    resolved.listener.push(transcript, event.isFinal);
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
        const [settings, storedN, learned, custom] = await Promise.all([
          loadSettings(),
          loadN(),
          loadLearned(),
          loadCustom(),
        ]);
        if (cancelled) return;

        const n = settings.adaptive ? storedN : settings.fixedN;
        const pool = resolvePool(
          settings.questionSource,
          loadBank(learned),
          mergeLearned(custom, learned),
          settings.maxTier,
        );

        // Questions can be deleted after the source was chosen, so re-check
        // here rather than trusting the settings screen's guard alone.
        if (pool.length < MIN_QUESTIONS) {
          setLabel('問題が足りません');
          return;
        }

        setMode(settings.mode);
        const plan = buildRound(n, pool, Math.random, settings.mode);
        planRef.current = plan;
        const engine = new RoundEngine(plan);
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
          listener: resolved.listener,
          onJudge: (answer) => queue.enqueue(answer),
        });
        runnerRef.current = runner;

        const { a, b } = phaseDurations(settings);

        // Invoked from schedule(), long after this setup block has returned, so
        // it owns its error handling — and always reaches the results screen.
        const finish = async () => {
          try {
            await within(queue.drain(), DRAIN_TIMEOUT_MS);
            if (!cancelled) {
              if (settings.adaptive) await saveN(engine.nextN(n));
              await appendHistory({
                date: localDate(),
                n,
                positionScore: engine.positionScore,
                answerScore: engine.answerScore,
                unresolved: engine.unresolvedCount,
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

          timerRef.current = setTimeout(
            () => {
              // Phase A closes at max(a, utterance) — readyToClose() resolves
              // at once unless the question is still being spoken. The paint
              // above already happened, so this only delays the mic opening.
              void runner.readyToClose().then(() => {
                if (cancelled) return;
                // tick() transitions synchronously, so the repaint lands with
                // the transition rather than chaining off another promise.
                runner.tick();
                schedule();
              });
            },
            phase === 'A' ? a : b,
          );
        };

        runner.start();
        if (cancelled) return;
        setReady(true);
        schedule();
      } catch (error) {
        console.error('[nback] ラウンドの準備に失敗しました', error);
        if (!cancelled) setLabel('準備に失敗しました。アプリを再起動してください');
      }
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      resolved.listener.stop();
      resolved.speaker.stop();
    };
  }, [resolved, onFinished]);

  const handleTap = useCallback((position: Position) => {
    runnerRef.current?.onTap(position);
    setSelected(position);
    setTapVerdict(scoreTap(planRef.current, runnerRef.current, position));
  }, []);

  return (
    <View style={styles.screen}>
      <Text style={styles.label}>{label}</Text>
      {answer && (
        <Text
          testID="live-transcript"
          style={[styles.heard, { color: answerColor(answer) }]}
        >
          「{answer.text}」{verdictMark(answer)}
        </Text>
      )}
      {mode === 'dual' && (
        <Grid
          flashPosition={flash}
          selected={selected}
          tapVerdict={tapVerdict}
          onTap={handleTap}
          disabled={!ready}
        />
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
  heard: {
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
});
