import { useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import type { RoundEngine } from './src/engine';
import type { RoundPlan } from './src/engine/types';
import { GameScreen } from './src/ui/GameScreen';
import { QuestionsScreen } from './src/ui/QuestionsScreen';
import { ResultsScreen } from './src/ui/ResultsScreen';
import { SettingsScreen } from './src/ui/SettingsScreen';

type Screen =
  | { name: 'game'; key: number }
  | { name: 'results'; engine: RoundEngine; plan: RoundPlan }
  | { name: 'settings' }
  | { name: 'questions' };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'game', key: 0 });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      {screen.name === 'game' && (
        <>
          <GameScreen
            key={screen.key}
            onFinished={(engine, plan) =>
              setScreen({ name: 'results', engine, plan })
            }
          />
          <Pressable
            style={styles.settingsButton}
            onPress={() => setScreen({ name: 'settings' })}
          >
            <Text style={styles.settingsLabel}>設定</Text>
          </Pressable>
        </>
      )}

      {screen.name === 'results' && (
        <ResultsScreen
          engine={screen.engine}
          n={screen.plan.n}
          onAgain={() => setScreen({ name: 'game', key: Date.now() })}
        />
      )}

      {screen.name === 'settings' && (
        <SettingsScreen
          onClose={() => setScreen({ name: 'game', key: Date.now() })}
          onEditQuestions={() => setScreen({ name: 'questions' })}
        />
      )}

      {/* Closing the editor returns to Settings rather than starting a round,
          so the owner can add several questions and then pick the source
          without a round beginning underneath them. */}
      {screen.name === 'questions' && (
        <QuestionsScreen onClose={() => setScreen({ name: 'settings' })} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  settingsButton: { position: 'absolute', top: 60, right: 24 },
  settingsLabel: { color: '#8e8e93', fontSize: 16 },
});
