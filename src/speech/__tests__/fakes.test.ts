import { FakeListener, FakeSpeaker } from '../fakes';

describe('FakeSpeaker', () => {
  it('records what was spoken', async () => {
    const speaker = new FakeSpeaker();
    await speaker.speak('犬の鳴き声は？');
    expect(speaker.spoken).toEqual(['犬の鳴き声は？']);
  });
});

describe('FakeListener', () => {
  it('returns the pushed transcript on stop', () => {
    const listener = new FakeListener();
    listener.start();
    listener.push('わん');
    expect(listener.stop()).toBe('わん');
  });

  it('keeps the latest transcript when recognition revises itself', () => {
    const listener = new FakeListener();
    listener.start();
    listener.push('わ');
    listener.push('わん');
    expect(listener.stop()).toBe('わん');
  });

  it('ignores pushes while not listening', () => {
    const listener = new FakeListener();
    listener.push('わん');
    expect(listener.stop()).toBe('');
  });

  it('resets between sessions', () => {
    const listener = new FakeListener();
    listener.start();
    listener.push('わん');
    listener.stop();
    listener.start();
    expect(listener.stop()).toBe('');
  });
});
