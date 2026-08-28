import * as Speech from 'expo-speech';
import type { Speaker } from './types';

export class ExpoSpeaker implements Speaker {
  constructor(private readonly locale: string = 'ja-JP') {}

  speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      Speech.speak(text, {
        language: this.locale,
        rate: 1.0,
        pitch: 1.0,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(), // never strand the round on a TTS failure
      });
    });
  }

  /**
   * iOS refuses to speak until one utterance has come out of a user gesture,
   * so a round that starts on its own is silent until the owner happens to
   * touch something. This is that utterance — inaudible, and synchronous so
   * it stays inside the tap that permits it.
   */
  unlock(): void {
    try {
      Speech.speak('　', { language: this.locale, volume: 0 });
    } catch {
      // A synthesizer that will not warm up is not a reason to block the
      // round: the questions simply go unspoken, which the owner can see.
    }
  }

  stop(): void {
    Speech.stop();
  }
}
