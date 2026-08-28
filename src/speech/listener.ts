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
 * to server recognition. Memoised per locale: one probe and one log line per
 * locale per app launch — switching from ja to en must not reuse a ja probe
 * result (or vice versa), since installedLocales differs per locale.
 *
 * The probe is a *request*, not a guarantee. On iOS the package builds a bare
 * SFSpeechRecognizer for the device locale, and getSupportedLocales() returns
 * supportedLocales() for installedLocales, so neither signal is specific to
 * the requested locale being downloaded. The native layer gates the real flag
 * on that locale's recognizer's own supportsOnDeviceRecognition, so a false
 * positive here degrades silently to server recognition rather than failing —
 * which is why the log says "requested", not "using".
 */
const onDeviceProbes = new Map<string, Promise<boolean>>();

export function detectOnDeviceRecognition(
  locale: string = RECOGNITION_LANG,
): Promise<boolean> {
  let probe = onDeviceProbes.get(locale);
  if (!probe) {
    probe = (async () => {
      let available = false;
      try {
        if (ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
          const { installedLocales } =
            await ExpoSpeechRecognitionModule.getSupportedLocales({});
          available = installedLocales.some((l) => sameLocale(l, locale));
        }
      } catch {
        available = false;
      }
      console.log(
        `[nback] speech recognition (${locale}): ${
          available
            ? 'on-device requested (iOS may still fall back to server)'
            : 'server'
        }`,
      );
      return available;
    })();
    onDeviceProbes.set(locale, probe);
  }
  return probe;
}

/** Test-only: forget the memoised probes. */
export function resetOnDeviceProbe(): void {
  onDeviceProbes.clear();
}

/**
 * Owns the recognizer's lifecycle but not its events — the UI subscribes with
 * useSpeechRecognitionEvent and calls push(). That keeps the native event API
 * confined to ui/.
 */
/**
 * Ceiling on waiting for a recognizer to hand over its final result after
 * being stopped. Reached only when the recognizer says nothing at all —
 * normally the final result or the session's end arrives well inside it.
 */
export const SETTLE_TIMEOUT_MS = 1_500;

export class ExpoListener implements Listener {
  private listening = false;
  private transcript = '';
  private onDevice = false;
  private settleResolvers: Array<() => void> = [];
  /** This session has said its last word — nothing more is coming. */
  private finished = false;

  constructor(private readonly locale: string = RECOGNITION_LANG) {
    // Fires well before the first phase B; until it answers we use the safe
    // fallback (server recognition), which is what the app did before.
    void detectOnDeviceRecognition(this.locale).then((available) => {
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
    this.finished = false;
    ExpoSpeechRecognitionModule.start({
      lang: this.locale,
      interimResults: true,
      continuous: false,
      requiresOnDeviceRecognition: this.onDevice,
      maxAlternatives: 1,
      iosCategory: IOS_CATEGORY,
    });
  }

  /**
   * Asks the recognizer to finish and waits for its last word. Everything the
   * owner said is delivered by then; reading the transcript before this
   * resolves is what silently turned real answers into 聞き取れず.
   */
  settle(): Promise<void> {
    // Nothing to wait for: either no session is open, or this one already
    // delivered its last word — a quick answer ends the session well inside
    // phase B, and waiting out the bound for it would just stall the round.
    if (!this.listening || this.finished) return Promise.resolve();
    ExpoSpeechRecognitionModule.stop();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => this.releaseSettle(), SETTLE_TIMEOUT_MS);
      this.settleResolvers.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private releaseSettle(): void {
    const waiting = this.settleResolvers;
    this.settleResolvers = [];
    for (const resolve of waiting) resolve();
  }

  stop(): string {
    this.listening = false;
    this.releaseSettle();
    ExpoSpeechRecognitionModule.stop();
    return this.transcript;
  }

  push(transcript: string, isFinal = false): void {
    if (!this.listening) return;
    this.transcript = transcript;
    // The final result is the last thing this session will say, so anything
    // waiting on settle() can stop waiting.
    if (isFinal) {
      this.finished = true;
      this.releaseSettle();
    }
  }

  sessionEnded(): void {
    this.finished = true;
    this.releaseSettle();
  }
}
