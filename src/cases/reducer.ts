import type { LoanCase, Turn } from './cases';

export type Phase = 'sheet' | 'conversation' | 'done';

export interface GameState {
  phase: Phase;
  turnIndex: number;
  revealed: boolean;
  guess: string;
}

export function initState(): GameState {
  return { phase: 'sheet', turnIndex: 0, revealed: false, guess: '' };
}

export function startConversation(s: GameState): GameState {
  if (s.phase !== 'sheet') return s;
  return { ...s, phase: 'conversation' };
}

export function setGuess(s: GameState, guess: string): GameState {
  return { ...s, guess };
}

export function reveal(s: GameState): GameState {
  if (s.phase !== 'conversation' || s.revealed) return s;
  return { ...s, revealed: true };
}

export function advance(s: GameState, totalTurns: number): GameState {
  if (s.phase !== 'conversation' || !s.revealed) return s;
  const next = s.turnIndex + 1;
  if (next >= totalTurns) {
    return { ...s, phase: 'done' };
  }
  return { ...s, turnIndex: next, revealed: false, guess: '' };
}

export function replay(): GameState {
  return initState();
}

export function currentTurn(c: LoanCase, s: GameState): Turn | null {
  if (s.phase !== 'conversation') return null;
  return c.conversation[s.turnIndex] ?? null;
}
