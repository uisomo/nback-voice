import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { groupSeries, listSeries, type CategoryGroup } from '../content/series';
import { MIN_QUESTIONS } from '../content/pool';
import { loadCustom, loadLearned, loadN, loadSettings } from '../store/storage';

interface Props {
  onSelect: (seriesId: string) => void;
  onOpenSettings: () => void;
}

interface Row {
  id: string;
  title: string;
  credit?: string;
  count: number;
  /** The lag this series is currently at, kept per series. */
  n: number;
}

interface Group {
  id: string;
  label: string;
  rows: Row[];
}

export function SeriesScreen({ onSelect, onOpenSettings }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [settings, custom, learned] = await Promise.all([
        loadSettings(),
        loadCustom(),
        loadLearned(),
      ]);
      const all = listSeries({ custom, learned, maxTier: settings.maxTier });
      const withLag = await Promise.all(
        groupSeries(all).map(async (group: CategoryGroup) => ({
          id: group.id,
          label: group.label,
          rows: await Promise.all(
            group.series.map(async (series) => ({
              id: series.id,
              title: series.title,
              credit: series.credit,
              count: series.questions.length,
              n: await loadN(series.id),
            })),
          ),
        })),
      );
      if (!cancelled) setGroups(withLag);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.heading}>シリーズを選ぶ</Text>
        <Pressable onPress={onOpenSettings}>
          <Text style={styles.settings}>設定</Text>
        </Pressable>
      </View>

      <ScrollView>
        {groups.map((group) => (
          <View key={group.id} style={styles.group}>
            <Text style={styles.category}>{group.label}</Text>
            {group.rows.map((row) => {
              const shortfall = MIN_QUESTIONS - row.count;
              const usable = shortfall <= 0;
              return (
                <Pressable
                  key={row.id}
                  testID={`series-${row.id}`}
                  onPress={() => usable && onSelect(row.id)}
                  style={[styles.row, !usable && styles.rowOff]}
                >
                  <Text style={styles.title}>{row.title}</Text>
                  {row.credit && <Text style={styles.credit}>{row.credit}</Text>}
                  <View style={styles.meta}>
                    <Text testID={`series-count-${row.id}`} style={styles.count}>
                      {usable ? `${row.count}問` : `あと ${shortfall} 問`}
                    </Text>
                    {usable && (
                      <Text testID={`series-lag-${row.id}`} style={styles.lag}>
                        {row.n}-back
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, paddingTop: 72, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  heading: { color: '#f4f1ea', fontSize: 28 },
  settings: { color: '#8e8e93', fontSize: 16 },
  group: { marginBottom: 28 },
  category: { color: '#c96f4a', fontSize: 14, marginBottom: 10 },
  row: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  rowOff: { opacity: 0.4 },
  title: { color: '#f4f1ea', fontSize: 18 },
  credit: { color: '#8e8e93', fontSize: 12, marginTop: 2 },
  meta: { flexDirection: 'row', gap: 12, marginTop: 4 },
  count: { color: '#8e8e93', fontSize: 14 },
  lag: { color: '#8e8e93', fontSize: 14, marginLeft: 'auto' },
});
