import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { RoundMode } from '../engine/types';
import {
  DEFAULT_SETTINGS,
  loadApiKey,
  loadSettings,
  saveApiKey,
  saveSettings,
  type AnswerInput,
  type Settings,
} from '../store/storage';
import { ClaudeJudgeClient } from '../judge/claude';
import type { JudgeClient } from '../judge/types';
import type { Question } from '../engine/types';

interface Props {
  onClose: () => void;
  onEditQuestions: () => void;
  /** Overridden in tests; defaults to the real Claude client. */
  judgeClient?: JudgeClient;
}

/** A question the judge can answer without the bank, used only by the check. */
const PROBE: Question = {
  id: 'probe',
  tier: 0,
  q: '犬の鳴き声は？',
  accept: ['わん'],
};

/**
 * Shows enough of the key to tell two apart, never enough to use. A key is
 * pasted once and then only ever recognized.
 */
function maskApiKey(apiKey: string): string {
  if (!apiKey) return '未設定';
  if (apiKey.length <= 12) return '設定済み';
  return `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}`;
}

type CheckState =
  | { name: 'idle' }
  | { name: 'checking' }
  | { name: 'ok' }
  | { name: 'failed'; message: string };

const STEP_CHOICES = [3000, 4000, 5000, 6000, 8000];
const TIER_CHOICES = [
  { tier: 1, label: 'やさしい' },
  { tier: 2, label: 'ふつう' },
];
const MODE_CHOICES: { mode: RoundMode; label: string }[] = [
  { mode: 'dual', label: '位置＋質問' },
  { mode: 'question', label: '質問のみ' },
];
const INPUT_CHOICES: { input: AnswerInput; label: string }[] = [
  { input: 'typed', label: '入力' },
  { input: 'voice', label: '音声' },
];

export function SettingsScreen({ onClose, onEditQuestions, judgeClient }: Props) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const [apiKey, setApiKey] = useState('');
  const [check, setCheck] = useState<CheckState>({ name: 'idle' });

  useEffect(() => {
    void loadSettings().then(setSettings);
    void loadApiKey().then(setApiKey);
  }, []);

  const judge = useMemo(
    () => judgeClient ?? new ClaudeJudgeClient(loadApiKey),
    [judgeClient],
  );

  const editApiKey = useCallback((next: string) => {
    setApiKey(next);
    setCheck({ name: 'idle' });
    void saveApiKey(next);
  }, []);

  /**
   * The only place a bad key is ever stated on screen. In a round it 401s,
   * the queue turns that into 未判定, and nothing says the app is misconfigured.
   */
  const runCheck = useCallback(async () => {
    setCheck({ name: 'checking' });
    try {
      await judge.judge(PROBE, 'わん');
      setCheck({ name: 'ok' });
    } catch (error) {
      setCheck({
        name: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [judge]);

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

      <Text style={styles.label}>回答のしかた</Text>
      <View style={styles.row}>
        {INPUT_CHOICES.map(({ input, label }) => (
          <Pressable
            key={input}
            testID={`answer-input-${input}`}
            onPress={() => update({ answerInput: input })}
            style={[styles.chip, settings.answerInput === input && styles.chipOn]}
          >
            <Text style={styles.chipLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>
        入力にすると、キーボードのマイクで喋った文字を、送る前に直せる。
      </Text>

      <Text style={styles.label}>考える時間の基準 (秒)</Text>
      <TextInput
        testID="budget-base-input"
        style={styles.input}
        keyboardType="number-pad"
        defaultValue={String(settings.budgetBaseMs / 1000)}
        onChangeText={(text) => {
          const seconds = Number(text);
          if (!Number.isFinite(seconds) || text.trim() === '') return;
          update({ budgetBaseMs: Math.round(seconds * 1000) });
        }}
      />
      <Text style={styles.note}>
        答え1文字につき1秒が、この基準に足される。時計が0になっても先へは進まない。
      </Text>

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

      <Text style={styles.label}>Claude APIキー</Text>
      <TextInput
        testID="api-key-input"
        style={styles.input}
        placeholder="sk-ant-..."
        placeholderTextColor="#8e8e93"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={editApiKey}
      />
      <View style={styles.row}>
        <Text style={styles.keyState}>{maskApiKey(apiKey)}</Text>
        <Pressable style={styles.chip} onPress={() => void runCheck()}>
          <Text style={styles.chipLabel}>接続を確認</Text>
        </Pressable>
      </View>
      {check.name === 'checking' && (
        <Text style={styles.keyState}>確認中…</Text>
      )}
      {check.name === 'ok' && (
        <Text style={styles.keyOk}>確認できました。採点が使えます。</Text>
      )}
      {check.name === 'failed' && (
        <Text style={styles.keyError}>失敗: {check.message}</Text>
      )}

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
  note: { color: '#8e8e93', fontSize: 14, marginBottom: 24 },
  input: {
    backgroundColor: '#1c1c1e',
    color: '#f4f1ea',
    fontSize: 16,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  keyState: { color: '#8e8e93', fontSize: 14 },
  keyOk: { color: '#4caf7d', fontSize: 14, marginBottom: 16 },
  keyError: { color: '#e5534b', fontSize: 14, marginBottom: 16 },
  button: { marginTop: 'auto', padding: 16, backgroundColor: '#1c1c1e', borderRadius: 12, alignItems: 'center' },
});
