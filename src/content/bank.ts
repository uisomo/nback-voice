import type { Question } from '../engine/types';
import raw from './bank.json';

const SHIPPED = raw as Question[];

/**
 * The shipped bank with runtime-learned synonyms merged over it. Learning is
 * stored separately so a bank update never discards it.
 */
export function loadBank(learned: Record<string, string[]> = {}): Question[] {
  return SHIPPED.map((q) => {
    const extra = learned[q.id];
    if (!extra || extra.length === 0) return q;
    return { ...q, accept: [...new Set([...q.accept, ...extra])] };
  });
}
