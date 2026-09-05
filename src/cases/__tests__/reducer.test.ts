import type { LoanCase } from '../cases';
import {
  advance,
  currentTurn,
  initState,
  reveal,
  replay,
  setGuess,
  startConversation,
} from '../reducer';

const CASE: LoanCase = {
  id: 't',
  product: 'sub-finance',
  title: 'T',
  credit: 'c',
  sheet: [{ label: 'L', value: 'V', group: 'terms' }],
  conversation: [
    { speaker: 'RM', line: 'one' },
    { speaker: 'CRO', line: 'two' },
  ],
};

describe('cases reducer', () => {
  it('starts on the sheet phase', () => {
    expect(initState()).toEqual({ phase: 'sheet', turnIndex: 0, revealed: false, guess: '' });
  });

  it('startConversation moves to the first turn', () => {
    const s = startConversation(initState());
    expect(s.phase).toBe('conversation');
    expect(currentTurn(CASE, s)).toEqual({ speaker: 'RM', line: 'one' });
  });

  it('setGuess stores the typed text', () => {
    const s = setGuess(startConversation(initState()), 'my guess');
    expect(s.guess).toBe('my guess');
  });

  it('reveal flips revealed and keeps the guess', () => {
    let s = setGuess(startConversation(initState()), 'g');
    s = reveal(s);
    expect(s.revealed).toBe(true);
    expect(s.guess).toBe('g');
  });

  it('reveal is a no-op outside the conversation phase', () => {
    expect(reveal(initState()).revealed).toBe(false);
  });

  it('advance from a revealed turn moves to the next, clearing guess and revealed', () => {
    let s = reveal(setGuess(startConversation(initState()), 'g'));
    s = advance(s, CASE.conversation.length);
    expect(s.turnIndex).toBe(1);
    expect(s.revealed).toBe(false);
    expect(s.guess).toBe('');
    expect(currentTurn(CASE, s)).toEqual({ speaker: 'CRO', line: 'two' });
  });

  it('advance past the last turn reaches done', () => {
    let s = startConversation(initState());
    s = advance(reveal(s), CASE.conversation.length); // -> turn 1
    s = advance(reveal(s), CASE.conversation.length); // -> done
    expect(s.phase).toBe('done');
    expect(currentTurn(CASE, s)).toBeNull();
  });

  it('replay returns to the initial state', () => {
    expect(replay()).toEqual(initState());
  });
});
