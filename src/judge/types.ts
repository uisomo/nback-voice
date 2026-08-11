import type { Question } from '../engine/types';

export interface Verdict {
  correct: boolean;
  /** The accepted phrasing Claude matched, to be learned into the bank. */
  matched: string | null;
}

export interface JudgeClient {
  judge(question: Question, transcript: string): Promise<Verdict>;
}
