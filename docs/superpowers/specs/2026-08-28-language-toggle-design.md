# UI言語切り替え(日本語/英語) — 設計

2026-08-28

## 1. 目的

現状アプリは全レイヤーが日本語専用: UI文言、出題内容、音声合成/認識のロケール
(`ja-JP`固定)、採点(Claude judge)のプロンプト、すべて。英語話者が使える形に
するには、UI・音声・採点を英語に切り替えられるだけでなく、**出題内容
(283問・25シリーズ)を英語に翻訳したものが存在しない限り切り替えは無意味**。
音声認識は`accept[]`の文字列と一致するかで採点するため、英語音声認識に
日本語の正解語彙をぶつけても成立しない。

よって本設計は2段構成:

1. **出題内容の英訳** — `series.json`と対になる`series.en.json`を生成し、
   既存のレビューツール(`reviewQuestion`, `findSemanticDuplicates`)を通す。
2. **切り替えの配線** — `Settings.language`を新設し、UI文言・音声ロケール・
   採点プロンプト・読み込むシリーズファイルをすべてそこから決定する。

(1)がなければ(2)は空箱なので、実装順序は1→2で固定する。

## 2. 対象範囲外

- 出題内容以外の資産(アプリ名、ストア説明文など)の英訳
- 日本語以外・英語以外の第3言語
- 自動言語検出(端末ロケールからの初期値推定) — 既定は`ja`固定、ユーザーが
  手動で切り替える

## 3. 出題内容の英訳

### 3.1 データモデル

`src/content/series.en.json` を新設。`series.json`と同じ`Series[]`構造
(`id`, `category`, `title`, `credit`, `questions[].id/tier/accept`)を持ち、
**`id`は日本語版と完全に一致**させる(シリーズID・問題IDとも不変)。翻訳する
のは`title`, `credit`, `questions[].q`, `questions[].accept[]`のみ。

`Question`/`Series`型(`engine/types.ts`, `content/series.ts`)にスキーマ変更
は不要 — 言語ごとに別ファイルを読むだけで、実行時の型は共通。

`CATEGORIES`(`content/series.ts`)のラベルも英語版を追加する必要がある。
こちらは3シリーズ分のラベルのみなので、別ファイルではなく
`CATEGORIES_EN`定数で足りる。

### 3.2 生成

`scripts/translate-questions.ts` を新設(`review-questions.ts`と同様の
tsc実行パターン)。シリーズ単位でバッチ翻訳する(1問ずつ訳すと同じシリーズ内
で用語表記が割れる: 例「General Partner」と「GP」の使い分けがシリーズ内で
統一されない)。プロンプト方針:

- 金融・ファンドファイナンス分野の慣用英語表記を使う(直訳のMTではない)
- `accept[]`は日本語版と同じ多様性を持たせる(略語・正式名称・言い換えの
  複数形): 例 `["MFN", "Most Favored Nation", "Most Favored Nation clause"]`
- 出典(`credit`)は書名を直訳せず、「(原著の書名) の内容をもとに」の形に
  統一する(例: 『ファンドファイナンスの教科書』→
  "Based on *Fund Finance no Kyokasho*")。英語版の書籍が実在するかは
  シリーズごとに調べない — 翻訳コンテンツの出典であることが分かれば足りる

### 3.3 品質チェック

生成後、既存のレビューパイプラインを英語コンテンツに対しても実行する:

- `reviewQuestion`(4項目: 正解の網羅性、自己完結性、出典依存の禁止、など)
- `findSemanticDuplicates`(概念重複)

`scripts/review-questions.ts`に`--lang=en`のようなフラグを足し、
`series.en.json`を対象に同じ監査を回せるようにする。プロンプト自体
(`review.ts`の`SYSTEM`/`DUPLICATE_SYSTEM`)は日本語のままでよい
(問題文が英語でも、日本語話者のレビュー担当者向けに指摘は日本語で
出す、という整理)。

## 4. 切り替えの配線

### 4.1 設定

`store/storage.ts`の`Settings`に`language: 'ja' | 'en'`を追加。
`DEFAULT_SETTINGS.language = 'ja'`。既存の`loadSettings()`のマージ処理で
未設定時のデフォルトが効くため、マイグレーション不要。

`SettingsScreen.tsx`に、既存の`Switch`パターン(`adaptive`トグルと同じ形)で
トグルを追加。`update({ language: ... })`を呼ぶだけで永続化される
(既存の`update()`の責務そのまま)。

### 4.2 出題内容の読み込み

`content/series.ts`の`listSeries()`(または相当関数)が`language`引数を
取り、`series.json`と`series.en.json`のどちらをimportするかを切り替える。
呼び出し元(`SeriesScreen`など)は`Settings.language`を渡す。

### 4.3 音声

`speech/speaker.ts`, `speech/listener.ts`の`'ja-JP'`ハードコードを廃止し、
`language`から`'ja' → 'ja-JP'`, `'en' → 'en-US'`に写像する。渡し方は
コンストラクタ引数(呼び出し側であるGameScreen起動時にSettingsから注入)。

**英語選択時、音声合成・音声認識ともに完全にen-USへ切り替える**
(3.1の英訳コンテンツを前提にしているため、これは日本語コンテンツと
英語音声の齟齬を意味しない)。

### 4.4 採点(Judge)

`judge/claude.ts`の`SYSTEM`定数とユーザーメッセージテンプレート
(`問題:`, `正答例:`, `利用者の回答:`)を言語ごとに用意し、`judge()`呼び出し
時の`language`引数で選択する。`judge/local.ts`(文字列正規化マッチ)は
言語非依存のため変更不要。

### 4.5 UI文言

6画面(`SettingsScreen`, `GameScreen`, `ResultsScreen`, `SeriesScreen`,
`QuestionsScreen`, および`content/series.ts`のカテゴリラベル)に散らばる
約230箇所のインラインJSX文字列を、`src/strings/`配下のi18nテーブルに
抽出する。`ja`オブジェクトと`en`オブジェクトをキーで対応させ、
`useStrings()`フックが`Settings.language`を読んで該当言語のテーブルを返す。

キーの命名は画面ごとの名前空間(例: `settings.save`, `results.unjudged`)。

## 5. テスト方針

- 出題内容: `translate-questions.ts`の出力形状テスト(`review.test.ts`と
  同様のパターン)。実際のAPI呼び出しはモック。
- ローダー: `language`引数で正しいファイルを読むこと。
- 音声: `language`→ロケール文字列の写像が正しいこと。
- 採点: `language`によって正しいSYSTEM/テンプレートが選ばれること。
- UI: 既存の約230件のテキスト表明は**すべて`language: 'ja'`前提のまま
  変更不要**とする — テストのデフォルト設定は現行の`DEFAULT_SETTINGS`
  (`language: 'ja'`)に揃うため。新規に、トグルを`en`に倒した場合の
  代表的な画面(Settings, Results)で英語文言が出ることを確認するテストを
  数件追加する。

## 6. 実装順序

1. `series.en.json`生成スクリプト + 実行 + レビュー通過
2. `Settings.language`とストレージ
3. `content/series.ts`のファイル切り替え
4. 音声ロケール切り替え
5. Judgeプロンプト切り替え
6. UI文言i18n化(6画面)+ Settings画面へのトグル追加
7. 全体テスト(既存416件 + 新規)
