import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

jest.mock('expo-speech-recognition', () => ({
  AVAudioSessionCategory: { playAndRecord: 'playAndRecord' },
  AVAudioSessionCategoryOptions: {
    defaultToSpeaker: 'defaultToSpeaker',
    allowBluetooth: 'allowBluetooth',
  },
  AVAudioSessionMode: { default: 'default', measurement: 'measurement' },
  ExpoSpeechRecognitionModule: {
    supportsOnDeviceRecognition: jest.fn(() => false),
    getSupportedLocales: jest.fn(async () => ({
      locales: [],
      installedLocales: [],
    })),
    start: jest.fn(),
    stop: jest.fn(),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  },
}));

const mocked = ExpoSpeechRecognitionModule as unknown as {
  supportsOnDeviceRecognition: jest.Mock;
  getSupportedLocales: jest.Mock;
  start: jest.Mock;
  stop: jest.Mock;
};

// Imported after the mock so the module picks it up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  ExpoListener,
  SETTLE_TIMEOUT_MS,
  detectOnDeviceRecognition,
  resetOnDeviceProbe,
} = require('../listener') as typeof import('../listener');

let logged: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  resetOnDeviceProbe();
  logged = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logged.mockRestore();
});

/** Let the constructor's fire-and-forget probe settle. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('on-device recognition selection', () => {
  it('requests on-device recognition when the probe reports ja-JP support', async () => {
    mocked.supportsOnDeviceRecognition.mockReturnValue(true);
    mocked.getSupportedLocales.mockResolvedValue({
      locales: ['en-US', 'ja-JP'],
      installedLocales: ['en-US', 'ja-JP'],
    });

    const listener = new ExpoListener();
    await flush();
    listener.start();

    expect(mocked.start.mock.calls[0][0]).toMatchObject({
      lang: 'ja-JP',
      requiresOnDeviceRecognition: true,
    });
    // The probe cannot prove the ja-JP model is downloaded, so the log must
    // not claim it is in use — iOS may still fall back to server recognition.
    expect(logged.mock.calls[0][0]).toContain('on-device requested');
  });

  it('accepts the underscore locale form Apple sometimes reports', async () => {
    mocked.supportsOnDeviceRecognition.mockReturnValue(true);
    mocked.getSupportedLocales.mockResolvedValue({
      locales: ['ja_JP'],
      installedLocales: ['ja_JP'],
    });

    const listener = new ExpoListener();
    await flush();
    listener.start();

    expect(mocked.start.mock.calls[0][0].requiresOnDeviceRecognition).toBe(true);
  });

  it('falls back to server recognition when ja-JP is not on the device', async () => {
    mocked.supportsOnDeviceRecognition.mockReturnValue(true);
    mocked.getSupportedLocales.mockResolvedValue({
      locales: ['en-US'],
      installedLocales: ['en-US'],
    });

    const listener = new ExpoListener();
    await flush();
    listener.start();

    expect(mocked.start.mock.calls[0][0].requiresOnDeviceRecognition).toBe(
      false,
    );
    expect(logged.mock.calls[0][0]).toContain('server');
  });

  it('falls back to server recognition when the device has no on-device engine', async () => {
    mocked.supportsOnDeviceRecognition.mockReturnValue(false);

    const listener = new ExpoListener();
    await flush();
    listener.start();

    expect(mocked.getSupportedLocales).not.toHaveBeenCalled();
    expect(mocked.start.mock.calls[0][0].requiresOnDeviceRecognition).toBe(
      false,
    );
  });

  it('falls back to server recognition when the probe throws', async () => {
    mocked.supportsOnDeviceRecognition.mockImplementation(() => {
      throw new Error('module not linked');
    });

    const listener = new ExpoListener();
    await flush();
    listener.start();

    expect(mocked.start.mock.calls[0][0].requiresOnDeviceRecognition).toBe(
      false,
    );
  });

  it('probes and logs once per app launch, not once per round', async () => {
    mocked.supportsOnDeviceRecognition.mockReturnValue(true);
    mocked.getSupportedLocales.mockResolvedValue({
      locales: ['ja-JP'],
      installedLocales: ['ja-JP'],
    });

    await detectOnDeviceRecognition();
    new ExpoListener();
    new ExpoListener();
    await flush();

    expect(mocked.getSupportedLocales).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledTimes(1);
  });
});

describe('audio session', () => {
  it('overrides the measurement mode that attenuates playback', async () => {
    const listener = new ExpoListener();
    await flush();
    listener.start();

    const options = mocked.start.mock.calls[0][0];
    expect(options.iosCategory).toEqual({
      category: 'playAndRecord',
      categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
      mode: 'default',
    });
  });
});

describe('transcript buffer', () => {
  it('keeps the last transcript pushed while listening and returns it on stop', async () => {
    const listener = new ExpoListener();
    await flush();
    listener.start();
    listener.push('わ');
    listener.push('わんわん');
    expect(listener.stop()).toBe('わんわん');
    expect(mocked.stop).toHaveBeenCalled();
  });

  it('ignores pushes outside a listening window', async () => {
    const listener = new ExpoListener();
    await flush();
    listener.push('聞こえないはず');
    listener.start();
    expect(listener.stop()).toBe('');
  });
});

describe('settling a session', () => {
  it('captures the final result the recognizer delivers after being asked to stop', async () => {
    // Chrome and SFSpeechRecognizer both emit their final result *after*
    // stop() — the transcript the owner actually said arrives in that gap.
    const listener = new ExpoListener();
    await flush();
    listener.start();

    const settled = listener.settle();
    expect(mocked.stop).toHaveBeenCalled();
    listener.push('わんわん', true);
    await settled;

    expect(listener.stop()).toBe('わんわん');
  });

  it('resolves as soon as the final result lands, without waiting out the bound', async () => {
    jest.useFakeTimers();
    try {
      const listener = new ExpoListener();
      await flush();
      listener.start();

      let done = false;
      const settled = listener.settle().then(() => {
        done = true;
      });
      listener.push('わんわん', true);
      await settled;

      expect(done).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('resolves when the session ends without ever producing a result', async () => {
    const listener = new ExpoListener();
    await flush();
    listener.start();

    const settled = listener.settle();
    listener.sessionEnded();
    await settled;

    expect(listener.stop()).toBe('');
  });

  it('gives up after the bound so a silent recognizer cannot stall the round', async () => {
    jest.useFakeTimers();
    try {
      const listener = new ExpoListener();
      await flush();
      listener.start();

      const settled = listener.settle();
      await jest.advanceTimersByTimeAsync(SETTLE_TIMEOUT_MS + 1);
      await settled;

      expect(listener.stop()).toBe('');
    } finally {
      jest.useRealTimers();
    }
  });

  it('does nothing when there is no open session', async () => {
    const listener = new ExpoListener();
    await flush();
    await listener.settle();
    expect(mocked.stop).not.toHaveBeenCalled();
  });

  it('still ignores results that arrive with no session open at all', async () => {
    const listener = new ExpoListener();
    await flush();
    listener.start();
    listener.stop();
    listener.push('ラウンド外', true);
    listener.start();

    expect(listener.stop()).toBe('');
  });
});

describe('locale selection', () => {
  it('starts recognition in ja-JP by default', () => {
    new ExpoListener().start();
    expect(mocked.start.mock.calls[0][0]).toMatchObject({ lang: 'ja-JP' });
  });

  it('starts recognition in the locale passed to the constructor', () => {
    new ExpoListener('en-US').start();
    expect(mocked.start.mock.calls[0][0]).toMatchObject({ lang: 'en-US' });
  });
});

describe('sessions that finish before the step does', () => {
  it('settles at once when the final result already arrived', async () => {
    jest.useFakeTimers();
    try {
      const listener = new ExpoListener();
      await flush();
      listener.start();
      // A quick answer: Chrome ends the session on its own, well inside phase B.
      listener.push('わんわん', true);

      let done = false;
      void listener.settle().then(() => {
        done = true;
      });
      await Promise.resolve();

      // No waiting out the bound for an event that has already happened.
      expect(done).toBe(true);
      expect(listener.stop()).toBe('わんわん');
    } finally {
      jest.useRealTimers();
    }
  });

  it('settles at once when the session already ended in silence', async () => {
    const listener = new ExpoListener();
    await flush();
    listener.start();
    listener.sessionEnded();

    let done = false;
    void listener.settle().then(() => {
      done = true;
    });
    await Promise.resolve();

    expect(done).toBe(true);
  });

  it('waits again for the next session', async () => {
    const listener = new ExpoListener();
    await flush();
    listener.start();
    listener.push('わんわん', true);
    listener.stop();

    listener.start();
    let done = false;
    void listener.settle().then(() => {
      done = true;
    });
    await Promise.resolve();

    // A fresh session has said nothing yet, so this one really must wait.
    expect(done).toBe(false);
  });
});
