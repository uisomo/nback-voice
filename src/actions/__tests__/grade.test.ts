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
