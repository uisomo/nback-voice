import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { groupSeries, listSeries, type CategoryGroup } from '../content/series';
import { MIN_QUESTIONS } from '../content/pool';
import {
  loadCustom,
  loadCustomDecks,
  loadHistory,
  loadLearned,
  loadN,
  loadSettings,
  saveSettings,
  type RoundRecord,
  type Settings,
  type SubscriptionTier,
  type ThemeVariety,
} from '../store/storage';
import { useStrings } from '../strings';
import { FinancialHeader } from './FinancialHeader';
import { SubscriptionModal } from './SubscriptionModal';
import { getTheme } from './theme';

interface Props {
  onSelect: (seriesId: string) => void;
  onOpenSettings: () => void;
}

interface Row {
  id: string;
  title: string;
  credit?: string;
  count: number;
  n: number;
  fundsCategory?: string;
  masteryPct: number;
}

/**
 * The combined score of the most recent round played on this series, as a
 * percent. A null channel (question mode has no position channel) is
 * excluded from the average rather than counted as zero — same rule the
 * engine itself uses when scoring a round. 0 when the series has never
 * been played.
 */
function lastRoundMasteryPct(seriesId: string, history: RoundRecord[]): number {
  const record = [...history].reverse().find((r) => r.seriesId === seriesId);
  if (!record) return 0;
  const channels = [record.positionScore, record.answerScore].filter(
    (score): score is number => score !== null,
  );
  if (channels.length === 0) return 0;
  const average = channels.reduce((sum, s) => sum + s, 0) / channels.length;
  return Math.round(average * 100);
}

interface Group {
  id: string;
  label: string;
  rows: Row[];
}

export function SeriesScreen({ onSelect, onOpenSettings }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [subModalOpen, setSubModalOpen] = useState(false);
  const strings = useStrings();

  const loadAll = async () => {
    const [s, custom, learned, customDecks, history] = await Promise.all([
      loadSettings(),
      loadCustom(),
      loadLearned(),
      loadCustomDecks(),
      loadHistory(),
    ]);
    setSettingsState(s);

    const all = listSeries({
      custom,
      learned,
      maxTier: s.maxTier,
      language: s.language,
      customDecks,
    });
    const withLag = await Promise.all(
      groupSeries(all, s.language).map(async (group: CategoryGroup) => ({
        id: group.id,
        label: group.label,
        rows: await Promise.all(
          group.series.map(async (series) => ({
            id: series.id,
            title: series.title,
            credit: series.credit,
            count: series.questions.length,
            n: await loadN(series.id),
            fundsCategory: series.fundsCategory,
            masteryPct: lastRoundMasteryPct(series.id, history),
          })),
        ),
      })),
    );
    setGroups(withLag);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadAll();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectTheme = async (variety: ThemeVariety) => {
    if (!settings) return;
    const next = { ...settings, themeVariety: variety };
    setSettingsState(next);
    await saveSettings(next);
  };

  const handleSelectCategory = async (catId: string) => {
    if (!settings) return;
    const next = { ...settings, selectedCategory: catId };
    setSettingsState(next);
    await saveSettings(next);
  };

  const handleTierChanged = (newTier: SubscriptionTier) => {
    if (!settings) return;
    setSettingsState({ ...settings, subscriptionTier: newTier });
  };

  const themeVariety = settings?.themeVariety || 'terminal';
  const subscriptionTier = settings?.subscriptionTier || 'pro';
  const selectedCat = settings?.selectedCategory || 'all';
  const theme = getTheme(themeVariety);

  // Only rows tagged with a funds-finance category (custom decks) are
  // filterable; authored/standard/custom series have no such tag and stay
  // visible regardless of which chip is selected.
  const visibleGroups =
    selectedCat === 'all'
      ? groups
      : groups
          .map((group) => ({
            ...group,
            rows: group.rows.filter(
              (row) => !row.fundsCategory || row.fundsCategory === selectedCat,
            ),
          }))
          .filter((group) => group.rows.length > 0);

  return (
    <View style={[styles.screen, { backgroundColor: theme.bg }]}>
      {/* Top Professional Financial Header */}
      <FinancialHeader
        subscriptionTier={subscriptionTier}
        themeVariety={themeVariety}
        selectedCategory={selectedCat}
        onSelectCategory={(id) => void handleSelectCategory(id)}
        onSelectTheme={(t) => void handleSelectTheme(t)}
        onOpenSubscription={() => setSubModalOpen(true)}
        onOpenSettings={onOpenSettings}
      />

      {/* Main Title Row */}
      <View style={[styles.header, { borderColor: theme.cardBorder }]}>
        <View>
          <Text style={[styles.heading, { color: theme.textPrimary }]}>
            {strings.series.heading}
          </Text>
          <Text style={[styles.subheading, { color: theme.textSecondary }]}>
            Financial Professional Flashcard & Voice N-Back Decks
          </Text>
        </View>
      </View>

      {/* Series Cards List */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {visibleGroups.map((group) => (
          <View key={group.id} style={styles.group}>
            <View style={styles.categoryHeader}>
              <View style={[styles.categoryBadge, { backgroundColor: theme.badgeBg }]}>
                <Text style={[styles.categoryBadgeText, { color: theme.accentGold }]}>
                  TRACK
                </Text>
              </View>
              <Text style={[styles.category, { color: theme.accentGold }]}>
                {group.label}
              </Text>
            </View>

            <View style={styles.deckCardsGrid}>
              {group.rows.map((row) => {
                const shortfall = MIN_QUESTIONS - row.count;
                const usable = shortfall <= 0;

                return (
                  <Pressable
                    key={row.id}
                    testID={`series-${row.id}`}
                    onPress={() => usable && onSelect(row.id)}
                    style={({ pressed }) => [
                      styles.deckCard,
                      {
                        backgroundColor: theme.cardBg,
                        borderColor: theme.cardBorder,
                      },
                      !usable && styles.rowOff,
                      pressed && usable && { transform: [{ scale: 0.99 }] },
                    ]}
                  >
                    <View style={styles.deckCardHeader}>
                      <Text style={[styles.title, { color: theme.textPrimary }]}>
                        {row.title}
                      </Text>
                    </View>

                    {row.credit && (
                      <Text style={[styles.credit, { color: theme.textSecondary }]}>
                        {row.credit}
                      </Text>
                    )}

                    {/* Progress Bar: most recent round's score on this series */}
                    <View style={styles.progressContainer}>
                      <View style={[styles.progressTrack, { backgroundColor: theme.bg }]}>
                        <View
                          style={[
                            styles.progressFill,
                            {
                              width: `${row.masteryPct}%`,
                              backgroundColor: theme.accentSuccess,
                            },
                          ]}
                        />
                      </View>
                      <Text
                        testID={`series-progress-${row.id}`}
                        style={[styles.progressText, { color: theme.textMuted }]}
                      >
                        {row.masteryPct}% Mastered
                      </Text>
                    </View>

                    {/* Card Meta Row */}
                    <View style={styles.meta}>
                      <Text
                        testID={`series-count-${row.id}`}
                        style={[styles.count, { color: theme.textSecondary }]}
                      >
                        {usable
                          ? strings.series.count(row.count)
                          : strings.series.shortfall(shortfall)}
                      </Text>

                      {usable && (
                        <View
                          style={[
                            styles.lagPill,
                            { backgroundColor: theme.badgeBg, borderColor: theme.accentGold },
                          ]}
                        >
                          <Text
                            testID={`series-lag-${row.id}`}
                            style={[styles.lag, { color: theme.accentGold }]}
                          >
                            {strings.series.lag(row.n)}
                          </Text>
                        </View>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Subscription Modal Component */}
      <SubscriptionModal
        visible={subModalOpen}
        onClose={() => setSubModalOpen(false)}
        currentTier={subscriptionTier}
        themeVariety={themeVariety}
        onTierChanged={handleTierChanged}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  heading: { fontSize: 24, fontWeight: 'bold' },
  subheading: { fontSize: 12, marginTop: 2 },
  scrollContent: { padding: 20 },
  group: { marginBottom: 28 },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  categoryBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  categoryBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  category: { fontSize: 15, fontWeight: 'bold' },
  deckCardsGrid: { gap: 12 },
  deckCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  rowOff: { opacity: 0.4 },
  deckCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  title: { fontSize: 17, fontWeight: 'bold', flex: 1 },
  credit: { fontSize: 12, marginTop: 4 },
  progressContainer: {
    marginVertical: 12,
    gap: 4,
  },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressText: {
    fontSize: 10,
    alignSelf: 'flex-end',
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  count: { fontSize: 13, fontWeight: '500' },
  lagPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  lag: { fontSize: 12, fontWeight: 'bold' },
});
