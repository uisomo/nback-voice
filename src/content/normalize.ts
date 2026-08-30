/** Suffixes users append that carry no answer content. Longest first. */
const SUFFIXES = ['だと思います', 'だと思う', 'ですね', 'かな', 'だよ', 'です', 'かも'];

/**
 * Characters that separate words without changing which word it is. Two
 * spellings of one term differ by nothing else: サブスクリプション・ライン /
 * サブスクリプションライン, Deal-by-Deal / deal by deal, ファシリティー /
 * ファシリティ. Folding them away is what lets the bank hold one spelling and
 * still grade the others right.
 *
 * Includes the katakana prolonged-sound mark ー (U+30FC), which katakana
 * folding leaves alone because it sits outside the ァ-ヶ block — without it
 * ファシリティー and ファシリティ stay different strings.
 */
const PUNCTUATION =
  /[、。，．・･！？!?,.：:；;「」『』【】（）()［\]\[〈〉《》”“"'’‘　\s‐-―─ー\-~〜]/g;

function katakanaToHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60),
  );
}

/**
 * Full-width Latin, digits and the few symbols that show up in answers. A
 * Japanese IME produces ＬＴＶ and ３９％ as readily as LTV and 39%, and the
 * bank is written in the half-width forms.
 */
function toHalfWidth(s: string): string {
  return s.replace(/[Ａ-Ｚａ-ｚ０-９％＆＝＋]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
}

/**
 * Canonicalize a spoken answer for comparison: fold full-width forms and
 * katakana, drop whitespace, punctuation and word separators, strip
 * polite/hedging suffixes.
 */
export function normalizeTranscript(raw: string): string {
  let s = katakanaToHiragana(toHalfWidth(raw).toLowerCase()).replace(
    PUNCTUATION,
    '',
  );

  for (const suffix of SUFFIXES) {
    // Never strip down to nothing — the suffix may BE the answer.
    if (s.length > suffix.length && s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }

  return s;
}
