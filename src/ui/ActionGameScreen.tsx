import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { RoundEngine, RoundRunner } from '../engine';
import type { RoundPlan } from '../engine';
import { getSequence } from '../actions/actions';
import type { Sequence } from '../actions/actions';
import { buildActionRound, eligibleCards } from '../actions/plan';
import type { Layer } from '../actions/plan';
import { ClaudeJudgeClient } from '../judge/claude';
import { JudgeQueue } from '../judge/queue';
import { ExpoListener } from '../speech/listener';
import { ExpoSpeaker } from '../speech/speaker';
import { TypedListener } from '../speech/typed';
import { loadApiKey } from '../store/storage';
import { useStrings } from '../strings';
import { getTheme } from './theme';

type Phase = 'intro' | 'play' | 'results';

/** Default lag, floored at 1 — there is no shorter lag than the card just named. */
const DEFAULT_N = 2;

/**
 * Hard cap on waiting for background grading at round end — mirrors GameScreen.
 * A stalled judge call must never hold the results screen hostage.
 */
const DRAIN_TIMEOUT_MS = 15_000;

function within(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

/**
 * The action-card dual-n-back. Thin shell around the reused RoundRunner: the
 * component owns only the intro/results toggles and the layer/N controls; the
 * play loop is the runner, wired exactly as GameScreen wires it (engine +
 * runner + JudgeQueue + ExpoSpeaker/ExpoListener). The two differences from
 * GameScreen are the plan source (buildActionRound over an authored Sequence
 * instead of buildRound over a question pool) and the two-layer progression.
 */
export function ActionGameScreen({
  sequenceId,
  onExit,
}: {
  sequenceId: string;
  onExit: () => void;
}) {
  const strings = useStrings();
  const theme = getTheme();
  const seq = getSequence(sequenceId);

  const [phase, setPhase] = useState<Phase>('intro');
  const [layer, setLayer] = useState<Layer>('purpose');
  const [n, setN] = useState(DEFAULT_N);
  /** Current step's prompt, painted as action-prompt while the round runs. */
  const [stepIndex, setStepIndex] = useState(0);
  const [total, setTotal] = useState(0);
  /** The finished engine, so the results screen can show score/N/hits. */
  const [result, setResult] = useState<{ engine: RoundEngine; layer: Layer } | null>(null);

  const runnerRef = useRef<RoundRunner | null>(null);
  const planRef = useRef<RoundPlan | null>(null);
  const speakerRef = useRef<ExpoSpeaker | null>(null);
  const listenerRef = useRef<ExpoListener | null>(null);
  const typedRef = useRef<TypedListener | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  // The recognizer feeds the live listener, same subscription GameScreen uses.
  // Harmless when the round is not running: push() on a stopped listener is a
  // no-op and there is nothing on screen depending on the transcript here.
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript;
    if (!transcript) return;
    listenerRef.current?.push(transcript, event.isFinal);
  });
  useSpeechRecognitionEvent('end', () => {
    listenerRef.current?.sessionEnded();
  });

  const teardown = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    listenerRef.current?.stop();
    typedRef.current?.stop();
    speakerRef.current?.stop();
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      teardown();
    };
  }, [teardown]);

  if (!seq) {
    return (
      <View style={[styles.root, { backgroundColor: theme.bg }]}>
        <Pressable testID="action-back" onPress={onExit}>
          <Text style={{ color: theme.textPrimary }}>{strings.actions.backToList}</Text>
        </Pressable>
      </View>
    );
  }

  /**
   * Builds the plan/engine/runner for a chosen layer at the current N and
   * drives it to completion, mirroring GameScreen's schedule()/advance() loop.
   * The play loop lives in the runner; this only paints step state and, on
   * 'done', flips to the results phase.
   */
  const startRound = (roundLayer: Layer) => {
    const plan = buildActionRound(seq, { n, layer: roundLayer, mode: 'question' });
    planRef.current = plan;
    setTotal(plan.steps.length);

    const engine = new RoundEngine(plan);
    const speaker = new ExpoSpeaker();
    const listener = new ExpoListener();
    speakerRef.current = speaker;
    listenerRef.current = listener;

    const queue = new JudgeQueue(
      new ClaudeJudgeClient(loadApiKey),
      {
        onVerdict: (index, correct) => engine.resolveAnswer(index, correct),
        onLearn: () => {},
      },
    );

    const runner = new RoundRunner({
      plan,
      engine,
      speaker,
      listener,
      onJudge: (answer) => queue.enqueue(answer),
    });
    runnerRef.current = runner;

    const finish = async () => {
      await within(queue.drain(), DRAIN_TIMEOUT_MS);
      if (cancelledRef.current) return;
      setResult({ engine, layer: roundLayer });
      setPhase('results');
    };

    const schedule = () => {
      if (cancelledRef.current) return;
      const { phase: runnerPhase, stepIndex: idx } = runner.state;
      if (runnerPhase === 'done') {
        void finish();
        return;
      }
      setStepIndex(idx);

      const advance = () => {
        void runner.readyToClose().then(() => {
          if (cancelledRef.current) return;
          runner.tick();
          schedule();
        });
      };
      // question mode is two-phase (A then B); pace each phase off a short
      // timer and let readyToClose() hold A open until the utterance ends.
      // The realtime voice loop itself is verified on device (Task 8); here
      // the runner just needs to keep advancing.
      const span = runnerPhase === 'A' ? 2000 : 3000;
      timerRef.current = setTimeout(advance, span);
    };

    speaker.unlock();
    runner.start();
    setPhase('play');
    schedule();
  };

  const handleStart = () => {
    setLayer('purpose');
    startRound('purpose');
  };

  const handleToLayer2 = () => {
    setLayer('action');
    startRound('action');
  };

  const handleAgain = () => {
    setLayer('purpose');
    startRound('purpose');
  };

  // --- Intro -------------------------------------------------------------
  if (phase === 'intro') {
    return (
      <ScrollView
        testID="action-intro"
        style={[styles.root, { backgroundColor: theme.bg }]}
        contentContainerStyle={styles.content}
      >
        <Text style={[styles.scenario, { color: theme.textSecondary }]}>{seq.scenario}</Text>
        <Text style={[styles.goal, { color: theme.textPrimary }]}>
          {strings.actions.goalLabel}：{seq.goal}
        </Text>

        <Text style={[styles.previewLabel, { color: theme.accentGold }]}>
          {strings.actions.cardsPreview}
        </Text>
        {eligibleCards(seq, 'purpose').map((card) => (
          <Text key={card.id} style={[styles.cardTitle, { color: theme.textPrimary }]}>
            {card.title}
          </Text>
        ))}

        <View style={styles.layerRow}>
          <Pressable
            testID="action-layer1"
            onPress={() => setLayer('purpose')}
            style={[styles.chip, layer === 'purpose' && { backgroundColor: theme.accentGold }]}
          >
            <Text style={[styles.chipText, { color: layer === 'purpose' ? '#050810' : theme.textPrimary }]}>
              {strings.actions.layer1}
            </Text>
          </Pressable>
          <Pressable
            testID="action-layer2"
            onPress={() => setLayer('action')}
            style={[styles.chip, layer === 'action' && { backgroundColor: theme.accentGold }]}
          >
            <Text style={[styles.chipText, { color: layer === 'action' ? '#050810' : theme.textPrimary }]}>
              {strings.actions.layer2}
            </Text>
          </Pressable>
        </View>

        <View style={styles.nRow}>
          <Pressable testID="action-n-down" onPress={() => setN((v) => Math.max(1, v - 1))} style={styles.nBtn}>
            <Text style={[styles.nBtnText, { color: theme.textPrimary }]}>−</Text>
          </Pressable>
          <Text style={[styles.nLabel, { color: theme.textMuted }]}>{strings.actions.nLabel}</Text>
          <Text testID="action-n-value" style={[styles.nValue, { color: theme.accentGold }]}>
            {n}
          </Text>
          <Pressable testID="action-n-up" onPress={() => setN((v) => v + 1)} style={styles.nBtn}>
            <Text style={[styles.nBtnText, { color: theme.textPrimary }]}>＋</Text>
          </Pressable>
        </View>

        <Pressable
          testID="action-start"
          onPress={handleStart}
          style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
        >
          <Text style={styles.primaryBtnText}>{strings.actions.start}</Text>
        </Pressable>
        <Pressable testID="action-back" onPress={onExit} style={styles.secondaryBtn}>
          <Text style={[styles.secondaryBtnText, { color: theme.textPrimary }]}>
            {strings.actions.backToList}
          </Text>
        </Pressable>
      </ScrollView>
    );
  }

  // --- Play --------------------------------------------------------------
  if (phase === 'play') {
    const prompt = layer === 'purpose' ? strings.actions.promptPurpose : strings.actions.promptAction;
    return (
      <View style={[styles.root, styles.playRoot, { backgroundColor: theme.bg }]}>
        <Text style={[styles.stepCounter, { color: theme.textMuted }]}>
          {stepIndex + 1} / {total}　{n}-back
        </Text>
        <Text testID="action-prompt" style={[styles.prompt, { color: theme.textPrimary }]}>
          {prompt}
        </Text>
        <Pressable testID="action-answer" style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}>
          <Text style={styles.primaryBtnText}>{strings.actions.answer}</Text>
        </Pressable>
        <Pressable testID="action-next" style={styles.secondaryBtn}>
          <Text style={[styles.secondaryBtnText, { color: theme.textPrimary }]}>{strings.actions.next}</Text>
        </Pressable>
      </View>
    );
  }

  // --- Results -----------------------------------------------------------
  const engine = result?.engine ?? null;
  const finishedLayer = result?.layer ?? 'purpose';
  return (
    <ScrollView
      testID="action-results"
      style={[styles.root, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.resultsTitle, { color: theme.accentGold }]}>
        {(finishedLayer === 'purpose' ? strings.actions.layer1 : strings.actions.layer2)}
      </Text>
      <Text style={[styles.resultLine, { color: theme.textPrimary }]}>
        {strings.actions.nLabel}: {n}
      </Text>
      {engine && (
        <Text style={[styles.resultLine, { color: theme.textSecondary }]}>
          {engine.answerScore === null ? '—' : `${Math.round(engine.answerScore * 100)}%`}
          {engine.unresolvedCount > 0 ? `　未判定 ${engine.unresolvedCount}` : ''}
        </Text>
      )}

      {finishedLayer === 'purpose' ? (
        <Pressable
          testID="action-to-layer2"
          onPress={handleToLayer2}
          style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
        >
          <Text style={styles.primaryBtnText}>{strings.actions.toLayer2}</Text>
        </Pressable>
      ) : (
        <>
          <Pressable
            testID="action-again"
            onPress={handleAgain}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.actions.again}</Text>
          </Pressable>
          <Pressable testID="action-back" onPress={onExit} style={styles.secondaryBtn}>
            <Text style={[styles.secondaryBtnText, { color: theme.textPrimary }]}>
              {strings.actions.backToList}
            </Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  playRoot: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  content: { padding: 16 },
  scenario: { fontSize: 13, lineHeight: 20, marginBottom: 12 },
  goal: { fontSize: 16, fontWeight: 'bold', marginBottom: 16 },
  previewLabel: { fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 8 },
  cardTitle: { fontSize: 14, marginBottom: 6 },
  layerRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  chip: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, backgroundColor: '#1c1c1e' },
  chipText: { fontSize: 14, fontWeight: '600' },
  nRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 20 },
  nBtn: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 10, backgroundColor: '#1c1c1e' },
  nBtnText: { fontSize: 22 },
  nLabel: { fontSize: 14 },
  nValue: { fontSize: 26, fontWeight: 'bold', minWidth: 28, textAlign: 'center' },
  primaryBtn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 20, alignSelf: 'stretch' },
  primaryBtnText: { color: '#050810', fontWeight: 'bold', fontSize: 15 },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  secondaryBtnText: { fontSize: 14 },
  stepCounter: { fontSize: 13, marginBottom: 16 },
  prompt: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 24 },
  resultsTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 12 },
  resultLine: { fontSize: 15, marginBottom: 6 },
});
