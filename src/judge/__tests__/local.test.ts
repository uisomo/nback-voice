import { localMatch } from '../local';
import type { Question } from '../../engine/types';

const DOG: Question = {
  id: 'q042',
  tier: 2,
  q: '犬の鳴き声は？',
  accept: ['わん', 'わんわん'],
};

describe('localMatch', () => {
  it('matches an exact accepted answer', () => {
    expect(localMatch(DOG, 'わん')).toBe(true);
  });

  it('matches across katakana and hiragana', () => {
    expect(localMatch(DOG, 'ワンワン')).toBe(true);
  });

  it('matches through a polite suffix', () => {
    expect(localMatch(DOG, 'わんです')).toBe(true);
  });

  it('rejects an unlisted answer', () => {
    expect(localMatch(DOG, 'にゃー')).toBe(false);
  });

  it('rejects an empty transcript', () => {
    expect(localMatch(DOG, '')).toBe(false);
    expect(localMatch(DOG, '　')).toBe(false);
  });

  it('normalizes the accept list too, so a katakana entry matches hiragana speech', () => {
    const q: Question = { ...DOG, accept: ['ワン'] };
    expect(localMatch(q, 'わん')).toBe(true);
  });
});
