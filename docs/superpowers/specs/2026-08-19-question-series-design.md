# 質問シリーズ — 設計

2026-08-19

## 1. 目的

起動していきなり出題が始まる今の形をやめ、**何を覚えにいくのかを選んでから**
ラウンドに入る。選ぶ単位が「シリーズ」で、シリーズは目的別の「カテゴリ」に
束ねられる。

シリーズの中身は `C:\Projects\company`(毎日Xに投稿する全自動会社)が扱っている
書籍の概念から起こす。company の学習アイテムは4択・長文・出典付きで、
本アプリの「一言で声に出せる短答」判定とは形が合わない。そのため4択をそのまま
持ち込まず、**概念だけを借りて短答問題を書き起こす**。

- 元(company): 「サブスクリプション・ラインの担保として最も一般的なものは
  どれか / A.ファンドの投資先株式 / B.LPの未出資コミットメント / ...」
- 本アプリ: `{ "q": "キャピタルコールの担保になるのは？",
  "accept": ["未出資コミットメント", "コミットメント", "アンファンデッド"] }`

## 2. 用語

| 語 | 意味 |
|---|---|
| カテゴリ | 目的別の大分類。表示順を持つ。例:「金融の語彙を体に入れる」 |
| シリーズ | 選択の単位。中身の内容に由来するタイトルを持つ。例:「説得のデザイン」 |
| 標準問題 | 既存 `bank.json` を1つのシリーズとして見せたもの |
| 自分の問題 | AsyncStorage のカスタム問題を1つのシリーズとして見せたもの |

カテゴリ ⊃ シリーズ ⊃ 問題。階層は2段までで、それ以上掘らない。

## 3. 採用した方針と、採らなかった方針

**採用: シリーズが `QuestionSource` を置き換える。**
`Settings.questionSource: 'builtin'|'custom'|'both'` を捨て、
`Settings.seriesId: string` にする。`standard` と `custom` もシリーズとして
一覧に並べ、「今回どの問題を使うか」の答えを1つの概念に統一する。
設定が増えるのではなく減る。

採らなかった案:

- **問題に `series` タグを持たせる。** データの差分は最小だが、シリーズの
  タイトル・出典・問数といったメタ情報の置き場が別表になり、選択画面が
  構造を再構築する羽目になる。カスタム問題は自分で選んでいないタグを
  持てない。
- **既存の出どころトグルと並存させる。** 「今回の問題はどこから来るか」の
  答えが2つになる。`both` × 金融シリーズ のような無意味な組み合わせに
  意味を与える作業が発生する。

## 4. コンテンツモデル

`src/content/` に2ファイル追加。このディレクトリは `boundaries.test.ts` により
React / React Native / Expo に依存しないことが強制されている。

### 4.1 `src/content/series.json`

```json
[
  {
    "id": "capital-call",
    "category": "finance",
    "title": "コミットメントとキャピタルコール",
    "credit": "『ファンドファイナンスの教科書』より",
    "questions": [
      { "id": "cc_01", "tier": 0, "q": "キャピタルコールの担保になるのは？",
        "accept": ["未出資コミットメント", "コミットメント", "アンファンデッド"] }
    ]
  }
]
```

### 4.2 `src/content/series.ts`

```ts
export const CATEGORIES = [
  { id: 'finance',  label: '金融の語彙を体に入れる' },
  { id: 'delivery', label: '伝え方を変える' },
  { id: 'basics',   label: 'だれでも答えられる' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

export interface Series {
  id: string;
  category: CategoryId;
  title: string;
  /** 出典。書籍の背後にない standard / custom には無い。 */
  credit?: string;
  questions: Question[];
}

export function listSeries(opts: {
  custom: Question[];
  learned: Record<string, string[]>;
  maxTier: number;
}): Series[];

export function findSeries(all: Series[], id: string): Series;
```

`listSeries` は JSON に載っていない2つを合成して返す:

- `standard` — `bank.json` を `maxTier` で絞ったもの。カテゴリ `basics`。
- `custom` — 引数で渡されたカスタム問題。カテゴリ `basics`。

`learned`(学習済み同義語)は**全シリーズの問題に**被せる。`standard` にだけ
`loadBank(learned)` を通す形にはしない。カスタム問題も、シリーズ問題も、
判定を重ねるほど言い回しを受け入れるようになるという性質は同じ。

選択画面もラウンドも同じ `listSeries` を通る。「内蔵問題だけ別経路」を
作らない。

`custom` を **引数で受け取る**のが要点で、これにより `series.ts` は
AsyncStorage を読まず、`content/` の device-free 制約を保ったままになる。

### 4.3 ID の一意性

`nback.learned` は問題IDをキーに学習済み同義語を貯める。IDが衝突すると
ある問題の学習が別の問題に漏れる。よってIDは
`bank.json` + `series.json` + `user_N` の全体で一意でなければならない。
シリーズ問題はシリーズごとの接頭辞を持つ(`cc_01` / `nav_01` / `pers_01`)。
テストで担保する。

`tier: 0` は「tier で絞らない」の意。`addCustom` が既に使っている規約と同じ。

## 5. プール解決と難易度

`resolvePool(source, builtin, custom, maxTier)` と `QuestionSource` 型は削除。
ラウンドは `listSeries(...)` → `findSeries(all, id)` → `.questions` で引く。

- **`maxTier` は `standard` にのみ効く。** 自分で選んだシリーズを難易度
  スライダーで後から間引くのは筋が悪いし、金融問題に tier の意味は無い。
  設定画面のチップは「標準問題のむずかしさ」に改名する。
- **9問未満のシリーズは表示するが開始できない。** 「あと N 問」を添えて
  無効表示。今 `custom` にだけある規則を全シリーズに一様に適用する。
- **保存された `seriesId` が存在しない場合は `standard` に落とす。**
  将来シリーズを改名・削除しても起動不能にならない。

`MIN_QUESTIONS`(= `STIMULI_PER_ROUND` = 9)は現状のまま。

## 6. 保存とマイグレーション

### 6.1 Settings

```ts
export interface Settings {
  stepDurationMs: number;
  adaptive: boolean;
  fixedN: number;
  maxTier: number;   // standard シリーズにのみ効く
  mode: RoundMode;
  seriesId: string;  // questionSource を置き換え。既定 'standard'
}
```

`loadSettings` で移行する:

| 旧 `questionSource` | 新 `seriesId` |
|---|---|
| `'custom'` | `'custom'` |
| `'builtin'` | `'standard'` |
| `'both'` | `'standard'` |

`'both'` は不可逆に失われる。混成プールは本方針に対応物が無く、自分の問題は
独立したシリーズになる。ここは round-trip しない、と明示しておく。

### 6.2 N をシリーズごとに持つ

```ts
const KEY_N           = 'nback.n';            // 旧: 素の数値
const KEY_N_BY_SERIES = 'nback.n.bySeries';   // Record<seriesId, number>

export async function loadN(seriesId: string): Promise<number>;
export async function saveN(seriesId: string, n: number): Promise<void>;
```

移行は一方向・非破壊: `nback.n.bySeries` が無く旧 `nback.n` がある場合、
`{ standard: <旧値> }` を書き、旧キーはそのまま残す。

未見のシリーズは `STARTING_N`(=1)から始まる。標準問題で3-backまで上げた人が
金融シリーズを初めて選んでも1-backから始まる ── これがシリーズ別Nの目的。

`saveN` は素の read-modify-write でよい。`addLearned` と違い1ラウンドに1回しか
走らないため、書き込み直列化は不要な儀式になる。

### 6.3 履歴

`RoundRecord` に `seriesId?: string` を追加。省略可にすることで既存履歴は
移行なしでそのまま読める。

## 7. 画面と導線

```
起動
 ↓
【シリーズを選ぶ】  ← ホーム (右上に設定)
 ↓ タップ
【ウォームアップ】 「説得のデザイン ／ 18問 ／ 1-back」
 ↓
【ラウンド】
 ↓
【結果】 [もう一度] [シリーズを変える]
```

### 7.1 `src/ui/SeriesScreen.tsx` (新規・ホーム)

```
シリーズを選ぶ                                    設定

─ 金融の語彙を体に入れる ──────────────────
  コミットメントとキャピタルコール          15問   2-back
  『ファンドファイナンスの教科書』より
  NAVと担保の基礎                          12問   1-back
  ...
─ だれでも答えられる ────────────────────
  標準問題                                120問   3-back
  自分の問題                        あと 4 問   ← 押せない
```

`CATEGORIES` の順に描画し、空のカテゴリは飛ばす。各行にタイトル・出典・問数・
現在のラグを出す。9問未満の行は無効化して不足数を明示する。
設定ボタンは `GameScreen` からここへ移す。

### 7.2 `App.tsx`

```ts
type Screen =
  | { name: 'series' }
  | { name: 'game'; seriesId: string; key: number }
  | { name: 'results'; engine: RoundEngine; plan: RoundPlan; seriesId: string }
  | { name: 'settings' }
  | { name: 'questions' };
```

初期値は `{ name: 'series' }`。設定を閉じるとラウンド開始ではなくシリーズ一覧へ
戻る(問題を編集した直後に一覧の問数が更新されるのもこの経路)。

### 7.3 既存画面の変更

- `GameScreen` — 必須 prop `seriesId` を受ける。`listSeries` でプールを解決し、
  N をそのIDで読み書きし、履歴に `seriesId` を刻む。ウォームアップ画面に
  シリーズ名を出す。マイクが開く前に「どの問題を出されるのか」が分かる。
- `ResultsScreen` — ボタンを2つに。「もう一度」は同じシリーズ、
  「シリーズを変える」はホームへ。
- `SettingsScreen` — 「問題の出どころ」ブロックと `SOURCE_CHOICES` を削除。
  tier チップを「標準問題のむずかしさ」に改名。
- `QuestionsScreen` — 変更なし。閉じると設定へ戻る。

## 8. 問題の執筆

### 8.1 素材の所在(実測)

このマシンに存在する原稿:

- `/mnt/c/Projects/book/Books2/6.FundsFinanceの教科書` — 全24章。
- `/mnt/c/Projects/book/Books2/11.Persuasion` —
  『複雑な情報で相手を動かす：理解・説得・決断を最短で達成する統合フレームワーク』。

`company/data/learn_sources.json` が挙げる書籍19/24/26 ──
『世界一頑固な人を動かす世界一の交渉術』を含む ── の原稿は**このマシンに無い**。
よって「説得のデザイン」の出典は、実際に蒸留した原稿である
『複雑な情報で相手を動かす』とする。読んでいない書籍を出典に書かない。
company 側が `url_status` / `provenance_status` / `source_note` で出典を
厳密に管理している以上、ここだけ緩めるわけにはいかない。

`company/data/company.db` の `learn_items` は0件(公開済みアイテムはこの複製に
無い)ため、DBは素材にしない。

### 8.2 初回に作る4シリーズ・57問

| カテゴリ | シリーズ | 問 | 出典 | 素材 |
|---|---|---|---|---|
| finance | `capital-call` コミットメントとキャピタルコール | 15 | 『ファンドファイナンスの教科書』より | 第2章 2-1、第10章 |
| finance | `nav-finance` NAVと担保の基礎 | 12 | 同上 | 第2章 2-2〜2-5、第10章 10-3 |
| finance | `fund-cast` ファンドの登場人物 | 12 | 同上 | 第3章、第17章、第18章 |
| delivery | `persuasion` 説得のデザイン | 18 | 『複雑な情報で相手を動かす』より | 全8章 |

`basics` カテゴリには `standard` と `custom` が入る(執筆不要)。

### 8.3 執筆規則

n-back の下で使えるようにするための規則。正しさだけでは足りない。

1. **答えは一息で言える名詞1語。** 目安8モーラ以内。長い正式名称には短い
   変種を添える: `"未出資コミットメント"` には `"コミットメント"` と
   `"アンファンデッド"` を `accept` に入れる。
2. **設問は一文・30字以内。** 4択の枠を外す。「〜はどれか」ではなく「〜は？」。
3. **`accept[]` には語彙の揺れだけを並べる。** 表記の揺れは不要。
   `normalizeTranscript` がカタカナ→ひらがな畳み込みと
   「です／かな／だと思います」の除去を既にやっている。
4. **数字は、その数字自体が概念のときだけ。**
   例:「Authority・Priority・Control は何点セット？」→ 3。
5. **英字略語(LTV・ACA・AIV)は日本語の答えを第一候補にし、**英字読みを
   `accept` に足す。音声認識はアルファベット列を日本語の名詞よりはるかに
   高い頻度で落とす。
6. **同一シリーズ内で答えを重複させない。** 1ラウンドは9問を引き、どの答えが
   どの問題だったかを問う。答えが重なると、その手番は本人に非が無いまま
   採点不能になる。
7. **出典はシリーズに1つ。** 問題ごとには持たせない。

## 9. テスト計画

TDD。以下はすべて実機なしで `npm test` により走る。

### 9.1 `src/content/__tests__/series.test.ts` (新規)

- 問題IDが `bank.json` + `series.json` 全体で一意。`user_N` 形式と衝突しない。
- 全 `category` が `CATEGORIES` に解決する。全シリーズが `MIN_QUESTIONS` 以上。
- 全 `accept[]` が非空で、各要素が `normalizeTranscript` 後も非空。
- シリーズ内で第一答の正規化結果が重複しない(規則6を約束ではなくテストにする)。
- `listSeries`: `maxTier` が `standard` にのみ効く / `custom` が引数から現れる /
  カテゴリ順が保たれる / 空カテゴリが飛ばされる。
- `findSeries`: 未知のIDは `standard` に落ちる。

### 9.2 `src/store/__tests__/storage.test.ts` (追加)

- `questionSource` → `seriesId` の移行を旧3値すべてで。
- `nback.n` → `nback.n.bySeries` の初期化。
- 未見シリーズの `loadN` が `STARTING_N`。
- 片方のシリーズへの `saveN` が他方を書き換えない。
- `seriesId` が履歴を往復する。

### 9.3 `src/ui/__tests__/SeriesScreen.test.tsx` (新規)

- カテゴリが定義順に描画される。
- 9問未満の行が無効で、不足数が出る。
- タップで `onSelect` がそのIDで発火する。
- ラグのバッジが保存済みのシリーズ別Nを反映する。

### 9.4 既存テストの更新

- `GameScreen.test.tsx` — `questionSource: 'custom'` の2ケースを
  `seriesId: 'custom'` に。N がシリーズIDの下に保存されることを追加検証。
- `SettingsScreen.test.tsx` — 出どころチップの3ケースを削除。
- `pool.test.ts` — `resolvePool` 削除に伴い `series.test.ts` へ吸収。
- `boundaries.test.ts` — 変更なし。`listSeries` がカスタム問題を引数で
  受け取る設計が、この制約を満たし続ける根拠になっている。

### 9.5 手動確認

`npm test` が緑になった後、実機でアプリを起動し、金融シリーズを1ラウンドと
標準問題を1ラウンド遊んで、シリーズ別Nが本当に独立していることを確かめる。

## 10. やらないこと

- company 側の生成スクリプト追加。今回は手書きJSONを1回作る。増やすときは
  また原稿を読む。
- アプリから company サーバーへの取得。オフラインのまま保つ。
- 4択UIの導入。短答判定モデルは変えない。
- カテゴリの3段目。階層は2段で止める。
