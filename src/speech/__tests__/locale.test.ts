import { languageToLocale } from '../locale';

describe('languageToLocale', () => {
  it('maps ja to ja-JP', () => {
    expect(languageToLocale('ja')).toBe('ja-JP');
  });

  it('maps en to en-US', () => {
    expect(languageToLocale('en')).toBe('en-US');
  });
});
