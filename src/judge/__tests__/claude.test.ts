import { parseVerdict } from '../claude';

describe('parseVerdict', () => {
  it('parses a correct verdict', () => {
    expect(parseVerdict('{"correct":true,"matched":"ワンコ"}')).toEqual({
      correct: true,
      matched: 'ワンコ',
    });
  });

  it('parses an incorrect verdict with a null match', () => {
    expect(parseVerdict('{"correct":false,"matched":null}')).toEqual({
      correct: false,
      matched: null,
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseVerdict('  {"correct":true,"matched":null}\n').correct).toBe(true);
  });

  it('throws on malformed JSON rather than guessing', () => {
    expect(() => parseVerdict('not json')).toThrow(/verdict/i);
  });

  it('throws when correct is missing', () => {
    expect(() => parseVerdict('{"matched":"x"}')).toThrow(/verdict/i);
  });
});
