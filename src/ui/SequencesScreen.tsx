import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { sequencesByProduct, type Product } from '../actions/actions';
import { FUNDS_FINANCE_CATEGORIES } from '../content/series';
import { useStrings } from '../strings';
import { getTheme } from './theme';

function iconFor(product: Product): string {
  return FUNDS_FINANCE_CATEGORIES.find((c) => c.id === product)?.icon ?? '🎯';
}

export function SequencesScreen({ onSelect }: { onSelect: (sequenceId: string) => void }) {
  const strings = useStrings();
  const theme = getTheme();
  const groups = sequencesByProduct();

  return (
    <ScrollView style={[styles.root, { backgroundColor: theme.bg }]} contentContainerStyle={styles.content}>
      {groups.map((group) => (
        <View key={group.product} style={styles.group}>
          <Text style={[styles.groupLabel, { color: theme.accentGold }]}>
            {iconFor(group.product)} {strings.actions.productLabel(group.product)}
          </Text>
          {group.sequences.map((s) => (
            <Pressable
              key={s.id}
              testID={`seq-${s.id}`}
              onPress={() => onSelect(s.id)}
              style={[styles.row, { borderColor: theme.cardBorder }]}
            >
              <Text style={[styles.goal, { color: theme.textPrimary }]}>{s.goal}</Text>
              <Text style={[styles.credit, { color: theme.textMuted }]}>{s.credit}</Text>
              <Text testID={`seq-count-${s.id}`} style={[styles.count, { color: theme.textMuted }]}>
                {s.cards.length}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16 },
  group: { marginBottom: 24 },
  groupLabel: { fontSize: 14, fontWeight: 'bold', marginBottom: 8 },
  row: { borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 10 },
  goal: { fontSize: 16, fontWeight: '600' },
  credit: { fontSize: 12, marginTop: 4 },
  count: { fontSize: 12, marginTop: 6 },
});
