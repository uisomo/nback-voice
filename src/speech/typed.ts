import type { Listener } from './types';

/**
 * A Listener backed by a text field instead of a recognizer.
 *
 * The app's own recognizer hands its result straight to scoring, so a
 * misheard word is final and lands as a wrong answer with nothing on screen
 * to say so. Typing — usually filled by the keyboard's dictation key — makes
 * the transcript editable before it counts.
 *
 * Phase B closes on settle(); here that means the player pressed send. The
 * UI passes no phase-B timer in this mode, which is what makes the round
 * submit-driven. It knows nothing about steps: whether a step even wants an
 * answer is the UI's business (see the plan's Task 7).
 */
export class TypedListener implements Listener {
  private value = '';
  private open = false;
  private release: (() => void) | null = null;
  private settled: Promise<void> = Promise.resolve();

  /** What is currently in the field. For the UI to render. */
  get text(): string {
    return this.value;
  }

  start(): void {
    this.value = '';
    this.open = true;
    this.settled = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  push(transcript: string): void {
    this.value = transcript;
  }

  settle(): Promise<void> {
    return this.settled;
  }

  stop(): string {
    this.open = false;
    return this.value;
  }

  /** The send button, or the keyboard's return key. */
  submit(): void {
    if (!this.open) return;
    this.open = false;
    this.release?.();
    this.release = null;
  }

  /** No session exists to end. */
  sessionEnded(): void {}
}
