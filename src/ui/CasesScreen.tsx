import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { casesByProduct, type Product } from '../cases/cases';
import { FUNDS_FINANCE_CATEGORIES } from '../content/series';
import { useStrings } from '../strings';
import { getTheme } from './theme';

function iconFor(product: Product): string {
  return FUNDS_FINANCE_CATEGORIES.find((c) => c.id === product)?.icon ?? '💼';
}

export function CasesScreen({ onSelect }: { onSelect: (caseId: string) => void }) {
  const strings = useStrings();
  const theme = getTheme();
  const groups = casesByProduct();

  return (
    <ScrollView style={[styles.root, { backgroundColor: theme.bg }]} contentContainerStyle={styles.content}>
      {groups.map((group) => (
        <View key={group.product} style={styles.group}>
          <Text style={[styles.groupLabel, { color: theme.accentGold }]}>
            {iconFor(group.product)} {strings.cases.productLabel(group.product)}
          </Text>
          {group.cases.map((c) => (
            <Pressable
              key={c.id}
              testID={`case-${c.id}`}
              onPress={() => onSelect(c.id)}
              style={[styles.row, { borderColor: theme.cardBorder }]}
            >
              <Text style={[styles.title, { color: theme.textPrimary }]}>{c.title}</Text>
              <Text style={[styles.credit, { color: theme.textMuted }]}>{c.credit}</Text>
              <Text testID={`case-count-${c.id}`} style={[styles.count, { color: theme.textMuted }]}>
                {c.conversation.length}
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
  title: { fontSize: 16, fontWeight: '600' },
  credit: { fontSize: 12, marginTop: 4 },
  count: { fontSize: 12, marginTop: 6 },
});
