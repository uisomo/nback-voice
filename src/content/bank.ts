import type { Question } from '../engine/types';
import raw from './bank.json';

const SHIPPED = raw as Question[];

/**
 * Overlay runtime-learned synonyms onto a question list. Learning is stored
 * separately and keyed by question id, so a bank update never discards it and
 * custom questions accumulate synonyms the same way built-ins do.
 */
export function mergeLearned(
  questions: Question[],
  learned: Record<string, string[]> = {},
): Question[] {
  return questions.map((q) => {
    const extra = learned[q.id];
    if (!extra || extra.length === 0) return q;
    return { ...q, accept: [...new Set([...q.accept, ...extra])] };
  });
}

/** The shipped bank with learned synonyms merged over it. */
export function loadBank(learned: Record<string, string[]> = {}): Question[] {
  return mergeLearned(SHIPPED, learned);
}
