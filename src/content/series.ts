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
  { id: 'custom-decks', label: '自分のデッキ' },
] as const;

export interface FundsFinanceCategory {
  id: string;
  name: string;
  nameEn: string;
  icon: string;
  description: string;
  sampleTerms: string[];
}

export const FUNDS_FINANCE_CATEGORIES: FundsFinanceCategory[] = [
  {
    id: 'sub-finance',
    name: 'サブスクリプション・ファイナンス',
    nameEn: 'Subscription Finance',
    icon: '💳',
    description: 'Capital calls, uncalled commitments, borrowing base, advance rates, side letters',
    sampleTerms: ['Capital Call', 'Borrowing Base', 'Advance Rate', 'Uncalled Commitment', 'Side Letter'],
  },
  {
    id: 'nav-finance',
    name: 'NAV ファイナンス',
    nameEn: 'NAV Finance',
    icon: '📊',
    description: 'Net asset value facilities, LTV covenants, portfolio valuation, asset coverage ratios',
    sampleTerms: ['NAV Facility', 'LTV Covenant', 'Asset Coverage Ratio', 'Portfolio Valuation'],
  },
  {
    id: 'hybrid-pref',
    name: 'ハイブリッド & 優先株ファイナンス',
    nameEn: 'Hybrid & Preferred Equity',
    icon: '⚖️',
    description: 'Hybrid facilities, preferred equity investments, mezzanine tranches, waterfalls',
    sampleTerms: ['Hybrid Facility', 'Preferred Equity', 'Mezzanine Tranche', 'Waterfall'],
  },
  {
    id: 'gp-facility',
    name: 'GP ファシリティ & 管理報酬',
    nameEn: 'GP Facilities & Fee Lines',
    icon: '🏛️',
    description: 'GP commitment facilities, management fee lines, co-investment loans',
    sampleTerms: ['GP Commitment Line', 'Management Fee Line', 'Co-investment Loan'],
  },
  {
    id: 'fund-covenants',
    name: 'ファンド契約 & コベナンツ',
    nameEn: 'Fund Documentation & Covenants',
    icon: '📜',
    description: 'LPA provisions, borrowing limits, event of default, clean-down provisions',
    sampleTerms: ['LPA Covenant', 'Borrowing Limit', 'Event of Default', 'Clean-down'],
  },
];

export interface FinancialRole {
  id: string;
  name: string;
  nameEn: string;
  icon: string;
  badge: string;
  description: string;
  difficulty: 'Wall St L1' | 'Quant L2' | 'Executive L3';
  isPro: boolean;
  sampleTopics: string[];
}

export const FINANCIAL_ROLES: FinancialRole[] = [
  {
    id: 'funds-finance',
    name: 'ファンドファイナンス',
    nameEn: 'Funds Finance & Sublines',
    icon: '🏢',
    badge: 'PE / Debt Desk',
    description: 'Capital calls, NAV facilities, borrowing base, side letters & LP/GP covenants',
    difficulty: 'Executive L3',
    isPro: true,
    sampleTopics: ['Capital Call', 'Borrowing Base', 'NAV Facility', 'Side Letter', 'Carried Interest'],
  },
  {
    id: 'hedge-funds',
    name: 'ヘッジファンド・トレーダー',
    nameEn: 'Hedge Funds & Trader Track',
    icon: '📈',
    badge: 'Trading Floor',
    description: 'Options Greeks, order book dynamics, alpha strategies & market microstructure',
    difficulty: 'Quant L2',
    isPro: true,
    sampleTopics: ['Options Greeks', 'Delta Neutral', 'Order Book', 'VaR 99%', 'Alpha / Beta'],
  },
  {
    id: 'banking',
    name: '投資銀行 (IBD & M&A)',
    nameEn: 'Investment Banking & M&A',
    icon: '💼',
    badge: 'Wall St Banking',
    description: 'LBO models, DCF valuation, accretion/dilution, enterprise value & debt sizing',
    difficulty: 'Executive L3',
    isPro: true,
    sampleTopics: ['LBO Model', 'DCF Valuation', 'EBITDA Multiple', 'Enterprise Value', 'Accretion'],
  },
  {
    id: 'risk-management',
    name: 'リスクマネージャー & クレジット',
    nameEn: 'Risk Managers & Credit',
    icon: '🛡️',
    badge: 'Risk & Compliance',
    description: 'Credit default swaps, Basel III/IV RWA, counterparty risk & stress testing',
    difficulty: 'Quant L2',
    isPro: true,
    sampleTopics: ['Credit Default Swap', 'Basel III RWA', 'Liquidity Coverage Ratio', 'Counterparty Risk'],
  },
  {
    id: 'cfa-prep',
    name: 'CFA チャーターホルダー',
    nameEn: 'CFA Charterholder Track',
    icon: '📜',
    badge: 'CFA Institute',
    description: 'CFA Level 1-3 ethics, quantitative methods, fixed income duration & derivatives',
    difficulty: 'Wall St L1',
    isPro: false,
    sampleTopics: ['Ethical Standards', 'Duration & Convexity', 'Time Value of Money', 'Sharpe Ratio'],
  },
  {
    id: 'private-equity',
    name: 'プライベート・エクイティ & VC',
    nameEn: 'Private Equity & VC',
    icon: '🏛️',
    badge: 'PE Waterfall',
    description: 'Valuation waterfalls, term sheets, hurdle rates, MOIC & liquidation preference',
    difficulty: 'Executive L3',
    isPro: true,
    sampleTopics: ['Waterfall Model', 'Hurdle Rate', 'Drag-Along', 'Liquidation Preference', 'MOIC'],
  },
  {
    id: 'wealth-management',
    name: 'ウェルスマネジメント',
    nameEn: 'Wealth & Private Banking',
    icon: '💰',
    badge: 'Private Banking',
    description: 'Asset allocation, portfolio rebalancing, estate structuring & tax optimization',
    difficulty: 'Wall St L1',
    isPro: false,
    sampleTopics: ['Asset Allocation', 'Rebalancing', 'Sortino Ratio', 'Family Office'],
  },
];

export type CategoryId = (typeof CATEGORIES)[number]['id'];

export interface Series {
  id: string;
  category: CategoryId;
  title: string;
  /** 出典. Absent on standard/custom, which have no book behind them. */
  credit?: string;
  questions: Question[];
  /** A FundsFinanceCategory id. Only set on series synthesized from a CustomDeck. */
  fundsCategory?: string;
}

/**
 * A user-authored deck, as stored on device. Shaped here (not imported from
 * storage.ts) so this module stays free of device imports (boundaries.test.ts).
 */
export interface CustomDeck {
  id: string;
  title: string;
  category: string;
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
  /** User-created decks, one series per deck under the custom-decks category. */
  customDecks?: CustomDeck[];
}

/**
 * Every series the app can offer, in category order. `standard` and `custom`
 * are synthesized here rather than living in the JSON, so the picker and the
 * round share one code path instead of the built-ins having their own.
 *
 * `custom` and `customDecks` arrive as arguments rather than being read from
 * AsyncStorage — that is what keeps this module free of device imports
 * (boundaries.test.ts).
 */
export function listSeries({
  custom,
  learned,
  maxTier,
  language = 'ja',
  customDecks = [],
}: SeriesInput): Series[] {
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

  const decks: Series[] = customDecks.map((deck) => ({
    id: deck.id,
    category: 'custom-decks',
    title: deck.title,
    questions: mergeLearned(deck.questions, learned),
    fundsCategory: deck.category,
  }));

  const all = [...authored, ...synthesized, ...decks];
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
