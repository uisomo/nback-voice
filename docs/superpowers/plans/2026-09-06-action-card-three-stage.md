# アクションカード 三段構成 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アクションカード画面を「学習 → 目的 → 具体アクション」の三段ドリルに作り替え、各段に n-back を入れ、テキスト入力・ローカル即時採点・即時開示・自己採点上書きで回す。

**Architecture:** 音声スタック（`RoundRunner` / `ExpoSpeaker` / `ExpoListener` / `JudgeQueue`）を `ActionGameScreen` から完全に切り離し、この画面専用の純粋同期モジュール2本（`src/actions/drill.ts` の状態機械、`src/actions/grade.ts` の文字バイグラム採点）に置き換える。`GameScreen` が使う音声スタック本体には一切触らない。適応N は `nextN()` を `drill.ts` から直接呼んで維持する。

**Tech Stack:** TypeScript / React Native (Expo 57) / Jest + @testing-library/react-native。**新規依存パッケージなし。**

**Spec:** `docs/superpowers/specs/2026-09-06-action-card-three-stage-design.md`

## Global Constraints

- **新しい npm 依存を足さない。** 採点は外部依存なし・完全同期・APIキー不要（spec §5）。
- **`src/actions/` は device-free を保つ。** react / react-native / expo を import しない。Task 6 でこれを `src/__tests__/boundaries.test.ts` の `DEVICE_FREE_DIRS` に追加して強制する。
- **`src/strings/index.ts` は ja / en のキー集合と値の型が完全一致していること。** `src/strings/__tests__/index.test.ts` がこれを検査する。ja に足したら en にも必ず足す。
- **`src/engine/`・`src/speech/`・`src/judge/`・`src/ui/GameScreen.tsx` を変更しない。** これらは音声ループの現役コードで、本計画の対象外（spec §3）。
- **`MATCH_THRESHOLD = 0.45`。** spec §5 は 0.35 と書いているが、実データ計測（本計画末尾「閾値の根拠」）の結果 0.45 を採る。
- **コミットメッセージは `feat(actions): ...` / `test(actions): ...` 形式**（既存の履歴に合わせる）。ブランチは `master` 直ではなく `feat/action-card-three-stage` を切ってから作業する。
- **テストは `npx jest <path>` で個別実行、タスク末尾で `npx jest` 全体実行。** `npm install` は走らせないこと（この WSL/`/mnt/c` 環境では ENOTEMPTY で無限ループすることがある）。

---

## File Structure

| ファイル | 役割 | 扱い |
|---|---|---|
| `src/actions/actions.ts` | スキーマ（`SubAction` / `ActionCard` / `Sequence`）と JSON 読み出し | 変更（Task 1） |
| `src/actions/sequences.json` | 17枚のカード本体 | 機械移行（Task 1）→ 本文執筆（Task 7） |
| `src/actions/grade.ts` | 文字バイグラム Dice 採点。純粋・同期 | 新規（Task 2） |
| `src/actions/drill.ts` | 三段ドリルの状態機械。純粋・同期。React 非依存 | 新規（Task 3・Task 4） |
| `src/actions/plan.ts` | 旧 `RoundPlan` 生成器 | Task 1 で最小追随 → Task 6 で削除 |
| `src/strings/index.ts` | ja / en 文言 | 変更（Task 5） |
| `src/ui/ActionGameScreen.tsx` | 画面。intro / play / results | 全面書き換え（Task 6） |
| `src/__tests__/boundaries.test.ts` | device-free 境界の強制 | 変更（Task 6） |

分割の理由: `grade.ts` は「2つの文字列がどれだけ似ているか」だけを知り、`drill.ts` は「今どのカードのどの欄を問うているか」だけを知り、画面は「それをどう描くか」だけを知る。3つは互いのモデルを持たないので、それぞれ単体でテストできる。

---

## Task 1: スキーマ変更と17枚の機械移行

`card.action` / `card.actionAccept` を捨て、`card.subActions: SubAction[]` に置き換える。既存の `action` は各カードの1つ目の小目的として移設する（中身の書き直しは Task 7）。この時点では `plan.ts` は最小限だけ追随させ、画面が壊れないようにしておく。

**Files:**
- Modify: `src/actions/actions.ts:6-17`
- Modify: `src/actions/sequences.json`（スクリプトで機械変換）
- Modify: `src/actions/plan.ts:14-26`
- Test: `src/actions/__tests__/actions.test.ts`
- Test: `src/actions/__tests__/plan.test.ts:4-16`（fixture のみ）

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces:
  ```ts
  export interface SubAction {
    id: string;              // "ch02-a01-s1"
    purpose: string;         // 小目的 — なぜこの一手順を踏むのか
    action: string;          // 具体アクション
    actionAccept: string[];  // 許容される言い換え
  }
  export interface ActionCard {
    id: string;
    order: number;
    title: string;           // 手段の総称
    purpose: string;         // 中目的
    purposeAccept: string[];
    subActions: SubAction[];
    category: Category;
    note?: string;
    layer2Skipped?: boolean;
  }
  ```
  `Sequence`・`Product`・`Category`・`PRODUCT_ORDER`・`listSequences()`・`getSequence()`・`sequencesByProduct()` は変更なし。

- [ ] **Step 1: ブランチを切る**

```bash
git checkout -b feat/action-card-three-stage
```

- [ ] **Step 2: 失敗するテストを書く**

`src/actions/__tests__/actions.test.ts` の末尾の2つの `it`（`'every card has a valid category...'` の次にある `'a card is either Layer-2 playable...'`）を、次の3つに置き換える。ファイル冒頭の import と `CATEGORIES` 定数はそのまま。

```ts
  it('every card has a valid category, non-empty title/purpose, and a non-empty purposeAccept', () => {
    for (const s of listSequences()) {
      for (const c of s.cards) {
        expect(CATEGORIES).toContain(c.category);
        expect(c.title.trim()).not.toBe('');
        expect(c.purpose.trim()).not.toBe('');
        expect(c.purposeAccept.length).toBeGreaterThan(0);
        for (const a of c.purposeAccept) expect(a.trim()).not.toBe('');
      }
    }
  });

  it('every subAction has a unique id, a non-empty purpose/action, and a non-empty actionAccept', () => {
    const ids: string[] = [];
    for (const s of listSequences()) {
      for (const c of s.cards) {
        for (const sub of c.subActions) {
          ids.push(sub.id);
          expect(sub.id.startsWith(`${c.id}-s`)).toBe(true);
          expect(sub.purpose.trim()).not.toBe('');
          expect(sub.action.trim()).not.toBe('');
          expect(sub.actionAccept.length).toBeGreaterThan(0);
          for (const a of sub.actionAccept) expect(a.trim()).not.toBe('');
        }
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('layer2Skipped is exactly the set of cards with no subActions', () => {
    for (const s of listSequences()) {
      for (const c of s.cards) {
        expect(Boolean(c.layer2Skipped)).toBe(c.subActions.length === 0);
      }
    }
  });

  it('credit does not claim a specific chapter as the source', () => {
    // 書籍全文検索の結果、引用元とされた章に該当語は0件だった（spec §4.2）。
    for (const s of listSequences()) {
      expect(s.credit).not.toMatch(/第\d+章/);
    }
  });
```

- [ ] **Step 3: テストを走らせて落ちることを確認**

Run: `npx jest src/actions/__tests__/actions.test.ts`
Expected: FAIL — `Property 'subActions' does not exist on type 'ActionCard'`（TS）および `credit` の `第2章` にマッチして失敗。

- [ ] **Step 4: スキーマを書き換える**

`src/actions/actions.ts` の `ActionCard` interface（6〜17行目）を、直前に `SubAction` を足した次の形に置き換える。

```ts
/** カード内の一手順。具体アクション段の出題単位。 */
export interface SubAction {
  id: string;
  /** 小目的 — なぜこの一手順を踏むのか。具体アクション段の問題文になる。 */
  purpose: string;
  /** 具体アクション — 実際に何をするか。具体アクション段の答え。 */
  action: string;
  actionAccept: string[];
}

export interface ActionCard {
  id: string;
  order: number;
  /** 手段の総称。刺激として出すが、答えにはしない（spec §2）。 */
  title: string;
  /** 中目的 — なぜその手段をとるのか。判断ロジックを含む。目的段の答え。 */
  purpose: string;
  purposeAccept: string[];
  /** 空なら具体アクション段では飛ばす。layer2Skipped と一致する。 */
  subActions: SubAction[];
  category: Category;
  note?: string;
  layer2Skipped?: boolean;
}
```

- [ ] **Step 5: sequences.json を機械変換する**

`src/actions/sequences.json` を次のスクリプトで一括変換する。既存の `action` を `subActions[0]` に移設し（`purpose` はカードの中目的を仮置き、Task 7 で書き直す）、`action` が空のカードは `subActions: []` にする。同時に `credit` の章指定を外す。

```bash
node -e "
const fs = require('fs');
const p = 'src/actions/sequences.json';
const seqs = JSON.parse(fs.readFileSync(p, 'utf8'));
for (const s of seqs) {
  s.credit = '『FundsFinanceの教科書』をもとに構成';
  s.cards = s.cards.map((c) => ({
    id: c.id,
    order: c.order,
    title: c.title,
    purpose: c.purpose,
    purposeAccept: c.purposeAccept,
    subActions: c.action && c.action.trim()
      ? [{ id: c.id + '-s1', purpose: c.purpose, action: c.action, actionAccept: c.actionAccept }]
      : [],
    category: c.category,
    ...(c.note !== undefined ? { note: c.note } : {}),
    ...(c.layer2Skipped ? { layer2Skipped: true } : {}),
  }));
}
fs.writeFileSync(p, JSON.stringify(seqs, null, 2) + '\n');
console.log('cards:', seqs.flatMap(s => s.cards).length, 'subActions:', seqs.flatMap(s => s.cards).flatMap(c => c.subActions).length);
"
```

Expected 出力: `cards: 17 subActions: 16`（`ch02-a07` だけが 0 個）

- [ ] **Step 6: plan.ts を最小限だけ追随させる**

`plan.ts` は Task 6 で消えるが、それまで `ActionGameScreen` がコンパイルできるよう最小限だけ直す。`src/actions/plan.ts:14-26` の2関数を置き換える。

```ts
export function eligibleCards(seq: Sequence, layer: Layer): ActionCard[] {
  if (layer === 'purpose') return seq.cards;
  return seq.cards.filter((c) => c.subActions.length > 0);
}

export function cardToQuestion(card: ActionCard, layer: Layer): Question {
  return {
    id: card.id,
    tier: 2,
    q: card.title,
    accept:
      layer === 'purpose'
        ? card.purposeAccept
        : card.subActions.flatMap((s) => s.actionAccept),
  };
}
```

- [ ] **Step 7: plan.test.ts の fixture を追随させる**

`src/actions/__tests__/plan.test.ts:4-16` の `card()` ヘルパを置き換える。アサーションは触らない。

```ts
function card(id: string, order: number, extra: Partial<Sequence['cards'][number]> = {}) {
  return {
    id,
    order,
    title: `title-${id}`,
    purpose: `purpose-${id}`,
    purposeAccept: [`p-${id}`],
    subActions: [
      { id: `${id}-s1`, purpose: `sp-${id}`, action: `action-${id}`, actionAccept: [`a-${id}`] },
    ],
    category: 'universal' as const,
    ...extra,
  };
}
```

同ファイル 59〜72行目の `'Layer 2 drops layer2Skipped cards from the walk'` の中で、2枚目のカードを作っている `card('c2', 2, { layer2Skipped: true, action: '', actionAccept: [] })` を次に変える。

```ts
        card('c2', 2, { layer2Skipped: true, subActions: [] }),
```

- [ ] **Step 8: テストを走らせて通ることを確認**

Run: `npx jest src/actions`
Expected: PASS（`actions.test.ts` と `plan.test.ts` の両方）

- [ ] **Step 9: 全体テストと型検査**

Run: `npx jest && npx tsc --noEmit`
Expected: 両方 PASS

- [ ] **Step 10: コミット**

```bash
git add src/actions/actions.ts src/actions/sequences.json src/actions/plan.ts src/actions/__tests__/actions.test.ts src/actions/__tests__/plan.test.ts
git commit -m "$(cat <<'EOF'
feat(actions): replace card.action with subActions

出題単位が小目的になったので、カード直下に具体アクションが1本だけ
ぶら下がる形は二重管理になる。既存の action を subActions[0] へ機械移設し、
小目的は中目的を仮置きした（本文は後続タスクで書き直す）。
credit の章指定は書籍全文検索で裏が取れなかったため外した。

Co-Authored-By: Claude <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W4zCKp7PC84aQHrNFf6EmZ
EOF
)"
```

---

## Task 2: 採点モジュール `grade.ts`

日本語には語境界がないので、**文字バイグラムの Dice 係数**で照合する。外部依存なし・完全同期。

**重要な性質（実測、本計画末尾参照）:** この指標は「模範解答の言い回しをどれだけ再現したか」を測る。**意味が同じで語が違う言い換えは検出できない。** 実データの `purposeAccept[]` は意図的な言い換えなので、模範解答との Dice は 0.00〜0.41 に散らばり、無関係なカード同士の最大 0.32 と分布が重なる。よって閾値は「言い回しの再現」を拾う側に置く（0.45）。緑＝再現できた、赤＝自分で自己採点しろ、という意味になる。これは逃げではなく spec §5 の設計そのもの（ローカル照合は初期値、自己採点が最終）。

**Files:**
- Create: `src/actions/grade.ts`
- Test: `src/actions/__tests__/grade.test.ts`

**Interfaces:**
- Consumes: `normalizeTranscript` from `src/content/normalize.ts`（既存・無変更）、`listSequences` / `getSequence` from `src/actions/actions.ts`（Task 1）
- Produces:
  ```ts
  export const MATCH_THRESHOLD: number;               // 0.45
  export function similarity(a: string, b: string): number;      // 0..1
  export function gradeAnswer(input: string, accept: string[]): boolean;
  ```

- [ ] **Step 1: 失敗するテストを書く**

`src/actions/__tests__/grade.test.ts` を新規作成する。

```ts
import { getSequence, listSequences } from '../actions';
import { gradeAnswer, MATCH_THRESHOLD, similarity } from '../grade';

const CARD = getSequence('ch02')!.cards[0];
const MODEL = CARD.purpose;
/** 実際の採点で使う集合 — 模範解答そのものを必ず含める。 */
const ACCEPT = [MODEL, ...CARD.purposeAccept];

describe('similarity', () => {
  it('is 1 for identical strings', () => {
    expect(similarity(MODEL, MODEL)).toBe(1);
  });

  it('ignores polite suffixes, full-width forms and punctuation', () => {
    expect(similarity(MODEL, `${MODEL}です`)).toBe(1);
    expect(similarity('ＬＴＶを開示させる', 'LTV を、開示させる')).toBe(1);
  });

  it('is 0 when either side normalizes to nothing', () => {
    expect(similarity(MODEL, '')).toBe(0);
    expect(similarity('', MODEL)).toBe(0);
    expect(similarity(MODEL, '　、。')).toBe(0);
  });

  it('falls back to equality for one-character inputs, which have no bigrams', () => {
    expect(similarity('あ', 'あ')).toBe(1);
    expect(similarity('あ', 'い')).toBe(0);
  });

  it('scores partial recall high and unrelated text near zero', () => {
    const half = MODEL.slice(0, Math.floor(MODEL.length / 2));
    expect(similarity(MODEL, half)).toBeGreaterThan(0.6);
    expect(similarity(MODEL, 'サブスクリプションラインのIRR押し上げを除去する')).toBeLessThan(0.1);
  });
});

describe('gradeAnswer', () => {
  it('accepts a verbatim model answer and a verbatim accept entry', () => {
    expect(gradeAnswer(MODEL, ACCEPT)).toBe(true);
    expect(gradeAnswer(CARD.purposeAccept[2], ACCEPT)).toBe(true);
  });

  it('takes the max over the whole set, not just the first entry', () => {
    // accept[2] は模範解答とはほとんど字面を共有しない。最大値を採らなければ落ちる。
    expect(similarity(MODEL, CARD.purposeAccept[2])).toBeLessThan(MATCH_THRESHOLD);
    expect(gradeAnswer(CARD.purposeAccept[2], ACCEPT)).toBe(true);
  });

  it('accepts partial recall of the model wording', () => {
    // 実測: 模範解答の先頭40%で全17枚の最小が 0.519、閾値0.45に対して余裕がある。
    const partial = MODEL.slice(0, Math.round(MODEL.length * 0.4));
    expect(gradeAnswer(partial, ACCEPT)).toBe(true);
  });

  it('rejects empty and whitespace-only input against any set', () => {
    expect(gradeAnswer('', ACCEPT)).toBe(false);
    expect(gradeAnswer('　 　', ACCEPT)).toBe(false);
    expect(gradeAnswer('', [])).toBe(false);
  });

  it('rejects an empty accept set', () => {
    expect(gradeAnswer(MODEL, [])).toBe(false);
  });

  it('never marks one card correct against another card accept set', () => {
    // 全17枚の総当たり。閾値を下げすぎたらここが落ちる。
    const cards = listSequences().flatMap((s) => s.cards);
    for (const c of cards) {
      const set = [c.purpose, ...c.purposeAccept];
      for (const other of cards) {
        if (other.id === c.id) continue;
        expect(gradeAnswer(other.purpose, set)).toBe(false);
      }
    }
  });

  it('is a wording-recall detector, not a paraphrase detector', () => {
    // 意図した言い換えは模範解答と字面をほぼ共有しない。この赤は誤りではなく、
    // 「自己採点で上書きしろ」の合図である（spec §5）。
    for (const a of CARD.purposeAccept) {
      expect(similarity(MODEL, a)).toBeLessThan(MATCH_THRESHOLD);
    }
  });
});
```

- [ ] **Step 2: テストを走らせて落ちることを確認**

Run: `npx jest src/actions/__tests__/grade.test.ts`
Expected: FAIL — `Cannot find module '../grade'`

- [ ] **Step 3: grade.ts を実装する**

`src/actions/grade.ts` を新規作成する。

```ts
import { normalizeTranscript } from '../content/normalize';

/**
 * 「模範解答の言い回しを再現できたか」の判定線。
 *
 * 実測（17枚・総当たり）で、無関係なカード同士の Dice 最大は 0.323、
 * 模範解答の先頭 1/3 を打った場合の最小は 0.453 だった。0.45 はその間で、
 * 誤検出ゼロを保ちながら部分想起を拾える唯一の帯である。
 *
 * この指標は意味ではなく字面を見るので、語を入れ替えた正しい言い換えは
 * 落ちる。それは想定内であり、自己採点の ✓ で上書きされる（spec §5）。
 */
export const MATCH_THRESHOLD = 0.45;

/** 文字バイグラムの出現回数。日本語には語境界がないので語ではなく文字で刻む。 */
function bigrams(s: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i += 1) {
    const gram = s.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/**
 * 文字バイグラムの Dice 係数（0..1）。両辺とも normalizeTranscript で
 * 畳んでから比べるので、全角/半角・カタカナ/ひらがな・句読点・丁寧語の
 * 揺れは差にならない。
 */
export function similarity(a: string, b: string): number {
  const x = normalizeTranscript(a);
  const y = normalizeTranscript(b);
  if (x.length === 0 || y.length === 0) return 0;
  // 1文字の文字列はバイグラムを1つも持たないので、Dice が定義できない。
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;

  const left = bigrams(x);
  const right = bigrams(y);
  let shared = 0;
  let total = 0;
  for (const [gram, count] of left) {
    total += count;
    const other = right.get(gram);
    if (other !== undefined) shared += Math.min(count, other);
  }
  for (const count of right.values()) total += count;
  return (2 * shared) / total;
}

/**
 * 模範解答と許容言い換えの集合に対して照合し、最大値が閾値以上なら正解。
 * 空入力は常に不正解。
 */
export function gradeAnswer(input: string, accept: string[]): boolean {
  if (normalizeTranscript(input).length === 0) return false;
  return accept.some((a) => similarity(input, a) >= MATCH_THRESHOLD);
}
```

- [ ] **Step 4: テストを走らせて通ることを確認**

Run: `npx jest src/actions/__tests__/grade.test.ts`
Expected: PASS（12件）

**閾値 0.45 を下げて通そうとしないこと。** これは総当たりで誤検出ゼロを保てる下限（無関係カード間の最大 0.323）から取った値である。もしどれかの正例が落ちたら、テスト側の再現割合を緩める（付録の表を見て余裕のある割合を選ぶ）。

- [ ] **Step 5: コミット**

```bash
git add src/actions/grade.ts src/actions/__tests__/grade.test.ts
git commit -m "$(cat <<'EOF'
feat(actions): add local bigram-Dice grading

日本語には語境界がないので文字バイグラムで照合する。外部依存なし・同期・
APIキー不要。閾値0.45は実データ総当たりの計測値（無関係カード間の最大
0.323、模範解答の先頭1/3で最小0.453）の間に置いた。意味の言い換えは
検出できないが、それは自己採点で上書きされる前提の設計である。

Co-Authored-By: Claude <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W4zCKp7PC84aQHrNFf6EmZ
EOF
)"
```

---

## Task 3: ドリル状態機械 その1 — 段・単位・ステップの構築

`drill.ts` の前半。「今どのカードのどの欄を問うているか」を決める部分だけを作る。回答・採点・適応N は Task 4。React に依存しない純粋モジュールで、`await`・タイマー・ドレインは一切無い。

**設計の要点（spec §6 とユーザー確定事項）:**

1. **ヘッダの序数 M は「問われているカードの序数」**（`targetIndex` が指すカードの `order`）。観察のみのステップでは、代わりに表示中カードの序数を出す。
2. **学習段は2画面。** 画面A「読む」でカード `i` の全文を出し、`つぎへ` で画面B「答える」に移ってカード `i-n` を問う。
3. **歩数は `単位数 + n`。** 素直に `i-n` のラグだけ入れると末尾N枚が一度も問われないため、後ろにドレイン用のN手を足す。先頭N手は観察のみ、末尾N手は出題のみ。これで全単位がちょうど1回ずつ問われる。

| 段 | 単位 | 単位数(ch02) | 歩数(n=2) | 画面A（読む） |
|---|---|---|---|---|
| 学習 | カード | 7 | 9 | あり（先頭7手） |
| 目的 | カード | 7 | 9 | なし |
| 具体アクション | 小目的（平坦化） | 約20 | 約22 | なし |

**Files:**
- Create: `src/actions/drill.ts`
- Test: `src/actions/__tests__/drill.test.ts`

**Interfaces:**
- Consumes: `ActionCard` / `Sequence` / `SubAction` from `src/actions/actions.ts`（Task 1）
- Produces:
  ```ts
  export type Stage = 'study' | 'purpose' | 'action';
  export const STAGE_ORDER: Stage[];                       // ['study','purpose','action']
  export function nextStage(stage: Stage): Stage | null;

  export interface DrillUnit { cardIndex: number; subIndex: number | null }
  export interface DrillStep {
    index: number;
    targetIndex: number | null;
    displayIndex: number | null;
    ordinal: number | null;
    totalCards: number;
    subIndex: number | null;
  }
  export function buildUnits(seq: Sequence, stage: Stage): DrillUnit[];
  export function buildSteps(units: DrillUnit[], n: number, stage: Stage, totalCards: number): DrillStep[];
  export function unitKey(unit: DrillUnit): string;
  ```

- [ ] **Step 1: 失敗するテストを書く**

`src/actions/__tests__/drill.test.ts` を新規作成する。

```ts
import type { Sequence } from '../actions';
import { buildSteps, buildUnits, nextStage, STAGE_ORDER, unitKey } from '../drill';

function sub(cardId: string, k: number) {
  return {
    id: `${cardId}-s${k}`,
    purpose: `sp-${cardId}-${k}`,
    action: `sa-${cardId}-${k}`,
    actionAccept: [`aa-${cardId}-${k}`],
  };
}

function card(id: string, order: number, subCount: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    order,
    title: `title-${id}`,
    purpose: `purpose-${id}`,
    purposeAccept: [`p-${id}`],
    subActions: Array.from({ length: subCount }, (_, k) => sub(id, k + 1)),
    category: 'universal' as const,
    ...extra,
  };
}

/** 4枚。小目的は 2 + 3 + 2 + 0 = 7 個。c4 は具体アクション段でスキップされる。 */
const SEQ: Sequence = {
  id: 's',
  product: 'sub-finance',
  goal: 'g',
  scenario: 'sc',
  credit: 'c',
  cards: [
    card('c1', 1, 2),
    card('c2', 2, 3),
    card('c3', 3, 2),
    card('c4', 4, 0, { layer2Skipped: true }),
  ],
};

const steps = (stage: Parameters<typeof buildSteps>[2], n: number) =>
  buildSteps(buildUnits(SEQ, stage), n, stage, SEQ.cards.length);

describe('stage order', () => {
  it('runs study -> purpose -> action and then ends', () => {
    expect(STAGE_ORDER).toEqual(['study', 'purpose', 'action']);
    expect(nextStage('study')).toBe('purpose');
    expect(nextStage('purpose')).toBe('action');
    expect(nextStage('action')).toBeNull();
  });
});

describe('buildUnits', () => {
  it('walks cards in the study and purpose stages', () => {
    for (const stage of ['study', 'purpose'] as const) {
      expect(buildUnits(SEQ, stage)).toEqual([
        { cardIndex: 0, subIndex: null },
        { cardIndex: 1, subIndex: null },
        { cardIndex: 2, subIndex: null },
        { cardIndex: 3, subIndex: null },
      ]);
    }
  });

  it('flattens subActions in the action stage and drops cards that have none', () => {
    expect(buildUnits(SEQ, 'action')).toEqual([
      { cardIndex: 0, subIndex: 0 },
      { cardIndex: 0, subIndex: 1 },
      { cardIndex: 1, subIndex: 0 },
      { cardIndex: 1, subIndex: 1 },
      { cardIndex: 1, subIndex: 2 },
      { cardIndex: 2, subIndex: 0 },
      { cardIndex: 2, subIndex: 1 },
    ]);
  });

  it('gives every unit a distinct key', () => {
    const keys = buildUnits(SEQ, 'action').map(unitKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(unitKey({ cardIndex: 1, subIndex: null })).not.toBe(unitKey({ cardIndex: 1, subIndex: 0 }));
  });
});

describe('buildSteps', () => {
  it('walks unit count + n steps so every unit is asked exactly once', () => {
    expect(steps('study', 2)).toHaveLength(6);
    expect(steps('purpose', 2)).toHaveLength(6);
    expect(steps('action', 1)).toHaveLength(8);
    const asked = steps('purpose', 2)
      .map((s) => s.targetIndex)
      .filter((t): t is number => t !== null);
    expect(asked).toEqual([0, 1, 2, 3]);
  });

  it('lags the target by n and leaves the first n steps observation-only', () => {
    expect(steps('study', 2).map((s) => s.targetIndex)).toEqual([null, null, 0, 1, 2, 3]);
  });

  it('shows a card to read only in the study stage, and only while cards remain', () => {
    expect(steps('study', 2).map((s) => s.displayIndex)).toEqual([0, 1, 2, 3, null, null]);
    expect(steps('purpose', 2).every((s) => s.displayIndex === null)).toBe(true);
    expect(steps('action', 1).every((s) => s.displayIndex === null)).toBe(true);
  });

  it('numbers the header by the card being asked, falling back to the card being read', () => {
    // 学習段 step0/1 は出題が無いので、読んでいるカードの序数を出す。
    expect(steps('study', 2).map((s) => s.ordinal)).toEqual([1, 2, 1, 2, 3, 4]);
    // 目的段には読む対象が無いので、観察のみの手は序数を持たない。
    expect(steps('purpose', 2).map((s) => s.ordinal)).toEqual([null, null, 1, 2, 3, 4]);
  });

  it('counts the ordinal in cards even when the action stage walks subActions', () => {
    const s = steps('action', 1);
    expect(s.map((x) => x.ordinal)).toEqual([null, 1, 1, 2, 2, 2, 3, 3]);
    expect(s.map((x) => x.subIndex)).toEqual([null, 0, 1, 0, 1, 2, 0, 1]);
    expect(s.every((x) => x.totalCards === 4)).toBe(true);
  });

  it('carries a null subIndex outside the action stage', () => {
    expect(steps('study', 2).every((s) => s.subIndex === null)).toBe(true);
    expect(steps('purpose', 2).every((s) => s.subIndex === null)).toBe(true);
  });

  it('still asks every card when n exceeds the card count', () => {
    const s = steps('purpose', 9);
    expect(s).toHaveLength(13);
    expect(s.slice(0, 9).every((x) => x.targetIndex === null)).toBe(true);
    expect(s.slice(9).map((x) => x.targetIndex)).toEqual([0, 1, 2, 3]);
  });

  it('yields n observation-only steps and nothing else when there are no units', () => {
    const s = buildSteps([], 2, 'action', 4);
    expect(s).toHaveLength(2);
    expect(s.every((x) => x.targetIndex === null && x.ordinal === null)).toBe(true);
  });

  it('numbers step.index from 0 in walk order', () => {
    expect(steps('study', 2).map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
```

- [ ] **Step 2: テストを走らせて落ちることを確認**

Run: `npx jest src/actions/__tests__/drill.test.ts`
Expected: FAIL — `Cannot find module '../drill'`

- [ ] **Step 3: drill.ts の前半を実装する**

`src/actions/drill.ts` を新規作成する。

```ts
import type { Sequence } from './actions';

export type Stage = 'study' | 'purpose' | 'action';

export const STAGE_ORDER: Stage[] = ['study', 'purpose', 'action'];

export function nextStage(stage: Stage): Stage | null {
  const i = STAGE_ORDER.indexOf(stage);
  return i >= 0 && i + 1 < STAGE_ORDER.length ? STAGE_ORDER[i + 1] : null;
}

/**
 * 歩きの1単位。学習段と目的段はカードそのもの、具体アクション段は
 * カード内の小目的である。序数は常にカード単位で数えるので、小目的も
 * 所属カードの添字を持ち歩く。
 */
export interface DrillUnit {
  cardIndex: number;
  /** 具体アクション段でのみ非 null。カード内で何番目の小目的か。 */
  subIndex: number | null;
}

export interface DrillStep {
  index: number;
  /** この設問が問う単位。null なら観察のみ（先頭N手）。 */
  targetIndex: number | null;
  /** 「読む」面に出す単位。学習段でカードが残っている間だけ非 null。 */
  displayIndex: number | null;
  /** 「全 7 個中 M 個目」の M（1始まり）。何も出さない手では null。 */
  ordinal: number | null;
  /** 「全 7 個中」の 7。常にカード枚数。 */
  totalCards: number;
  /** 問う対象の小目的の添字。具体アクション段でのみ非 null。 */
  subIndex: number | null;
}

export function unitKey(unit: DrillUnit): string {
  return `${unit.cardIndex}:${unit.subIndex ?? '-'}`;
}

export function buildUnits(seq: Sequence, stage: Stage): DrillUnit[] {
  if (stage !== 'action') {
    return seq.cards.map((_, cardIndex) => ({ cardIndex, subIndex: null }));
  }
  // subActions が空のカード（layer2Skipped）はここで自然に落ちる。
  return seq.cards.flatMap((card, cardIndex) =>
    card.subActions.map((_, subIndex) => ({ cardIndex, subIndex })),
  );
}

/**
 * 歩数は units.length + n。素直に i-n のラグを入れるだけだと末尾N単位が
 * 一度も問われないので、後ろにドレイン用のN手を足す。先頭N手は観察のみ、
 * 末尾N手は出題のみになり、全単位がちょうど1回ずつ問われる。
 */
export function buildSteps(
  units: DrillUnit[],
  n: number,
  stage: Stage,
  totalCards: number,
): DrillStep[] {
  const ordinalOf = (unitIndex: number) => units[unitIndex].cardIndex + 1;

  return Array.from({ length: units.length + n }, (_, index) => {
    const targetIndex = index >= n ? index - n : null;
    const displayIndex = stage === 'study' && index < units.length ? index : null;
    const ordinal =
      targetIndex !== null
        ? ordinalOf(targetIndex)
        : displayIndex !== null
          ? ordinalOf(displayIndex)
          : null;
    return {
      index,
      targetIndex,
      displayIndex,
      ordinal,
      totalCards,
      subIndex: targetIndex !== null ? units[targetIndex].subIndex : null,
    };
  });
}
```

- [ ] **Step 4: テストを走らせて通ることを確認**

Run: `npx jest src/actions/__tests__/drill.test.ts`
Expected: PASS（12件）

- [ ] **Step 5: コミット**

```bash
git add src/actions/drill.ts src/actions/__tests__/drill.test.ts
git commit -m "$(cat <<'EOF'
feat(actions): build three-stage drill steps

学習・目的・具体アクションの各段について、歩きの単位とステップを組む
純粋関数。歩数を units+n にして末尾N単位もドレインで問われるようにし、
序数は具体アクション段でも常にカード単位で数える。

Co-Authored-By: Claude <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W4zCKp7PC84aQHrNFf6EmZ
EOF
)"
```

---

## Task 4: ドリル状態機械 その2 — 回答・自己採点・適応N

`drill.ts` の後半。カーソル、回答の記録、模範解答の組み立て、自己採点による上書き、段末の `answerScore` と `nextN` の連動を足す。ここまでで画面は「描く」以外の判断を一切しなくてよくなる。

**採点まわりの決め事（spec §5・§6.2・§6.3）:**

- 模範解答は必ず `accept` 集合の先頭に入れる。ユーザーが模範解答そのものを打ったら当然正解になる。
- **学習段の具体アクション欄はカード直下の答えを持たない。** そのカードの全 `subActions` の `action` と `actionAccept` を合併した集合に照合し、模範解答としては全ての具体アクションを列挙して開示する。一手順でも言い当てれば正解。
- `subActions` が空のカード（`layer2Skipped`）は、学習段でも具体アクション欄を出さない。
- 段末の `answerScore = 正解数 ÷ 判定済み数`。位置チャネルが無いので `roundScore` は `answerScore` に等しく、`nextN(score, n, { positionScore: null, answerScore: score })` を呼ぶ。判定済みが0件なら N は変えない。

**Files:**
- Modify: `src/actions/drill.ts`（Task 3 の内容に追記）
- Test: `src/actions/__tests__/drill.test.ts`（Task 3 の内容に追記）

**Interfaces:**
- Consumes: Task 3 の `Stage` / `DrillUnit` / `DrillStep` / `buildUnits` / `buildSteps` / `unitKey`、Task 2 の `gradeAnswer`、既存の `nextN` from `src/engine/adaptive.ts`
- Produces:
  ```ts
  export type Field = 'purpose' | 'action';
  export interface AnswerSpec { model: string; accept: string[] }
  export interface AnswerRecord { stepIndex: number; field: Field; input: string; correct: boolean }
  export interface StepContent { card: ActionCard; subAction: SubAction | null }
  export interface DrillState {
    stage: Stage; n: number;
    units: DrillUnit[]; steps: DrillStep[];
    cursor: number; answers: AnswerRecord[]; checked: Set<string>;
  }
  export function createDrill(seq: Sequence, stage: Stage, n: number): DrillState;
  export function currentStep(state: DrillState): DrillStep | null;
  export function isFinished(state: DrillState): boolean;
  export function advance(state: DrillState): DrillState;
  export function toggleChecked(state: DrillState, key: string): DrillState;
  export function unitContent(seq: Sequence, unit: DrillUnit): StepContent;
  export function fieldsFor(stage: Stage, card: ActionCard): Field[];
  export function purposeAnswer(card: ActionCard): AnswerSpec;
  export function actionAnswer(card: ActionCard, subIndex: number | null): AnswerSpec | null;
  export function submitAnswer(state: DrillState, field: Field, input: string, spec: AnswerSpec): DrillState;
  export function setSelfGrade(state: DrillState, stepIndex: number, field: Field, correct: boolean): DrillState;
  export function answerFor(state: DrillState, stepIndex: number, field: Field): AnswerRecord | undefined;
  export function stageScore(state: DrillState): number | null;
  export function updatedN(state: DrillState): number;
  ```

- [ ] **Step 1: 失敗するテストを書く**

`src/actions/__tests__/drill.test.ts` の import 行を差し替え、末尾に describe を3つ足す。

冒頭の import を次に置き換える（`SEQ` / `card` / `sub` / `steps` ヘルパはそのまま使う）。

```ts
import type { Sequence } from '../actions';
import {
  actionAnswer,
  advance,
  answerFor,
  buildSteps,
  buildUnits,
  createDrill,
  currentStep,
  fieldsFor,
  isFinished,
  nextStage,
  purposeAnswer,
  setSelfGrade,
  stageScore,
  STAGE_ORDER,
  submitAnswer,
  toggleChecked,
  unitContent,
  unitKey,
  updatedN,
} from '../drill';
```

ファイル末尾に次を足す。

```ts
const CORRECT = 'purpose-c1';
const WRONG = 'まったく関係のない答えを書いた';

describe('drill cursor', () => {
  it('starts at step 0 with no answers and nothing checked', () => {
    const d = createDrill(SEQ, 'study', 2);
    expect(d.stage).toBe('study');
    expect(d.n).toBe(2);
    expect(d.cursor).toBe(0);
    expect(d.answers).toEqual([]);
    expect(d.checked.size).toBe(0);
    expect(d.steps).toHaveLength(6);
    expect(currentStep(d)).toBe(d.steps[0]);
    expect(isFinished(d)).toBe(false);
  });

  it('advances one step at a time and finishes past the last step', () => {
    let d = createDrill(SEQ, 'study', 2);
    for (let i = 0; i < 6; i += 1) {
      expect(isFinished(d)).toBe(false);
      expect(currentStep(d)?.index).toBe(i);
      d = advance(d);
    }
    expect(isFinished(d)).toBe(true);
    expect(currentStep(d)).toBeNull();
  });

  it('does not mutate the state it is given', () => {
    const d = createDrill(SEQ, 'study', 2);
    advance(d);
    expect(d.cursor).toBe(0);
  });
});

describe('step content and fields', () => {
  it('resolves a unit to its card, and to its subAction in the action stage', () => {
    const study = createDrill(SEQ, 'study', 2);
    expect(unitContent(SEQ, study.units[1])).toEqual({ card: SEQ.cards[1], subAction: null });
    const action = createDrill(SEQ, 'action', 1);
    // units[3] は c2 の2つ目の小目的。
    expect(unitContent(SEQ, action.units[3])).toEqual({
      card: SEQ.cards[1],
      subAction: SEQ.cards[1].subActions[1],
    });
  });

  it('shows both fields in the study stage and one field in the others', () => {
    expect(fieldsFor('study', SEQ.cards[0])).toEqual(['purpose', 'action']);
    expect(fieldsFor('purpose', SEQ.cards[0])).toEqual(['purpose']);
    expect(fieldsFor('action', SEQ.cards[0])).toEqual(['action']);
  });

  it('drops the action field in the study stage for a card with no subActions', () => {
    expect(fieldsFor('study', SEQ.cards[3])).toEqual(['purpose']);
  });
});

describe('model answers', () => {
  it('puts the model answer itself at the head of the accept set', () => {
    const spec = purposeAnswer(SEQ.cards[0]);
    expect(spec.model).toBe('purpose-c1');
    expect(spec.accept[0]).toBe('purpose-c1');
    expect(spec.accept).toContain('p-c1');
  });

  it('targets one subAction when the action stage names it', () => {
    const spec = actionAnswer(SEQ.cards[1], 2)!;
    expect(spec.model).toBe('sa-c2-3');
    expect(spec.accept).toEqual(['sa-c2-3', 'aa-c2-3']);
  });

  it('merges every subAction when the study stage asks the card as a whole', () => {
    const spec = actionAnswer(SEQ.cards[0], null)!;
    // 開示は全列挙、照合は合併集合。一手順でも言い当てれば正解（spec §6.2）。
    expect(spec.model).toBe('sa-c1-1\nsa-c1-2');
    expect(spec.accept).toEqual(['sa-c1-1', 'aa-c1-1', 'sa-c1-2', 'aa-c1-2']);
  });

  it('has no action answer at all for a card with no subActions', () => {
    expect(actionAnswer(SEQ.cards[3], null)).toBeNull();
  });
});

describe('answers, self-grading and adaptive N', () => {
  const atStep = (stage: Parameters<typeof createDrill>[1], n: number, step: number) => {
    let d = createDrill(SEQ, stage, n);
    while (d.cursor < step) d = advance(d);
    return d;
  };

  it('grades a submitted answer locally and records the raw input', () => {
    const d = submitAnswer(atStep('study', 2, 2), 'purpose', CORRECT, purposeAnswer(SEQ.cards[0]));
    const rec = answerFor(d, 2, 'purpose')!;
    expect(rec).toEqual({ stepIndex: 2, field: 'purpose', input: CORRECT, correct: true });
    expect(stageScore(d)).toBe(1);
  });

  it('marks an unrelated answer wrong', () => {
    const d = submitAnswer(atStep('study', 2, 2), 'purpose', WRONG, purposeAnswer(SEQ.cards[0]));
    expect(answerFor(d, 2, 'purpose')!.correct).toBe(false);
    expect(stageScore(d)).toBe(0);
  });

  it('keeps one record per step and field, replacing a resubmission', () => {
    let d = submitAnswer(atStep('study', 2, 2), 'purpose', WRONG, purposeAnswer(SEQ.cards[0]));
    d = submitAnswer(d, 'purpose', CORRECT, purposeAnswer(SEQ.cards[0]));
    expect(d.answers).toHaveLength(1);
    expect(answerFor(d, 2, 'purpose')!.correct).toBe(true);
  });

  it('keeps the two study-stage fields as separate records', () => {
    let d = submitAnswer(atStep('study', 2, 2), 'purpose', CORRECT, purposeAnswer(SEQ.cards[0]));
    d = submitAnswer(d, 'action', WRONG, actionAnswer(SEQ.cards[0], null)!);
    expect(d.answers).toHaveLength(2);
    expect(stageScore(d)).toBe(0.5);
  });

  it('lets self-grading overwrite the local verdict in both directions', () => {
    let d = submitAnswer(atStep('study', 2, 2), 'purpose', WRONG, purposeAnswer(SEQ.cards[0]));
    d = setSelfGrade(d, 2, 'purpose', true);
    expect(answerFor(d, 2, 'purpose')!.correct).toBe(true);
    expect(stageScore(d)).toBe(1);
    d = setSelfGrade(d, 2, 'purpose', false);
    expect(stageScore(d)).toBe(0);
  });

  it('ignores a self-grade for a step and field that was never answered', () => {
    const d = setSelfGrade(createDrill(SEQ, 'study', 2), 4, 'action', true);
    expect(d.answers).toEqual([]);
    expect(stageScore(d)).toBeNull();
  });

  it('raises N only on a perfect stage', () => {
    const d = submitAnswer(atStep('purpose', 2, 2), 'purpose', CORRECT, purposeAnswer(SEQ.cards[0]));
    expect(stageScore(d)).toBe(1);
    expect(updatedN(d)).toBe(3);
  });

  it('lowers N at or below half, and floors it at 1', () => {
    let d = submitAnswer(atStep('purpose', 2, 2), 'purpose', CORRECT, purposeAnswer(SEQ.cards[0]));
    d = submitAnswer(advance(d), 'purpose', WRONG, purposeAnswer(SEQ.cards[1]));
    expect(stageScore(d)).toBe(0.5);
    expect(updatedN(d)).toBe(1);

    const bottom = submitAnswer(atStep('purpose', 1, 1), 'purpose', WRONG, purposeAnswer(SEQ.cards[0]));
    expect(updatedN(bottom)).toBe(1);
  });

  it('holds N steady between half and perfect', () => {
    let d = submitAnswer(atStep('purpose', 2, 2), 'purpose', CORRECT, purposeAnswer(SEQ.cards[0]));
    d = submitAnswer(advance(d), 'purpose', CORRECT, purposeAnswer(SEQ.cards[1]));
    d = submitAnswer(advance(d), 'purpose', WRONG, purposeAnswer(SEQ.cards[2]));
    expect(stageScore(d)).toBeCloseTo(2 / 3);
    expect(updatedN(d)).toBe(2);
  });

  it('leaves N alone when nothing was judged', () => {
    // 単位が0件なら全ステップが観察のみ。判定済み0件なので N は動かない。
    const d = createDrill({ ...SEQ, cards: [SEQ.cards[3]] }, 'action', 3);
    expect(d.steps).toHaveLength(3);
    expect(stageScore(d)).toBeNull();
    expect(updatedN(d)).toBe(3);
  });
});

describe('study-stage green checks', () => {
  it('toggles on and off and never touches the score', () => {
    const key = unitKey({ cardIndex: 0, subIndex: null });
    let d = toggleChecked(createDrill(SEQ, 'study', 2), key);
    expect(d.checked.has(key)).toBe(true);
    expect(stageScore(d)).toBeNull();
    d = toggleChecked(d, key);
    expect(d.checked.has(key)).toBe(false);
  });

  it('does not mutate the state it is given', () => {
    const d = createDrill(SEQ, 'study', 2);
    toggleChecked(d, unitKey({ cardIndex: 0, subIndex: null }));
    expect(d.checked.size).toBe(0);
  });
});
```

- [ ] **Step 2: テストを走らせて落ちることを確認**

Run: `npx jest src/actions/__tests__/drill.test.ts`
Expected: FAIL — `createDrill is not a function`（および他の未実装 export で TS エラー）

- [ ] **Step 3: drill.ts に後半を実装する**

`src/actions/drill.ts` の import 行を次に差し替える。

```ts
import { nextN } from '../engine/adaptive';
import type { ActionCard, Sequence, SubAction } from './actions';
import { gradeAnswer } from './grade';
```

ファイル末尾に次を追記する。

```ts
export type Field = 'purpose' | 'action';

/** 開示に使う模範解答と、照合に使う許容集合。model は必ず accept に含まれる。 */
export interface AnswerSpec {
  model: string;
  accept: string[];
}

export interface AnswerRecord {
  stepIndex: number;
  field: Field;
  /** ユーザーが打った生の文字列。開示画面で「あなたの答え」として出す。 */
  input: string;
  /** ローカル照合の結果。自己採点で上書きされる。 */
  correct: boolean;
}

export interface StepContent {
  card: ActionCard;
  /** 具体アクション段でのみ非 null。 */
  subAction: SubAction | null;
}

export interface DrillState {
  stage: Stage;
  n: number;
  units: DrillUnit[];
  steps: DrillStep[];
  cursor: number;
  answers: AnswerRecord[];
  /** 学習段の緑チェック。セッション限りの飾りで、採点にも進行にも無関係。 */
  checked: Set<string>;
}

export function createDrill(seq: Sequence, stage: Stage, n: number): DrillState {
  const units = buildUnits(seq, stage);
  return {
    stage,
    n,
    units,
    steps: buildSteps(units, n, stage, seq.cards.length),
    cursor: 0,
    answers: [],
    checked: new Set(),
  };
}

export function currentStep(state: DrillState): DrillStep | null {
  return state.steps[state.cursor] ?? null;
}

export function isFinished(state: DrillState): boolean {
  return state.cursor >= state.steps.length;
}

export function advance(state: DrillState): DrillState {
  return { ...state, cursor: state.cursor + 1 };
}

export function toggleChecked(state: DrillState, key: string): DrillState {
  const checked = new Set(state.checked);
  if (checked.has(key)) checked.delete(key);
  else checked.add(key);
  return { ...state, checked };
}

export function unitContent(seq: Sequence, unit: DrillUnit): StepContent {
  const card = seq.cards[unit.cardIndex];
  return {
    card,
    subAction: unit.subIndex === null ? null : card.subActions[unit.subIndex],
  };
}

/**
 * その段でその カードについて開く入力欄。学習段は中目的と具体アクションの
 * 2欄だが、subActions を持たないカードは具体アクション欄を出さない。
 */
export function fieldsFor(stage: Stage, card: ActionCard): Field[] {
  if (stage === 'purpose') return ['purpose'];
  if (stage === 'action') return ['action'];
  return card.subActions.length > 0 ? ['purpose', 'action'] : ['purpose'];
}

export function purposeAnswer(card: ActionCard): AnswerSpec {
  return { model: card.purpose, accept: [card.purpose, ...card.purposeAccept] };
}

/**
 * subIndex が与えられればその小目的1本の答え。null（学習段）ならカードの
 * 全 subActions を合併する — 開示は全列挙、照合は合併集合で、一手順でも
 * 言い当てれば正解にする。テストではなく学習の段なので網羅は求めない。
 */
export function actionAnswer(card: ActionCard, subIndex: number | null): AnswerSpec | null {
  if (subIndex !== null) {
    const sub = card.subActions[subIndex];
    if (!sub) return null;
    return { model: sub.action, accept: [sub.action, ...sub.actionAccept] };
  }
  if (card.subActions.length === 0) return null;
  return {
    model: card.subActions.map((s) => s.action).join('\n'),
    accept: card.subActions.flatMap((s) => [s.action, ...s.actionAccept]),
  };
}

export function answerFor(
  state: DrillState,
  stepIndex: number,
  field: Field,
): AnswerRecord | undefined {
  return state.answers.find((a) => a.stepIndex === stepIndex && a.field === field);
}

export function submitAnswer(
  state: DrillState,
  field: Field,
  input: string,
  spec: AnswerSpec,
): DrillState {
  const record: AnswerRecord = {
    stepIndex: state.cursor,
    field,
    input,
    correct: gradeAnswer(input, spec.accept),
  };
  const answers = state.answers.filter(
    (a) => !(a.stepIndex === record.stepIndex && a.field === field),
  );
  return { ...state, answers: [...answers, record] };
}

/**
 * 自己採点。ローカル照合はあくまで初期値で、ユーザーの ✓／✕ が最終になる。
 * 閾値の誤りが学習を壊さないための逃げ道である（spec §5）。
 */
export function setSelfGrade(
  state: DrillState,
  stepIndex: number,
  field: Field,
  correct: boolean,
): DrillState {
  return {
    ...state,
    answers: state.answers.map((a) =>
      a.stepIndex === stepIndex && a.field === field ? { ...a, correct } : a,
    ),
  };
}

/** 正解数 ÷ 判定済み数。判定済みが0件なら null。 */
export function stageScore(state: DrillState): number | null {
  if (state.answers.length === 0) return null;
  const correct = state.answers.filter((a) => a.correct).length;
  return correct / state.answers.length;
}

/**
 * 段末の適応N。位置チャネルが無いので roundScore は answerScore に等しく、
 * 既存ルールどおり満点でだけ上がり、0.5以下で下がる。判定済み0件なら
 * 据え置き。
 */
export function updatedN(state: DrillState): number {
  const score = stageScore(state);
  if (score === null) return state.n;
  return nextN(score, state.n, { positionScore: null, answerScore: score });
}
```

- [ ] **Step 4: テストを走らせて通ることを確認**

Run: `npx jest src/actions/__tests__/drill.test.ts`
Expected: PASS（30件前後）

- [ ] **Step 5: 型検査と全体テスト**

Run: `npx tsc --noEmit && npx jest`
Expected: 両方 PASS

- [ ] **Step 6: コミット**

```bash
git add src/actions/drill.ts src/actions/__tests__/drill.test.ts
git commit -m "$(cat <<'EOF'
feat(actions): drill answers, self-grading and adaptive N

回答の記録、模範解答の組み立て、自己採点による上書き、段末の
answerScore と nextN の連動。学習段の具体アクション欄は全 subActions の
合併集合に照合し、一手順でも言い当てれば正解にする。位置チャネルが
無いので roundScore は answerScore に等しい。

Co-Authored-By: Claude <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W4zCKp7PC84aQHrNFf6EmZ
EOF
)"
```

---

## Task 5: 文言

固定文の `promptPurpose` / `promptAction` を捨て、文脈を組み立てる文言に置き換える（spec §8）。画面より先にやるのは、Task 6 の画面テストがこれらのキーを参照するため。

`src/strings/index.ts` は `Strings` interface → `ja` → `en` の3か所に同じ形を書く。3か所すべてを揃えること。`src/strings/__tests__/index.test.ts` の既存テストが ja/en のキー集合と値の型の一致を検査するので、片方だけ足すと落ちる。

**Files:**
- Modify: `src/strings/index.ts:125-141`（interface）, `:271-292`（ja）, `:422-443`（en）

**Interfaces:**
- Consumes: なし
- Produces: `strings.actions` の新しい形（下記）。`strings.actions.productLabel` は無変更で、`src/ui/SequencesScreen.tsx:21` が引き続き使う。

- [ ] **Step 1: interface を書き換える**

`src/strings/index.ts:125-141` の `actions: { ... };` ブロック全体を次に置き換える。

```ts
  actions: {
    tab: string;
    /** 三段ナビのラベル。 */
    stageStudy: string;
    stagePurpose: string;
    stageAction: string;
    /** プレイ画面のヘッダと本文のラベル。 */
    grandPurposeLabel: string;
    meansLabel: string;
    midPurposeLabel: string;
    subPurposeLabel: string;
    concreteActionLabel: string;
    /** 「全 7 個中 3 個目のアクション」。 */
    ordinalOf: (m: number, total: number) => string;
    observeOnly: string;
    /** 開示画面。 */
    yourAnswer: string;
    modelAnswer: string;
    selfGradeLabel: string;
    selfGradeCorrect: string;
    selfGradeWrong: string;
    next: string;
    nextQuestion: string;
    nextStage: string;
    again: string;
    backToList: string;
    start: string;
    nLabel: string;
    goalLabel: string;
    cardsPreview: string;
    stageScoreLabel: string;
    productLabel: (p: string) => string;
  };
```

- [ ] **Step 2: ja を書き換える**

`src/strings/index.ts:271-292` の `actions: { ... },` ブロック全体を次に置き換える。

```ts
  actions: {
    tab: 'アクション',
    stageStudy: '学習',
    stagePurpose: '目的',
    stageAction: '具体アクション',
    grandPurposeLabel: '大目的',
    meansLabel: '手段の総称',
    midPurposeLabel: '目的',
    subPurposeLabel: '小目的',
    concreteActionLabel: '具体アクション',
    ordinalOf: (m, total) => `全 ${total} 個中 ${m} 個目のアクション`,
    observeOnly: 'この手は観察のみ',
    yourAnswer: 'あなたの答え',
    modelAnswer: '模範解答',
    selfGradeLabel: '自己採点',
    selfGradeCorrect: '✓',
    selfGradeWrong: '✕',
    next: 'つぎへ',
    nextQuestion: '次の問題へ',
    nextStage: '次の段へ',
    again: 'もう一度',
    backToList: '一覧へ',
    start: 'はじめる',
    nLabel: 'N',
    goalLabel: '目標',
    cardsPreview: 'カードの並び',
    stageScoreLabel: '正答率',
    productLabel: (p) =>
      p === 'sub-finance' ? 'サブスクリプション・ファイナンス'
      : p === 'nav-finance' ? 'NAV ファイナンス'
      : p === 'hybrid-pref' ? 'ハイブリッド & 優先株'
      : p === 'gp-facility' ? 'GP ファシリティ'
      : p,
  },
```

- [ ] **Step 3: en を書き換える**

`src/strings/index.ts:422-443` の `actions: { ... },` ブロック全体を次に置き換える。

```ts
  actions: {
    tab: 'Actions',
    stageStudy: 'Study',
    stagePurpose: 'Purpose',
    stageAction: 'Concrete action',
    grandPurposeLabel: 'Overall goal',
    meansLabel: 'Name of the move',
    midPurposeLabel: 'Purpose',
    subPurposeLabel: 'Sub-purpose',
    concreteActionLabel: 'Concrete action',
    ordinalOf: (m, total) => `Action ${m} of ${total}`,
    observeOnly: 'Observe only',
    yourAnswer: 'Your answer',
    modelAnswer: 'Model answer',
    selfGradeLabel: 'Self-grade',
    selfGradeCorrect: '✓',
    selfGradeWrong: '✕',
    next: 'Next',
    nextQuestion: 'Next question',
    nextStage: 'Next stage',
    again: 'Again',
    backToList: 'Back to list',
    start: 'Start',
    nLabel: 'N',
    goalLabel: 'Goal',
    cardsPreview: 'Card order',
    stageScoreLabel: 'Score',
    productLabel: (p) =>
      p === 'sub-finance' ? 'Subscription Finance'
      : p === 'nav-finance' ? 'NAV Finance'
      : p === 'hybrid-pref' ? 'Hybrid & Preferred'
      : p === 'gp-facility' ? 'GP Facilities'
      : p,
  },
```

- [ ] **Step 4: 文言テストを走らせる**

Run: `npx jest src/strings`
Expected: PASS（ja/en のキー集合と型が一致していること）

- [ ] **Step 5: 型検査で旧キーの参照を洗い出す**

Run: `npx tsc --noEmit`
Expected: FAIL — `src/ui/ActionGameScreen.tsx` が `layer1` / `layer2` / `promptPurpose` / `promptAction` / `answer` / `toLayer2` を参照しているというエラーが6件前後。**これは想定どおり**で、Task 6 の画面書き換えで解消する。`SequencesScreen.tsx` にエラーが出ていないことだけ確認する。

- [ ] **Step 6: コミット**

一時的に `tsc` が通らない状態でコミットする。Task 6 とセットで初めて緑になる。

```bash
git add src/strings/index.ts
git commit -m "$(cat <<'EOF'
feat(actions): replace fixed prompts with contextual strings

「N手前のカードの目的は？」は文字どおりのNであって実際のラグですらなく、
覚える価値も無かった。序数・階層ラベル・開示と自己採点の文言に置き換える。
ActionGameScreen は次のコミットまで型が通らない。

Co-Authored-By: Claude <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W4zCKp7PC84aQHrNFf6EmZ
EOF
)"
```

---

## Task 6: 画面の作り替え

`ActionGameScreen` から音声スタックを全部外し、`drill.ts` を駆動する素直な描画に置き換える。用済みになった `plan.ts` を消し、`src/actions/` を device-free 境界に登録する。

**画面の骨格（spec §7 とユーザー確定事項）:**

- **intro** — シナリオ／目標／カード並びのプレビュー、三段ナビ（`学習 → 目的 → 具体アクション`。矢印は進行順を示すだけの非対話要素）、N ピッカー、はじめる。開始は必ず学習段から。
- **play** — ヘッダ（大目的・序数・`N-back`）は全段共通で常時表示。本体は1ステップにつき最大3面。
  - `read`（学習段だけ、`displayIndex` が非 null のとき）… カードの入れ子を全部見せる。枠をタップすると緑になる。
  - `observe`（目的段・具体アクション段の先頭N手）… 出題も表示も無い手。`つぎへ` だけ。
  - `answer` … 入力欄。学習段は2欄、他は1欄。具体アクション段では小目的が問題文として出る。
  - `reveal` … あなたの答え／模範解答／緑赤の判定バー／自己採点 ✓ ✕ ／次の問題へ。
- **results** — 段名、正答率、更新後の N、次の段へ（最終段なら もう一度／一覧へ）。

**Files:**
- Rewrite: `src/ui/ActionGameScreen.tsx`
- Rewrite: `src/ui/__tests__/ActionGameScreen.test.tsx`
- Delete: `src/actions/plan.ts`, `src/actions/__tests__/plan.test.ts`
- Modify: `src/__tests__/boundaries.test.ts:10`

**Interfaces:**
- Consumes: Task 3・4 の `drill.ts` の全 export、Task 5 の `strings.actions.*`、既存の `getSequence` / `getTheme`
- Produces: `ActionGameScreen({ sequenceId, onExit })` — props は無変更なので `App.tsx:138` は触らない。

- [ ] **Step 1: 失敗するテストを書く**

`src/ui/__tests__/ActionGameScreen.test.tsx` の中身を全部次に置き換える。**`jest.mock('expo-speech-recognition', ...)` と `jest.mock('expo-speech', ...)` は消す** — この画面が音声モジュールを import しなくなったことの証明そのものなので、モック無しで通ることに意味がある。

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { listSequences } from '../../actions/actions';
import { ja } from '../../strings';
import { ActionGameScreen } from '../ActionGameScreen';
import { getTheme } from '../theme';

// expo-speech / expo-speech-recognition のモックは無い。この画面はもう
// 音声スタックを import しないので、モック無しで描画できること自体が
// 依存が切れている証拠になる（spec §3・§7）。

const SEQ = listSequences()[0];
const THEME = getTheme();

/** N を 1 に落として学習段を開始する。ラグが短いほど手数が少なくて済む。 */
function startStudyAtN1() {
  render(<ActionGameScreen sequenceId={SEQ.id} onExit={jest.fn()} />);
  fireEvent.press(screen.getByTestId('action-n-down')); // 2 -> 1
  fireEvent.press(screen.getByTestId('action-start'));
}

const bgOf = (testID: string) =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style).backgroundColor;

/** step 0 の読む面を抜け、step 1 でカード1を問われる面まで進む。 */
function reachFirstQuestion() {
  startStudyAtN1();
  fireEvent.press(screen.getByTestId('action-read-next')); // step 0 -> step 1
  fireEvent.press(screen.getByTestId('action-read-next')); // step 1 の読む面 -> 答える面
}

describe('intro', () => {
  it('shows the scenario, the goal and every card title', () => {
    render(<ActionGameScreen sequenceId={SEQ.id} onExit={jest.fn()} />);
    expect(screen.getByTestId('action-intro')).toBeTruthy();
    expect(screen.getByText(SEQ.scenario)).toBeTruthy();
    for (const card of SEQ.cards) expect(screen.getByText(card.title)).toBeTruthy();
  });

  it('shows the three stages in order as a non-interactive nav', () => {
    render(<ActionGameScreen sequenceId={SEQ.id} onExit={jest.fn()} />);
    expect(screen.getByTestId('action-nav-study').props.children).toBe(ja.actions.stageStudy);
    expect(screen.getByTestId('action-nav-purpose').props.children).toBe(ja.actions.stagePurpose);
    expect(screen.getByTestId('action-nav-action').props.children).toBe(ja.actions.stageAction);
  });

  it('picks N, flooring at 1', () => {
    render(<ActionGameScreen sequenceId={SEQ.id} onExit={jest.fn()} />);
    fireEvent.press(screen.getByTestId('action-n-up'));
    expect(screen.getByTestId('action-n-value').props.children).toBe(3);
    for (let i = 0; i < 5; i += 1) fireEvent.press(screen.getByTestId('action-n-down'));
    expect(screen.getByTestId('action-n-value').props.children).toBe(1);
  });

  it('renders a back affordance and exits when the sequence is unknown', () => {
    const onExit = jest.fn();
    render(<ActionGameScreen sequenceId="no-such-sequence" onExit={onExit} />);
    fireEvent.press(screen.getByTestId('action-back'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('the study stage', () => {
  it('opens on a read pane with the card nesting and no input fields', () => {
    startStudyAtN1();
    expect(screen.getByTestId('action-play')).toBeTruthy();
    expect(screen.getByText(SEQ.cards[0].title)).toBeTruthy();
    expect(screen.getByText(SEQ.cards[0].purpose)).toBeTruthy();
    expect(screen.queryByTestId('action-input-purpose')).toBeNull();
  });

  it('keeps the grand purpose and the asked ordinal in the header', () => {
    startStudyAtN1();
    expect(screen.getByTestId('action-header-goal').props.children).toBe(SEQ.goal);
    // 先頭手は出題が無いので、読んでいるカードの序数を出す。
    expect(screen.getByTestId('action-header-ordinal').props.children).toBe(
      ja.actions.ordinalOf(1, SEQ.cards.length),
    );
    expect(screen.getByTestId('action-header-n').props.children).toEqual([1, '-back']);
  });

  it('toggles the green check on the read pane', () => {
    startStudyAtN1();
    expect(screen.queryByTestId('action-read-checked')).toBeNull();
    fireEvent.press(screen.getByTestId('action-read'));
    expect(screen.getByTestId('action-read-checked')).toBeTruthy();
    fireEvent.press(screen.getByTestId('action-read'));
    expect(screen.queryByTestId('action-read-checked')).toBeNull();
  });

  it('asks the n-back card, not the one on screen', () => {
    reachFirstQuestion();
    // 画面には カード2 が出ているが、問われているのは カード1 である。
    expect(screen.getByTestId('action-header-ordinal').props.children).toBe(
      ja.actions.ordinalOf(1, SEQ.cards.length),
    );
    expect(screen.getByTestId('action-input-purpose')).toBeTruthy();
    expect(screen.getByTestId('action-input-action')).toBeTruthy();
  });
});

describe('answering and revealing', () => {
  it('reveals both answers and paints the local verdict per field', () => {
    reachFirstQuestion();
    fireEvent.changeText(screen.getByTestId('action-input-purpose'), SEQ.cards[0].purpose);
    fireEvent.changeText(screen.getByTestId('action-input-action'), 'まったく関係のない答えを書いた');
    fireEvent.press(screen.getByTestId('action-next'));

    expect(screen.getByTestId('action-your-purpose').props.children).toBe(SEQ.cards[0].purpose);
    expect(screen.getByTestId('action-model-purpose').props.children).toBe(SEQ.cards[0].purpose);
    expect(bgOf('action-verdict-purpose')).toBe(THEME.accentSuccess);
    expect(bgOf('action-verdict-action')).toBe(THEME.accentWarning);
  });

  it('lets self-grading repaint the verdict in both directions', () => {
    reachFirstQuestion();
    fireEvent.changeText(screen.getByTestId('action-input-purpose'), SEQ.cards[0].purpose);
    fireEvent.press(screen.getByTestId('action-next'));
    expect(bgOf('action-verdict-purpose')).toBe(THEME.accentSuccess);

    fireEvent.press(screen.getByTestId('action-self-wrong-purpose'));
    expect(bgOf('action-verdict-purpose')).toBe(THEME.accentWarning);
    fireEvent.press(screen.getByTestId('action-self-correct-purpose'));
    expect(bgOf('action-verdict-purpose')).toBe(THEME.accentSuccess);
  });

  it('moves to the next step from the reveal pane', () => {
    reachFirstQuestion();
    fireEvent.press(screen.getByTestId('action-next'));
    fireEvent.press(screen.getByTestId('action-next-question'));
    // step 2 の読む面。問われるのは カード2。
    expect(screen.getByTestId('action-read')).toBeTruthy();
    expect(screen.getByTestId('action-header-ordinal').props.children).toBe(
      ja.actions.ordinalOf(2, SEQ.cards.length),
    );
  });
});

describe('stage transitions', () => {
  /** 現在の面がどれであれ、1ステップ分だけ最短で進める。 */
  function stepThrough() {
    if (screen.queryByTestId('action-read-next')) fireEvent.press(screen.getByTestId('action-read-next'));
    if (screen.queryByTestId('action-observe-next')) fireEvent.press(screen.getByTestId('action-observe-next'));
    if (screen.queryByTestId('action-next')) fireEvent.press(screen.getByTestId('action-next'));
    if (screen.queryByTestId('action-next-question')) fireEvent.press(screen.getByTestId('action-next-question'));
  }

  it('ends the study stage on a results screen and leads into the purpose stage', () => {
    startStudyAtN1();
    // 学習段は カード枚数 + N 手。
    for (let i = 0; i < SEQ.cards.length + 1; i += 1) stepThrough();

    expect(screen.getByTestId('action-results')).toBeTruthy();
    expect(screen.getByTestId('action-results-stage').props.children).toBe(ja.actions.stageStudy);
    // 何も入力しなかったので全問不正解。
    expect(screen.getByTestId('action-results-score').props.children).toEqual([
      ja.actions.stageScoreLabel, ': ', '0%',
    ]);

    fireEvent.press(screen.getByTestId('action-next-stage'));
    expect(screen.getByTestId('action-play')).toBeTruthy();
    // 目的段には読む面が無く、先頭N手は観察のみになる。
    expect(screen.queryByTestId('action-read')).toBeNull();
    expect(screen.getByTestId('action-observe-next')).toBeTruthy();
    expect(screen.getByTestId('action-header-ordinal').props.children).toBe('—');
  });
});
```

- [ ] **Step 2: テストを走らせて落ちることを確認**

Run: `npx jest src/ui/__tests__/ActionGameScreen.test.tsx`
Expected: FAIL — `Unable to find an element with testID: action-nav-study` ほか多数。

- [ ] **Step 3: 画面を書き換える**

`src/ui/ActionGameScreen.tsx` の中身を全部次に置き換える。

```tsx
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { getSequence } from '../actions/actions';
import type { ActionCard } from '../actions/actions';
import {
  actionAnswer,
  advance,
  answerFor,
  createDrill,
  currentStep,
  fieldsFor,
  isFinished,
  nextStage,
  purposeAnswer,
  setSelfGrade,
  stageScore,
  submitAnswer,
  toggleChecked,
  unitContent,
  unitKey,
  updatedN,
} from '../actions/drill';
import type { AnswerSpec, DrillState, DrillStep, Field, Stage } from '../actions/drill';
import { useStrings } from '../strings';
import { getTheme } from './theme';

type Phase = 'intro' | 'play' | 'results';

/**
 * 1ステップの中で切り替わる面。read は学習段だけ、observe は出題も表示も
 * 無い先頭N手だけに出る。
 */
type Pane = 'read' | 'observe' | 'answer' | 'reveal';

const DEFAULT_N = 2;

function initialPane(step: DrillStep): Pane {
  if (step.displayIndex !== null) return 'read';
  if (step.targetIndex !== null) return 'answer';
  return 'observe';
}

/**
 * アクションカードの三段ドリル。音声スタックは使わない — タイマーも
 * 非同期採点も無く、状態は drill.ts の純粋な状態機械が全部持つので、
 * ここは描画とタップの受け口だけを持つ（spec §3）。
 */
export function ActionGameScreen({
  sequenceId,
  onExit,
}: {
  sequenceId: string;
  onExit: () => void;
}) {
  const strings = useStrings();
  const theme = getTheme();
  const seq = getSequence(sequenceId);

  const [phase, setPhase] = useState<Phase>('intro');
  const [n, setN] = useState(DEFAULT_N);
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [pane, setPane] = useState<Pane>('read');
  const [inputs, setInputs] = useState<Record<Field, string>>({ purpose: '', action: '' });

  if (!seq) {
    return (
      <View style={[styles.root, { backgroundColor: theme.bg }]}>
        <Pressable testID="action-back" onPress={onExit}>
          <Text style={{ color: theme.textPrimary }}>{strings.actions.backToList}</Text>
        </Pressable>
      </View>
    );
  }

  const stageLabel = (stage: Stage) =>
    stage === 'study'
      ? strings.actions.stageStudy
      : stage === 'purpose'
        ? strings.actions.stagePurpose
        : strings.actions.stageAction;

  const startStage = (stage: Stage, atN: number) => {
    const fresh = createDrill(seq, stage, atN);
    setDrill(fresh);
    setInputs({ purpose: '', action: '' });
    setPane(initialPane(fresh.steps[0]));
    setPhase('play');
  };

  const goNextStep = (state: DrillState) => {
    const next = advance(state);
    setDrill(next);
    if (isFinished(next)) {
      // 段末で一度だけ N を更新する。次の段はこの N で始まる。
      setN(updatedN(next));
      setPhase('results');
      return;
    }
    setInputs({ purpose: '', action: '' });
    setPane(initialPane(currentStep(next)!));
  };

  const specFor = (field: Field, card: ActionCard, subIndex: number | null): AnswerSpec | null =>
    field === 'purpose' ? purposeAnswer(card) : actionAnswer(card, subIndex);

  const labelFor = (field: Field) =>
    field === 'purpose' ? strings.actions.midPurposeLabel : strings.actions.concreteActionLabel;

  // --- Intro -------------------------------------------------------------
  if (phase === 'intro' || !drill) {
    return (
      <ScrollView
        testID="action-intro"
        style={[styles.root, { backgroundColor: theme.bg }]}
        contentContainerStyle={styles.content}
      >
        <Text style={[styles.scenario, { color: theme.textSecondary }]}>{seq.scenario}</Text>
        <Text style={[styles.goal, { color: theme.textPrimary }]}>
          {strings.actions.goalLabel}：{seq.goal}
        </Text>

        <Text style={[styles.sectionLabel, { color: theme.accentGold }]}>
          {strings.actions.cardsPreview}
        </Text>
        {seq.cards.map((card) => (
          <Text key={card.id} style={[styles.cardTitle, { color: theme.textPrimary }]}>
            {card.title}
          </Text>
        ))}

        {/* 矢印は進行順を示すだけの非対話要素。開始は必ず学習段から。 */}
        <View style={styles.navRow}>
          <Text testID="action-nav-study" style={[styles.navItem, { color: theme.accentGold }]}>
            {strings.actions.stageStudy}
          </Text>
          <Text style={[styles.navArrow, { color: theme.textMuted }]}>→</Text>
          <Text testID="action-nav-purpose" style={[styles.navItem, { color: theme.textSecondary }]}>
            {strings.actions.stagePurpose}
          </Text>
          <Text style={[styles.navArrow, { color: theme.textMuted }]}>→</Text>
          <Text testID="action-nav-action" style={[styles.navItem, { color: theme.textSecondary }]}>
            {strings.actions.stageAction}
          </Text>
        </View>

        <View style={styles.nRow}>
          <Pressable
            testID="action-n-down"
            onPress={() => setN((v) => Math.max(1, v - 1))}
            style={styles.nBtn}
          >
            <Text style={[styles.nBtnText, { color: theme.textPrimary }]}>−</Text>
          </Pressable>
          <Text style={[styles.nLabel, { color: theme.textMuted }]}>{strings.actions.nLabel}</Text>
          <Text testID="action-n-value" style={[styles.nValue, { color: theme.accentGold }]}>
            {n}
          </Text>
          <Pressable testID="action-n-up" onPress={() => setN((v) => v + 1)} style={styles.nBtn}>
            <Text style={[styles.nBtnText, { color: theme.textPrimary }]}>＋</Text>
          </Pressable>
        </View>

        <Pressable
          testID="action-start"
          onPress={() => startStage('study', n)}
          style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
        >
          <Text style={styles.primaryBtnText}>{strings.actions.start}</Text>
        </Pressable>
        <Pressable testID="action-back" onPress={onExit} style={styles.secondaryBtn}>
          <Text style={[styles.secondaryBtnText, { color: theme.textPrimary }]}>
            {strings.actions.backToList}
          </Text>
        </Pressable>
      </ScrollView>
    );
  }

  // --- Results -----------------------------------------------------------
  if (phase === 'results') {
    const score = stageScore(drill);
    const following = nextStage(drill.stage);
    return (
      <ScrollView
        testID="action-results"
        style={[styles.root, { backgroundColor: theme.bg }]}
        contentContainerStyle={styles.content}
      >
        <Text testID="action-results-stage" style={[styles.resultsTitle, { color: theme.accentGold }]}>
          {stageLabel(drill.stage)}
        </Text>
        <Text testID="action-results-score" style={[styles.resultLine, { color: theme.textPrimary }]}>
          {strings.actions.stageScoreLabel}: {score === null ? '—' : `${Math.round(score * 100)}%`}
        </Text>
        <Text testID="action-results-n" style={[styles.resultLine, { color: theme.textSecondary }]}>
          {strings.actions.nLabel}: {n}
        </Text>

        {following ? (
          <Pressable
            testID="action-next-stage"
            onPress={() => startStage(following, n)}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.actions.nextStage}</Text>
          </Pressable>
        ) : (
          <Pressable
            testID="action-again"
            onPress={() => startStage('study', n)}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.actions.again}</Text>
          </Pressable>
        )}
        <Pressable testID="action-back" onPress={onExit} style={styles.secondaryBtn}>
          <Text style={[styles.secondaryBtnText, { color: theme.textPrimary }]}>
            {strings.actions.backToList}
          </Text>
        </Pressable>
      </ScrollView>
    );
  }

  // --- Play --------------------------------------------------------------
  const step = currentStep(drill)!;
  const display = step.displayIndex === null ? null : unitContent(seq, drill.units[step.displayIndex]);
  const target = step.targetIndex === null ? null : unitContent(seq, drill.units[step.targetIndex]);
  const fields = target ? fieldsFor(drill.stage, target.card) : [];

  const submitAll = () => {
    if (!target) return;
    let next = drill;
    for (const field of fields) {
      const spec = specFor(field, target.card, step.subIndex);
      if (spec) next = submitAnswer(next, field, inputs[field], spec);
    }
    setDrill(next);
    setPane('reveal');
  };

  return (
    <ScrollView
      testID="action-play"
      style={[styles.root, { backgroundColor: theme.bg }]}
      contentContainerStyle={styles.content}
    >
      <Text style={[styles.sectionLabel, { color: theme.accentGold }]}>
        {strings.actions.grandPurposeLabel}
      </Text>
      <Text testID="action-header-goal" style={[styles.goal, { color: theme.textPrimary }]}>
        {seq.goal}
      </Text>
      <View style={styles.headerRow}>
        <Text testID="action-header-ordinal" style={[styles.ordinal, { color: theme.textSecondary }]}>
          {step.ordinal === null
            ? '—'
            : strings.actions.ordinalOf(step.ordinal, step.totalCards)}
        </Text>
        <Text testID="action-header-n" style={[styles.backTag, { color: theme.textMuted }]}>
          {drill.n}-back
        </Text>
      </View>
      <View style={[styles.rule, { backgroundColor: theme.cardBorder }]} />

      {pane === 'read' && display && (
        <>
          <Pressable
            testID="action-read"
            onPress={() => setDrill(toggleChecked(drill, unitKey(drill.units[step.displayIndex!])))}
            style={[
              styles.readCard,
              {
                backgroundColor: theme.cardBg,
                borderColor: drill.checked.has(unitKey(drill.units[step.displayIndex!]))
                  ? theme.accentSuccess
                  : theme.cardBorder,
              },
            ]}
          >
            {drill.checked.has(unitKey(drill.units[step.displayIndex!])) && (
              <View testID="action-read-checked" style={[styles.checkDot, { backgroundColor: theme.accentSuccess }]} />
            )}
            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
              {strings.actions.meansLabel}
            </Text>
            <Text style={[styles.body, { color: theme.textPrimary }]}>{display.card.title}</Text>
            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
              {strings.actions.midPurposeLabel}
            </Text>
            <Text style={[styles.body, { color: theme.textPrimary }]}>{display.card.purpose}</Text>
            {display.card.subActions.map((sub) => (
              <View key={sub.id} style={styles.subBlock}>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                  {strings.actions.subPurposeLabel}
                </Text>
                <Text style={[styles.body, { color: theme.textSecondary }]}>{sub.purpose}</Text>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                  {strings.actions.concreteActionLabel}
                </Text>
                <Text style={[styles.body, { color: theme.textSecondary }]}>{sub.action}</Text>
              </View>
            ))}
          </Pressable>
          <Pressable
            testID="action-read-next"
            onPress={() => (step.targetIndex !== null ? setPane('answer') : goNextStep(drill))}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.actions.next}</Text>
          </Pressable>
        </>
      )}

      {pane === 'observe' && (
        <>
          <Text testID="action-observe" style={[styles.body, { color: theme.textMuted }]}>
            {strings.actions.observeOnly}
          </Text>
          <Pressable
            testID="action-observe-next"
            onPress={() => goNextStep(drill)}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.actions.next}</Text>
          </Pressable>
        </>
      )}

      {pane === 'answer' && target && (
        <>
          {/* 具体アクション段は小目的が問題文になる（spec §6.1）。 */}
          {target.subAction && (
            <>
              <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                {strings.actions.subPurposeLabel}
              </Text>
              <Text testID="action-prompt" style={[styles.body, { color: theme.textPrimary }]}>
                {target.subAction.purpose}
              </Text>
            </>
          )}
          {fields.map((field) => (
            <View key={field} style={styles.subBlock}>
              <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{labelFor(field)}</Text>
              <TextInput
                testID={`action-input-${field}`}
                value={inputs[field]}
                onChangeText={(text) => setInputs((prev) => ({ ...prev, [field]: text }))}
                multiline
                style={[
                  styles.input,
                  { color: theme.textPrimary, backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
                ]}
              />
            </View>
          ))}
          <Pressable
            testID="action-next"
            onPress={submitAll}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.actions.next}</Text>
          </Pressable>
        </>
      )}

      {pane === 'reveal' && target && (
        <>
          {fields.map((field) => {
            const record = answerFor(drill, drill.cursor, field);
            const spec = specFor(field, target.card, step.subIndex);
            if (!record || !spec) return null;
            return (
              <View key={field} style={styles.subBlock}>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                  {strings.actions.yourAnswer}
                </Text>
                <Text testID={`action-your-${field}`} style={[styles.body, { color: theme.textPrimary }]}>
                  {record.input}
                </Text>
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                  {strings.actions.modelAnswer}
                </Text>
                <Text testID={`action-model-${field}`} style={[styles.body, { color: theme.textSecondary }]}>
                  {spec.model}
                </Text>
                <View
                  testID={`action-verdict-${field}`}
                  style={[
                    styles.verdict,
                    { backgroundColor: record.correct ? theme.accentSuccess : theme.accentWarning },
                  ]}
                />
                <View style={styles.selfGradeRow}>
                  <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                    {strings.actions.selfGradeLabel}
                  </Text>
                  <Pressable
                    testID={`action-self-correct-${field}`}
                    onPress={() => setDrill(setSelfGrade(drill, drill.cursor, field, true))}
                    style={[styles.gradeBtn, { borderColor: theme.accentSuccess }]}
                  >
                    <Text style={{ color: theme.accentSuccess }}>{strings.actions.selfGradeCorrect}</Text>
                  </Pressable>
                  <Pressable
                    testID={`action-self-wrong-${field}`}
                    onPress={() => setDrill(setSelfGrade(drill, drill.cursor, field, false))}
                    style={[styles.gradeBtn, { borderColor: theme.accentWarning }]}
                  >
                    <Text style={{ color: theme.accentWarning }}>{strings.actions.selfGradeWrong}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          <Pressable
            testID="action-next-question"
            onPress={() => goNextStep(drill)}
            style={[styles.primaryBtn, { backgroundColor: theme.accentGold }]}
          >
            <Text style={styles.primaryBtnText}>{strings.actions.nextQuestion}</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },
  scenario: { fontSize: 13, lineHeight: 20, marginBottom: 12 },
  goal: { fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  sectionLabel: { fontSize: 12, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 6 },
  cardTitle: { fontSize: 14, marginBottom: 6 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 },
  navItem: { fontSize: 14, fontWeight: '600' },
  navArrow: { fontSize: 14 },
  nRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 20 },
  nBtn: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 10, backgroundColor: '#1c1c1e' },
  nBtnText: { fontSize: 22 },
  nLabel: { fontSize: 14 },
  nValue: { fontSize: 26, fontWeight: 'bold', minWidth: 28, textAlign: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ordinal: { fontSize: 14, fontWeight: '600' },
  backTag: { fontSize: 13 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  readCard: { borderWidth: 1, borderRadius: 12, padding: 14 },
  checkDot: { position: 'absolute', top: 10, right: 10, width: 10, height: 10, borderRadius: 5 },
  subBlock: { marginTop: 12 },
  fieldLabel: { fontSize: 11, fontWeight: 'bold', marginBottom: 4, marginTop: 8 },
  body: { fontSize: 14, lineHeight: 21 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14, minHeight: 64 },
  verdict: { height: 6, borderRadius: 3, marginTop: 10 },
  selfGradeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  gradeBtn: { borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 16 },
  primaryBtn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 20, alignSelf: 'stretch' },
  primaryBtnText: { color: '#050810', fontWeight: 'bold', fontSize: 15 },
  secondaryBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  secondaryBtnText: { fontSize: 14 },
  resultsTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 12 },
  resultLine: { fontSize: 15, marginBottom: 6 },
});
```

- [ ] **Step 4: 画面テストを走らせて通ることを確認**

Run: `npx jest src/ui/__tests__/ActionGameScreen.test.tsx`
Expected: PASS（12件）

- [ ] **Step 5: 用済みになった plan.ts を消す**

`buildActionRound` / `cardToQuestion` の呼び出し元が消えた。`eligibleCards` の役目は `buildUnits` が引き取っている。まるごと削除する。

```bash
git rm src/actions/plan.ts src/actions/__tests__/plan.test.ts
```

- [ ] **Step 6: src/actions を device-free 境界に登録する**

`src/__tests__/boundaries.test.ts:10` を書き換える。

```ts
const DEVICE_FREE_DIRS = ['actions', 'engine', 'judge', 'content'];
```

- [ ] **Step 7: 全体テストと型検査**

Run: `npx tsc --noEmit && npx jest`
Expected: 両方 PASS。境界テストが `src/actions` を4ディレクトリ目として走ること。

- [ ] **Step 8: コミット**

```bash
git add -A src/ui/ActionGameScreen.tsx src/ui/__tests__/ActionGameScreen.test.tsx src/__tests__/boundaries.test.ts src/actions
git commit -m "$(cat <<'EOF'
feat(actions): rebuild the action screen as a three-stage drill

RoundRunner・ExpoSpeaker・ExpoListener・JudgeQueue・ClaudeJudgeClient への
依存を全部外し、drill.ts を駆動するだけの画面にした。タイマーもドレインも
非同期採点も無い。テストから expo のモックが消えたことが依存が切れた証拠。
呼び出し元が消えた plan.ts を削除し、src/actions を device-free 境界に登録した。

Co-Authored-By: Claude <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W4zCKp7PC84aQHrNFf6EmZ
EOF
)"
```

---

## Task 7: コンテンツ執筆（ユーザー承認を挟む）

Task 1〜6 は現行コンテンツの機械的移行のまま動く。ここで初めて中身を書く。**このタスクだけはコードではなく文章の仕事であり、実装者が独断で進めてはいけない。** 各シーケンス単位でユーザーに提示し、承認を得てから次へ進む。

### 書き直しの基準

現データの最大の欠陥は、**手段の総称を目的の欄に入れていた**ことである（spec §2）。17枚中13枚前後の `purpose` が「Xをして、Yを可視化する」という手段の言い換えで、判断ロジックを含んでいない。覚えても他の場面に転用できない。

| 階層 | 格納先 | 書くべきこと | よくある失敗 |
|---|---|---|---|
| 手段の総称 | `card.title` | その一手の呼び名 | — |
| 中目的 | `card.purpose` | **なぜその手段をとるのか。** 判断ロジック（どういう状況で・何を優先し・だから何をする）を含む | 手段の言い換え |
| 小目的 | `subAction.purpose` | その一手順の「なぜ」 | 具体アクションの要約 |
| 具体アクション | `subAction.action` | 実際に何をするか。数字・期限・様式まで | 抽象的な方針 |

**基準例（ch02-a01、spec §2 より）:**

```
大目的      証拠格付けで情報開示の誠実性を見極める
 手段の総称  インテーク文書の優先グレード別要求
 中目的      案件に取り組んでよいかを判断するプロセスがあり、最重要な
             Deal Killer 項目から着手する。だから重要書類を先に出させ、
             顧客の負荷を下げつつ早く提出できる依頼に設計する
   小目的 a  Deal Killer になり得る論点を先に潰す
     具体 a  LPA・サイドレター・投資家リストを最優先で請求する
   小目的 b  顧客の負荷を下げて提出を早める
     具体 b  10営業日の期限を切り、様式を指定して往復を減らす
   小目的 c  出てこなかった場合の扱いを先に握る
     具体 c  未提出なら保守的代替推計を用いる旨をあらかじめ伝える
```

現行の `purpose`「グレードAの最優先文書を早期に確保し、証拠格付けの土台を確立する」は手段の言い換えでしかない。上の中目的は「なぜ最優先文書からなのか」に答えている。この差が全17枚に必要。

### 分量の目安

- `purpose` — 1〜3文。判断ロジックが入る以上、現行より長くなる。
- `purposeAccept` — 3件前後。**言い回しを変えた同義文**を書く。採点は字面のバイグラムを見るので、ここに載せた表現を打った人だけが緑になる。載せるほど当たりやすくなる。
- `subActions` — 1枚あたり2〜4個。
- `subAction.actionAccept` — 2〜3件。

### 進め方

- [ ] **Step 1: ch02（7枚）の草稿を書き、ユーザーに提示する**

`src/actions/sequences.json` の `ch02` について、7枚の `purpose` / `purposeAccept` を書き直し、`subActions` を 2〜4個ずつ書く。`ch02-a07` は `layer2Skipped: true` / `subActions: []` のまま据え置き（`purpose` の書き直しだけ行う）。

書いたら **編集前に、diff の要点を日本語で列挙してユーザーに見せ、承認を求める。** 承認なしにコミットしない。

- [ ] **Step 2: 承認後、ch02 を反映してテストを走らせる**

Run: `npx jest src/actions`
Expected: PASS。`actions.test.ts` の `'every subAction has a unique id...'` と `'layer2Skipped is exactly the set of cards with no subActions'` がスキーマ違反を捕まえる。

- [ ] **Step 3: 採点が実データで機能するか確認する**

Run: `npx jest src/actions/__tests__/grade.test.ts`
Expected: PASS。特に `'never marks one card correct against another card accept set'` が全カード総当たりで落ちないこと。**新しい `purposeAccept` を足したことで別カードと衝突したらここが落ちる。** 落ちたら閾値ではなく文章を直す（似すぎている2枚のどちらかを書き分ける）。

- [ ] **Step 4: ch02 をコミット**

```bash
git add src/actions/sequences.json
git commit -m "$(cat <<'EOF'
content(actions): rewrite ch02 purposes as decision logic

「Xをして、Yを可視化する」という手段の言い換えを、なぜその手段をとるのか
という判断ロジックに書き直し、各カードに小目的→具体アクションの入れ子を
足した。

Co-Authored-By: Claude <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01W4zCKp7PC84aQHrNFf6EmZ
EOF
)"
```

- [ ] **Step 5: ch11（10枚）について Step 1〜4 を繰り返す**

同じ手順。承認 → 反映 → テスト → コミット。コミットメッセージの `ch02` を `ch11` に読み替える。

- [ ] **Step 6: 実データで通しプレイして手触りを確認する**

Run: `npm run web`

ブラウザで アクション タブ → ch02 を開き、次を目で確認する。

1. intro に三段ナビが出て、はじめる で学習段に入る
2. 学習段でカードの入れ子が読め、枠をタップすると緑になる
3. 「つぎへ」で N手前のカードを問われ、ヘッダの序数が問われているカードを指している
4. 「つぎへ」で即座に模範解答が開示され、緑／赤が付く
5. 自己採点の ✓／✕ で色が変わる
6. 段末に正答率と更新後の N が出て、「次の段へ」で目的段に入る
7. 目的段では大目的と序数だけが出て、手段の総称は出ない
8. 具体アクション段では小目的が問題文として出る

- [ ] **Step 7: 全体テストと型検査、そしてブランチをまとめる**

Run: `npx tsc --noEmit && npx jest`
Expected: 両方 PASS

その後 `superpowers:finishing-a-development-branch` に従って master へ取り込む。

---

## 付録: 閾値の根拠

`MATCH_THRESHOLD = 0.45` は現行17枚の実データを総当たりで計測して決めた（spec §5 の「実データで調整する」に対する答え）。正規化は `normalizeTranscript` を通し、文字バイグラムの Dice 係数を採った。

**言い換え検出は不可能である。** `purposeAccept[]` は意図的な言い換えなので、模範解答との Dice は 0.000〜0.411 に散らばる。一方、無関係なカード同士でも最大 0.323 出る（`ch11-a08` と `ch11-a10` はどちらも「開示の非対称性」を扱うので字面が近い）。この二つの分布は完全に重なっていて、言い換えを拾いつつ誤検出を避ける閾値は存在しない。leave-one-out で測ると:

| 閾値 | 言い換えの再現率 | カード間の誤検出率 |
|---|---|---|
| 0.15 | 69% | 6.6% |
| 0.20 | 51% | 2.6% |
| 0.25 | 35% | 1.1% |
| 0.35 | 16% | 0.0% |

**言い回しの再現検出は非常によく効く。** 模範解答の先頭何割かを打った場合のスコア（全17枚）:

| 打った割合 | 最小 | 中央値 |
|---|---|---|
| 50% | 0.619 | 0.653 |
| 40% | 0.519 | 0.557 |
| 34% | 0.453 | 0.491 |
| 25% | 0.343 | 0.381 |

無関係カードの最大が 0.323、模範解答の先頭1/3の最小が 0.453。**0.45 はこの隙間の上側**で、誤検出ゼロを保ちながら「3割以上再現できた」を拾える。spec の 0.35 だと隙間の下寄りで、25%しか打っていない答えを緑にしかねない。

この設計で緑／赤が意味するのは「意味が合っているか」ではなく「言い回しを再現できたか」である。それでよいのは、**自己採点が必ず上書きできる**からである（spec §5）。むしろ 0.20 のような中間の閾値は、正しい言い換えの半分を赤にしつつ全く違う答えの 2.6% を緑にするので、両方向に嘘をつく。0.45 の赤は「自分で判定しろ」という正直な合図になる。

---

## Self-Review

**spec カバレッジ:**

| spec | 対応タスク |
|---|---|
| §2 用語と階層 | Task 1（スキーマ）・Task 7（本文） |
| §3 採らなかった方針 | Task 6（RoundRunner を再利用せず新規に書く／音声スタックは残す）・Task 4（`nextN` を直接呼ぶ） |
| §4.1 スキーマ | Task 1 |
| §4.2 コンテンツ改訂 | `credit` は Task 1、`purpose` と `subActions` は Task 7 |
| §5 採点 | Task 2（閾値は付録の実測値で 0.45 に変更） |
| §6 状態機械 | Task 3（段・単位・ステップ）・Task 4（回答・採点・適応N） |
| §6.1 各段の出題単位 | Task 3 の `buildUnits`、Task 4 の `fieldsFor` |
| §6.2 学習段の進み方 | Task 4 の `actionAnswer(card, null)`（合併集合）・Task 6 の read 面と緑チェック |
| §6.3 進行と適応N | Task 4 の `stageScore` / `updatedN` |
| §7 画面 | Task 6 |
| §8 文言 | Task 5 |
| §9 テスト | 各タスク内 |
| §10 作業順 | Task 1→7（文言を画面より前に出した点だけ spec と順序が違う。画面テストが文言キーを参照するため） |

**spec からの意図的な逸脱（3点）:**

1. **`MATCH_THRESHOLD` を 0.35 → 0.45。** 付録の実測による。
2. **歩数を `単位数 + n` に伸ばした。** spec のままだと末尾N単位が一度も問われない。ユーザー確定事項。
3. **学習段を2画面に分けた。** spec §6.2「直後に」の解釈。ユーザー確定事項。
4. **`plan.ts` を削除。** spec §9 は `plan.test.ts` を追随させると書いているが、`buildActionRound` の呼び出し元が消え `eligibleCards` の役目も `buildUnits` が引き取るため、丸ごと死ぬ。Task 1 で最小追随させて各コミットを緑に保ち、Task 6 で削除する。

**型の整合:** `Stage` は `drill.ts` が唯一の定義元で、`plan.ts` の `Layer` は Task 6 で消える。`Field` は `'purpose' | 'action'` で `fieldsFor` / `submitAnswer` / `setSelfGrade` / `answerFor` / `specFor` / testID サフィックスの全部で同じ綴り。`AnswerSpec.model` は開示に、`AnswerSpec.accept` は照合にだけ使い、`accept[0]` は常に `model` と等しい。
