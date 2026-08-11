export interface Speaker {
  /** Resolves when the utterance finishes, so phase A can end on speech end. */
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
