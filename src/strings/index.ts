import { useEffect, useState } from 'react';
import { loadSettings } from '../store/storage';

export interface Strings {
  common: {
    settings: string;
    close: string;
  };
  settings: {
    apiKeyUnset: string;
    apiKeySet: string;
    tierEasy: string;
    tierNormal: string;
    modeDual: string;
    modeQuestion: string;
    inputTyped: string;
    inputVoice: string;
    sectionMode: string;
    sectionAnswerInput: string;
    noteTypedInput: string;
    sectionBudget: string;
    noteBudget: string;
    linkEditQuestions: string;
    sectionStepDuration: string;
    stepDurationUnit: string;
    sectionAdaptive: string;
    sectionSeriesN: string;
    noteSeriesN: string;
    seriesNDown: string;
    seriesNUp: string;
    seriesNReset: string;
    sectionMaxTier: string;
    sectionApiKey: string;
    apiKeyPlaceholder: string;
    checkConnection: string;
    checking: string;
    checkOk: string;
    checkFailedPrefix: string;
    sectionLanguage: string;
  };
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
  settings: {
    apiKeyUnset: '未設定',
    apiKeySet: '設定済み',
    tierEasy: 'やさしい',
    tierNormal: 'ふつう',
    modeDual: '位置＋質問',
    modeQuestion: '質問のみ',
    inputTyped: '入力',
    inputVoice: '音声',
    sectionMode: 'モード',
    sectionAnswerInput: '回答のしかた',
    noteTypedInput: '入力にすると、キーボードのマイクで喋った文字を、送る前に直せる。',
    sectionBudget: '考える時間の基準 (秒)',
    noteBudget: '答え1文字につき1秒が、この基準に足される。時計が0になっても先へは進まない。',
    linkEditQuestions: '自分の問題を編集',
    sectionStepDuration: '1ステップの長さ',
    stepDurationUnit: '秒',
    sectionAdaptive: 'Nを自動調整',
    sectionSeriesN: 'シリーズごとのN',
    noteSeriesN: '自動調整の到達点をシリーズごとに直接調整・リセットできる。',
    seriesNDown: '－',
    seriesNUp: '＋',
    seriesNReset: 'リセット',
    sectionMaxTier: '標準問題のむずかしさ',
    sectionApiKey: 'Claude APIキー',
    apiKeyPlaceholder: 'sk-ant-...',
    checkConnection: '接続を確認',
    checking: '確認中…',
    checkOk: '確認できました。採点が使えます。',
    checkFailedPrefix: '失敗: ',
    sectionLanguage: '言語 (英語)',
  },
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
  settings: {
    apiKeyUnset: 'Not set',
    apiKeySet: 'Set',
    tierEasy: 'Easy',
    tierNormal: 'Normal',
    modeDual: 'Position + Question',
    modeQuestion: 'Question only',
    inputTyped: 'Typed',
    inputVoice: 'Voice',
    sectionMode: 'Mode',
    sectionAnswerInput: 'How you answer',
    noteTypedInput: 'In typed mode, you can fix what the keyboard mic heard before sending it.',
    sectionBudget: 'Base thinking time (seconds)',
    noteBudget: '1 second is added per character of the answer. The round never advances early just because the clock hits 0.',
    linkEditQuestions: 'Edit my questions',
    sectionStepDuration: 'Step length',
    stepDurationUnit: 's',
    sectionAdaptive: 'Auto-adjust N',
    sectionSeriesN: 'N per series',
    noteSeriesN: 'Adjust or reset where auto-adjust has landed, per series.',
    seriesNDown: '－',
    seriesNUp: '＋',
    seriesNReset: 'Reset',
    sectionMaxTier: 'Standard question difficulty',
    sectionApiKey: 'Claude API key',
    apiKeyPlaceholder: 'sk-ant-...',
    checkConnection: 'Check connection',
    checking: 'Checking…',
    checkOk: 'Connected. Grading is available.',
    checkFailedPrefix: 'Failed: ',
    sectionLanguage: 'Language (English)',
  },
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
