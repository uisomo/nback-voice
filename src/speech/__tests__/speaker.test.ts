import * as Speech from 'expo-speech';

jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));

const mocked = Speech as unknown as { speak: jest.Mock; stop: jest.Mock };

// Imported after the mock so the module picks it up.
const { ExpoSpeaker } =
  require('../speaker') as typeof import('../speaker');

beforeEach(() => {
  jest.clearAllMocks();
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
