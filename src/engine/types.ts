/** Grid position, 0..8, row-major (0 = top-left, 4 = center, 8 = bottom-right). */
export type Position = number;

export interface Question {
  id: string;
  /** 1 = trivially known, 2 = general knowledge, 3 = one-step inference. */
  tier: number;
  q: string;
  /** Accepted answers, including synonyms. Grown at runtime by the judge. */
  accept: string[];
}

export interface StepPlan {
  index: number;
  /** Where the block flashes. null on trailing recall-only steps. */
  position: Position | null;
  /** The question spoken. null on trailing recall-only steps. */
  question: Question | null;
  /** Index of the step this one recalls. null for the first N steps. */
  recallTarget: number | null;
}

/** 'dual' scores position and answer; 'question' drops the visual channel. */
export type RoundMode = 'dual' | 'question';

export interface RoundPlan {
  n: number;
  mode: RoundMode;
  steps: StepPlan[];
}

export type Rng = () => number;
