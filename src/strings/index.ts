import { useEffect, useState } from 'react';
import { loadSettings } from '../store/storage';

export interface Strings {
  common: {
    settings: string;
    close: string;
  };
  settings: Record<string, never>;
  game: Record<string, never>;
  results: Record<string, never>;
  series: Record<string, never>;
  questions: Record<string, never>;
}

export const ja: Strings = {
  common: {
    settings: '設定',
    close: '閉じる',
  },
  settings: {},
  game: {},
  results: {},
  series: {},
  questions: {},
};

export const en: Strings = {
  common: {
    settings: 'Settings',
    close: 'Close',
  },
  settings: {},
  game: {},
  results: {},
  series: {},
  questions: {},
};

export function useStrings(): Strings {
  const [strings, setStrings] = useState<Strings>(ja);

  useEffect(() => {
    let cancelled = false;
    void loadSettings().then((settings) => {
      if (!cancelled) setStrings(settings.language === 'en' ? en : ja);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return strings;
}
