/** Suffixes users append that carry no answer content. Longest first. */
const SUFFIXES = ['だと思います', 'だと思う', 'ですね', 'かな', 'だよ', 'です', 'かも'];

const PUNCTUATION = /[、。！？!?,.　\s]/g;

function katakanaToHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60),
  );
}

/**
 * Canonicalize a spoken answer for comparison: fold katakana, drop whitespace
 * and punctuation, strip polite/hedging suffixes.
 */
export function normalizeTranscript(raw: string): string {
  let s = katakanaToHiragana(raw).replace(PUNCTUATION, '');

  for (const suffix of SUFFIXES) {
    // Never strip down to nothing — the suffix may BE the answer.
    if (s.length > suffix.length && s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }

  return s;
}
