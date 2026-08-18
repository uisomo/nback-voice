# 質問シリーズ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 起動していきなり出題する形をやめ、カテゴリに束ねたシリーズを選んでから n-back ラウンドに入れるようにする。

**Architecture:** `Settings.questionSource` を `Settings.seriesId` に置き換える。シリーズは `src/content/series.json` に持ち、既存 `bank.json` の「標準問題」と AsyncStorage の「自分の問題」も同じ `Series` 型に合成して1つの一覧にする。N(ラグ)はシリーズごとに保存する。ホーム画面を新しい `SeriesScreen` にする。

**Tech Stack:** Expo (React Native 0.86) / TypeScript / jest-expo / @testing-library/react-native / AsyncStorage

**Spec:** `docs/superpowers/specs/2026-08-19-question-series-design.md`

## Global Constraints

- `src/content/`・`src/engine/`・`src/judge/` は React / React Native / Expo / AsyncStorage を **import してはならない**。`src/__tests__/boundaries.test.ts` が失敗する。
- 問題ID は `bank.json` + `series.json` + `user_N` の全体で一意。`nback.learned` が問題IDをキーにするため、衝突は学習済み同義語の漏洩になる。
- 1ラウンドは9問を引く。`MIN_QUESTIONS = STIMULI_PER_ROUND = 9`。9問未満のシリーズは開始できない。
- シリーズ問題の `tier` は必ず `0`(tier で絞らない、の意)。`maxTier` は `standard` にのみ効く。
- UI文言は日本語。コード内コメントは英語(既存コードの慣習)。
- テストは `npm test` で全て実機なしに走る。
- 答えは声に出せる短い名詞。`accept[]` には語彙の揺れのみ入れる(`normalizeTranscript` がカタカナ→ひらがな畳み込みと「です／かな／だと思います」除去を既に行う)。

---

### Task 1: シリーズのコンテンツモデル

`Series` 型・カテゴリ表・`listSeries`・`groupSeries`・`findSeries` を作り、最初の1シリーズ(`capital-call`)を載せる。残り3シリーズは Task 2。

**Files:**
- Create: `src/content/series.json`
- Create: `src/content/series.ts`
- Test: `src/content/__tests__/series.test.ts`

**Interfaces:**
- Consumes: `src/engine/types.ts` の `Question`、`src/content/bank.ts` の `loadBank` / `mergeLearned`
- Produces:
  - `CATEGORIES: readonly { id: string; label: string }[]`
  - `type CategoryId = 'finance' | 'delivery' | 'basics'`
  - `interface Series { id: string; category: CategoryId; title: string; credit?: string; questions: Question[] }`
  - `interface CategoryGroup { id: CategoryId; label: string; series: Series[] }`
  - `STANDARD_SERIES_ID = 'standard'`, `CUSTOM_SERIES_ID = 'custom'`
  - `listSeries(opts: { custom: Question[]; learned: Record<string, string[]>; maxTier: number }): Series[]`
  - `groupSeries(all: Series[]): CategoryGroup[]`
  - `findSeries(all: Series[], id: string): Series`

- [ ] **Step 1: Write the failing test**

`src/content/__tests__/series.test.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CATEGORIES,
  CUSTOM_SERIES_ID,
  STANDARD_SERIES_ID,
  findSeries,
  groupSeries,
  listSeries,
} from '../series';
import { normalizeTranscript } from '../normalize';
import { MIN_QUESTIONS } from '../pool';
import type { Question } from '../../engine/types';

const CUSTOM: Question[] = [
  { id: 'user_1', tier: 0, q: '自作1', accept: ['あ'] },
  { id: 'user_2', tier: 0, q: '自作2', accept: ['い'] },
];

const all = () => listSeries({ custom: CUSTOM, learned: {}, maxTier: 2 });

describe('series.json data contract', () => {
  const authored = JSON.parse(
    readFileSync(join(__dirname, '..', 'series.json'), 'utf8'),
  ) as { id: string; category: string; questions: Question[] }[];

  const bank = JSON.parse(
    readFileSync(join(__dirname, '..', 'bank.json'), 'utf8'),
  ) as Question[];

  it('gives every question a globally unique id', () => {
    // nback.learned is keyed by question id: a collision would leak one
    // question's learned synonyms into another.
    const ids = [...bank, ...authored.flatMap((s) => s.questions)].map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never collides with the custom-question id scheme', () => {
    for (const series of authored) {
      for (const question of series.questions) {
        expect(question.id).not.toMatch(/^user_/);
      }
    }
  });

  it('puts every series in a declared category', () => {
    const known = CATEGORIES.map((c) => c.id);
    for (const series of authored) {
      expect(known).toContain(series.category);
    }
  });

  it('gives every series enough questions for a round', () => {
    for (const series of authored) {
      expect(series.questions.length).toBeGreaterThanOrEqual(MIN_QUESTIONS);
    }
  });

  it('marks every series question tier 0 so maxTier cannot filter it', () => {
    for (const series of authored) {
      for (const question of series.questions) {
        expect(question.tier).toBe(0);
      }
    }
  });

  it('gives every question at least one answer that survives normalization', () => {
    for (const series of authored) {
      for (const question of series.questions) {
        expect(question.accept.length).toBeGreaterThan(0);
        for (const answer of question.accept) {
          expect(normalizeTranscript(answer)).not.toBe('');
        }
      }
    }
  });

  it('never repeats an answer inside one series', () => {
    // A round draws 9 of these and asks which answer went with which
    // question. Two questions sharing an answer makes a step unscoreable
    // through no fault of the player.
    for (const series of authored) {
      const firsts = series.questions.map((q) => normalizeTranscript(q.accept[0]));
      expect(new Set(firsts).size).toBe(firsts.length);
    }
  });
});

describe('listSeries', () => {
  it('synthesizes the standard series from the built-in bank', () => {
    const standard = all().find((s) => s.id === STANDARD_SERIES_ID);
    expect(standard).toBeDefined();
    expect(standard!.questions.length).toBeGreaterThan(MIN_QUESTIONS);
  });

  it('tier-filters the standard series only', () => {
    const atOne = listSeries({ custom: CUSTOM, learned: {}, maxTier: 1 });
    const atTwo = listSeries({ custom: CUSTOM, learned: {}, maxTier: 2 });
    const count = (list: ReturnType<typeof listSeries>, id: string) =>
      list.find((s) => s.id === id)!.questions.length;

    expect(count(atOne, STANDARD_SERIES_ID)).toBeLessThan(
      count(atTwo, STANDARD_SERIES_ID),
    );
    expect(count(atOne, 'capital-call')).toBe(count(atTwo, 'capital-call'));
  });

  it('carries the custom questions through untouched', () => {
    const custom = all().find((s) => s.id === CUSTOM_SERIES_ID);
    expect(custom!.questions.map((q) => q.id)).toEqual(['user_1', 'user_2']);
  });

  it('merges learned synonyms onto authored series, not just the bank', () => {
    const learned = { cc_01: ['よびだし'] };
    const list = listSeries({ custom: CUSTOM, learned, maxTier: 2 });
    const question = list
      .find((s) => s.id === 'capital-call')!
      .questions.find((q) => q.id === 'cc_01')!;
    expect(question.accept).toContain('よびだし');
  });

  it('merges learned synonyms onto custom questions too', () => {
    const list = listSeries({
      custom: CUSTOM,
      learned: { user_1: ['ええ'] },
      maxTier: 2,
    });
    const question = list
      .find((s) => s.id === CUSTOM_SERIES_ID)!
      .questions.find((q) => q.id === 'user_1')!;
    expect(question.accept).toEqual(['あ', 'ええ']);
  });

  it('orders series by category declaration order', () => {
    const categories = all().map((s) => s.category);
    const rank = (c: string) => CATEGORIES.findIndex((x) => x.id === c);
    const ranks = categories.map(rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});

describe('groupSeries', () => {
  it('labels each group and skips categories with no series', () => {
    const groups = groupSeries(all());
    expect(groups.map((g) => g.id)).toContain('finance');
    expect(groups.map((g) => g.id)).toContain('basics');
    for (const group of groups) {
      expect(group.series.length).toBeGreaterThan(0);
      expect(group.label).not.toBe('');
    }
  });

  it('drops a category whose series are all absent', () => {
    const onlyFinance = all().filter((s) => s.category === 'finance');
    expect(groupSeries(onlyFinance).map((g) => g.id)).toEqual(['finance']);
  });
});

describe('findSeries', () => {
  it('finds by id', () => {
    expect(findSeries(all(), 'capital-call').id).toBe('capital-call');
  });

  it('falls back to standard for an unknown id', () => {
    // Renaming or dropping a series must not brick the app on launch for
    // someone whose stored seriesId no longer exists.
    expect(findSeries(all(), 'no-such-series').id).toBe(STANDARD_SERIES_ID);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/content/__tests__/series.test.ts`
Expected: FAIL — `Cannot find module '../series'`

- [ ] **Step 3: Create `src/content/series.json`**

```json
[
  {
    "id": "capital-call",
    "category": "finance",
    "title": "コミットメントとキャピタルコール",
    "credit": "『ファンドファイナンスの教科書』より",
    "questions": [
      { "id": "cc_01", "tier": 0, "q": "GPがLPに出資の払込を求めることは？", "accept": ["キャピタルコール", "資本コール", "コール"] },
      { "id": "cc_02", "tier": 0, "q": "サブラインの返済原資になる未払込の資金は？", "accept": ["未コールコミットメント", "コミットメント", "未払込コミットメント", "アンファンデッド"] },
      { "id": "cc_03", "tier": 0, "q": "未コール残高に掛け目を乗じた与信枠の上限は？", "accept": ["ボローイングベース", "借入ベース", "ボロイングベース"] },
      { "id": "cc_04", "tier": 0, "q": "ボローイングベースを計算するときの掛け目は？", "accept": ["アドバンスレート", "掛け目", "かけめ"] },
      { "id": "cc_05", "tier": 0, "q": "LPとGPが個別に結ぶ特別条件の覚書は？", "accept": ["サイドレター"] },
      { "id": "cc_06", "tier": 0, "q": "他のLPと同等の条件を保証する条項は？", "accept": ["最恵国待遇", "エムエフエヌ", "MFN"] },
      { "id": "cc_07", "tier": 0, "q": "コミットメントを一部だけ算入することを何という？", "accept": ["ヘアカット", "掛け目控除"] },
      { "id": "cc_08", "tier": 0, "q": "投資実行から払込までのつなぎ資金は？", "accept": ["ブリッジ", "ブリッジ資金", "つなぎ"] },
      { "id": "cc_09", "tier": 0, "q": "通常の返済に充てる資金源を何という？", "accept": ["一次返済原資", "一次原資"] },
      { "id": "cc_10", "tier": 0, "q": "特定LPへの偏りが返済原資を壊すリスクは？", "accept": ["集中リスク", "集中"] },
      { "id": "cc_11", "tier": 0, "q": "借入と返済を繰り返せる融資枠の形式は？", "accept": ["リボルビング", "リボルバー", "回転"] },
      { "id": "cc_12", "tier": 0, "q": "持分比率に応じて按分することを何という？", "accept": ["プロラタ", "按分", "あんぶん"] },
      { "id": "cc_13", "tier": 0, "q": "ファンドの基本ルールを定める契約は？", "accept": ["エルピーエー", "LPA", "リミテッドパートナーシップ契約", "組合契約"] },
      { "id": "cc_14", "tier": 0, "q": "キャピタルコールを発動する側は？", "accept": ["ジーピー", "GP", "ゼネラルパートナー", "無限責任組合員"] },
      { "id": "cc_15", "tier": 0, "q": "ファンドが新規投資を実行できる期間は？", "accept": ["投資期間", "インベストメントピリオド"] }
    ]
  }
]
```

- [ ] **Step 4: Create `src/content/series.ts`**

```ts
import type { Question } from '../engine/types';
import { loadBank, mergeLearned } from './bank';
import raw from './series.json';

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

const AUTHORED = raw as AuthoredSeries[];

export interface SeriesInput {
  custom: Question[];
  learned: Record<string, string[]>;
  /** Highest built-in tier to draw from. Applies to the standard series only. */
  maxTier: number;
}

/**
 * Every series the app can offer, in category order. `standard` and `custom`
 * are synthesized here rather than living in the JSON, so the picker and the
 * round share one code path instead of the built-ins having their own.
 *
 * `custom` arrives as an argument rather than being read from AsyncStorage —
 * that is what keeps this module free of device imports (boundaries.test.ts).
 */
export function listSeries({ custom, learned, maxTier }: SeriesInput): Series[] {
  const authored: Series[] = AUTHORED.map((series) => ({
    ...series,
    category: series.category as CategoryId,
    questions: mergeLearned(series.questions, learned),
  }));

  const synthesized: Series[] = [
    {
      id: STANDARD_SERIES_ID,
      category: 'basics',
      title: '標準問題',
      questions: loadBank(learned).filter((q) => q.tier <= maxTier),
    },
    {
      id: CUSTOM_SERIES_ID,
      category: 'basics',
      title: '自分の問題',
      questions: mergeLearned(custom, learned),
    },
  ];

  const all = [...authored, ...synthesized];
  return CATEGORIES.flatMap((category) =>
    all.filter((series) => series.category === category.id),
  );
}

/** Groups for the picker. Categories with no series are dropped, not shown empty. */
export function groupSeries(all: Series[]): CategoryGroup[] {
  return CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/content/__tests__/series.test.ts src/__tests__/boundaries.test.ts`
Expected: PASS — both files green. `boundaries.test.ts` proves `series.ts` pulled in no device imports.

- [ ] **Step 6: Commit**

```bash
git add src/content/series.ts src/content/series.json src/content/__tests__/series.test.ts
git commit -m "feat(content): シリーズのコンテンツモデル — カテゴリ・合成・フォールバック"
```

---

### Task 2: 残り3シリーズの執筆

`series.json` に `nav-finance` / `fund-cast` / `persuasion` を追加する。Task 1 のデータ契約テストが新シリーズにも自動で効くので、新しいテストは1本だけ足す。

**Files:**
- Modify: `src/content/series.json` (配列に3要素追加)
- Test: `src/content/__tests__/series.test.ts` (1 describe 追加)

**Interfaces:**
- Consumes: Task 1 の `listSeries`
- Produces: シリーズID `nav-finance` / `fund-cast` / `persuasion`。Task 4 の画面テストがこれらの存在を前提にする。

**出典について:** `company/data/learn_sources.json` は書籍19/24/26を挙げるが、その原稿はこのマシンに無い。実際に読んだ原稿にのみ出典を付ける。金融3シリーズは `/mnt/c/Projects/book/Books2/6.FundsFinanceの教科書`、説得シリーズは `/mnt/c/Projects/book/Books2/11.Persuasion` 由来。

- [ ] **Step 1: Write the failing test**

`src/content/__tests__/series.test.ts` の末尾に追加:

```ts
describe('the shipped catalogue', () => {
  it('offers the four authored series across two purpose categories', () => {
    const list = listSeries({ custom: [], learned: {}, maxTier: 2 });
    const ids = list.map((s) => s.id);
    expect(ids).toEqual([
      'capital-call',
      'nav-finance',
      'fund-cast',
      'persuasion',
      STANDARD_SERIES_ID,
      CUSTOM_SERIES_ID,
    ]);
  });

  it('credits every authored series to the manuscript it came from', () => {
    const list = listSeries({ custom: [], learned: {}, maxTier: 2 });
    for (const series of list) {
      const synthesized =
        series.id === STANDARD_SERIES_ID || series.id === CUSTOM_SERIES_ID;
      if (synthesized) {
        expect(series.credit).toBeUndefined();
      } else {
        expect(series.credit).toMatch(/より$/);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/content/__tests__/series.test.ts -t 'shipped catalogue'`
Expected: FAIL — 受け取る配列は `['capital-call', 'standard', 'custom']` で、3シリーズが足りない。

- [ ] **Step 3: Add the three series to `src/content/series.json`**

`capital-call` オブジェクトの後ろ、配列の閉じ括弧の前に挿入する:

```json
  ,
  {
    "id": "nav-finance",
    "category": "finance",
    "title": "NAVと担保の基礎",
    "credit": "『ファンドファイナンスの教科書』より",
    "questions": [
      { "id": "nav_01", "tier": 0, "q": "資産の時価から負債を引いた純資産価値は？", "accept": ["エヌエーブイ", "NAV", "純資産価値"] },
      { "id": "nav_02", "tier": 0, "q": "資産価値に対する貸付残高の比率は？", "accept": ["エルティーブイ", "LTV", "ローントゥバリュー"] },
      { "id": "nav_03", "tier": 0, "q": "投資先から定期的に受け取る返済原資は？", "accept": ["分配金", "分配"] },
      { "id": "nav_04", "tier": 0, "q": "投資先を第三者に売って得る返済原資は？", "accept": ["売却代金", "売却", "売却益"] },
      { "id": "nav_05", "tier": 0, "q": "貸し手が入金口座を押さえるために結ぶ契約は？", "accept": ["口座支配契約", "アカウントコントロール契約", "エーシーエー"] },
      { "id": "nav_06", "tier": 0, "q": "入金を自動で返済に充てる仕組みは？", "accept": ["スイープ", "自動充当"] },
      { "id": "nav_07", "tier": 0, "q": "サブラインとNAVを組み合わせた商品は？", "accept": ["ハイブリッド"] },
      { "id": "nav_08", "tier": 0, "q": "特定の資産や分配だけを返済原資に縛る商品は？", "accept": ["アセットバックト", "アセットバック", "資産担保型"] },
      { "id": "nav_09", "tier": 0, "q": "借り手が返済原資を動かせる法的な力は？", "accept": ["権限", "オーソリティー"] },
      { "id": "nav_10", "tier": 0, "q": "貸し手の請求が他に先んじる度合いは？", "accept": ["優先順位", "プライオリティ"] },
      { "id": "nav_11", "tier": 0, "q": "資金の流れを物理的に押さえることは？", "accept": ["支配", "コントロール"] },
      { "id": "nav_12", "tier": 0, "q": "現地法について弁護士に出させる意見書は？", "accept": ["リーガルオピニオン", "法律意見書", "意見書"] }
    ]
  },
  {
    "id": "fund-cast",
    "category": "finance",
    "title": "ファンドの登場人物",
    "credit": "『ファンドファイナンスの教科書』より",
    "questions": [
      { "id": "fc_01", "tier": 0, "q": "出資するが運用に関与しない投資家は？", "accept": ["エルピー", "LP", "リミテッドパートナー", "有限責任組合員"] },
      { "id": "fc_02", "tier": 0, "q": "税務や規制の事情で作る別のビークルは？", "accept": ["エーアイブイ", "AIV", "代替投資ビークル"] },
      { "id": "fc_03", "tier": 0, "q": "課税を遮断するために間に挟む法人は？", "accept": ["ブロッカー", "ブロッカー法人"] },
      { "id": "fc_04", "tier": 0, "q": "本体と同条件で並走する兄弟ファンドは？", "accept": ["並行ファンド", "パラレルファンド"] },
      { "id": "fc_05", "tier": 0, "q": "新しい主体を既存契約に参加させる契約は？", "accept": ["ジョインダー", "ジョインダー契約", "参加契約"] },
      { "id": "fc_06", "tier": 0, "q": "ファンドに投資するファンドは？", "accept": ["ファンドオブファンズ", "エフオーエフ", "FoF"] },
      { "id": "fc_07", "tier": 0, "q": "国家が運用する巨大な投資ファンドは？", "accept": ["政府系ファンド", "エスダブリューエフ", "SWF", "ソブリンウェルスファンド"] },
      { "id": "fc_08", "tier": 0, "q": "政府系ファンドの透明性を求める国際原則は？", "accept": ["サンティアゴ原則", "サンティアゴ"] },
      { "id": "fc_09", "tier": 0, "q": "資産と負債の期間を合わせる管理は？", "accept": ["エーエルエム", "ALM", "資産負債管理"] },
      { "id": "fc_10", "tier": 0, "q": "米国の年金を規律する法律は？", "accept": ["エリサ", "ERISA", "エリサ法"] },
      { "id": "fc_11", "tier": 0, "q": "富裕層一族の資産を運用する組織は？", "accept": ["ファミリーオフィス"] },
      { "id": "fc_12", "tier": 0, "q": "運用資産の総額を何という？", "accept": ["エーユーエム", "AUM", "運用資産総額"] }
    ]
  },
  {
    "id": "persuasion",
    "category": "delivery",
    "title": "説得のデザイン",
    "credit": "『複雑な情報で相手を動かす』より",
    "questions": [
      { "id": "pe_01", "tier": 0, "q": "説得されたと感じた瞬間に起きる抵抗は？", "accept": ["リアクタンス", "心理的リアクタンス", "反応性"] },
      { "id": "pe_02", "tier": 0, "q": "状況・問題・問い・答えで組む構造は？", "accept": ["エスシーキューエー", "SCQA"] },
      { "id": "pe_03", "tier": 0, "q": "結論を先に置くミントの構造原則は？", "accept": ["ピラミッド原則", "ピラミッド"] },
      { "id": "pe_04", "tier": 0, "q": "情報を3〜4個の塊に分けて出す方法は？", "accept": ["チャンキング", "チャンク"] },
      { "id": "pe_05", "tier": 0, "q": "作業記憶が一度に扱える塊はいくつ？", "accept": ["4", "四", "よん", "よっつ", "四つ"] },
      { "id": "pe_06", "tier": 0, "q": "既知の知識を橋にして新概念を渡す道具は？", "accept": ["アナロジー", "たとえ", "比喩"] },
      { "id": "pe_07", "tier": 0, "q": "相手に自分の言葉で説明させる手法は？", "accept": ["フェインマンテクニック", "フェインマン"] },
      { "id": "pe_08", "tier": 0, "q": "聞く時間を長く取り感情を探らせる対話法は？", "accept": ["ディープキャンバシング", "ディープキャンバス"] },
      { "id": "pe_09", "tier": 0, "q": "現在の立場と本当のゴールの差を作ることは？", "accept": ["乖離", "かいり", "ディスクレパンシー"] },
      { "id": "pe_10", "tier": 0, "q": "質問だけで相手を自己矛盾に導く技法は？", "accept": ["ソクラテス法", "ソクラテス式問答", "ソクラテス"] },
      { "id": "pe_11", "tier": 0, "q": "弱い反論を先に自分で潰しておく理論は？", "accept": ["予防接種理論", "予防接種", "イノキュレーション"] },
      { "id": "pe_12", "tier": 0, "q": "小さなYESを積んで大きなYESにつなぐ技は？", "accept": ["フットインザドア", "段階的要請"] },
      { "id": "pe_13", "tier": 0, "q": "注意・必要性・解決・可視化・行動と進む型は？", "accept": ["モンロー説得シーケンス", "モンロー", "モンローシーケンス"] },
      { "id": "pe_14", "tier": 0, "q": "物語への没入が反論の力を奪う現象は？", "accept": ["ナラティブトランスポーテーション", "トランスポーテーション", "物語没入"] },
      { "id": "pe_15", "tier": 0, "q": "直感で速く判断する側の思考は？", "accept": ["システム1", "システムいち", "システムワン"] },
      { "id": "pe_16", "tier": 0, "q": "合意できないときの最良の代替案は？", "accept": ["バトナ", "BATNA"] },
      { "id": "pe_17", "tier": 0, "q": "最初の数字が判断の基準になる効果は？", "accept": ["アンカリング", "アンカー"] },
      { "id": "pe_18", "tier": 0, "q": "YesかNoではなくAかBかを問う枠は？", "accept": ["強制選択", "フォーストチョイス"] }
    ]
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/content/__tests__/series.test.ts`
Expected: PASS — 一意性・9問下限・tier 0・答えの非重複を含む全ケースが緑。

- [ ] **Step 5: Commit**

```bash
git add src/content/series.json src/content/__tests__/series.test.ts
git commit -m "feat(content): 金融3シリーズと説得シリーズ 57問"
```

---

### Task 3: 保存層 — seriesId とシリーズ別N

**Files:**
- Modify: `src/store/storage.ts`
- Test: `src/store/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: Task 1 の `STANDARD_SERIES_ID`
- Produces:
  - `Settings.seriesId: string` (`questionSource` は削除)
  - `loadN(seriesId: string): Promise<number>`
  - `saveN(seriesId: string, n: number): Promise<void>`
  - `RoundRecord.seriesId?: string`

- [ ] **Step 1: Write the failing test**

`src/store/__tests__/storage.test.ts` の `describe('adaptive N', ...)` を丸ごと次に置き換え、末尾に移行の describe を足す:

```ts
describe('adaptive N per series', () => {
  it('starts at 1 for a series never played', async () => {
    // The lag is the whole difficulty of the exercise. A finance series is
    // heavy on its own, so it must not inherit the standard series' lag.
    expect(await loadN('capital-call')).toBe(1);
  });

  it('round-trips per series', async () => {
    await saveN('standard', 4);
    expect(await loadN('standard')).toBe(4);
  });

  it('keeps series independent', async () => {
    await saveN('standard', 3);
    await saveN('persuasion', 2);
    expect(await loadN('standard')).toBe(3);
    expect(await loadN('persuasion')).toBe(2);
    expect(await loadN('fund-cast')).toBe(1);
  });

  it('seeds the standard series from the legacy single-value key', async () => {
    await AsyncStorage.setItem('nback.n', JSON.stringify(3));
    expect(await loadN('standard')).toBe(3);
    expect(await loadN('capital-call')).toBe(1);
  });

  it('leaves the legacy key in place after seeding', async () => {
    await AsyncStorage.setItem('nback.n', JSON.stringify(3));
    await loadN('standard');
    expect(await AsyncStorage.getItem('nback.n')).toBe('3');
  });
});

describe('settings migration to seriesId', () => {
  it('defaults to the standard series', async () => {
    expect((await loadSettings()).seriesId).toBe('standard');
  });

  it('migrates questionSource "custom" to the custom series', async () => {
    await AsyncStorage.setItem(
      'nback.settings',
      JSON.stringify({ questionSource: 'custom' }),
    );
    expect((await loadSettings()).seriesId).toBe('custom');
  });

  it('migrates "builtin" and "both" to the standard series', async () => {
    // 'both' has no equivalent: the mixed pool is gone and 自分の問題 is now
    // its own series. This is deliberately lossy.
    for (const source of ['builtin', 'both']) {
      await AsyncStorage.setItem(
        'nback.settings',
        JSON.stringify({ questionSource: source }),
      );
      expect((await loadSettings()).seriesId).toBe('standard');
    }
  });

  it('drops the obsolete key from the returned settings', async () => {
    await AsyncStorage.setItem(
      'nback.settings',
      JSON.stringify({ questionSource: 'custom' }),
    );
    expect(await loadSettings()).not.toHaveProperty('questionSource');
  });

  it('prefers an explicit seriesId over the legacy key', async () => {
    await AsyncStorage.setItem(
      'nback.settings',
      JSON.stringify({ questionSource: 'custom', seriesId: 'persuasion' }),
    );
    expect((await loadSettings()).seriesId).toBe('persuasion');
  });
});

describe('history carries the series', () => {
  it('round-trips seriesId', async () => {
    await appendHistory({
      date: '2026-08-19',
      n: 2,
      positionScore: 1,
      answerScore: 0.5,
      unresolved: 0,
      seriesId: 'persuasion',
    });
    expect((await loadHistory())[0].seriesId).toBe('persuasion');
  });
});
```

既存の `describe('settings defaults for the new fields', ...)` の中にある2つの
`expect(s.questionSource).toBe('builtin');` は
`expect(s.seriesId).toBe('standard');` に書き換える。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/storage.test.ts`
Expected: FAIL — `loadN('capital-call')` は引数を無視して1を返すので一部通るが、`saveN('standard', 3)` の分離テストと `seriesId` 系が落ちる。TypeScript も `saveN` の引数数で型エラーを出す。

- [ ] **Step 3: Modify `src/store/storage.ts`**

`import type { QuestionSource } from '../content/pool';` を削除し、次を追加:

```ts
import { STANDARD_SERIES_ID } from '../content/series';
```

`Settings` を差し替え:

```ts
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
}
```

`RoundRecord` に1行足す:

```ts
export interface RoundRecord {
  date: string;
  n: number;
  /** null in question mode: the channel was absent, not scored zero. */
  positionScore: number | null;
  answerScore: number | null;
  unresolved: number;
  /** Absent on rounds recorded before series existed. */
  seriesId?: string;
}
```

`DEFAULT_SETTINGS` の `questionSource: 'builtin',` を `seriesId: STANDARD_SERIES_ID,` に置き換える。

`KEY_N` の隣に足す:

```ts
const KEY_N_BY_SERIES = 'nback.n.bySeries';
```

`loadSettings` を差し替え:

```ts
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
    settings.seriesId = questionSource === 'custom' ? 'custom' : STANDARD_SERIES_ID;
  }

  return settings;
}
```

`loadN` / `saveN` を差し替え:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/storage.test.ts`
Expected: PASS

型チェック: `npx tsc --noEmit`
Expected: `GameScreen.tsx` と `SettingsScreen.tsx` がまだ `questionSource` / 旧 `loadN` を使っているためエラーが残る。Task 5・6 で解消する。ここでは storage のテストが緑であればよい。

- [ ] **Step 5: Commit**

```bash
git add src/store/storage.ts src/store/__tests__/storage.test.ts
git commit -m "feat(store): seriesId への移行とシリーズ別N"
```

---

### Task 4: SeriesScreen

**Files:**
- Create: `src/ui/SeriesScreen.tsx`
- Test: `src/ui/__tests__/SeriesScreen.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `listSeries` / `groupSeries`、Task 3 の `loadN` / `loadSettings` / `loadCustom` / `loadLearned`、`MIN_QUESTIONS`
- Produces: `<SeriesScreen onSelect={(seriesId: string) => void} onOpenSettings={() => void} />`

- [ ] **Step 1: Write the failing test**

`src/ui/__tests__/SeriesScreen.test.tsx`:

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { addCustom, saveN } from '../../store/storage';
import { SeriesScreen } from '../SeriesScreen';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('SeriesScreen', () => {
  it('lists categories in declaration order', async () => {
    render(<SeriesScreen onSelect={jest.fn()} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('金融の語彙を体に入れる')).toBeTruthy();
    });
    expect(screen.getByText('伝え方を変える')).toBeTruthy();
    expect(screen.getByText('だれでも答えられる')).toBeTruthy();
  });

  it('shows each series with its question count and 出典', async () => {
    render(<SeriesScreen onSelect={jest.fn()} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('コミットメントとキャピタルコール')).toBeTruthy();
    });
    expect(screen.getByTestId('series-count-capital-call')).toHaveTextContent('15問');
    expect(screen.getByText('『ファンドファイナンスの教科書』より')).toBeTruthy();
  });

  it('selects a series on press', async () => {
    const onSelect = jest.fn();
    render(<SeriesScreen onSelect={onSelect} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('series-persuasion')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('series-persuasion'));
    expect(onSelect).toHaveBeenCalledWith('persuasion');
  });

  it('refuses a series with fewer than nine questions and names the shortfall', async () => {
    await addCustom('一問だけ', 'あ');
    const onSelect = jest.fn();
    render(<SeriesScreen onSelect={onSelect} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/あと 8 問/)).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('series-custom'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows the stored lag for each series independently', async () => {
    await saveN('capital-call', 2);
    render(<SeriesScreen onSelect={jest.fn()} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('series-lag-capital-call')).toHaveTextContent('2-back');
    });
    expect(screen.getByTestId('series-lag-persuasion')).toHaveTextContent('1-back');
  });

  it('opens settings', async () => {
    const onOpenSettings = jest.fn();
    render(<SeriesScreen onSelect={jest.fn()} onOpenSettings={onOpenSettings} />);
    await waitFor(() => {
      expect(screen.getByText('設定')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('設定'));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/ui/__tests__/SeriesScreen.test.tsx`
Expected: FAIL — `Cannot find module '../SeriesScreen'`

- [ ] **Step 3: Create `src/ui/SeriesScreen.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  groupSeries,
  listSeries,
  type CategoryGroup,
} from '../content/series';
import { MIN_QUESTIONS } from '../content/pool';
import {
  loadCustom,
  loadLearned,
  loadN,
  loadSettings,
} from '../store/storage';

interface Props {
  onSelect: (seriesId: string) => void;
  onOpenSettings: () => void;
}

interface Row {
  id: string;
  title: string;
  credit?: string;
  count: number;
  /** The lag this series is currently at, kept per series. */
  n: number;
}

interface Group {
  id: string;
  label: string;
  rows: Row[];
}

export function SeriesScreen({ onSelect, onOpenSettings }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [settings, custom, learned] = await Promise.all([
        loadSettings(),
        loadCustom(),
        loadLearned(),
      ]);
      const all = listSeries({ custom, learned, maxTier: settings.maxTier });
      const withLag = await Promise.all(
        groupSeries(all).map(async (group: CategoryGroup) => ({
          id: group.id,
          label: group.label,
          rows: await Promise.all(
            group.series.map(async (series) => ({
              id: series.id,
              title: series.title,
              credit: series.credit,
              count: series.questions.length,
              n: await loadN(series.id),
            })),
          ),
        })),
      );
      if (!cancelled) setGroups(withLag);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.heading}>シリーズを選ぶ</Text>
        <Pressable onPress={onOpenSettings}>
          <Text style={styles.settings}>設定</Text>
        </Pressable>
      </View>

      <ScrollView>
        {groups.map((group) => (
          <View key={group.id} style={styles.group}>
            <Text style={styles.category}>{group.label}</Text>
            {group.rows.map((row) => {
              // A series below nine cannot fill a round. Show it anyway with
              // the shortfall named, rather than hiding it and leaving the
              // owner to guess why their questions never appear.
              const shortfall = MIN_QUESTIONS - row.count;
              const usable = shortfall <= 0;
              return (
                <Pressable
                  key={row.id}
                  testID={`series-${row.id}`}
                  onPress={() => usable && onSelect(row.id)}
                  style={[styles.row, !usable && styles.rowOff]}
                >
                  <Text style={styles.title}>{row.title}</Text>
                  {row.credit && <Text style={styles.credit}>{row.credit}</Text>}
                  <View style={styles.meta}>
                    <Text testID={`series-count-${row.id}`} style={styles.count}>
                      {usable ? `${row.count}問` : `あと ${shortfall} 問`}
                    </Text>
                    {usable && (
                      <Text testID={`series-lag-${row.id}`} style={styles.lag}>
                        {row.n}-back
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, paddingTop: 72, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  heading: { color: '#f4f1ea', fontSize: 28 },
  settings: { color: '#8e8e93', fontSize: 16 },
  group: { marginBottom: 28 },
  category: { color: '#c96f4a', fontSize: 14, marginBottom: 10 },
  row: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1e',
  },
  rowOff: { opacity: 0.4 },
  title: { color: '#f4f1ea', fontSize: 18 },
  credit: { color: '#8e8e93', fontSize: 12, marginTop: 2 },
  meta: { flexDirection: 'row', gap: 12, marginTop: 4 },
  count: { color: '#8e8e93', fontSize: 14 },
  lag: { color: '#8e8e93', fontSize: 14, marginLeft: 'auto' },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/ui/__tests__/SeriesScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/SeriesScreen.tsx src/ui/__tests__/SeriesScreen.test.tsx
git commit -m "feat(ui): シリーズ選択画面 — カテゴリ・問数・出典・シリーズ別ラグ"
```

---

### Task 5: GameScreen をシリーズで動かし、pool.ts を捨てる

**Files:**
- Modify: `src/ui/GameScreen.tsx`
- Modify: `src/content/pool.ts` (`resolvePool` と `QuestionSource` を削除、`MIN_QUESTIONS` は残す)
- Delete: `src/content/__tests__/pool.test.ts` (`MIN_QUESTIONS` のケースは `series.test.ts` へ移す)
- Test: `src/ui/__tests__/GameScreen.test.tsx`
- Test: `src/content/__tests__/series.test.ts` (1ケース追加)

**Interfaces:**
- Consumes: Task 1 の `listSeries` / `findSeries`、Task 3 の `loadN(seriesId)` / `saveN(seriesId, n)`
- Produces: `<GameScreen seriesId={string} onFinished={...} deps={...} />`

- [ ] **Step 1: Write the failing test**

`src/content/__tests__/series.test.ts` の末尾に、`pool.test.ts` から救い出すケースを足す:

```ts
describe('MIN_QUESTIONS', () => {
  it('is the number of stimuli in a round', () => {
    // The series picker's guard and GameScreen's re-check both compare
    // against this, so it must track STIMULI_PER_ROUND rather than being
    // its own literal.
    expect(MIN_QUESTIONS).toBe(9);
  });
});
```

`src/ui/__tests__/GameScreen.test.tsx` の `describe('GameScreen question source', ...)` を丸ごと次に置き換える:

```tsx
describe('GameScreen series', () => {
  it('draws only from the chosen series', async () => {
    for (let i = 0; i < 9; i++) await addCustom(`自作${i}`, `答え${i}`);
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    render(
      <GameScreen seriesId="custom" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await runWholeRound();
    expect(speaker.spoken).toHaveLength(9);
    for (const spoken of speaker.spoken) {
      expect(spoken).toMatch(/^自作\d$/);
    }
  });

  it('draws from an authored series without any settings change', async () => {
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    render(
      <GameScreen seriesId="persuasion" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await runWholeRound();
    // Every persuasion question ends in ？ and none of them are bank items.
    expect(speaker.spoken).toHaveLength(9);
    for (const spoken of speaker.spoken) {
      expect(spoken).toMatch(/？$/);
    }
  });

  it('shows 問題が足りません when the series is too small', async () => {
    await addCustom('一問だけ', 'あ');
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="custom" onFinished={jest.fn()} deps={deps} />);
    expect(await screen.findByText(/問題が足りません/)).toBeTruthy();
  });

  it('falls back to the standard series for an unknown id', async () => {
    const { deps, speaker } = makeDefaultDeps(alwaysCorrect);
    render(
      <GameScreen seriesId="deleted-series" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await runWholeRound();
    expect(speaker.spoken).toHaveLength(9);
  });

  it('saves the raised lag under the series that earned it', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(
      <GameScreen seriesId="persuasion" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await runWholeRound();
    expect(await loadN('persuasion')).toBe(2);
    // The standard series must not inherit a lag earned elsewhere.
    expect(await loadN('standard')).toBe(1);
  });

  it('names the series on the warm-up screen before the mic opens', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(
      <GameScreen seriesId="persuasion" onFinished={jest.fn()} deps={deps} />,
    );
    expect(await screen.findByTestId('warmup-series')).toHaveTextContent(
      '説得のデザイン ／ 18問',
    );
  });

  it('stamps the series onto the history record', async () => {
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(
      <GameScreen seriesId="persuasion" onFinished={jest.fn()} deps={deps} />,
    );
    await beginRound();
    await runWholeRound();
    expect((await loadHistory())[0].seriesId).toBe('persuasion');
  });
});
```

このファイル内の既存の `render(<GameScreen onFinished={...} deps={deps} />)` は
すべて `render(<GameScreen seriesId="standard" onFinished={...} deps={deps} />)`
に書き換える。既存の `expect(await loadN()).toBe(...)` はすべて
`expect(await loadN('standard')).toBe(...)` にする。
`import { screen }` が未追加なら `@testing-library/react-native` の import に足す。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/ui/__tests__/GameScreen.test.tsx`
Expected: FAIL — `GameScreen` は `seriesId` prop を知らず、`settings.questionSource` を読もうとする。

- [ ] **Step 3: Modify `src/ui/GameScreen.tsx`**

import を差し替える。`import { loadBank, mergeLearned } from '../content/bank';` と
`import { MIN_QUESTIONS, resolvePool } from '../content/pool';` を次に置き換え:

```ts
import { MIN_QUESTIONS } from '../content/pool';
import { findSeries, listSeries } from '../content/series';
```

`Props` に prop を足す:

```ts
interface Props {
  /** Which series this round draws from. */
  seriesId: string;
  onFinished: (engine: RoundEngine, plan: RoundPlan) => void;
  /** Overridden in tests; defaults to the real Expo and Claude implementations. */
  deps?: GameScreenDeps;
}
```

コンポーネントの引数を `export function GameScreen({ seriesId, onFinished, deps }: Props) {` にする。

セットアップブロックの `Promise.all` と pool 解決を差し替え:

```ts
        const [settings, learned, custom] = await Promise.all([
          loadSettings(),
          loadLearned(),
          loadCustom(),
        ]);
        if (cancelled) return;

        const series = findSeries(
          listSeries({ custom, learned, maxTier: settings.maxTier }),
          seriesId,
        );
        const storedN = await loadN(series.id);
        const n = settings.adaptive ? storedN : settings.fixedN;
        const pool = series.questions;
```

`if (pool.length < MIN_QUESTIONS)` のブロックはそのまま残す(コメントも含む)。

`finish` の中の2箇所を差し替え:

```ts
              if (settings.adaptive) await saveN(series.id, engine.nextN(n));
              await appendHistory({
                date: localDate(),
                n,
                positionScore: engine.positionScore,
                answerScore: engine.answerScore,
                unresolved: engine.unresolvedCount,
                seriesId: series.id,
              });
```

この `useEffect` の依存配列に `seriesId` を足す(現在 `[resolved]` などになっている配列の末尾に追加)。

ウォームアップ画面にシリーズ名を出す(spec §7.3)。state を1つ足す:

```ts
  const [seriesLabel, setSeriesLabel] = useState('');
```

`const pool = series.questions;` の直後に足す:

```ts
        // Named before the mic opens: the lag alone does not say which set of
        // questions is about to be asked, and picking the wrong one costs a
        // whole round.
        setSeriesLabel(`${series.title} ／ ${pool.length}問`);
```

`if (warmup) {` のブロック内、`<LagHeader n={lag} />` の直後に足す:

```tsx
        <Text testID="warmup-series" style={styles.warmupSeries}>
          {seriesLabel}
        </Text>
```

styles に足す:

```ts
  warmupSeries: {
    color: '#f4f1ea',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 4,
  },
```

- [ ] **Step 4: Strip `src/content/pool.ts` down**

ファイル全体を次に置き換える:

```ts
import { STIMULI_PER_ROUND } from '../engine/sequence';

/** A round draws 9 distinct questions, so a series below this is unusable. */
export const MIN_QUESTIONS = STIMULI_PER_ROUND;
```

続いて古いテストを消す:

```bash
git rm src/content/__tests__/pool.test.ts
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/ui/__tests__/GameScreen.test.tsx src/content/__tests__/series.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/ui/GameScreen.tsx src/content/pool.ts src/ui/__tests__/GameScreen.test.tsx src/content/__tests__/series.test.ts
git commit -m "feat(game): ラウンドをシリーズで引き、Nと履歴をシリーズに紐づける"
```

---

### Task 6: 導線をつなぐ — App / Results / Settings

**Files:**
- Modify: `App.tsx`
- Modify: `src/ui/ResultsScreen.tsx`
- Modify: `src/ui/SettingsScreen.tsx`
- Test: `src/ui/__tests__/SettingsScreen.test.tsx`
- Modify: `src/ui/__tests__/ResultsScreen.test.tsx`

**Interfaces:**
- Consumes: Task 4 の `SeriesScreen`、Task 5 の `GameScreen` の `seriesId` prop
- Produces: 起動時ホームが `SeriesScreen` になる。`ResultsScreen` に `onChangeSeries` prop が増える。

- [ ] **Step 1: Write the failing test**

`src/ui/__tests__/SettingsScreen.test.tsx` の `describe('SettingsScreen question source', ...)` を丸ごと削除し、代わりに次を足す:

```tsx
describe('SettingsScreen after series', () => {
  it('no longer offers a question-source toggle', async () => {
    render(<SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />);
    await waitFor(() => {});
    expect(screen.queryByTestId('source-builtin')).toBeNull();
    expect(screen.queryByTestId('source-custom')).toBeNull();
    expect(screen.queryByTestId('source-both')).toBeNull();
  });

  it('says the difficulty chips govern the standard series only', async () => {
    render(<SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('標準問題のむずかしさ')).toBeTruthy();
    });
  });
});
```

`src/ui/__tests__/ResultsScreen.test.tsx` の `describe('ResultsScreen', ...)`
の中に足す。既存の `finishedEngine(resolved: number)` ヘルパをそのまま使う:

```tsx
  it('offers a way back to the series list', () => {
    const onChangeSeries = jest.fn();
    const { getByText } = render(
      <ResultsScreen
        engine={finishedEngine(9)}
        n={2}
        onAgain={() => {}}
        onChangeSeries={onChangeSeries}
      />,
    );
    fireEvent.press(getByText('シリーズを変える'));
    expect(onChangeSeries).toHaveBeenCalled();
  });
```

このファイルの既存の `<ResultsScreen ... />` はすべて必須 prop が増えるため、
各所に `onChangeSeries={() => {}}` を足す(足さないと `npx tsc --noEmit` が落ちる)。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/ui/__tests__/SettingsScreen.test.tsx src/ui/__tests__/ResultsScreen.test.tsx`
Expected: FAIL — source チップがまだ存在し、`シリーズを変える` は無い。

- [ ] **Step 3: Modify `src/ui/SettingsScreen.tsx`**

- `import { MIN_QUESTIONS, type QuestionSource } from '../content/pool';` を削除。
- `import { ... loadCustom ... }` から `loadCustom` を外す(他で使っていなければ)。
- `const SOURCE_CHOICES = [...]` の宣言を削除。
- `const [customCount, setCustomCount] = useState(0);` と
  `void loadCustom().then((custom) => setCustomCount(custom.length));` を削除。
- `customShortfall` / `customUsable` / `isSourceUsable` の3つの宣言を削除。
- JSX の `<Text style={styles.label}>問題の出どころ</Text>` から、その直後の
  `SOURCE_CHOICES.map(...)` を含む `<View style={styles.row}>...</View>` までを削除。
- tier チップの見出しを差し替える。`TIER_CHOICES` を描画している直前の
  `<Text style={styles.label}>` の中身を `標準問題のむずかしさ` にする。

- [ ] **Step 4: Modify `src/ui/ResultsScreen.tsx`**

`Props` に1行足す:

```ts
interface Props {
  engine: RoundEngine;
  n: number;
  onAgain: () => void;
  onChangeSeries: () => void;
}
```

引数を `export function ResultsScreen({ engine, n, onAgain, onChangeSeries }: Props) {` にする。

末尾の `<Pressable style={styles.button} ...>もう一度</Pressable>` を次に置き換える:

```tsx
      <View style={styles.buttons}>
        <Pressable style={styles.button} onPress={onAgain}>
          <Text style={styles.buttonLabel}>もう一度</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={onChangeSeries}>
          <Text style={styles.buttonLabel}>シリーズを変える</Text>
        </Pressable>
      </View>
```

styles に足す:

```ts
  buttons: { flexDirection: 'row', gap: 12, marginTop: 24 },
  secondary: {
    flex: 1,
    padding: 16,
    backgroundColor: '#1c1c1e',
    borderRadius: 12,
    alignItems: 'center',
  },
```

既存の `button` から `marginTop: 24` を外し、`flex: 1` を足す。

- [ ] **Step 5: Modify `App.tsx`**

ファイル全体を次に置き換える:

```tsx
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
```

- [ ] **Step 6: Run the whole suite and the type checker**

Run: `npm test`
Expected: PASS — 全ファイル緑。

Run: `npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 7: Commit**

```bash
git add App.tsx src/ui/ResultsScreen.tsx src/ui/SettingsScreen.tsx src/ui/__tests__/SettingsScreen.test.tsx src/ui/__tests__/ResultsScreen.test.tsx
git commit -m "feat(ui): ホームをシリーズ選択に — 出どころトグルを畳む"
```

- [ ] **Step 8: Manual verification**

実機またはシミュレータで確認する:

```bash
npm start
```

1. 起動してシリーズ一覧が出ること。カテゴリ見出しが3つ、`自分の問題` が「あと 9 問」で押せないこと。
2. 「コミットメントとキャピタルコール」を選び、ウォームアップを経て1ラウンド遊ぶ。9問すべて金融の問題が読まれること。
3. 結果画面から「シリーズを変える」で一覧に戻れること。
4. 「標準問題」を1ラウンド遊び、一覧に戻って**2つのシリーズのラグが別々に表示される**こと。これがシリーズ別Nの唯一の実地確認になる。
