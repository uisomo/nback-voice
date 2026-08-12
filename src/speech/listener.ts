import {
  AVAudioSessionCategory,
  AVAudioSessionCategoryOptions,
  AVAudioSessionMode,
  ExpoSpeechRecognitionModule,
} from 'expo-speech-recognition';
import type { SetCategoryOptions } from 'expo-speech-recognition';
import type { Listener } from './types';

export const RECOGNITION_LANG = 'ja-JP';

/**
 * The package's default session is playAndRecord with mode `measurement`,
 * which disables output signal processing and markedly attenuates the speaker.
 * Since we speak a question through that same session on every step, the
 * questions after the first would come out much quieter. `default` mode leaves
 * playback alone.
 */
const IOS_CATEGORY: SetCategoryOptions = {
  category: AVAudioSessionCategory.playAndRecord,
  categoryOptions: [
    AVAudioSessionCategoryOptions.defaultToSpeaker,
    AVAudioSessionCategoryOptions.allowBluetooth,
  ],
  mode: AVAudioSessionMode.default,
};

function sameLocale(a: string, b: string): boolean {
  return a.replace(/_/g, '-').toLowerCase() === b.toLowerCase();
}

/**
 * Spec §3 wants recognition on-device (¥0, works offline). Enabling it blindly
 * fails outright when the model is not installed, so probe first and fall back
 * to server recognition. Memoised: one probe and one log line per app launch.
 */
let onDeviceProbe: Promise<boolean> | null = null;

export function detectOnDeviceRecognition(): Promise<boolean> {
  onDeviceProbe ??= (async () => {
    let available = false;
    try {
      if (ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
        const { installedLocales } =
          await ExpoSpeechRecognitionModule.getSupportedLocales({});
        available = installedLocales.some((locale) =>
          sameLocale(locale, RECOGNITION_LANG),
        );
      }
    } catch {
      available = false;
    }
    console.log(
      `[nback] speech recognition: ${
        available ? `on-device (${RECOGNITION_LANG})` : 'server'
      }`,
    );
    return available;
  })();
  return onDeviceProbe;
}

/** Test-only: forget the memoised probe. */
export function resetOnDeviceProbe(): void {
  onDeviceProbe = null;
}

/**
 * Owns the recognizer's lifecycle but not its events — the UI subscribes with
 * useSpeechRecognitionEvent and calls push(). That keeps the native event API
 * confined to ui/.
 */
export class ExpoListener implements Listener {
  private listening = false;
  private transcript = '';
  private onDevice = false;

  constructor() {
    // Fires well before the first phase B; until it answers we use the safe
    // fallback (server recognition), which is what the app did before.
    void detectOnDeviceRecognition().then((available) => {
      this.onDevice = available;
    });
  }

  static async requestPermissions(): Promise<boolean> {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return result.granted;
  }

  start(): void {
    this.transcript = '';
    this.listening = true;
    ExpoSpeechRecognitionModule.start({
      lang: RECOGNITION_LANG,
      interimResults: true,
      continuous: false,
      requiresOnDeviceRecognition: this.onDevice,
      maxAlternatives: 1,
      iosCategory: IOS_CATEGORY,
    });
  }

  stop(): string {
    this.listening = false;
    ExpoSpeechRecognitionModule.stop();
    return this.transcript;
  }

  push(transcript: string): void {
    if (this.listening) this.transcript = transcript;
  }
}
