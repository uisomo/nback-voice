import type { Question } from '../engine/types';
import { loadBank, mergeLearned } from './bank';
import { CATEGORIES_EN } from './translate';
import rawJa from './series.json';
import rawEn from './series.en.json';

/**
 * Purpose-shaped groupings, in display order. A category exists to answer
 * "what am I training for", so its label is a sentence about intent rather
 * than a subject name.
 */
export const CATEGORIES = [
  { id: 'finance', label: '金融の語彙を体に入れる' },
  { id: 'delivery', label: '伝え方を変える' },
  { id: 'basics', label: 'だれでも答えられる' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

export interface Series {
  id: string;
  category: CategoryId;
  title: string;
  /** 出典. Absent on standard/custom, which have no book behind them. */
  credit?: string;
  questions: Question[];
}

export interface CategoryGroup {
  id: CategoryId;
  label: string;
  series: Series[];
}

export const STANDARD_SERIES_ID = 'standard';
export const CUSTOM_SERIES_ID = 'custom';

interface AuthoredSeries {
  id: string;
  category: string;
  title: string;
  credit?: string;
  questions: Question[];
}

const AUTHORED_JA = rawJa as AuthoredSeries[];
const AUTHORED_EN = rawEn as AuthoredSeries[];

const STANDARD_TITLE: Record<'ja' | 'en', string> = {
  ja: '標準問題',
  en: 'Standard Questions',
};
const CUSTOM_TITLE: Record<'ja' | 'en', string> = {
  ja: '自分の問題',
  en: 'My Questions',
};

/** Category labels for the given language, in `CATEGORIES`' fixed order. */
function categoryLabels(language: 'ja' | 'en'): Record<CategoryId, string> {
  if (language === 'ja') {
    return Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<CategoryId, string>;
  }
  return CATEGORIES_EN as Record<CategoryId, string>;
}

export interface SeriesInput {
  custom: Question[];
  learned: Record<string, string[]>;
  /** Highest built-in tier to draw from. Applies to the standard series only. */
  maxTier: number;
  /** UI/content language. Defaults to 'ja' so existing callers are unaffected. */
  language?: 'ja' | 'en';
}

/**
 * Every series the app can offer, in category order. `standard` and `custom`
 * are synthesized here rather than living in the JSON, so the picker and the
 * round share one code path instead of the built-ins having their own.
 *
 * `custom` arrives as an argument rather than being read from AsyncStorage —
 * that is what keeps this module free of device imports (boundaries.test.ts).
 */
export function listSeries({ custom, learned, maxTier, language = 'ja' }: SeriesInput): Series[] {
  const source = language === 'en' ? AUTHORED_EN : AUTHORED_JA;
  const authored: Series[] = source.map((series) => ({
    ...series,
    category: series.category as CategoryId,
    questions: mergeLearned(series.questions, learned),
  }));

  const synthesized: Series[] = [
    {
      id: STANDARD_SERIES_ID,
      category: 'basics',
      title: STANDARD_TITLE[language],
      questions: loadBank(learned).filter((q) => q.tier <= maxTier),
    },
    {
      id: CUSTOM_SERIES_ID,
      category: 'basics',
      title: CUSTOM_TITLE[language],
      questions: mergeLearned(custom, learned),
    },
  ];

  const all = [...authored, ...synthesized];
  return CATEGORIES.flatMap((category) =>
    all.filter((series) => series.category === category.id),
  );
}

/** Groups for the picker. Categories with no series are dropped, not shown empty. */
export function groupSeries(all: Series[], language: 'ja' | 'en' = 'ja'): CategoryGroup[] {
  const labels = categoryLabels(language);
  return CATEGORIES.map((category) => ({
    id: category.id,
    label: labels[category.id],
    series: all.filter((series) => series.category === category.id),
  })).filter((group) => group.series.length > 0);
}

/**
 * Resolve a stored id. Falls back to the standard series rather than throwing:
 * a renamed or removed series must not make the app unlaunchable.
 */
export function findSeries(all: Series[], id: string): Series {
  return (
    all.find((series) => series.id === id) ??
    all.find((series) => series.id === STANDARD_SERIES_ID)!
  );
}
