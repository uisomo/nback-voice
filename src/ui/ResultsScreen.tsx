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

const ASCII_TERM = /^[A-Za-z0-9&.\-+ ]+$/;
/** A short token with no space — MFN, NAV, LPA — as opposed to its expansion. */
const ASCII_ABBREVIATION = /^[A-Za-z0-9&.\-]+$/;
/** Marks a term as an actual Japanese equivalent, not a katakana reading. */
const KANJI = /[一-龯]/;

/**
 * accept[0] is the canonical answer; the rest is recognizer tolerance plus
 * whatever the judge learned at runtime, not the answer. Three exceptions are
 * worth surfacing alongside accept[0], because together they are the answer
 * to "what does this abbreviation mean" rather than just "what do I say":
 * the English abbreviation itself (e.g. MFN), the full name it expands to
 * (e.g. Most Favored Nation), and — when accept[0] is not already Japanese —
 * a Japanese form. Plain English terms with no abbreviation (Side Letter,
 * Bridge) have nothing to expand, so only the parts that exist are shown.
 */
interface AnswerForms {
  abbreviation: string | null;
  expansion: string | null;
  japanese: string | null;
}

function answerForms(accept: string[]): AnswerForms {
  const [canonical, ...rest] = accept;
  const canonicalIsAscii = canonical !== undefined && ASCII_TERM.test(canonical);
  const canonicalIsAbbreviation =
    canonicalIsAscii && ASCII_ABBREVIATION.test(canonical);

  // The abbreviation is accept[0] itself when that is already a short ASCII
  // token; otherwise look for one in the rest of the list.
  const abbreviation = canonicalIsAbbreviation
    ? canonical
    : (rest.find((term) => ASCII_ABBREVIATION.test(term)) ?? null);

  // The expansion is any other ASCII term that is NOT the abbreviation
  // itself — i.e. it has a space (or is simply longer), which is what marks
  // it as the spelled-out name rather than another rendering of the acronym.
  const expansion =
    [canonical, ...rest].find(
      (term) =>
        term !== abbreviation &&
        ASCII_TERM.test(term) &&
        !ASCII_ABBREVIATION.test(term),
    ) ?? null;

  // Japanese only needs surfacing when accept[0] is not already Japanese —
  // otherwise accept[0] itself on screen already is the Japanese form. A pure
  // katakana reading of the English (e.g. エヌエーブイ for NAV) is how to say
  // the English word, not a translation of it — kanji is what marks a term
  // as an actual Japanese equivalent, so that is preferred when both exist.
  const japaneseCandidates = canonicalIsAscii
    ? rest.filter((term) => !ASCII_TERM.test(term))
    : [];
  const japanese =
    japaneseCandidates.find((term) => KANJI.test(term)) ??
    japaneseCandidates[0] ??
    null;

  return { abbreviation, expansion, japanese };
}

/**
 * The line shown under a review row: accept[0], plus whichever of the
 * abbreviation/expansion/Japanese forms are not already accept[0] and exist —
 * e.g. "MFN（Most Favored Nation）/ 最恵国優遇条項" for a JP canonical answer,
 * or "最恵国優遇条項" alone with nothing appended when there is nothing to add.
 */
function answerDisplay(question: { accept: string[] }): string {
  const [canonical] = question.accept;
  if (canonical === undefined) return '';
  const { abbreviation, expansion, japanese } = answerForms(question.accept);

  const canonicalIsAbbreviation = canonical === abbreviation;
  const parenParts = [
    // accept[0] already covers whichever of abbreviation/japanese it equals.
    canonicalIsAbbreviation ? null : abbreviation,
    expansion,
  ].filter((part): part is string => part !== null);

  let out = canonical;
  if (parenParts.length > 0) out += `（${parenParts.join(' / ')}）`;
  if (japanese !== null && japanese !== canonical) out += `　/　${japanese}`;
  return out;
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
              {item.question.accept[0] !== undefined && (
                <Text
                  testID={`review-answer-${item.index}`}
                  style={styles.answerLabel}
                >
                  答え:{' '}
                  <Text style={styles.answerValue}>
                    {answerDisplay(item.question)}
                  </Text>
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
