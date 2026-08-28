import * as Speech from 'expo-speech';

jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));

const mocked = Speech as unknown as { speak: jest.Mock; stop: jest.Mock };

// Imported after the mock so the module picks it up.
const { ExpoSpeaker } =
  require('../speaker') as typeof import('../speaker');

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks() only wipes call history, not implementations set via
  // mockImplementation() — without this, a throwing implementation from one
  // test (e.g. "does not stall the round...") leaks into the next.
  mocked.speak.mockImplementation(() => {});
});

describe('ExpoSpeaker', () => {
  it('speaks the question in Japanese', () => {
    void new ExpoSpeaker().speak('犬の鳴き声は？');
    expect(mocked.speak.mock.calls[0][0]).toBe('犬の鳴き声は？');
    expect(mocked.speak.mock.calls[0][1]).toMatchObject({ language: 'ja-JP' });
  });

  it('resolves the utterance when the synthesizer reports it done', async () => {
    const speaking = new ExpoSpeaker().speak('質問');
    mocked.speak.mock.calls[0][1].onDone();
    await expect(speaking).resolves.toBeUndefined();
  });
});

describe('unlocking audio', () => {
  it('speaks something inaudible', () => {
    // iOS only lets a page speak once an utterance has come out of a user
    // gesture. This is that utterance: it must make no sound.
    new ExpoSpeaker().unlock();
    expect(mocked.speak).toHaveBeenCalledTimes(1);
    expect(mocked.speak.mock.calls[0][1]).toMatchObject({ volume: 0 });
  });

  it('is synchronous, so it can run inside the tap that allows it', () => {
    // Anything awaited first lands outside the gesture and is refused.
    const speaker = new ExpoSpeaker();
    expect(speaker.unlock()).toBeUndefined();
    expect(mocked.speak).toHaveBeenCalled();
  });

  it('does not stall the round if the synthesizer rejects it', () => {
    mocked.speak.mockImplementation(() => {
      throw new Error('speech synthesis unavailable');
    });
    expect(() => new ExpoSpeaker().unlock()).not.toThrow();
  });
});

describe('locale selection', () => {
  it('speaks in ja-JP by default', () => {
    void new ExpoSpeaker().speak('質問');
    expect(mocked.speak.mock.calls[0][1]).toMatchObject({ language: 'ja-JP' });
  });

  it('speaks in the locale passed to the constructor', () => {
    void new ExpoSpeaker('en-US').speak('question');
    expect(mocked.speak.mock.calls[0][1]).toMatchObject({ language: 'en-US' });
  });

  it('unlocks using the constructor locale too', () => {
    new ExpoSpeaker('en-US').unlock();
    expect(mocked.speak.mock.calls[0][1]).toMatchObject({ language: 'en-US' });
  });
});
