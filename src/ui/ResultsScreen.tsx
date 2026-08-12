import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RoundEngine } from '../engine';

interface Props {
  engine: RoundEngine;
  n: number;
  onAgain: () => void;
}

function pct(v: number | null): string {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

export function ResultsScreen({ engine, n, onAgain }: Props) {
  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>{n}-back の結果</Text>
      <Text style={styles.row}>位置　{pct(engine.positionScore)}</Text>
      <Text style={styles.row}>回答　{pct(engine.answerScore)}</Text>
      {engine.unresolvedCount > 0 && (
        <Text style={styles.note}>未判定 {engine.unresolvedCount} 件</Text>
      )}
      <Text style={styles.row}>総合　{pct(engine.roundScore)}</Text>
      <Pressable style={styles.button} onPress={onAgain}>
        <Text style={styles.buttonLabel}>もう一度</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 32, backgroundColor: '#000' },
  heading: { color: '#f4f1ea', fontSize: 28, marginBottom: 24 },
  row: { color: '#f4f1ea', fontSize: 20, marginBottom: 8 },
  note: { color: '#c96f4a', fontSize: 16, marginBottom: 8 },
  button: {
    marginTop: 32,
    padding: 16,
    backgroundColor: '#c96f4a',
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonLabel: { color: '#fff', fontSize: 18 },
});
