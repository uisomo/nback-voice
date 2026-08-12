import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { RoundEngine, RoundRunner, buildRound } from '../engine';
import type { Position, RoundPlan } from '../engine/types';
import { loadBank } from '../content/bank';
import { ClaudeJudgeClient } from '../judge/claude';
import { JudgeQueue } from '../judge/queue';
import type { JudgeClient } from '../judge/types';
import { ExpoListener } from '../speech/listener';
import { ExpoSpeaker } from '../speech/speaker';
import type { Listener, Speaker } from '../speech/types';
import {
  addLearned,
  appendHistory,
  loadLearned,
  loadN,
  loadSettings,
  phaseDurations,
  saveN,
} from '../store/storage';
import { Grid } from './Grid';

const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';

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

      const [settings, storedN, learned] = await Promise.all([
        loadSettings(),
        loadN(),
        loadLearned(),
      ]);
      if (cancelled) return;

      const n = settings.adaptive ? storedN : settings.fixedN;
      const bank = loadBank(learned).filter((q) => q.tier <= settings.maxTier);
      const plan = buildRound(n, bank);
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

      const finish = async () => {
        await queue.drain();
        if (cancelled) return;
        if (settings.adaptive) await saveN(engine.nextN(n));
        await appendHistory({
          date: new Date().toISOString().slice(0, 10),
          n,
          positionScore: engine.positionScore,
          answerScore: engine.answerScore,
          unresolved: engine.unresolvedCount,
        });
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
            void runner.tick().then(schedule);
          },
          phase === 'A' ? a : b,
        );
      };

      await runner.start();
      if (cancelled) return;
      setReady(true);
      schedule();
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resolved, onFinished]);

  const handleTap = useCallback((position: Position) => {
    runnerRef.current?.onTap(position);
    setSelected(position);
  }, []);

  return (
    <View style={styles.screen}>
      <Text style={styles.label}>{label}</Text>
      <Grid
        flashPosition={flash}
        selected={selected}
        onTap={handleTap}
        disabled={!ready}
      />
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
