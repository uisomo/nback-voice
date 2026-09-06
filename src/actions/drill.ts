import { nextN } from '../engine/adaptive';
import type { ActionCard, Sequence, SubAction } from './actions';
import { gradeAnswer } from './grade';

export type Stage = 'study' | 'purpose' | 'action';

export const STAGE_ORDER: Stage[] = ['study', 'purpose', 'action'];

export function nextStage(stage: Stage): Stage | null {
  const i = STAGE_ORDER.indexOf(stage);
  return i >= 0 && i + 1 < STAGE_ORDER.length ? STAGE_ORDER[i + 1] : null;
}

/**
 * 歩きの1単位。学習段と目的段はカードそのもの、具体アクション段は
 * カード内の小目的である。序数は常にカード単位で数えるので、小目的も
 * 所属カードの添字を持ち歩く。
 */
export interface DrillUnit {
  cardIndex: number;
  /** 具体アクション段でのみ非 null。カード内で何番目の小目的か。 */
  subIndex: number | null;
}

export interface DrillStep {
  index: number;
  /** この設問が問う単位。null なら観察のみ（先頭N手）。 */
  targetIndex: number | null;
  /** 「読む」面に出す単位。学習段でカードが残っている間だけ非 null。 */
  displayIndex: number | null;
  /** 「全 7 個中 M 個目」の M（1始まり）。何も出さない手では null。 */
  ordinal: number | null;
  /** 「全 7 個中」の 7。常にカード枚数。 */
  totalCards: number;
  /** 問う対象の小目的の添字。具体アクション段でのみ非 null。 */
  subIndex: number | null;
}

export function unitKey(unit: DrillUnit): string {
  return `${unit.cardIndex}:${unit.subIndex ?? '-'}`;
}

export function buildUnits(seq: Sequence, stage: Stage): DrillUnit[] {
  if (stage !== 'action') {
    return seq.cards.map((_, cardIndex) => ({ cardIndex, subIndex: null }));
  }
  // subActions が空のカード（layer2Skipped）はここで自然に落ちる。
  return seq.cards.flatMap((card, cardIndex) =>
    card.subActions.map((_, subIndex) => ({ cardIndex, subIndex })),
  );
}

/**
 * 歩数は units.length + n。素直に i-n のラグを入れるだけだと末尾N単位が
 * 一度も問われないので、後ろにドレイン用のN手を足す。先頭N手は観察のみ、
 * 末尾N手は出題のみになり、全単位がちょうど1回ずつ問われる。
 */
export function buildSteps(
  units: DrillUnit[],
  n: number,
  stage: Stage,
  totalCards: number,
): DrillStep[] {
  const ordinalOf = (unitIndex: number) => units[unitIndex].cardIndex + 1;

  return Array.from({ length: units.length + n }, (_, index) => {
    const targetIndex = index >= n ? index - n : null;
    const displayIndex = stage === 'study' && index < units.length ? index : null;
    const ordinal =
      targetIndex !== null
        ? ordinalOf(targetIndex)
        : displayIndex !== null
          ? ordinalOf(displayIndex)
          : null;
    return {
      index,
      targetIndex,
      displayIndex,
      ordinal,
      totalCards,
      subIndex: targetIndex !== null ? units[targetIndex].subIndex : null,
    };
  });
}

export type Field = 'purpose' | 'action';

/** 開示に使う模範解答と、照合に使う許容集合。model は必ず accept に含まれる。 */
export interface AnswerSpec {
  model: string;
  accept: string[];
}

export interface AnswerRecord {
  stepIndex: number;
  field: Field;
  /** ユーザーが打った生の文字列。開示画面で「あなたの答え」として出す。 */
  input: string;
  /** ローカル照合の結果。自己採点で上書きされる。 */
  correct: boolean;
}

export interface StepContent {
  card: ActionCard;
  /** 具体アクション段でのみ非 null。 */
  subAction: SubAction | null;
}

export interface DrillState {
  stage: Stage;
  n: number;
  units: DrillUnit[];
  steps: DrillStep[];
  cursor: number;
  answers: AnswerRecord[];
  /** 学習段の緑チェック。セッション限りの飾りで、採点にも進行にも無関係。 */
  checked: Set<string>;
}

export function createDrill(seq: Sequence, stage: Stage, n: number): DrillState {
  const units = buildUnits(seq, stage);
  return {
    stage,
    n,
    units,
    steps: buildSteps(units, n, stage, seq.cards.length),
    cursor: 0,
    answers: [],
    checked: new Set(),
  };
}

export function currentStep(state: DrillState): DrillStep | null {
  return state.steps[state.cursor] ?? null;
}

export function isFinished(state: DrillState): boolean {
  return state.cursor >= state.steps.length;
}

export function advance(state: DrillState): DrillState {
  return { ...state, cursor: state.cursor + 1 };
}

export function toggleChecked(state: DrillState, key: string): DrillState {
  const checked = new Set(state.checked);
  if (checked.has(key)) checked.delete(key);
  else checked.add(key);
  return { ...state, checked };
}

export function unitContent(seq: Sequence, unit: DrillUnit): StepContent {
  const card = seq.cards[unit.cardIndex];
  return {
    card,
    subAction: unit.subIndex === null ? null : card.subActions[unit.subIndex],
  };
}

/**
 * その段でその カードについて開く入力欄。学習段は中目的と具体アクションの
 * 2欄だが、subActions を持たないカードは具体アクション欄を出さない。
 */
export function fieldsFor(stage: Stage, card: ActionCard): Field[] {
  if (stage === 'purpose') return ['purpose'];
  if (stage === 'action') return ['action'];
  return card.subActions.length > 0 ? ['purpose', 'action'] : ['purpose'];
}

export function purposeAnswer(card: ActionCard): AnswerSpec {
  return { model: card.purpose, accept: [card.purpose, ...card.purposeAccept] };
}

/**
 * subIndex が与えられればその小目的1本の答え。null（学習段）ならカードの
 * 全 subActions を合併する — 開示は全列挙、照合は合併集合で、一手順でも
 * 言い当てれば正解にする。テストではなく学習の段なので網羅は求めない。
 */
export function actionAnswer(card: ActionCard, subIndex: number | null): AnswerSpec | null {
  if (subIndex !== null) {
    const sub = card.subActions[subIndex];
    if (!sub) return null;
    return { model: sub.action, accept: [sub.action, ...sub.actionAccept] };
  }
  if (card.subActions.length === 0) return null;
  return {
    model: card.subActions.map((s) => s.action).join('\n'),
    accept: card.subActions.flatMap((s) => [s.action, ...s.actionAccept]),
  };
}

export function answerFor(
  state: DrillState,
  stepIndex: number,
  field: Field,
): AnswerRecord | undefined {
  return state.answers.find((a) => a.stepIndex === stepIndex && a.field === field);
}

export function submitAnswer(
  state: DrillState,
  field: Field,
  input: string,
  spec: AnswerSpec,
): DrillState {
  const record: AnswerRecord = {
    stepIndex: state.cursor,
    field,
    input,
    correct: gradeAnswer(input, spec.accept),
  };
  const answers = state.answers.filter(
    (a) => !(a.stepIndex === record.stepIndex && a.field === field),
  );
  return { ...state, answers: [...answers, record] };
}

/**
 * 自己採点。ローカル照合はあくまで初期値で、ユーザーの ✓／✕ が最終になる。
 * 閾値の誤りが学習を壊さないための逃げ道である（spec §5）。
 */
export function setSelfGrade(
  state: DrillState,
  stepIndex: number,
  field: Field,
  correct: boolean,
): DrillState {
  return {
    ...state,
    answers: state.answers.map((a) =>
      a.stepIndex === stepIndex && a.field === field ? { ...a, correct } : a,
    ),
  };
}

/** 正解数 ÷ 判定済み数。判定済みが0件なら null。 */
export function stageScore(state: DrillState): number | null {
  if (state.answers.length === 0) return null;
  const correct = state.answers.filter((a) => a.correct).length;
  return correct / state.answers.length;
}

/**
 * 段末の適応N。位置チャネルが無いので roundScore は answerScore に等しく、
 * 既存ルールどおり満点でだけ上がり、0.5以下で下がる。判定済み0件なら
 * 据え置き。
 */
export function updatedN(state: DrillState): number {
  const score = stageScore(state);
  if (score === null) return state.n;
  return nextN(score, state.n, { positionScore: null, answerScore: score });
}
