import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { getSequence } from '../actions/actions';
import type { ActionCard } from '../actions/actions';
import {
  actionAnswer,
  advance,
  answerFor,
  createDrill,
  currentStep,
  fieldsFor,
  isFinished,
  nextStage,
  purposeAnswer,
  setSelfGrade,
  stageScore,
  submitAnswer,
  toggleChecked,
  unitContent,
  unitKey,
  updatedN,
} from '../actions/drill';
import type { AnswerSpec, DrillState, DrillStep, Field, Stage } from '../actions/drill';
import { useStrings } from '../strings';
import { getTheme } from './theme';

type Phase = 'intro' | 'play' | 'results';

/**
 * 1ステップの中で切り替わる面。read は学習段だけ、observe は出題も表示も
 * 無い先頭N手だけに出る。
 */
type Pane = 'read' | 'observe' | 'answer' | 'reveal';

const DEFAULT_N = 2;

function initialPane(step: DrillStep): Pane {
  if (step.displayIndex !== null) return 'read';
  if (step.targetIndex !== null) return 'answer';
  return 'observe';
}

/**
 * アクションカードの三段ドリル。音声スタックは使わない — タイマーも
 * 非同期採点も無く、状態は drill.ts の純粋な状態機械が全部持つので、
 * ここは描画とタップの受け口だけを持つ（spec §3）。
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
  const [n, setN] = useState(DEFAULT_N);
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [pane, setPane] = useState<Pane>('read');
  const [inputs, setInputs] = useState<Record<Field, string>>({ purpose: '', action: '' });

  if (!seq) {
    return (
      <View style={[styles.root, { backgroundColor: theme.bg }]}>
        <Pressable testID="action-back" onPress={onExit}>
          <Text style={{ color: theme.textPrimary }}>{strings.actions.backToList}</Text>
        </Pressable>
      </View>
    );
  }

  const stageLabel = (stage: Stage) =>
    stage === 'study'
      ? strings.actions.stageStudy
      : stage === 'purpose'
        ? strings.actions.stagePurpose
        : strings.actions.stageAction;

  const startStage = (stage: Stage, atN: number) => {
    const fresh = createDrill(seq, stage, atN);
    setDrill(fresh);
    setInputs({ purpose: '', action: '' });
    setPane(initialPane(fresh.steps[0]));
    setPhase('play');
  };

  const goNextStep = (state: DrillState) => {
    const next = advance(state);
    setDrill(next);
    if (isFinished(next)) {
      // 段末で一度だけ N を更新する。次の段はこの N で始まる。
      setN(updatedN(next));
      setPhase('results');
      return;
    }
    setInputs({ purpose: '', action: '' });
    setPane(initialPane(currentStep(next)!));
  };

  const specFor = (field: Field, card: ActionCard, subIndex: number | null): AnswerSpec | null =>
    field === 'purpose' ? purposeAnswer(card) : actionAnswer(card, subIndex);

  const labelFor = (field: Field) =>
    field === 'purpose' ? strings.actions.midPurposeLabel : strings.actions.concreteActionLabel;

  // --- Intro -------------------------------------------------------------
  if (phase === 'intro' || !drill) {
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

        <Text style={[styles.sectionLabel, { color: theme.accentGold }]}>
          {strings.actions.cardsPreview}
        </Text>
        {seq.cards.map((card) => (
          <Text key={card.id} style={[styles.cardTitle, { color: theme.textPrimary }]}>
            {card.title}
          </Text>
        ))}

        {/* 矢印は進行順を示すだけの非対話要素。開始は必ず学習段から。 */}
        <View style={styles.navRow}>
          <Text testID="action-nav-study" style={[styles.navItem, { color: theme.accentGold }]}>
            {strings.actions.stageStudy}
          </Text>
          <Text style={[styles.navArrow, { color: theme.textMuted }]}>→</Text>
          <Text testID="action-nav-purpose" style={[styles.navItem, { color: theme.textSecondary }]}>
            {strings.actions.stagePurpose}
          </Text>
          <Text style={[styles.navArrow, { color: theme.textMuted }]}>→</Text>
          <Text testID="action-nav-action" style={[styles.navItem, { color: theme.textSecondary }]}>
            {strings.actions.stageAction}
          </Text>
        </View>

        <View style={styles.nRow}>
          <Pressable
            testID="action-n-down"
            onPress={() => setN((v) => Math.max(1, v - 1))}
            style={styles.nBtn}
          >
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
          onPress={() => startStage('study', n)}
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

  // --- Results -----------------------------------------------------------
  if (phase === 'results') {
    const score = stageScore(drill);
    const following = nextStage(drill.stage);
    return (
      <ScrollView
        testID="action-results"
        style={[styles.root, { backgroundColor: theme.bg }]}
        contentContainerStyle={styles.content}
      >
        <Text testID="action-results-stage" style={[styles.resultsTitle, { color: theme.accentGold }]}>
          {stageLabel(drill.stage)}
        </Text>
        <Text testID="action-results-score" style={[styles.resultLine, { color: theme.textPrimary }]}>
          {strings.actions.stageScoreLabel}: {score === null ? '—' : `${Math.round(score * 100)}%`}
        </Text>
        <Text testID="action-results-n" style={[styles.resultLine, { color: theme.textSecondary }]}>
          {strings.actions.nLabel}: {n}
        </Text>

        {following ? (
          <Pressable
            testID="action-next-stage"
            onPress={() => startStage(following, n)}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.actions.nextStage}</Text>
          </Pressable>
        ) : (
          <Pressable
            testID="action-again"
            onPress={() => startStage('study', n)}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.actions.again}</Text>
          </Pressable>
        )}
        <Pressable testID="action-back" onPress={onExit} style={styles.secondaryBtn}>
          <Text style={[styles.secondaryBtnText, { color: theme.textPrimary }]}>
            {strings.actions.backToList}
          </Text>
        </Pressable>
      </ScrollView>
    );
  }

  // --- Play --------------------------------------------------------------
  const step = currentStep(drill)!;
  const display = step.displayIndex === null ? null : unitContent(seq, drill.units[step.displayIndex]);
  const target = step.targetIndex === null ? null : unitContent(seq, drill.units[step.targetIndex]);
  const fields = target ? fieldsFor(drill.stage, target.card) : [];
  // 序数は面ごとに指すものが変わる。読む面には設問が無いので画面のカードを、
  // 答える面と開示面は問われているカードを名指す。観察のみの手は両方 null。
  const headerOrdinal = pane === 'read' ? step.displayOrdinal : step.targetOrdinal;

  const submitAll = () => {
    if (!target) return;
    let next = drill;
    for (const field of fields) {
      const spec = specFor(field, target.card, step.subIndex);
      if (spec) next = submitAnswer(next, field, inputs[field], spec);
    }
    setDrill(next);
    setPane('reveal');
  };

  return (
    <ScrollView
      testID="action-play"
      style={[styles.root, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.sectionLabel, { color: theme.accentGold }]}>
        {strings.actions.grandPurposeLabel}
      </Text>
      <Text testID="action-header-goal" style={[styles.goal, { color: theme.textPrimary }]}>
        {seq.goal}
      </Text>
      <View style={styles.headerRow}>
        <Text testID="action-header-ordinal" style={[styles.ordinal, { color: theme.textSecondary }]}>
          {headerOrdinal === null
            ? '—'
            : strings.actions.ordinalOf(headerOrdinal, step.totalCards)}
        </Text>
        <Text testID="action-header-n" style={[styles.backTag, { color: theme.textMuted }]}>
          {drill.n}-back
        </Text>
      </View>
      <View style={[styles.rule, { backgroundColor: theme.cardBorder }]} />

      {/*
        段の途中で抜ける導線。action-game ではタブバーが隠れるので、これが
        無いと残りの手を全部タップし切るまで画面から出られなくなる。つぎへ
        と取り違えないよう副次ボタンの見た目のまま、どの面からも押せる位置に置く。
      */}
      <Pressable testID="action-back" onPress={onExit} style={styles.secondaryBtn}>
        <Text style={[styles.secondaryBtnText, { color: theme.textPrimary }]}>
          {strings.actions.backToList}
        </Text>
      </Pressable>

      {pane === 'read' && display && (
        <>
          <Pressable
            testID="action-read"
            onPress={() => setDrill(toggleChecked(drill, unitKey(drill.units[step.displayIndex!])))}
            style={[
              styles.readCard,
              {
                backgroundColor: theme.cardBg,
                borderColor: drill.checked.has(unitKey(drill.units[step.displayIndex!]))
                  ? theme.accentSuccess
                  : theme.cardBorder,
              },
            ]}
          >
            {drill.checked.has(unitKey(drill.units[step.displayIndex!])) && (
              <View testID="action-read-checked" style={[styles.checkDot, { backgroundColor: theme.accentSuccess }]} />
            )}
            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
              {strings.actions.meansLabel}
            </Text>
            <Text style={[styles.body, { color: theme.textPrimary }]}>{display.card.title}</Text>
            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
              {strings.actions.midPurposeLabel}
            </Text>
            <Text testID="action-read-purpose" style={[styles.body, { color: theme.textPrimary }]}>
              {display.card.purpose}
            </Text>
            {display.card.subActions.map((sub) => (
              <View key={sub.id} style={styles.subBlock}>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                  {strings.actions.subPurposeLabel}
                </Text>
                <Text style={[styles.body, { color: theme.textSecondary }]}>{sub.purpose}</Text>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                  {strings.actions.concreteActionLabel}
                </Text>
                <Text style={[styles.body, { color: theme.textSecondary }]}>{sub.action}</Text>
              </View>
            ))}
          </Pressable>
          <Pressable
            testID="action-read-next"
            onPress={() => (step.targetIndex !== null ? setPane('answer') : goNextStep(drill))}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.actions.next}</Text>
          </Pressable>
        </>
      )}

      {pane === 'observe' && (
        <>
          <Text testID="action-observe" style={[styles.body, { color: theme.textMuted }]}>
            {strings.actions.observeOnly}
          </Text>
          <Pressable
            testID="action-observe-next"
            onPress={() => goNextStep(drill)}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.actions.next}</Text>
          </Pressable>
        </>
      )}

      {pane === 'answer' && target && (
        <>
          {/* 具体アクション段は小目的が問題文になる（spec §6.1）。 */}
          {target.subAction && (
            <>
              <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                {strings.actions.subPurposeLabel}
              </Text>
              <Text testID="action-prompt" style={[styles.body, { color: theme.textPrimary }]}>
                {target.subAction.purpose}
              </Text>
            </>
          )}
          {fields.map((field) => (
            <View key={field} style={styles.subBlock}>
              <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{labelFor(field)}</Text>
              <TextInput
                testID={`action-input-${field}`}
                value={inputs[field]}
                onChangeText={(text) => setInputs((prev) => ({ ...prev, [field]: text }))}
                multiline
                style={[
                  styles.input,
                  { color: theme.textPrimary, backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
                ]}
              />
            </View>
          ))}
          <Pressable
            testID="action-next"
            onPress={submitAll}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.actions.next}</Text>
          </Pressable>
        </>
      )}

      {pane === 'reveal' && target && (
        <>
          {fields.map((field) => {
            const record = answerFor(drill, drill.cursor, field);
            const spec = specFor(field, target.card, step.subIndex);
            if (!record || !spec) return null;
            return (
              <View key={field} style={styles.subBlock}>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                  {strings.actions.yourAnswer}
                </Text>
                <Text testID={`action-your-${field}`} style={[styles.body, { color: theme.textPrimary }]}>
                  {record.input}
                </Text>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                  {strings.actions.modelAnswer}
                </Text>
                <Text testID={`action-model-${field}`} style={[styles.body, { color: theme.textSecondary }]}>
                  {spec.model}
                </Text>
                <View
                  testID={`action-verdict-${field}`}
                  style={[
                    styles.verdict,
                    { backgroundColor: record.correct ? theme.accentSuccess : theme.accentWarning },
                  ]}
                />
                <View style={styles.selfGradeRow}>
                  <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                    {strings.actions.selfGradeLabel}
                  </Text>
                  <Pressable
                    testID={`action-self-correct-${field}`}
                    onPress={() => setDrill(setSelfGrade(drill, drill.cursor, field, true))}
                    style={[styles.gradeBtn, { borderColor: theme.accentSuccess }]}
                  >
                    <Text style={{ color: theme.accentSuccess }}>{strings.actions.selfGradeCorrect}</Text>
                  </Pressable>
                  <Pressable
                    testID={`action-self-wrong-${field}`}
                    onPress={() => setDrill(setSelfGrade(drill, drill.cursor, field, false))}
                    style={[styles.gradeBtn, { borderColor: theme.accentWarning }]}
                  >
                    <Text style={{ color: theme.accentWarning }}>{strings.actions.selfGradeWrong}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          <Pressable
            testID="action-next-question"
            onPress={() => goNextStep(drill)}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.actions.nextQuestion}</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  scenario: { fontSize: 13, lineHeight: 20, marginBottom: 12 },
  goal: { fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  sectionLabel: { fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 6 },
  cardTitle: { fontSize: 14, marginBottom: 6 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 },
  navItem: { fontSize: 14, fontWeight: '600' },
  navArrow: { fontSize: 14 },
  nRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 20 },
  nBtn: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 10, backgroundColor: '#1c1c1e' },
  nBtnText: { fontSize: 22 },
  nLabel: { fontSize: 14 },
  nValue: { fontSize: 26, fontWeight: 'bold', minWidth: 28, textAlign: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ordinal: { fontSize: 14, fontWeight: '600' },
  backTag: { fontSize: 13 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  readCard: { borderWidth: 1, borderRadius: 12, padding: 14 },
  checkDot: { position: 'absolute', top: 10, right: 10, width: 10, height: 10, borderRadius: 5 },
  subBlock: { marginTop: 12 },
  fieldLabel: { fontSize: 11, fontWeight: 'bold', marginBottom: 4, marginTop: 8 },
  body: { fontSize: 14, lineHeight: 21 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14, minHeight: 64 },
  verdict: { height: 6, borderRadius: 3, marginTop: 10 },
  selfGradeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  gradeBtn: { borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 16 },
  primaryBtn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 20, alignSelf: 'stretch' },
  primaryBtnText: { color: '#050810', fontWeight: 'bold', fontSize: 15 },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  secondaryBtnText: { fontSize: 14 },
  resultsTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 12 },
  resultLine: { fontSize: 15, marginBottom: 6 },
});
