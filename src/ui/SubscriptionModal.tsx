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

export function SubscriptionModal({
  visible,
  onClose,
  currentTier = 'pro',
  themeVariety = 'terminal',
  onTierChanged,
}: Props) {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier>(currentTier);
  const theme = getTheme(themeVariety);

  const handleSelectPlan = async (tier: SubscriptionTier) => {
    setSelectedTier(tier);
    const settings = await loadSettings();
    await saveSettings({ ...settings, subscriptionTier: tier });
    if (onTierChanged) onTierChanged(tier);
  };

  if (!visible) return null;

  return (
    <View style={[styles.overlay, { backgroundColor: 'rgba(5, 8, 17, 0.85)' }]}>
      <View
        style={[
          styles.modalContainer,
          { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTextGroup}>
            <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>
              Financial Pro Membership
            </Text>
            <Text style={[styles.headerSub, { color: theme.textSecondary }]}>
              Unlock all specialized financial flashcard tracks & Voice N-Back AI
            </Text>
          </View>
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

        {/* Billing Cycle Toggle */}
        <View style={[styles.cycleContainer, { backgroundColor: theme.bg }]}>
          <Pressable
            onPress={() => setBillingCycle('monthly')}
            style={[
              styles.cycleTab,
              billingCycle === 'monthly' && { backgroundColor: theme.cardBg },
            ]}
          >
            <Text
              style={[
                styles.cycleText,
                {
                  color:
                    billingCycle === 'monthly' ? theme.accentPrimary : theme.textMuted,
                },
              ]}
            >
              Monthly Billing
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setBillingCycle('annual')}
            style={[
              styles.cycleTab,
              billingCycle === 'annual' && { backgroundColor: theme.cardBg },
            ]}
          >
            <Text
              style={[
                styles.cycleText,
                {
                  color:
                    billingCycle === 'annual' ? theme.accentGold : theme.textMuted,
                },
              ]}
            >
              Annual Billing 🔥 (Save 20%)
            </Text>
          </Pressable>
        </View>

        <ScrollView style={styles.content}>
          {/* Tier Cards Grid */}
          <View style={styles.tiersGrid}>
            {/* Free Starter Tier */}
            <View
              style={[
                styles.tierCard,
                { backgroundColor: theme.bg, borderColor: theme.cardBorder },
                selectedTier === 'free' && { borderColor: theme.textMuted, borderWidth: 2 },
              ]}
            >
              <Text style={[styles.tierBadge, { color: theme.textMuted }]}>
                BASIC ACCESS
              </Text>
              <Text style={[styles.tierTitle, { color: theme.textPrimary }]}>
                Starter Desk
              </Text>
              <View style={styles.priceRow}>
                <Text style={[styles.price, { color: theme.textPrimary }]}>$0</Text>
                <Text style={[styles.priceUnit, { color: theme.textMuted }]}>/ forever</Text>
              </View>
              <Text style={[styles.tierDesc, { color: theme.textSecondary }]}>
                Essential financial flashcards & 1-back N-Back practice.
              </Text>
              <Pressable
                onPress={() => void handleSelectPlan('free')}
                style={[
                  styles.planButton,
                  {
                    backgroundColor:
                      selectedTier === 'free' ? theme.cardBorder : 'transparent',
                    borderColor: theme.cardBorder,
                    borderWidth: 1,
                  },
                ]}
              >
                <Text style={[styles.planButtonText, { color: theme.textPrimary }]}>
                  {selectedTier === 'free' ? 'Current Plan' : 'Select Free'}
                </Text>
              </Pressable>
            </View>

            {/* Wall Street Pro Tier (Featured) */}
            <View
              style={[
                styles.tierCard,
                styles.featuredCard,
                { backgroundColor: theme.badgeBg, borderColor: theme.accentGold },
              ]}
            >
              <View style={[styles.popularTag, { backgroundColor: theme.accentGold }]}>
                <Text style={styles.popularTagText}>MOST POPULAR FOR PROS</Text>
              </View>
              <Text style={[styles.tierTitle, { color: theme.textPrimary }]}>
                Wall Street Pro
              </Text>
              <View style={styles.priceRow}>
                <Text style={[styles.price, { color: theme.accentGold }]}>
                  {billingCycle === 'annual' ? '$19.99' : '$29.99'}
                </Text>
                <Text style={[styles.priceUnit, { color: theme.textSecondary }]}>/ month</Text>
              </View>
              <Text style={[styles.tierDesc, { color: theme.textSecondary }]}>
                Full access to all 7 Financial Persona tracks, Unlimited Voice N-Back AI & Speech Judge.
              </Text>

              <View style={styles.featureList}>
                <Text style={[styles.featureItem, { color: theme.textPrimary }]}>
                  ✓ All 7 Financial Persona Decks
                </Text>
                <Text style={[styles.featureItem, { color: theme.textPrimary }]}>
                  ✓ Unlimited AI Speech Recognition
                </Text>
                <Text style={[styles.featureItem, { color: theme.textPrimary }]}>
                  ✓ Adaptive N-Back Lag (Up to 5-back)
                </Text>
                <Text style={[styles.featureItem, { color: theme.textPrimary }]}>
                  ✓ Custom Flashcard Importer & Editor
                </Text>
                <Text style={[styles.featureItem, { color: theme.textPrimary }]}>
                  ✓ Real-time Speech AI Judge (Claude)
                </Text>
              </View>

              <Pressable
                onPress={() => void handleSelectPlan('pro')}
                style={[
                  styles.planButton,
                  { backgroundColor: theme.accentGold },
                ]}
              >
                <Text style={[styles.planButtonText, { color: '#000', fontWeight: 'bold' }]}>
                  {selectedTier === 'pro' ? 'Active Subscription ✓' : 'Upgrade to Pro'}
                </Text>
              </Pressable>
            </View>

            {/* Enterprise Desk */}
            <View
              style={[
                styles.tierCard,
                { backgroundColor: theme.bg, borderColor: theme.cardBorder },
                selectedTier === 'enterprise' && {
                  borderColor: theme.accentPrimary,
                  borderWidth: 2,
                },
              ]}
            >
              <Text style={[styles.tierBadge, { color: theme.accentPrimary }]}>
                INSTITUTIONAL
              </Text>
              <Text style={[styles.tierTitle, { color: theme.textPrimary }]}>
                Enterprise Desk
              </Text>
              <View style={styles.priceRow}>
                <Text style={[styles.price, { color: theme.accentPrimary }]}>
                  {billingCycle === 'annual' ? '$79' : '$99'}
                </Text>
                <Text style={[styles.priceUnit, { color: theme.textMuted }]}>/ seat / mo</Text>
              </View>
              <Text style={[styles.tierDesc, { color: theme.textSecondary }]}>
                For hedge funds, bank desks, and investment teams with team analytics & custom compliance.
              </Text>
              <Pressable
                onPress={() => void handleSelectPlan('enterprise')}
                style={[
                  styles.planButton,
                  {
                    backgroundColor:
                      selectedTier === 'enterprise' ? theme.accentPrimary : 'transparent',
                    borderColor: theme.accentPrimary,
                    borderWidth: 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.planButtonText,
                    {
                      color:
                        selectedTier === 'enterprise' ? '#000' : theme.accentPrimary,
                      fontWeight: '600',
                    },
                  ]}
                >
                  {selectedTier === 'enterprise' ? 'Active Enterprise ✓' : 'Select Enterprise'}
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>

        {/* Footer Action */}
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
    maxWidth: 680,
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
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerTextGroup: {
    flex: 1,
    flexShrink: 1,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  headerSub: {
    fontSize: 13,
    marginTop: 4,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  cycleContainer: {
    flexDirection: 'row',
    margin: 16,
    padding: 4,
    borderRadius: 10,
  },
  cycleTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  cycleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 16,
  },
  tiersGrid: {
    gap: 16,
    paddingBottom: 20,
  },
  tierCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 18,
    position: 'relative',
  },
  featuredCard: {
    borderWidth: 2,
  },
  popularTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginBottom: 10,
  },
  popularTagText: {
    color: '#000',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  tierBadge: {
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 4,
  },
  tierTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginVertical: 8,
  },
  price: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  priceUnit: {
    fontSize: 13,
    marginLeft: 6,
  },
  tierDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  featureList: {
    gap: 6,
    marginBottom: 16,
  },
  featureItem: {
    fontSize: 13,
  },
  planButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
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
