import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { RoundEngine, RoundRunner, buildRound } from '../engine';
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

interface Props {
  onFinished: (engine: RoundEngine, plan: RoundPlan) => void;
  /** Overridden in tests; defaults to the real Expo and Claude implementations. */
  deps?: GameScreenDeps;
}

export function GameScreen({ onFinished, deps }: Props) {
  const resolved = useMemo(() => deps ?? realDeps(), [deps]);
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState<Position | null>(null);
  const [selected, setSelected] = useState<Position | null>(null);
  const [label, setLabel] = useState('準備中…');
  const [mode, setMode] = useState<RoundMode>('dual');

  const runnerRef = useRef<RoundRunner | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript;
    if (transcript) resolved.listener.push(transcript);
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
        const engine = new RoundEngine(plan);
        const queue = new JudgeQueue(resolved.judgeClient, {
          onVerdict: (index, correct) => engine.resolveAnswer(index, correct),
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
          if (phase === 'A') setSelected(null);
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
  }, []);

  return (
    <View style={styles.screen}>
      <Text style={styles.label}>{label}</Text>
      {mode === 'dual' && (
        <Grid
          flashPosition={flash}
          selected={selected}
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
});
