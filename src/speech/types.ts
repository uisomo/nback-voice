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
  /**
   * Asks the recognizer to finish and resolves once its final result has
   * landed — or the session ended, or a bound elapsed. Both Chrome and
   * SFSpeechRecognizer deliver the last transcript *after* being stopped, so
   * a round that reads the transcript on its own clock loses whatever the
   * owner said last. Phase B closes on this, exactly as phase A closes on the
   * utterance.
   */
  settle(): Promise<void>;
  /** Stops listening and returns the final transcript ('' if nothing heard). */
  stop(): string;
  /** Feeds a recognition result in. Called by the UI's event subscription. */
  push(transcript: string, isFinal?: boolean): void;
  /** The recognizer's session ended; no further results are coming. */
  sessionEnded(): void;
}
