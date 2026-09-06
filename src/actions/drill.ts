import type { Sequence } from './actions';

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
