import { normalizeTranscript } from '../normalize';

describe('normalizeTranscript', () => {
  it('folds katakana to hiragana', () => {
    expect(normalizeTranscript('ワンワン')).toBe('わんわん');
    expect(normalizeTranscript('トウキョウ')).toBe('とうきょう');
  });

  it('strips whitespace including full-width spaces', () => {
    expect(normalizeTranscript(' わん わん　')).toBe('わんわん');
  });

  it('strips Japanese punctuation', () => {
    expect(normalizeTranscript('わん、わん。')).toBe('わんわん');
    expect(normalizeTranscript('東京！')).toBe('東京');
  });

  it('strips polite and hedging suffixes', () => {
    expect(normalizeTranscript('東京です')).toBe('東京');
    expect(normalizeTranscript('東京だと思う')).toBe('東京');
    expect(normalizeTranscript('東京かな')).toBe('東京');
    expect(normalizeTranscript('東京ですね')).toBe('東京');
  });

  it('leaves kanji untouched', () => {
    expect(normalizeTranscript('東京都')).toBe('東京都');
  });

  it('handles an empty string', () => {
    expect(normalizeTranscript('')).toBe('');
  });

  it('does not strip a suffix that is the entire answer', () => {
    expect(normalizeTranscript('です')).toBe('です');
  });
});
