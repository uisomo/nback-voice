import AsyncStorage from '@react-native-async-storage/async-storage';
import { CUSTOM_SERIES_ID, STANDARD_SERIES_ID } from '../content/series';
import { DEFAULT_BUDGET_BASE_MS } from '../engine/budget';
import type { Question, RoundMode } from '../engine/types';

/**
 * How the answer is given. Independent of RoundMode, which says what gets
 * scored: all four combinations are meaningful.
 */
export type AnswerInput = 'voice' | 'typed';
export type SubscriptionTier = 'free' | 'pro' | 'god';
export type ThemeVariety = 'terminal' | 'executive' | 'quant';

export interface Settings {
  /** Total step length in ms; split 40% phase A / 60% phase B. */
  stepDurationMs: number;
  adaptive: boolean;
  /** Used only when adaptive is false. */
  fixedN: number;
  /** Highest question tier to draw from. Standard series only. */
  maxTier: number;
  /** 'dual' scores position and answer; 'question' drops the visual channel. */
  mode: RoundMode;
  /** Which series a round draws from. */
  seriesId: string;
  /** How answers are entered. Typed is the default; voice is opted into. */
  answerInput: AnswerInput;
  /** Base of the answer time budget, before the per-character part. */
  budgetBaseMs: number;
  /** UI/content/speech/judge language. Switching requires series.en.json etc. */
  language: 'ja' | 'en';
  /** Subscription plan level for professional financial features. */
  subscriptionTier: SubscriptionTier;
  /** UI Theme Variety: terminal (Bloomberg), executive (Wall St Luxury), quant (Cyberpunk Neon). */
  themeVariety: ThemeVariety;
  /** Active category filter tab selected by financial professional. */
  selectedCategory: string;
}

export interface RoundRecord {
  date: string;
  n: number;
  /** null in question mode: the channel was absent, not scored zero. */
  positionScore: number | null;
  answerScore: number | null;
  unresolved: number;
  /** Absent on rounds recorded before series existed. */
  seriesId?: string;
  /** Absent on rounds recorded before typed mode, and null in voice mode. */
  onTimeScore?: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  stepDurationMs: 5000,
  adaptive: true,
  fixedN: 1,
  maxTier: 2,
  mode: 'dual',
  seriesId: CUSTOM_SERIES_ID,
  answerInput: 'typed',
  budgetBaseMs: DEFAULT_BUDGET_BASE_MS,
  language: 'ja',
  subscriptionTier: 'free',
  themeVariety: 'terminal',
  selectedCategory: 'all',
};

const KEY_SETTINGS = 'nback.settings';
const KEY_N = 'nback.n';
const KEY_N_BY_SERIES = 'nback.n.bySeries';
const KEY_HISTORY = 'nback.history';
const KEY_LEARNED = 'nback.learned';
const KEY_CUSTOM = 'nback.custom';
const KEY_CUSTOM_SEQ = 'nback.customSeq';
const KEY_CUSTOM_DECKS = 'nback.customDecks';
const KEY_CUSTOM_DECK_SEQ = 'nback.customDeckSeq';
const KEY_API_KEY = 'nback.apiKey';

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** The pre-series shape, kept only so stored settings can be migrated. */
interface LegacySettings {
  questionSource?: string;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await readJson<Partial<Settings> & LegacySettings>(
    KEY_SETTINGS,
    {},
  );
  const { questionSource, ...rest } = stored;
  const settings = { ...DEFAULT_SETTINGS, ...rest };

  // 'custom' becomes its own series; 'builtin' and 'both' both land on the
  // standard one, since the mixed pool has no equivalent under series.
  if (rest.seriesId === undefined && questionSource !== undefined) {
    settings.seriesId =
      questionSource === 'custom' ? 'custom' : STANDARD_SERIES_ID;
  }

  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(KEY_SETTINGS, JSON.stringify(settings));
}

/**
 * The lag a new player starts at. 1 — answering the question just asked —
 * is already demanding with a grid to watch; the adaptive rule raises it
 * after a round scored 80% or better, so difficulty is earned rather than
 * assumed.
 */
export const STARTING_N = 1;

/**
 * The per-series lag map, seeding itself once from the pre-series single
 * value. The legacy key is left in place: the migration is one-way but not
 * destructive.
 */
async function loadNMap(): Promise<Record<string, number>> {
  const stored = await readJson<Record<string, number> | null>(
    KEY_N_BY_SERIES,
    null,
  );
  if (stored) return stored;

  const legacy = await readJson<number | null>(KEY_N, null);
  if (legacy === null) return {};

  const seeded = { [STANDARD_SERIES_ID]: legacy };
  await AsyncStorage.setItem(KEY_N_BY_SERIES, JSON.stringify(seeded));
  return seeded;
}

export async function loadN(seriesId: string): Promise<number> {
  return (await loadNMap())[seriesId] ?? STARTING_N;
}

export async function saveN(seriesId: string, n: number): Promise<void> {
  // A plain read-modify-write: unlike addLearned, this runs once at round
  // end, so there is no concurrent writer to serialize against.
  const map = await loadNMap();
  map[seriesId] = n;
  await AsyncStorage.setItem(KEY_N_BY_SERIES, JSON.stringify(map));
}

export async function loadHistory(): Promise<RoundRecord[]> {
  return readJson<RoundRecord[]>(KEY_HISTORY, []);
}

export async function appendHistory(record: RoundRecord): Promise<void> {
  const history = await loadHistory();
  history.push(record);
  await AsyncStorage.setItem(KEY_HISTORY, JSON.stringify(history));
}

/** How many rounds have been recorded under today's local date. */
export function roundsPlayedToday(history: RoundRecord[]): number {
  const today = localDate();
  return history.filter((record) => record.date === today).length;
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

/** A user-authored deck: a title, a funds-finance category, and its own questions. */
export interface CustomDeck {
  id: string;
  title: string;
  /** A FundsFinanceCategory id. */
  category: string;
  questions: Question[];
}

/** Category id every user-authored deck is tagged with — shown as its own "自作" filter chip. */
export const CUSTOM_DECK_CATEGORY = 'custom';

/**
 * A deck holds at most this many questions — kept small enough to review at
 * a glance. Still used by QuestionsScreen.tsx's draft-count guard; the
 * per-tier ceiling enforced in addCustomDeck/updateCustomDeck is separate
 * and tracked via tierLimits().
 */
export const MAX_DECK_QUESTIONS = 10;

export interface TierLimits {
  maxDecks: number;
  maxQuestionsPerDeck: number;
  /** Rounds playable per local calendar day. Infinity means no cap. */
  maxRoundsPerDay: number;
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: { maxDecks: 0, maxQuestionsPerDeck: 0, maxRoundsPerDay: 3 },
  pro: { maxDecks: 5, maxQuestionsPerDeck: 3, maxRoundsPerDay: Infinity },
  god: { maxDecks: 20, maxQuestionsPerDeck: 10, maxRoundsPerDay: Infinity },
};

/**
 * Whether this bundle is the demo. Read from the environment on every call
 * rather than captured once, so a test can flip it — Metro inlines
 * `process.env.EXPO_PUBLIC_*` as a literal wherever it appears, so the
 * production build still folds this to a constant.
 */
export function isDemoBuild(): boolean {
  return process.env.EXPO_PUBLIC_DEMO === '1';
}

/**
 * The only way limits should be read. A settings blob saved before a tier
 * value was removed (e.g. the old 'enterprise') must not crash the app —
 * it is treated as free rather than migrated, since the stored value is
 * otherwise harmless.
 *
 * The demo build lifts the daily round cap and nothing else. A demo exists to
 * be played with, and stopping the person you handed it to after three rounds
 * is the one thing it must not do; the deck and question ceilings still show
 * what the free tier really is. This is a build-time split, not a setting, so
 * the paying app has no code path that can be talked into unlimited rounds.
 */
export function tierLimits(tier: SubscriptionTier): TierLimits {
  const limits = TIER_LIMITS[tier] ?? TIER_LIMITS.free;
  return isDemoBuild() ? { ...limits, maxRoundsPerDay: Infinity } : limits;
}

export async function loadCustomDecks(): Promise<CustomDeck[]> {
  return readJson<CustomDeck[]>(KEY_CUSTOM_DECKS, []);
}

/**
 * Ids come from a monotonic counter shared across decks and questions, so a
 * deleted deck's question ids can never be reused by a later deck — and with
 * them, their learned synonyms.
 */
export async function addCustomDeck(
  tier: SubscriptionTier,
  title: string,
  category: string,
  drafts: { q: string; accept: string[] }[],
): Promise<CustomDeck> {
  const limits = tierLimits(tier);
  if (drafts.length > limits.maxQuestionsPerDeck) {
    throw new Error(`Your plan allows at most ${limits.maxQuestionsPerDeck} questions per deck. Upgrade for more.`);
  }

  const decks = await loadCustomDecks();
  if (decks.length >= limits.maxDecks) {
    throw new Error(`Your plan allows at most ${limits.maxDecks} decks. Upgrade for more.`);
  }

  let seq = await readJson<number>(KEY_CUSTOM_DECK_SEQ, 0);
  const questions: Question[] = drafts.map((draft) => {
    seq += 1;
    return { id: `deck_${seq}`, tier: 0, q: draft.q, accept: draft.accept };
  });
  const deck: CustomDeck = { id: `deck_${++seq}`, title, category, questions };

  await AsyncStorage.setItem(KEY_CUSTOM_DECKS, JSON.stringify([...decks, deck]));
  await AsyncStorage.setItem(KEY_CUSTOM_DECK_SEQ, JSON.stringify(seq));
  return deck;
}

export async function deleteCustomDeck(id: string): Promise<void> {
  const decks = await loadCustomDecks();
  const removed = decks.find((deck) => deck.id === id);
  await AsyncStorage.setItem(
    KEY_CUSTOM_DECKS,
    JSON.stringify(decks.filter((deck) => deck.id !== id)),
  );
  for (const question of removed?.questions ?? []) {
    await clearLearned(question.id);
  }
}

/**
 * Replaces a deck's title, category, and questions. Old question ids are
 * regenerated rather than reused — an edited question's phrasing invalidates
 * whatever Claude previously learned to accept for it, so that must be
 * dropped rather than carried over under an unchanged id.
 */
export async function updateCustomDeck(
  tier: SubscriptionTier,
  id: string,
  title: string,
  category: string,
  drafts: { q: string; accept: string[] }[],
): Promise<CustomDeck> {
  const limits = tierLimits(tier);
  if (drafts.length > limits.maxQuestionsPerDeck) {
    throw new Error(`Your plan allows at most ${limits.maxQuestionsPerDeck} questions per deck. Upgrade for more.`);
  }

  const decks = await loadCustomDecks();
  const existing = decks.find((deck) => deck.id === id);

  let seq = await readJson<number>(KEY_CUSTOM_DECK_SEQ, 0);
  const questions: Question[] = drafts.map((draft) => {
    seq += 1;
    return { id: `deck_${seq}`, tier: 0, q: draft.q, accept: draft.accept };
  });
  const updated: CustomDeck = { id, title, category, questions };

  await AsyncStorage.setItem(
    KEY_CUSTOM_DECKS,
    JSON.stringify(decks.map((deck) => (deck.id === id ? updated : deck))),
  );
  await AsyncStorage.setItem(KEY_CUSTOM_DECK_SEQ, JSON.stringify(seq));

  for (const question of existing?.questions ?? []) {
    await clearLearned(question.id);
  }
  return updated;
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

/**
 * The judge's credential. Deliberately outside Settings: loadSettings()
 * results are dumped wholesale in tests and logs, and a secret must not ride
 * along. Stored as a raw string rather than JSON so nothing re-quotes it.
 *
 * Falls back to the build-time env var, so an existing .env keeps working and
 * clearing the field returns to it rather than leaving the app with no key.
 */
export async function loadApiKey(): Promise<string> {
  const stored = (await AsyncStorage.getItem(KEY_API_KEY))?.trim();
  return stored || process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY || '';
}

export async function saveApiKey(apiKey: string): Promise<void> {
  await AsyncStorage.setItem(KEY_API_KEY, apiKey.trim());
}
