import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type { Listener } from './types';

/**
 * Owns the recognizer's lifecycle but not its events — the UI subscribes with
 * useSpeechRecognitionEvent and calls push(). That keeps the native event API
 * confined to ui/.
 */
export class ExpoListener implements Listener {
  private listening = false;
  private transcript = '';

  static async requestPermissions(): Promise<boolean> {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return result.granted;
  }

  start(): void {
    this.transcript = '';
    this.listening = true;
    ExpoSpeechRecognitionModule.start({
      lang: 'ja-JP',
      interimResults: true,
      continuous: false,
      requiresOnDeviceRecognition: false,
      maxAlternatives: 1,
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
