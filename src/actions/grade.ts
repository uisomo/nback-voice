import { normalizeTranscript } from '../content/normalize';

/**
 * 「模範解答の言い回しを再現できたか」の判定線。
 *
 * 実測（現行データ 17枚・総当たり）で、無関係なカード同士の Dice 最大は
 * 0.203、模範解答の先頭 1/3 を打った場合の最小は 0.478 だった。0.45 はその
 * 間で、誤検出ゼロを保ちながら部分想起を拾える帯にある。具体アクション段が
 * 裁く小目的の手順（正規化後の中央値45字。中目的は128字）でも、別カード間の
 * 最大は 0.237 で誤検出は無い。
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
