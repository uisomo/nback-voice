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
const { ExpoListener, detectOnDeviceRecognition, resetOnDeviceProbe } =
  require('../listener') as typeof import('../listener');

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
