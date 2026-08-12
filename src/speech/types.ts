export interface Speaker {
  /**
   * Starts speaking at once and resolves when the utterance finishes. Phase A
   * paints immediately and closes at max(its configured length, this promise),
   * so a question is never clipped — see RoundRunner.readyToClose().
   */
  speak(text: string): Promise<void>;
  stop(): void;
}

export interface Listener {
  start(): void;
  /** Stops listening and returns the final transcript ('' if nothing heard). */
  stop(): string;
  /** Feeds a recognition result in. Called by the UI's event subscription. */
  push(transcript: string): void;
}
