export function languageToLocale(language: 'ja' | 'en'): string {
  return language === 'en' ? 'en-US' : 'ja-JP';
}
