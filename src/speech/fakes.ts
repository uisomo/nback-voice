import type { Listener, Speaker } from './types';

export class FakeSpeaker implements Speaker {
  spoken: string[] = [];
  stopped = 0;

  async speak(text: string): Promise<void> {
    this.spoken.push(text);
  }

  stop(): void {
    this.stopped++;
  }
}

export class FakeListener implements Listener {
  private listening = false;
  private transcript = '';
  sessions = 0;

  start(): void {
    this.listening = true;
    this.transcript = '';
    this.sessions++;
  }

  stop(): string {
    this.listening = false;
    return this.transcript;
  }

  push(transcript: string): void {
    this.transcript = transcript;
  }
}
