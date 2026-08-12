import * as Speech from 'expo-speech';
import type { Speaker } from './types';

export class ExpoSpeaker implements Speaker {
  speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      Speech.speak(text, {
        language: 'ja-JP',
        rate: 1.0,
        pitch: 1.0,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(), // never strand the round on a TTS failure
      });
    });
  }

  stop(): void {
    Speech.stop();
  }
}
