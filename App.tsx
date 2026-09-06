import { useEffect, useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import type { RoundEngine } from './src/engine';
import type { RoundPlan } from './src/engine/types';
import { resolveEntitledTier } from './src/store/iap';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './src/store/storage';
import { CaseGameScreen } from './src/ui/CaseGameScreen';
import { CasesScreen } from './src/ui/CasesScreen';
import { GameScreen } from './src/ui/GameScreen';
import { QuestionsScreen } from './src/ui/QuestionsScreen';
import { ResultsScreen } from './src/ui/ResultsScreen';
import { SeriesScreen } from './src/ui/SeriesScreen';
import { SettingsScreen } from './src/ui/SettingsScreen';

type Screen =
  | { name: 'series' }
  | { name: 'game'; seriesId: string; key: number }
  | {
      name: 'results';
      engine: RoundEngine;
      plan: RoundPlan;
      seriesId: string;
    }
  | { name: 'settings' }
  | { name: 'questions' }
  | { name: 'cases' }
  | { name: 'case-game'; caseId: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'series' });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    if (screen.name === 'results') void loadSettings().then(setSettings);
  }, [screen]);

  // Re-sync entitlement once at launch so a reinstall, a renewal that lapsed
  // while the app was closed, or a purchase made on another device is
  // reflected without the user having to open the paywall and hit restore.
  useEffect(() => {
    void (async () => {
      const tier = await resolveEntitledTier();
      const current = await loadSettings();
      if (current.subscriptionTier !== tier) {
        await saveSettings({ ...current, subscriptionTier: tier });
      }
    })();
  }, []);

  const activeTab =
    screen.name === 'questions' ? 'questions'
    : screen.name === 'settings' ? 'settings'
    : screen.name === 'cases' ? 'cases'
    : 'series';
  const showBottomBar =
    screen.name === 'series' ||
    screen.name === 'questions' ||
    screen.name === 'settings' ||
    screen.name === 'cases';

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        {screen.name === 'series' && (
          <SeriesScreen
            onSelect={(seriesId) =>
              setScreen({ name: 'game', seriesId, key: Date.now() })
            }
            onOpenSettings={() => setScreen({ name: 'settings' })}
          />
        )}

        {screen.name === 'game' && (
          <GameScreen
            key={screen.key}
            seriesId={screen.seriesId}
            onFinished={(engine, plan) =>
              setScreen({
                name: 'results',
                engine,
                plan,
                seriesId: screen.seriesId,
              })
            }
          />
        )}

        {screen.name === 'results' && (
          <ResultsScreen
            engine={screen.engine}
            n={screen.plan.n}
            language={settings.language}
            onAgain={() =>
              setScreen({
                name: 'game',
                seriesId: screen.seriesId,
                key: Date.now(),
              })
            }
            onChangeSeries={() => setScreen({ name: 'series' })}
          />
        )}

        {screen.name === 'settings' && (
          <SettingsScreen
            onClose={() => setScreen({ name: 'series' })}
            onEditQuestions={() => setScreen({ name: 'questions' })}
          />
        )}

        {screen.name === 'questions' && (
          <QuestionsScreen onClose={() => setScreen({ name: 'series' })} />
        )}

        {screen.name === 'cases' && (
          <CasesScreen onSelect={(caseId) => setScreen({ name: 'case-game', caseId })} />
        )}

        {screen.name === 'case-game' && (
          <CaseGameScreen
            caseId={screen.caseId}
            onExit={() => setScreen({ name: 'cases' })}
          />
        )}
      </View>

      {/* 4 Main Bottom Navigation Buttons: 教材 (Decks), 案件 (Cases), 作成 (Create Custom Q&A), 設定 (Settings) */}
      {showBottomBar && (
        <View style={styles.bottomNav}>
          <Pressable
            onPress={() => setScreen({ name: 'series' })}
            style={[styles.navBtn, activeTab === 'series' && styles.navBtnActive]}
          >
            <Text style={styles.navIcon}>📚</Text>
            <Text style={[styles.navLabel, activeTab === 'series' && styles.navLabelActive]}>
              教材
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setScreen({ name: 'cases' })}
            style={[styles.navBtn, activeTab === 'cases' && styles.navBtnActive]}
          >
            <Text style={styles.navIcon}>💼</Text>
            <Text style={[styles.navLabel, activeTab === 'cases' && styles.navLabelActive]}>
              案件
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setScreen({ name: 'questions' })}
            style={[styles.navBtn, activeTab === 'questions' && styles.navBtnActive]}
          >
            <Text style={styles.navIcon}>✏️</Text>
            <Text style={[styles.navLabel, activeTab === 'questions' && styles.navLabelActive]}>
              作成
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setScreen({ name: 'settings' })}
            style={[styles.navBtn, activeTab === 'settings' && styles.navBtnActive]}
          >
            <Text style={styles.navIcon}>⚙️</Text>
            <Text style={[styles.navLabel, activeTab === 'settings' && styles.navLabelActive]}>
              設定
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050810' },
  container: { flex: 1 },
  bottomNav: {
    height: 64,
    backgroundColor: '#070a10',
    borderTopWidth: 1,
    borderTopColor: '#232d42',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  navBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  navBtnActive: {},
  navIcon: {
    fontSize: 18,
    marginBottom: 2,
  },
  navLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  navLabelActive: {
    color: '#d4af37',
    fontWeight: 'bold',
  },
});
