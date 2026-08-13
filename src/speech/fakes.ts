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

  settle(): Promise<void> {
    return Promise.resolve();
  }

  stop(): string {
    this.listening = false;
    return this.transcript;
  }

  push(transcript: string): void {
    if (this.listening) this.transcript = transcript;
  }

  sessionEnded(): void {}
}

/**
 * A Listener shaped like the real recognizers: nothing is delivered while the
 * mic is open — the final transcript only lands once the session is asked to
 * finish, which is when Chrome and SFSpeechRecognizer emit theirs. Use it to
 * prove the round reads the transcript after that, not on its own clock.
 */
export class LateFinalListener implements Listener {
  sessions = 0;
  settles = 0;
  private listening = false;
  private transcript = '';
  private finished = false;
  private resolvers: Array<() => void> = [];

  /** `canned` delivers itself on settle; null leaves delivery to the test. */
  constructor(private readonly canned: string | null = null) {}

  start(): void {
    this.listening = true;
    this.transcript = '';
    this.finished = false;
    this.sessions++;
  }

  settle(): Promise<void> {
    this.settles++;
    if (this.finished) return Promise.resolve();
    if (this.canned !== null) {
      this.deliverFinal(this.canned);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  /** The recognizer hands over its final result and the session finishes. */
  deliverFinal(transcript: string): void {
    this.push(transcript, true);
  }

  stop(): string {
    this.listening = false;
    return this.transcript;
  }

  push(transcript: string, isFinal = false): void {
    if (!this.listening) return;
    this.transcript = transcript;
    if (isFinal) {
      this.finished = true;
      this.release();
    }
  }

  sessionEnded(): void {
    this.finished = true;
    this.release();
  }

  private release(): void {
    const waiting = this.resolvers;
    this.resolvers = [];
    for (const resolve of waiting) resolve();
  }
}
