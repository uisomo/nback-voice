import { TypedListener } from '../typed';

/** Resolved-ness of a promise, without hanging the test on a pending one. */
function isResolved(promise: Promise<void>): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    Promise.resolve().then(() => false),
  ]);
}

describe('TypedListener', () => {
  it('does not settle until the answer is submitted', async () => {
    const listener = new TypedListener();
    listener.start();
    const settled = listener.settle();

    expect(await isResolved(settled)).toBe(false);

    listener.push('キャピタルコール');
    expect(await isResolved(settled)).toBe(false);

    listener.submit();
    expect(await isResolved(settled)).toBe(true);
  });

  it('returns what was typed', () => {
    const listener = new TypedListener();
    listener.start();
    listener.push('キャピタル');
    listener.push('キャピタルコール');
    listener.submit();
    expect(listener.stop()).toBe('キャピタルコール');
  });

  it('clears the field for each new answer window', () => {
    const listener = new TypedListener();
    listener.start();
    listener.push('ひとつめ');
    listener.submit();
    expect(listener.stop()).toBe('ひとつめ');

    listener.start();
    expect(listener.text).toBe('');
    listener.submit();
    expect(listener.stop()).toBe('');
  });

  /** Empty is 未回答, never a wrong answer — the engine decides that. */
  it('submits empty text as empty', async () => {
    const listener = new TypedListener();
    listener.start();
    const settled = listener.settle();
    listener.submit();
    expect(await isResolved(settled)).toBe(true);
    expect(listener.stop()).toBe('');
  });

  it('ignores a second submit for the same window', async () => {
    const listener = new TypedListener();
    listener.start();
    const settled = listener.settle();
    listener.submit();
    listener.push('あとから');
    listener.submit();
    expect(await isResolved(settled)).toBe(true);
    expect(listener.stop()).toBe('あとから');
  });

  /** A stray keyboard event before the window opens must not advance a step. */
  it('ignores submit before start', async () => {
    const listener = new TypedListener();
    listener.submit();
    listener.start();
    const settled = listener.settle();
    expect(await isResolved(settled)).toBe(false);
  });

  it('settles immediately when the window is already closed', async () => {
    const listener = new TypedListener();
    listener.start();
    listener.submit();
    expect(await isResolved(listener.settle())).toBe(true);
  });

  it('has no session to end', () => {
    const listener = new TypedListener();
    listener.start();
    expect(() => listener.sessionEnded()).not.toThrow();
  });
});
