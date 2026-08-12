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

async function writeLearned(questionId: string, answer: string): Promise<void> {
  const learned = await loadLearned();
  const existing = learned[questionId] ?? [];
  if (existing.includes(answer)) return;
  learned[questionId] = [...existing, answer];
  await AsyncStorage.setItem(KEY_LEARNED, JSON.stringify(learned));
}

/**
 * Serializes every write, because this is read-modify-write over one key and
 * a round can learn several synonyms at once: two concurrent calls would both
 * read the same map and the later write would drop the earlier one's answer.
 */
let learnedWrites: Promise<unknown> = Promise.resolve();

export function addLearned(questionId: string, answer: string): Promise<void> {
  const next = learnedWrites.then(() => writeLearned(questionId, answer));
  // The chain must survive a failed write; the caller still sees the rejection.
  learnedWrites = next.catch(() => undefined);
  return next;
}

/**
 * The device's local calendar date. Deliberately not toISOString(), which is
 * UTC and would file every round played before 09:00 JST under the day before.
 */
export function localDate(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function phaseDurations(settings: Settings): { a: number; b: number } {
  const a = Math.round(settings.stepDurationMs * 0.4);
  return { a, b: settings.stepDurationMs - a };
}
