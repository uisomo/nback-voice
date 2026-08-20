import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RoundEngine } from '../engine';
import type { AnswerReview } from '../engine/round';

interface Props {
  engine: RoundEngine;
  n: number;
  onAgain: () => void;
  onChangeSeries: () => void;
}

const CORRECT = '#4caf7d';
const WRONG = '#e5534b';
const NEUTRAL = '#8e8e93';

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

/** Green only for a verdict of correct: 未判定 and 聞き取れず are not failures. */
function answerColor(row: AnswerReview): string {
  if (row.transcript === null || row.correct === null) return NEUTRAL;
  return row.correct ? CORRECT : WRONG;
}

function verdictLabel(row: AnswerReview): string {
  if (row.transcript === null) return '—';
  if (row.correct === null) return '未判定';
  return row.correct ? '○' : '×';
}

function positionMark(row: AnswerReview): { label: string; color: string } {
  if (row.position === 'correct') return { label: '位置 ○', color: CORRECT };
  if (row.position === 'wrong') return { label: '位置 ×', color: WRONG };
  return { label: '位置 —', color: NEUTRAL };
}

export function ResultsScreen({ engine, n, onAgain, onChangeSeries }: Props) {
  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>{n}-back の結果</Text>
      <Text style={styles.lag}>{n}つ前の質問に答えるラウンド</Text>
      <Text style={styles.row}>位置　{pct(engine.positionScore)}</Text>
      <Text style={styles.row}>回答　{pct(engine.answerScore)}</Text>
      {engine.onTimeScore !== null && (
        <Text style={styles.row}>時間内　{pct(engine.onTimeScore)}</Text>
      )}
      {engine.unresolvedCount > 0 && (
        <Text style={styles.note}>未判定 {engine.unresolvedCount} 件</Text>
      )}
      <Text style={styles.row}>総合　{pct(engine.roundScore)}</Text>

      <ScrollView style={styles.list}>
        {engine.review.map((item) => {
          const position = positionMark(item);
          return (
            <View
              key={item.index}
              testID={`review-row-${item.index}`}
              style={styles.item}
            >
              <Text style={styles.question}>{item.question.q}</Text>
              <View style={styles.itemRow}>
                <Text
                  testID={`review-heard-${item.index}`}
                  style={[styles.heard, { color: answerColor(item) }]}
                >
                  {item.transcript === null
                    ? '（聞き取れず）'
                    : `「${item.transcript}」`}
                </Text>
                <Text
                  testID={`review-verdict-${item.index}`}
                  style={[styles.verdict, { color: answerColor(item) }]}
                >
                  {verdictLabel(item)}
                </Text>
                {item.position !== null && (
                  <Text
                    testID={`review-position-${item.index}`}
                    style={[styles.position, { color: position.color }]}
                  >
                    {position.label}
                  </Text>
                )}
              </View>
              {/*
                accept[0] only. The rest of the list is recognizer tolerance
                plus what the judge learned at runtime — those exist so your
                phrasing passes, and they grow as you play. They are not the
                answer.
              */}
              {item.question.accept[0] !== undefined && (
                <Text
                  testID={`review-answer-${item.index}`}
                  style={styles.answerLabel}
                >
                  答え: <Text style={styles.answerValue}>{item.question.accept[0]}</Text>
                </Text>
              )}
              {item.onTime === false && (
                <Text testID={`review-late-${item.index}`} style={styles.late}>
                  時間超過（目安 {(item.budgetMs / 1000).toFixed(0)}s）
                </Text>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.buttons}>
        <Pressable style={styles.button} onPress={onAgain}>
          <Text style={styles.buttonLabel}>もう一度</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={onChangeSeries}>
          <Text style={styles.buttonLabel}>シリーズを変える</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 32, backgroundColor: '#000' },
  heading: { color: '#f4f1ea', fontSize: 28, marginBottom: 4 },
  lag: { color: '#c96f4a', fontSize: 15, marginBottom: 20 },
  row: { color: '#f4f1ea', fontSize: 20, marginBottom: 8 },
  note: { color: '#c96f4a', fontSize: 16, marginBottom: 8 },
  list: { flexGrow: 0, marginTop: 16, marginBottom: 8 },
  item: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1c1c1e' },
  question: { color: '#8e8e93', fontSize: 14 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  heard: { fontSize: 17, flexShrink: 1 },
  verdict: { fontSize: 17 },
  position: { fontSize: 14, marginLeft: 'auto' },
  answerLabel: { color: '#8e8e93', fontSize: 14, marginTop: 3 },
  answerValue: { color: '#f4f1ea' },
  late: { color: '#e5534b', fontSize: 13, marginTop: 2 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 24 },
  button: {
    flex: 1,
    padding: 16,
    backgroundColor: '#c96f4a',
    borderRadius: 12,
    alignItems: 'center',
  },
  secondary: {
    flex: 1,
    padding: 16,
    backgroundColor: '#1c1c1e',
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonLabel: { color: '#fff', fontSize: 18 },
});
