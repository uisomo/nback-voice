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
    noteStepDuration: string;
    sectionAdaptive: string;
    noteAdaptive: string;
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
    langJa: string;
    langEn: string;
    sectionUpgrade: string;
    upgradeButton: string;
  };
  game: {
    lagHeader: (n: number) => string;
    preparing: string;
    micPermissionNeeded: string;
    seriesLabel: (title: string, count: number) => string;
    notEnoughQuestions: string;
    dailyLimitReached: string;
    stepLabel: (index: number, total: number, n: number, answering: boolean) => string;
    setupFailed: string;
    warmupCaption: string;
    warmupHint: string;
    warmupNLabel: string;
    warmupStart: string;
    recogErrorPrefix: string;
    heardQuote: (text: string) => string;
    typedPlaceholderClosed: string;
    typedPlaceholderOpen: string;
    send: string;
  };
  results: {
    dash: string;
    unjudged: string;
    correctMark: string;
    wrongMark: string;
    positionCorrect: string;
    positionWrong: string;
    positionDash: string;
    heading: (n: number) => string;
    subheading: (n: number) => string;
    rowPosition: string;
    rowAnswer: string;
    rowOnTime: string;
    unjudgedCount: (n: number) => string;
    rowTotal: string;
    notHeard: string;
    heardQuote: (text: string) => string;
    answerLabelPrefix: string;
    lateNote: (s: string) => string;
    again: string;
    changeSeries: string;
  };
  series: {
    heading: string;
    count: (n: number) => string;
    shortfall: (n: number) => string;
    lag: (n: number) => string;
  };
  questions: {
    heading: string;
    count: (n: number) => string;
    placeholderQuestion: string;
    placeholderAnswer: string;
    save: string;
    delete: string;
    cancel: string;
    newDeck: string;
    editDeck: string;
    deckNamePlaceholder: string;
    addQuestion: string;
    saveDeck: string;
    removeQuestion: string;
    noDecks: string;
  };
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
    sectionStepDuration: '1ステップの長さ（問題表示＋回答の合計時間）',
    stepDurationUnit: '秒',
    noteStepDuration: '問題が出てから回答が締め切られるまでの、1ステップあたりの時間。判定の基準ではなく、ペース配分の設定。',
    sectionAdaptive: 'Nを自動調整',
    noteAdaptive: '直前のラウンドが100%（全問正解）だとNが上がる。半分以下の正解率だとNが下がる。',
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
    sectionLanguage: '言語',
    langJa: '日本語',
    langEn: 'English',
    sectionUpgrade: 'プラン',
    upgradeButton: 'アップグレード',
  },
  game: {
    lagHeader: (n) => `${n}-back ・ ${n}つ前の質問に答える`,
    preparing: '準備中…',
    micPermissionNeeded: 'マイクの許可が必要です',
    seriesLabel: (title, count) => `${title} ／ ${count}問`,
    notEnoughQuestions: '問題が足りません',
    dailyLimitReached: '本日の上限（3回）に達しました。アップグレードすると無制限になります',
    stepLabel: (index, total, n, answering) =>
      `${index} / ${total}　${n}-back　${answering ? 'どうぞ' : '出題中'}`,
    setupFailed: '準備に失敗しました。アプリを再起動してください',
    warmupCaption: 'ウォームアップ',
    warmupHint: 'タップすると始まります',
    warmupNLabel: 'N を選ぶ',
    warmupStart: '開始',
    recogErrorPrefix: '認識エラー: ',
    heardQuote: (text) => `「${text}」`,
    typedPlaceholderClosed: 'まだ答えません',
    typedPlaceholderOpen: '答えを入力',
    send: '送る',
  },
  results: {
    dash: '—',
    unjudged: '未判定',
    correctMark: '○',
    wrongMark: '×',
    positionCorrect: '位置 ○',
    positionWrong: '位置 ×',
    positionDash: '位置 —',
    heading: (n) => `${n}-back の結果`,
    subheading: (n) => `${n}つ前の質問に答えるラウンド`,
    rowPosition: '位置　',
    rowAnswer: '回答　',
    rowOnTime: '時間内　',
    unjudgedCount: (n) => `未判定 ${n} 件`,
    rowTotal: '総合　',
    notHeard: '（聞き取れず）',
    heardQuote: (text) => `「${text}」`,
    answerLabelPrefix: '答え: ',
    lateNote: (s) => `時間超過（目安 ${s}s）`,
    again: 'もう一度',
    changeSeries: 'シリーズを変える',
  },
  series: {
    heading: 'シリーズを選ぶ',
    count: (n) => `${n}問`,
    shortfall: (n) => `あと ${n} 問`,
    lag: (n) => `${n}-back`,
  },
  questions: {
    heading: '自分のデッキ',
    count: (n) => `${n} 問`,
    placeholderQuestion: '問題',
    placeholderAnswer: '答え',
    save: '保存',
    delete: '削除',
    cancel: '取消',
    newDeck: '新しいデッキ',
    editDeck: 'デッキを編集',
    deckNamePlaceholder: 'デッキ名',
    addQuestion: '質問を追加',
    saveDeck: 'デッキを保存',
    removeQuestion: '削除',
    noDecks: 'まだデッキがありません',
  },
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
    sectionStepDuration: 'Step length (question display + answer time)',
    stepDurationUnit: 's',
    noteStepDuration: 'How long each step lasts, from question to answer deadline. This paces the round — it is not a grading threshold.',
    sectionAdaptive: 'Auto-adjust N',
    noteAdaptive: 'N goes up after a round scored 100% (every answer correct). It goes down after a round scored 50% or below.',
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
    sectionLanguage: 'Language',
    langJa: '日本語',
    langEn: 'English',
    sectionUpgrade: 'Plan',
    upgradeButton: 'Upgrade',
  },
  game: {
    lagHeader: (n) => `${n}-back — answer the question from ${n} step${n === 1 ? '' : 's'} ago`,
    preparing: 'Preparing…',
    micPermissionNeeded: 'Microphone permission is required',
    seriesLabel: (title, count) => `${title} — ${count} questions`,
    notEnoughQuestions: 'Not enough questions',
    dailyLimitReached: "You've reached today's limit (3 rounds). Upgrade for unlimited play.",
    stepLabel: (index, total, n, answering) =>
      `${index} / ${total}   ${n}-back   ${answering ? 'Your turn' : 'Listen'}`,
    setupFailed: 'Setup failed. Please restart the app',
    warmupCaption: 'Warm-up',
    warmupHint: 'Tap to begin',
    warmupNLabel: 'Choose N',
    warmupStart: 'Start',
    recogErrorPrefix: 'Recognition error: ',
    heardQuote: (text) => `"${text}"`,
    typedPlaceholderClosed: 'Not answering yet',
    typedPlaceholderOpen: 'Type your answer',
    send: 'Send',
  },
  results: {
    dash: '—',
    unjudged: 'Ungraded',
    correctMark: '○',
    wrongMark: '×',
    positionCorrect: 'Position ○',
    positionWrong: 'Position ×',
    positionDash: 'Position —',
    heading: (n) => `${n}-back Results`,
    subheading: (n) => `A round answering the question from ${n} step${n === 1 ? '' : 's'} ago`,
    rowPosition: 'Position   ',
    rowAnswer: 'Answer   ',
    rowOnTime: 'On time   ',
    unjudgedCount: (n) => `${n} ungraded`,
    rowTotal: 'Total   ',
    notHeard: '(not heard)',
    heardQuote: (text) => `"${text}"`,
    answerLabelPrefix: 'Answer: ',
    lateNote: (s) => `Over time (budget ${s}s)`,
    again: 'Again',
    changeSeries: 'Change series',
  },
  series: {
    heading: 'Choose a series',
    count: (n) => `${n} questions`,
    shortfall: (n) => `${n} more needed`,
    lag: (n) => `${n}-back`,
  },
  questions: {
    heading: 'My Decks',
    count: (n) => `${n} questions`,
    placeholderQuestion: 'Question',
    placeholderAnswer: 'Answer',
    save: 'Save',
    delete: 'Delete',
    cancel: 'Cancel',
    newDeck: 'New Deck',
    editDeck: 'Edit Deck',
    deckNamePlaceholder: 'Deck name',
    addQuestion: 'Add Question',
    saveDeck: 'Save Deck',
    removeQuestion: 'Remove',
    noDecks: 'No decks yet',
  },
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
