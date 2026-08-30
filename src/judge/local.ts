import { canonicalAnswer } from '../content/aliases';
import { normalizeTranscript } from '../content/normalize';
import type { Question } from '../engine/types';

/**
 * Free, instant grading. Both sides are folded to the same canonical form
 * first, so a question that only lists "Subscription Line" still accepts
 * "subline" and "capital call facility" — the market's other names for it
 * live in aliases.ts rather than being repeated in every accept list.
 */
export function localMatch(question: Question, transcript: string): boolean {
  if (normalizeTranscript(transcript).length === 0) return false;
  const said = canonicalAnswer(transcript);
  return question.accept.some((a) => canonicalAnswer(a) === said);
}
