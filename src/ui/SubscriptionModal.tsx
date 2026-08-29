import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { loadSettings, saveSettings, type SubscriptionTier, type ThemeVariety } from '../store/storage';
import { getTheme } from './theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  currentTier?: SubscriptionTier;
  themeVariety?: ThemeVariety;
  onTierChanged?: (newTier: SubscriptionTier) => void;
}

interface TierCopy {
  tier: SubscriptionTier;
  tabLabel: string;
  title: string;
  monthlyPrice: string;
  annualPrice: string;
  annualNote: string;
  description: string;
  selectLabel: string;
  activeLabel: string;
}

const TIERS: TierCopy[] = [
  {
    tier: 'free',
    tabLabel: 'Starter',
    title: 'Starter',
    monthlyPrice: '$0',
    annualPrice: '$0',
    annualNote: '',
    description: '自作問題不可・教材は1日3回まで。',
    selectLabel: 'このプランにする',
    activeLabel: '現在のプラン',
  },
  {
    tier: 'pro',
    tabLabel: 'Funds Finance Pro',
    title: 'Funds Finance Pro',
    monthlyPrice: '$10',
    annualPrice: '$5',
    annualNote: 'コーヒー一杯分',
    description: '解回数無制限・自作問題は最大5デッキ×3問まで。',
    selectLabel: 'このプランにする',
    activeLabel: '現在のプラン',
  },
  {
    tier: 'god',
    tabLabel: 'Funds Finance God',
    title: 'Funds Finance God',
    monthlyPrice: '$20',
    annualPrice: '$10',
    annualNote: '昼食一回分',
    description: '解回数無制限・自作問題は最大20デッキ×10問まで。',
    selectLabel: 'このプランにする',
    activeLabel: '現在のプラン',
  },
];

export function SubscriptionModal({
  visible,
  onClose,
  currentTier = 'free',
  themeVariety = 'terminal',
  onTierChanged,
}: Props) {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [activeTab, setActiveTab] = useState<SubscriptionTier>(currentTier);
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier>(currentTier);
  const theme = getTheme(themeVariety);

  const handleSelectPlan = async (tier: SubscriptionTier) => {
    setSelectedTier(tier);
    const settings = await loadSettings();
    await saveSettings({ ...settings, subscriptionTier: tier });
    if (onTierChanged) onTierChanged(tier);
  };

  if (!visible) return null;

  const active = TIERS.find((t) => t.tier === activeTab)!;
  const price =
    active.tier === 'free' ? active.monthlyPrice : billingCycle === 'annual' ? active.annualPrice : active.monthlyPrice;

  return (
    <View style={[styles.overlay, { backgroundColor: 'rgba(5, 8, 17, 0.85)' }]}>
      <View
        style={[
          styles.modalContainer,
          { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
        ]}
      >
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>
            Financial Pro Membership
          </Text>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeButton,
              { backgroundColor: theme.bg },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.closeText, { color: theme.textSecondary }]}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.tabRow}>
          {TIERS.map((t) => (
            <Pressable
              key={t.tier}
              onPress={() => setActiveTab(t.tier)}
              style={[
                styles.tab,
                {
                  backgroundColor: activeTab === t.tier ? theme.accentGold : theme.bg,
                  borderColor: theme.cardBorder,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: activeTab === t.tier ? '#000' : theme.textPrimary },
                ]}
              >
                {t.tabLabel}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView style={styles.content}>
          <View
            style={[
              styles.tierCard,
              { backgroundColor: theme.bg, borderColor: theme.cardBorder },
            ]}
          >
            <Text style={[styles.tierTitle, { color: theme.textPrimary }]}>{active.title}</Text>

            {active.tier !== 'free' && (
              <View style={[styles.cycleContainer, { backgroundColor: theme.cardBg }]}>
                <Pressable
                  onPress={() => setBillingCycle('annual')}
                  style={[
                    styles.cycleTab,
                    billingCycle === 'annual' && { backgroundColor: theme.badgeBg },
                  ]}
                >
                  <Text
                    style={[
                      styles.cycleText,
                      { color: billingCycle === 'annual' ? theme.accentGold : theme.textMuted },
                    ]}
                  >
                    年間
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setBillingCycle('monthly')}
                  style={[
                    styles.cycleTab,
                    billingCycle === 'monthly' && { backgroundColor: theme.badgeBg },
                  ]}
                >
                  <Text
                    style={[
                      styles.cycleText,
                      { color: billingCycle === 'monthly' ? theme.accentGold : theme.textMuted },
                    ]}
                  >
                    月額
                  </Text>
                </Pressable>
              </View>
            )}

            <View style={styles.priceRow}>
              <Text style={[styles.price, { color: theme.accentGold }]}>{price}</Text>
              <Text style={[styles.priceUnit, { color: theme.textSecondary }]}>/ month</Text>
            </View>
            {active.tier !== 'free' && billingCycle === 'annual' && (
              <Text style={[styles.annualNote, { color: theme.textMuted }]}>
                {active.annualNote}
              </Text>
            )}

            <Text style={[styles.tierDesc, { color: theme.textSecondary }]}>
              {active.description}
            </Text>

            <Pressable
              onPress={() => void handleSelectPlan(active.tier)}
              style={[
                styles.planButton,
                {
                  backgroundColor:
                    selectedTier === active.tier ? theme.cardBorder : theme.accentGold,
                },
              ]}
            >
              <Text style={[styles.planButtonText, { color: '#000', fontWeight: 'bold' }]}>
                {selectedTier === active.tier ? active.activeLabel : active.selectLabel}
              </Text>
            </Pressable>
          </View>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: theme.cardBorder }]}>
          <Text style={[styles.footerNote, { color: theme.textMuted }]}>
            🔒 Secure SSL Encrypted. Cancel or modify subscription anytime.
          </Text>
          <Pressable onPress={onClose} style={styles.doneButton}>
            <Text style={[styles.doneText, { color: theme.accentPrimary }]}>Done</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    zIndex: 100,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: 'bold',
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  tabRow: {
    flexDirection: 'row',
    gap: 6,
    padding: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  content: {
    paddingHorizontal: 16,
  },
  tierCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 18,
    marginBottom: 16,
  },
  tierTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  cycleContainer: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 3,
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  cycleTab: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  cycleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  price: {
    fontSize: 30,
    fontWeight: 'bold',
  },
  priceUnit: {
    fontSize: 13,
    marginLeft: 6,
  },
  annualNote: {
    fontSize: 12,
    marginTop: 2,
  },
  tierDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
    marginBottom: 14,
  },
  planButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  planButtonText: {
    fontSize: 14,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderTopWidth: 1,
  },
  footerNote: {
    fontSize: 11,
    flex: 1,
  },
  doneButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  doneText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
