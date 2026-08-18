import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { RoundMode } from '../engine/types';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
} from '../store/storage';

interface Props {
  onClose: () => void;
  onEditQuestions: () => void;
}

const STEP_CHOICES = [3000, 4000, 5000, 6000, 8000];
const TIER_CHOICES = [
  { tier: 1, label: 'やさしい' },
  { tier: 2, label: 'ふつう' },
];
const MODE_CHOICES: { mode: RoundMode; label: string }[] = [
  { mode: 'dual', label: '位置＋質問' },
  { mode: 'question', label: '質問のみ' },
];

export function SettingsScreen({ onClose, onEditQuestions }: Props) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  // A ref, not the state value, so two rapid taps don't both build their patch
  // from the same stale object and lose the first change. The write stays out
  // of the setState updater, which must be pure.
  const latest = useRef(settings);
  latest.current = settings;

  const update = useCallback((patch: Partial<Settings>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setSettings(next);
    void saveSettings(next);
  }, []);


  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>設定</Text>

      <Text style={styles.label}>モード</Text>
      <View style={styles.row}>
        {MODE_CHOICES.map(({ mode, label }) => (
          <Pressable
            key={mode}
            onPress={() => update({ mode })}
            style={[styles.chip, settings.mode === mode && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>


      <Pressable style={styles.link} onPress={onEditQuestions}>
        <Text style={styles.linkLabel}>自分の問題を編集</Text>
      </Pressable>

      <Text style={styles.label}>1ステップの長さ</Text>
      <View style={styles.row}>
        {STEP_CHOICES.map((ms) => (
          <Pressable
            key={ms}
            onPress={() => update({ stepDurationMs: ms })}
            style={[styles.chip, settings.stepDurationMs === ms && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>{ms / 1000}秒</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Nを自動調整</Text>
        <Switch
          value={settings.adaptive}
          onValueChange={(adaptive) => update({ adaptive })}
        />
      </View>

      {!settings.adaptive && (
        <View style={styles.row}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              onPress={() => update({ fixedN: n })}
              style={[styles.chip, settings.fixedN === n && styles.chipOn]}
            >
              <Text style={styles.chipLabel}>{n}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.label}>標準問題のむずかしさ</Text>
      <View style={styles.row}>
        {TIER_CHOICES.map(({ tier, label }) => (
          <Pressable
            key={tier}
            onPress={() => update({ maxTier: tier })}
            style={[styles.chip, settings.maxTier === tier && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.button} onPress={onClose}>
        <Text style={styles.chipLabel}>閉じる</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 32, paddingTop: 80, backgroundColor: '#000' },
  heading: { color: '#f4f1ea', fontSize: 28, marginBottom: 24 },
  label: { color: '#f4f1ea', fontSize: 16, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#1c1c1e' },
  chipOn: { backgroundColor: '#c96f4a' },
  chipOff: { opacity: 0.4 },
  link: { marginBottom: 24 },
  linkLabel: { color: '#c96f4a', fontSize: 16 },
  chipLabel: { color: '#f4f1ea', fontSize: 16 },
  button: { marginTop: 'auto', padding: 16, backgroundColor: '#1c1c1e', borderRadius: 12, alignItems: 'center' },
});
