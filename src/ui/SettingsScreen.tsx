import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
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
  loadCustom,
  loadLearned,
  loadN,
  loadSettings,
  saveApiKey,
  saveN,
  saveSettings,
  STARTING_N,
  type AnswerInput,
  type Settings,
} from '../store/storage';
import { ClaudeJudgeClient } from '../judge/claude';
import type { JudgeClient } from '../judge/types';
import type { Question } from '../engine/types';
import { listSeries, type Series } from '../content/series';
import { useStrings } from '../strings';
import type { Strings } from '../strings';

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
function maskApiKey(apiKey: string, strings: Strings['settings']): string {
  if (!apiKey) return strings.apiKeyUnset;
  if (apiKey.length <= 12) return strings.apiKeySet;
  return `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}`;
}

type CheckState =
  | { name: 'idle' }
  | { name: 'checking' }
  | { name: 'ok' }
  | { name: 'failed'; message: string };

const STEP_CHOICES = [3000, 4000, 5000, 6000, 8000];
const TIER_CHOICES = [
  { tier: 1, labelKey: 'tierEasy' as const },
  { tier: 2, labelKey: 'tierNormal' as const },
];
const MODE_CHOICES: { mode: RoundMode; labelKey: 'modeDual' | 'modeQuestion' }[] = [
  { mode: 'dual', labelKey: 'modeDual' },
  { mode: 'question', labelKey: 'modeQuestion' },
];
const INPUT_CHOICES: { input: AnswerInput; labelKey: 'inputTyped' | 'inputVoice' }[] = [
  { input: 'typed', labelKey: 'inputTyped' },
  { input: 'voice', labelKey: 'inputVoice' },
];

/**
 * The one place ms<->s conversion happens for the budget field, in either
 * direction. Called both to seed the field before settings load (from
 * DEFAULT_SETTINGS) and to resync it once the real stored value arrives —
 * a single formula, not two independent ones that could drift apart.
 */
function msToSeconds(ms: number): string {
  return String(ms / 1000);
}

export function SettingsScreen({ onClose, onEditQuestions, judgeClient }: Props) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const [apiKey, setApiKey] = useState('');
  const [check, setCheck] = useState<CheckState>({ name: 'idle' });
  const strings = useStrings();

  // Seeded from DEFAULT_SETTINGS so the field shows something before load
  // resolves, then resynced once — see the effect below. Kept separate from
  // `settings` so a blank/unparseable keystroke can be shown without ever
  // being parsed into (or fought back from) budgetBaseMs.
  const [budgetText, setBudgetText] = useState(() =>
    msToSeconds(DEFAULT_SETTINGS.budgetBaseMs),
  );

  useEffect(() => {
    void loadSettings().then((loaded) => {
      setSettings(loaded);
      setBudgetText(msToSeconds(loaded.budgetBaseMs));
    });
    void loadApiKey().then(setApiKey);
  }, []);

  const [series, setSeries] = useState<Series[]>([]);
  const [seriesN, setSeriesN] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Series identity (id, title) does not depend on maxTier — that only
      // filters which standard-series *questions* a round draws from, never
      // which series exist or what N they are stored under — so this loads
      // once rather than re-running on every settings change.
      const [custom, learned] = await Promise.all([loadCustom(), loadLearned()]);
      if (cancelled) return;
      const all = listSeries({ custom, learned, maxTier: DEFAULT_SETTINGS.maxTier });
      setSeries(all);
      const entries = await Promise.all(
        all.map(async (s) => [s.id, await loadN(s.id)] as const),
      );
      if (cancelled) return;
      setSeriesN(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Clamped at STARTING_N: there is no lag below the one the app starts at. */
  const adjustSeriesN = useCallback((seriesId: string, delta: number) => {
    setSeriesN((current) => {
      const next = Math.max(STARTING_N, (current[seriesId] ?? STARTING_N) + delta);
      void saveN(seriesId, next);
      return { ...current, [seriesId]: next };
    });
  }, []);

  const resetSeriesN = useCallback((seriesId: string) => {
    setSeriesN((current) => {
      void saveN(seriesId, STARTING_N);
      return { ...current, [seriesId]: STARTING_N };
    });
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
      <Text style={styles.heading}>{strings.common.settings}</Text>

      {/* This screen is taller than a phone, and the web build disables page
          scrolling (`body { overflow: hidden }`), so without this the lower
          half was clipped away with no way to reach it. 閉じる stays outside,
          below, so the way out is never the thing you have to scroll for. */}
      <ScrollView testID="settings-scroll" style={styles.body}>
        <Text style={styles.label}>{strings.settings.sectionMode}</Text>
        <View style={styles.row}>
          {MODE_CHOICES.map(({ mode, labelKey }) => (
            <Pressable
              key={mode}
              onPress={() => update({ mode })}
              style={[styles.chip, settings.mode === mode && styles.chipOn]}
            >
              <Text style={styles.chipLabel}>{strings.settings[labelKey]}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>{strings.settings.sectionAnswerInput}</Text>
        <View style={styles.row}>
          {INPUT_CHOICES.map(({ input, labelKey }) => (
            <Pressable
              key={input}
              testID={`answer-input-${input}`}
              onPress={() => update({ answerInput: input })}
              style={[styles.chip, settings.answerInput === input && styles.chipOn]}
            >
              <Text style={styles.chipLabel}>{strings.settings[labelKey]}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.note}>
          {strings.settings.noteTypedInput}
        </Text>

        <Text style={styles.label}>{strings.settings.sectionBudget}</Text>
        <TextInput
          testID="budget-base-input"
          style={styles.input}
          keyboardType="number-pad"
          value={budgetText}
          onChangeText={(text) => {
            // Always reflects what was typed, even blank or unparseable —
            // never snapped back mid-edit. Only a parseable value propagates.
            setBudgetText(text);
            const seconds = Number(text);
            if (!Number.isFinite(seconds) || text.trim() === '') return;
            // Clamped at 0: a negative base makes a clock that starts red and
            // rows that read 時間超過（目安 -1s）.
            update({ budgetBaseMs: Math.max(0, Math.round(seconds * 1000)) });
          }}
        />
        <Text style={styles.note}>
          {strings.settings.noteBudget}
        </Text>

        <Pressable style={styles.link} onPress={onEditQuestions}>
          <Text style={styles.linkLabel}>{strings.settings.linkEditQuestions}</Text>
        </Pressable>

        <Text style={styles.label}>{strings.settings.sectionStepDuration}</Text>
        <View style={styles.row}>
          {STEP_CHOICES.map((ms) => (
            <Pressable
              key={ms}
              onPress={() => update({ stepDurationMs: ms })}
              style={[styles.chip, settings.stepDurationMs === ms && styles.chipOn]}
            >
              <Text style={styles.chipLabel}>{ms / 1000}{strings.settings.stepDurationUnit}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>{strings.settings.sectionAdaptive}</Text>
          <Switch
            value={settings.adaptive}
            onValueChange={(adaptive) => update({ adaptive })}
          />
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>{strings.settings.sectionLanguage}</Text>
          <Switch
            testID="language-switch"
            value={settings.language === 'en'}
            onValueChange={(isEn) => update({ language: isEn ? 'en' : 'ja' })}
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

        <Text style={styles.label}>{strings.settings.sectionSeriesN}</Text>
        <Text style={styles.note}>
          {strings.settings.noteSeriesN}
        </Text>
        {series.map((s) => (
          <View key={s.id} testID={`series-n-row-${s.id}`} style={styles.seriesRow}>
            <Text style={styles.seriesTitle}>{s.title}</Text>
            <View style={styles.seriesControls}>
              <Pressable
                testID={`series-n-down-${s.id}`}
                style={styles.chip}
                onPress={() => adjustSeriesN(s.id, -1)}
              >
                <Text style={styles.chipLabel}>{strings.settings.seriesNDown}</Text>
              </Pressable>
              <Text testID={`series-n-value-${s.id}`} style={styles.seriesN}>
                {seriesN[s.id] ?? STARTING_N}
              </Text>
              <Pressable
                testID={`series-n-up-${s.id}`}
                style={styles.chip}
                onPress={() => adjustSeriesN(s.id, 1)}
              >
                <Text style={styles.chipLabel}>{strings.settings.seriesNUp}</Text>
              </Pressable>
              <Pressable
                testID={`series-n-reset-${s.id}`}
                style={styles.chip}
                onPress={() => resetSeriesN(s.id)}
              >
                <Text style={styles.chipLabel}>{strings.settings.seriesNReset}</Text>
              </Pressable>
            </View>
          </View>
        ))}

        <Text style={styles.label}>{strings.settings.sectionMaxTier}</Text>
        <View style={styles.row}>
          {TIER_CHOICES.map(({ tier, labelKey }) => (
            <Pressable
              key={tier}
              onPress={() => update({ maxTier: tier })}
              style={[styles.chip, settings.maxTier === tier && styles.chipOn]}
            >
              <Text style={styles.chipLabel}>{strings.settings[labelKey]}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>{strings.settings.sectionApiKey}</Text>
        <TextInput
          testID="api-key-input"
          style={styles.input}
          placeholder={strings.settings.apiKeyPlaceholder}
          placeholderTextColor="#8e8e93"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={editApiKey}
        />
        <View style={styles.row}>
          <Text style={styles.keyState}>{maskApiKey(apiKey, strings.settings)}</Text>
          <Pressable style={styles.chip} onPress={() => void runCheck()}>
            <Text style={styles.chipLabel}>{strings.settings.checkConnection}</Text>
          </Pressable>
        </View>
        {check.name === 'checking' && (
          <Text style={styles.keyState}>{strings.settings.checking}</Text>
        )}
        {check.name === 'ok' && (
          <Text style={styles.keyOk}>{strings.settings.checkOk}</Text>
        )}
        {check.name === 'failed' && (
          <Text style={styles.keyError}>{strings.settings.checkFailedPrefix}{check.message}</Text>
        )}
      </ScrollView>

      <Pressable style={styles.button} onPress={onClose}>
        <Text style={styles.chipLabel}>{strings.common.close}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 32, paddingTop: 80, backgroundColor: '#000' },
  heading: { color: '#f4f1ea', fontSize: 28, marginBottom: 24 },
  body: { flex: 1, marginBottom: 16 },
  label: { color: '#f4f1ea', fontSize: 16, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#1c1c1e' },
  chipOn: { backgroundColor: '#c96f4a' },
  chipOff: { opacity: 0.4 },
  link: { marginBottom: 24 },
  linkLabel: { color: '#c96f4a', fontSize: 16 },
  chipLabel: { color: '#f4f1ea', fontSize: 16 },
  seriesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  seriesTitle: { color: '#f4f1ea', fontSize: 14, flexShrink: 1 },
  seriesControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  seriesN: { color: '#f4f1ea', fontSize: 16, minWidth: 20, textAlign: 'center' },
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
  // No marginTop: 'auto' — the scroll body above is flex: 1, so it already
  // takes the slack and pins this to the bottom of the screen.
  button: { padding: 16, backgroundColor: '#1c1c1e', borderRadius: 12, alignItems: 'center' },
});
