import { normalizeTranscript } from '../content/normalize';
import type { Question } from '../engine/types';

/** Free, instant grading. Both sides are normalized before comparison. */
export function localMatch(question: Question, transcript: string): boolean {
  const said = normalizeTranscript(transcript);
  if (said.length === 0) return false;
  return question.accept.some((a) => normalizeTranscript(a) === said);
}
