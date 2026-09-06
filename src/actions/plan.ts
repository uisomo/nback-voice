import type { Question, RoundMode, RoundPlan, StepPlan } from '../engine';
import type { ActionCard, Sequence } from './actions';

export type Layer = 'purpose' | 'action';

export interface ActionRoundOpts {
  n: number;
  layer: Layer;
  mode: RoundMode;
}

const GRID_SIZE = 9;

export function eligibleCards(seq: Sequence, layer: Layer): ActionCard[] {
  if (layer === 'purpose') return seq.cards;
  return seq.cards.filter((c) => !c.layer2Skipped);
}

export function cardToQuestion(card: ActionCard, layer: Layer): Question {
  return {
    id: card.id,
    tier: 2,
    q: card.title,
    accept: layer === 'purpose' ? card.purposeAccept : card.actionAccept,
  };
}

export function buildActionRound(seq: Sequence, opts: ActionRoundOpts): RoundPlan {
  const { n, layer, mode } = opts;
  const cards = eligibleCards(seq, layer);
  const steps: StepPlan[] = cards.map((card, i) => ({
    index: i,
    position: mode === 'dual' ? i % GRID_SIZE : null,
    question: cardToQuestion(card, layer),
    recallTarget: i >= n ? i - n : null,
  }));
  return { n, mode, steps };
}
