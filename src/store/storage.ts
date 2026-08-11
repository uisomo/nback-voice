import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Settings {
  /** Total step length in ms; split 40% phase A / 60% phase B. */
  stepDurationMs: number;
  adaptive: boolean;
  /** Used only when adaptive is false. */
  fixedN: number;
  /** Highest question tier to draw from. */
  maxTier: number;
}

export interface RoundRecord {
  date: string;
  n: number;
  positionScore: number;
  answerScore: number | null;
  unresolved: number;
}

export const DEFAULT_SETTINGS: Settings = {
  stepDurationMs: 5000,
  adaptive: true,
  fixedN: 2,
  maxTier: 2,
};

const KEY_SETTINGS = 'nback.settings';
const KEY_N = 'nback.n';
const KEY_HISTORY = 'nback.history';
const KEY_LEARNED = 'nback.learned';

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function loadSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings>>(KEY_SETTINGS, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(KEY_SETTINGS, JSON.stringify(settings));
}

export async function loadN(): Promise<number> {
  return readJson<number>(KEY_N, 2);
}

export async function saveN(n: number): Promise<void> {
  await AsyncStorage.setItem(KEY_N, JSON.stringify(n));
}

export async function loadHistory(): Promise<RoundRecord[]> {
  return readJson<RoundRecord[]>(KEY_HISTORY, []);
}

export async function appendHistory(record: RoundRecord): Promise<void> {
  const history = await loadHistory();
  history.push(record);
  await AsyncStorage.setItem(KEY_HISTORY, JSON.stringify(history));
}

export async function loadLearned(): Promise<Record<string, string[]>> {
  return readJson<Record<string, string[]>>(KEY_LEARNED, {});
}

export async function addLearned(
  questionId: string,
  answer: string,
): Promise<void> {
  const learned = await loadLearned();
  const existing = learned[questionId] ?? [];
  if (existing.includes(answer)) return;
  learned[questionId] = [...existing, answer];
  await AsyncStorage.setItem(KEY_LEARNED, JSON.stringify(learned));
}

export function phaseDurations(settings: Settings): { a: number; b: number } {
  const a = Math.round(settings.stepDurationMs * 0.4);
  return { a, b: settings.stepDurationMs - a };
}
