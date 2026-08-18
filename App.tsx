import { useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import type { RoundEngine } from './src/engine';
import type { RoundPlan } from './src/engine/types';
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
  | { name: 'questions' };

export default function App() {
  // The series list is home: what you are training on is chosen before a
  // round starts, not buried in settings behind a round already running.
  const [screen, setScreen] = useState<Screen>({ name: 'series' });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
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

      {/* Closing Settings returns to the series list rather than starting a
          round, so a question just added is reflected in the counts. */}
      {screen.name === 'settings' && (
        <SettingsScreen
          onClose={() => setScreen({ name: 'series' })}
          onEditQuestions={() => setScreen({ name: 'questions' })}
        />
      )}

      {screen.name === 'questions' && (
        <QuestionsScreen onClose={() => setScreen({ name: 'settings' })} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
});
