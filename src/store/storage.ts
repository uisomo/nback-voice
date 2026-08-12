import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QuestionSource } from '../content/pool';
import type { Question, RoundMode } from '../engine/types';

export interface Settings {
  /** Total step length in ms; split 40% phase A / 60% phase B. */
  stepDurationMs: number;
  adaptive: boolean;
  /** Used only when adaptive is false. */
  fixedN: number;
  /** Highest question tier to draw from. Built-ins only. */
  maxTier: number;
  /** 'dual' scores position and answer; 'question' drops the visual channel. */
  mode: RoundMode;
  /** Which questions a round draws from. */
  questionSource: QuestionSource;
}

export interface RoundRecord {
  date: string;
  n: number;
  /** null in question mode: the channel was absent, not scored zero. */
  positionScore: number | null;
  answerScore: number | null;
  unresolved: number;
}

export const DEFAULT_SETTINGS: Settings = {
  stepDurationMs: 5000,
  adaptive: true,
  fixedN: 2,
  maxTier: 2,
  mode: 'dual',
  questionSource: 'builtin',
};

const KEY_SETTINGS = 'nback.settings';
const KEY_N = 'nback.n';
const KEY_HISTORY = 'nback.history';
const KEY_LEARNED = 'nback.learned';
const KEY_CUSTOM = 'nback.custom';
const KEY_CUSTOM_SEQ = 'nback.customSeq';

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

async function clearLearnedNow(questionId: string): Promise<void> {
  const learned = await loadLearned();
  if (!(questionId in learned)) return;
  delete learned[questionId];
  await AsyncStorage.setItem(KEY_LEARNED, JSON.stringify(learned));
}

/**
 * Forget everything learned for one question. Goes through the same write
 * chain as addLearned — otherwise an in-flight learn could land afterwards
 * and resurrect a synonym the owner just invalidated.
 */
export function clearLearned(questionId: string): Promise<void> {
  const next = learnedWrites.then(() => clearLearnedNow(questionId));
  learnedWrites = next.catch(() => undefined);
  return next;
}

export async function loadCustom(): Promise<Question[]> {
  return readJson<Question[]>(KEY_CUSTOM, []);
}

/**
 * Ids come from a monotonic counter rather than the array length, so deleting
 * a question can never cause a later one to reuse its id — and with it, its
 * learned synonyms.
 */
export async function addCustom(q: string, answer: string): Promise<Question> {
  const seq = (await readJson<number>(KEY_CUSTOM_SEQ, 0)) + 1;
  const question: Question = {
    id: `user_${seq}`,
    tier: 0,
    q,
    accept: [answer],
  };
  const custom = await loadCustom();
  await AsyncStorage.setItem(KEY_CUSTOM, JSON.stringify([...custom, question]));
  await AsyncStorage.setItem(KEY_CUSTOM_SEQ, JSON.stringify(seq));
  return question;
}

/**
 * Editing either field invalidates phrasings Claude accepted against the old
 * pair, so the learned list is cleared and rebuilds itself from the next answer.
 */
export async function updateCustom(
  id: string,
  q: string,
  answer: string,
): Promise<void> {
  const custom = await loadCustom();
  const next = custom.map((item) =>
    item.id === id ? { ...item, q, accept: [answer] } : item,
  );
  await AsyncStorage.setItem(KEY_CUSTOM, JSON.stringify(next));
  await clearLearned(id);
}

export async function deleteCustom(id: string): Promise<void> {
  const custom = await loadCustom();
  await AsyncStorage.setItem(
    KEY_CUSTOM,
    JSON.stringify(custom.filter((item) => item.id !== id)),
  );
  await clearLearned(id);
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
