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

/**
 * A Speaker whose utterance only finishes when the test says so — the shape
 * ExpoSpeaker really has, where speak() resolves on the synthesizer's onDone
 * seconds later. Use it to prove nothing in the step machine or the UI waits
 * for the audio before painting.
 */
export class SlowFakeSpeaker implements Speaker {
  spoken: string[] = [];
  stopped = 0;
  private resolvers: Array<() => void> = [];

  speak(text: string): Promise<void> {
    this.spoken.push(text);
    return new Promise<void>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  stop(): void {
    this.stopped++;
  }

  /** Utterances started but not yet finished. */
  get pending(): number {
    return this.resolvers.length;
  }

  /** Finish every utterance currently in flight. */
  resolveSpeak(): void {
    const pending = this.resolvers;
    this.resolvers = [];
    for (const resolve of pending) resolve();
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
    if (this.listening) this.transcript = transcript;
  }
}
