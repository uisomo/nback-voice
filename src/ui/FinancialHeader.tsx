import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FUNDS_FINANCE_CATEGORIES, type FundsFinanceCategory } from '../content/series';
import { isDemoBuild } from '../store/storage';
import type { SubscriptionTier, ThemeVariety } from '../store/storage';
import { getTheme } from './theme';

interface Props {
  subscriptionTier: SubscriptionTier;
  themeVariety: ThemeVariety;
  selectedCategory: string;
  onSelectCategory: (catId: string) => void;
  onSelectTheme: (theme: ThemeVariety) => void;
  onOpenSubscription: () => void;
  onOpenSettings: () => void;
}

export function FinancialHeader({
  subscriptionTier,
  themeVariety,
  selectedCategory,
  onSelectCategory,
  onOpenSubscription,
}: Props) {
  const theme = getTheme(themeVariety);

  return (
    <View style={[styles.container, { backgroundColor: theme.headerBg, borderBottomColor: theme.cardBorder }]}>
      {/* App Brand Header */}
      <View style={styles.topRow}>
        <View style={styles.brandContainer}>
          <Text style={[styles.logoText, { color: theme.accentGold }]}>FUNDS FINANCE</Text>
          <View style={[styles.proBadge, { backgroundColor: theme.accentGold }]}>
            <Text style={styles.proBadgeText}>PRO</Text>
          </View>
          {/* Two deploys that look identical are a trap: the demo lifts the
              daily cap, so "why is the limit not working" has to be answerable
              from the screen rather than from the URL. */}
          {isDemoBuild() && (
            <View testID="demo-badge" style={styles.demoBadge}>
              <Text style={styles.demoBadgeText}>DEMO</Text>
            </View>
          )}
        </View>

        {/* Subscription Pro Badge */}
        <Pressable
          onPress={onOpenSubscription}
          style={({ pressed }) => [
            styles.subButton,
            {
              backgroundColor: theme.badgeBg,
              borderColor: theme.accentGold,
            },
            pressed && { opacity: 0.8 },
          ]}
        >
          <Text style={[styles.subButtonText, { color: theme.accentGold }]}>
            {subscriptionTier === 'free' ? 'FREE TIER' : '👑 PRO MEMBER'}
          </Text>
        </Pressable>
      </View>

      {/* Funds Finance Categories Grid / Tabs (No finger side sliders, clean touch buttons) */}
      <View style={styles.categoriesGrid}>
        <Pressable
          onPress={() => onSelectCategory('all')}
          style={[
            styles.catButton,
            {
              backgroundColor: selectedCategory === 'all' ? theme.accentPrimary : theme.cardBg,
              borderColor: selectedCategory === 'all' ? theme.accentPrimary : theme.cardBorder,
            },
          ]}
        >
          <Text
            style={[
              styles.catButtonText,
              { color: selectedCategory === 'all' ? '#000' : theme.textPrimary },
            ]}
          >
            All Decks
          </Text>
        </Pressable>

        {FUNDS_FINANCE_CATEGORIES.map((cat: FundsFinanceCategory) => {
          const isSelected = selectedCategory === cat.id;
          return (
            <Pressable
              key={cat.id}
              onPress={() => onSelectCategory(cat.id)}
              style={[
                styles.catButton,
                {
                  backgroundColor: isSelected ? theme.accentPrimary : theme.cardBg,
                  borderColor: isSelected ? theme.accentPrimary : theme.cardBorder,
                },
              ]}
            >
              <Text style={styles.catIcon}>{cat.icon}</Text>
              <Text
                style={[
                  styles.catButtonText,
                  { color: isSelected ? '#000' : theme.textPrimary },
                ]}
              >
                {cat.nameEn.split('&')[0].trim()}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  logoText: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  proBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  demoBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: '#e5534b',
  },
  demoBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
  },
  proBadgeText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '900',
  },
  subButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  subButtonText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  catButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  catIcon: {
    fontSize: 12,
  },
  catButtonText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
