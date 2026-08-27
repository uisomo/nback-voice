import { RoundEngine } from '../round';
import { RoundRunner, SPEAK_TIMEOUT_MS, speakTimeoutMs } from '../runner';
import { buildRound } from '../sequence';
import {
  FakeListener,
  FakeSpeaker,
  LateFinalListener,
  SlowFakeSpeaker,
} from '../../speech/fakes';
import type { PendingAnswer } from '../round';
import { TypedListener } from '../../speech/typed';
import type { Question } from '../types';

const BANK: Question[] = Array.from({ length: 20 }, (_, i) => ({
  id: `q${i}`,
  tier: 1,
  q: `質問${i}`,
  accept: [`答え${i}`],
}));

function setup(n = 2, speaker: FakeSpeaker | SlowFakeSpeaker = new FakeSpeaker()) {
  const plan = buildRound(n, BANK, Math.random);
  const engine = new RoundEngine(plan);
  const listener = new FakeListener();
  const judged: PendingAnswer[] = [];
  const runner = new RoundRunner({
    plan,
    engine,
    speaker,
    listener,
    onJudge: (a) => judged.push(a),
  });
  return { plan, engine, speaker, listener, runner, judged };
}

describe('RoundRunner phases', () => {
  it('starts in phase A of step 0 and speaks the first question', async () => {
    const { runner, speaker, plan } = setup();
    runner.start();
    expect(runner.state).toMatchObject({ stepIndex: 0, phase: 'A' });
    expect(speaker.spoken).toEqual([plan.steps[0].question!.q]);
  });

  it('exposes the flash position during phase A', async () => {
    const { runner, plan } = setup();
    runner.start();
    expect(runner.state.flashPosition).toBe(plan.steps[0].position);
  });

  it('does not open the mic during phase A', async () => {
    const { runner, listener } = setup();
    runner.start();
    expect(listener.sessions).toBe(0);
  });

  it('opens the mic on the first tick, entering phase B', async () => {
    const { runner, listener } = setup();
    runner.start();
    runner.tick();
    expect(runner.state.phase).toBe('B');
    expect(listener.sessions).toBe(1);
  });

  it('closes the mic and advances to the next step on the second tick', async () => {
    const { runner, plan, speaker } = setup();
    runner.start();
    runner.tick(); // A -> B
    runner.tick(); // B -> next step A
    expect(runner.state).toMatchObject({ stepIndex: 1, phase: 'A' });
    expect(speaker.spoken).toEqual([
      plan.steps[0].question!.q,
      plan.steps[1].question!.q,
    ]);
  });

  it('speaks nothing on trailing recall-only steps', async () => {
    const { runner, speaker, plan } = setup(2);
    runner.start();
    // Advance through all 9 stimulus steps (2 ticks each).
    for (let i = 0; i < 9 * 2; i++) runner.tick();
    expect(runner.state.stepIndex).toBe(9);
    expect(speaker.spoken).toHaveLength(9);
    expect(runner.state.flashPosition).toBeNull();
    expect(plan.steps[9].question).toBeNull();
  });

  it('finishes after 9 + N steps', async () => {
    const { runner } = setup(2);
    runner.start();
    for (let i = 0; i < 11 * 2; i++) runner.tick();
    expect(runner.finished).toBe(true);
    expect(runner.state.phase).toBe('done');
  });
});

describe('RoundRunner utterance overlap', () => {
  it('advances the step state without waiting for the utterance to finish', () => {
    const speaker = new SlowFakeSpeaker();
    const { runner, plan } = setup(2, speaker);

    runner.start();
    expect(speaker.pending).toBe(1); // step 0 still being spoken
    expect(runner.state.flashPosition).toBe(plan.steps[0].position);

    runner.tick(); // step 0 A -> B
    runner.tick(); // step 0 closes, step 1 phase A

    // The new step is already painted even though no utterance ever finished.
    expect(runner.state).toMatchObject({ stepIndex: 1, phase: 'A' });
    expect(runner.state.flashPosition).toBe(plan.steps[1].position);
    expect(speaker.spoken).toEqual([
      plan.steps[0].question!.q,
      plan.steps[1].question!.q,
    ]);
  });

  it('reaches the end of the round with every utterance still unresolved', () => {
    // tick() itself never blocks; only readyToClose() does. A caller that
    // ignores the gate must still drive the machine to completion.
    const speaker = new SlowFakeSpeaker();
    const { runner } = setup(2, speaker);
    runner.start();
    for (let i = 0; i < 11 * 2; i++) runner.tick();
    expect(runner.finished).toBe(true);
    expect(speaker.pending).toBe(9);
  });

  it('silences the synthesizer before the mic opens', () => {
    const speaker = new SlowFakeSpeaker();
    const { runner, listener } = setup(2, speaker);
    runner.start();
    expect(speaker.stopped).toBe(0);
    runner.tick(); // phase A -> B
    expect(speaker.stopped).toBe(1);
    expect(listener.sessions).toBe(1);
  });
});

describe('RoundRunner phase A closing', () => {
  /** Whether a promise has settled, without blocking on it. */
  async function settled(promise: Promise<void>): Promise<boolean> {
    let done = false;
    void promise.then(() => {
      done = true;
    });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    return done;
  }

  it('holds phase A open until the question has actually been said', async () => {
    const speaker = new SlowFakeSpeaker();
    const { runner } = setup(2, speaker);
    runner.start();

    expect(await settled(runner.readyToClose())).toBe(false);

    speaker.resolveSpeak();
    await runner.readyToClose();
    expect(await settled(runner.readyToClose())).toBe(true);
  });

  it('closes phase B on its timer alone, never on the speech', async () => {
    const speaker = new SlowFakeSpeaker();
    const { runner } = setup(2, speaker);
    runner.start();
    speaker.resolveSpeak();
    await runner.readyToClose();
    runner.tick(); // -> phase B

    // The next question is not spoken yet, but even a lingering utterance
    // must not extend the answer window.
    expect(await settled(runner.readyToClose())).toBe(true);
  });

  it('closes a silent recall-only phase A immediately', async () => {
    const speaker = new SlowFakeSpeaker();
    const { runner, plan } = setup(2, speaker);
    runner.start();
    for (let i = 0; i < 9 * 2; i++) runner.tick(); // into the trailing steps
    expect(plan.steps[9].question).toBeNull();
    expect(await settled(runner.readyToClose())).toBe(true);
  });

  it('caps a never-settling utterance with the watchdog so the round proceeds', async () => {
    jest.useFakeTimers();
    try {
      const speaker = new SlowFakeSpeaker();
      const { runner, listener, plan } = setup(2, speaker);
      runner.start();
      const timeout = speakTimeoutMs(plan.steps[0].question!.q);

      let closed = false;
      void runner.readyToClose().then(() => {
        closed = true;
      });

      await jest.advanceTimersByTimeAsync(timeout - 1);
      expect(closed).toBe(false);
      expect(listener.sessions).toBe(0); // mic still shut during phase A

      await jest.advanceTimersByTimeAsync(2);
      expect(closed).toBe(true);

      runner.tick();
      expect(speaker.stopped).toBe(1); // the runaway utterance is cut off
      expect(listener.sessions).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  /**
   * The bug this guards: a long scenario-style question (the deep-dive
   * series runs some to ~90 characters) can genuinely take well over the old
   * flat 10s to finish on real ja-JP TTS. A watchdog sized for a short
   * question fired on that ordinary, unhurried speech and cut it off
   * mid-sentence — which reads as the round silently skipping ahead while
   * the question is still being read.
   */
  it('gives a long question more time before the watchdog fires', async () => {
    jest.useFakeTimers();
    try {
      const longQuestion: Question = {
        id: 'long',
        tier: 1,
        q: '融資担当者はLPプールの平均信用力が高いことに安心していたが、フィッチのPCMではストレスが強まるほど相関係数が上昇する設計だと知った',
        accept: ['答え'],
      };
      const bank = [longQuestion, ...BANK];
      const speaker = new SlowFakeSpeaker();
      const plan = buildRound(2, bank, () => 0); // deterministic: draws index 0 first
      const engine = new RoundEngine(plan);
      const listener = new FakeListener();
      const runner = new RoundRunner({
        plan,
        engine,
        speaker,
        listener,
        onJudge: () => {},
      });
      runner.start();
      expect(plan.steps[0].question).toBe(longQuestion);

      let closed = false;
      void runner.readyToClose().then(() => {
        closed = true;
      });

      // Past the old flat 10s ceiling, but the question is still genuinely
      // being spoken — must not have been cut off yet.
      await jest.advanceTimersByTimeAsync(SPEAK_TIMEOUT_MS + 1_000);
      expect(closed).toBe(false);
      expect(speaker.stopped).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('settles the utterance handle once the speech finishes', async () => {
    const speaker = new SlowFakeSpeaker();
    const { runner } = setup(2, speaker);
    runner.start();

    let settled = false;
    void runner.utterance.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    speaker.resolveSpeak();
    await runner.utterance;
    expect(settled).toBe(true);
  });

  it('settles the utterance handle when the synthesizer never calls back', async () => {
    jest.useFakeTimers();
    try {
      const speaker = new SlowFakeSpeaker();
      const { runner, plan } = setup(2, speaker);
      runner.start();
      const timeout = speakTimeoutMs(plan.steps[0].question!.q);

      let settled = false;
      void runner.utterance.then(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(timeout + 1);
      expect(settled).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('RoundRunner scoring integration', () => {
  it('submits the tap taken during the step to the engine', async () => {
    const { runner, engine, plan } = setup(2);
    runner.start();
    runner.tick(); // step 0 B
    runner.tick(); // step 1 A
    runner.tick(); // step 1 B
    runner.tick(); // step 2 A  (first scored step)
    runner.onTap(plan.steps[0].position!);
    runner.tick(); // step 2 B
    runner.tick(); // step 2 closes
    expect(engine.positionScore).toBeCloseTo(1 / 9);
  });

  it('accepts a tap during phase B as well as phase A', async () => {
    const { runner, engine, plan } = setup(2);
    runner.start();
    for (let i = 0; i < 4; i++) runner.tick(); // into step 2 phase A
    runner.tick(); // step 2 phase B
    runner.onTap(plan.steps[0].position!);
    runner.tick(); // step 2 closes
    expect(engine.positionScore).toBeCloseTo(1 / 9);
  });

  it('sends the heard transcript for judging when a step closes', async () => {
    const { runner, listener, judged, plan } = setup(2);
    runner.start();
    for (let i = 0; i < 5; i++) runner.tick(); // into step 2 phase B
    listener.push('わん');
    runner.tick(); // step 2 closes
    expect(judged).toHaveLength(1);
    expect(judged[0].index).toBe(2);
    expect(judged[0].transcript).toBe('わん');
    expect(judged[0].question).toBe(plan.steps[0].question);
  });

  it('queues nothing for judging when the user said nothing', async () => {
    const { runner, judged } = setup(2);
    runner.start();
    for (let i = 0; i < 6; i++) runner.tick();
    expect(judged).toHaveLength(0);
  });

  it('clears the tap between steps', async () => {
    const { runner, engine, plan } = setup(2);
    runner.start();
    for (let i = 0; i < 4; i++) runner.tick(); // step 2 phase A
    runner.onTap(plan.steps[0].position!);
    runner.tick();
    runner.tick(); // step 2 closes, correct
    runner.tick(); // step 3 phase B, no tap this time
    runner.tick(); // step 3 closes
    expect(engine.positionScore).toBeCloseTo(1 / 9);
  });
});

describe('RoundRunner phase B closing', () => {
  function lateSetup(canned: string | null = null) {
    const plan = buildRound(2, BANK, Math.random);
    const engine = new RoundEngine(plan);
    const listener = new LateFinalListener(canned);
    const judged: PendingAnswer[] = [];
    const runner = new RoundRunner({
      plan,
      engine,
      speaker: new FakeSpeaker(),
      listener,
      onJudge: (a) => judged.push(a),
    });
    return { plan, engine, listener, runner, judged };
  }

  it('holds phase B open until the recognizer has settled', async () => {
    const { runner, listener } = lateSetup();
    runner.start();
    runner.tick(); // into phase B, mic open

    let closed = false;
    void runner.readyToClose().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(listener.settles).toBe(1);
    expect(closed).toBe(false);

    listener.deliverFinal('わんわん');
    await Promise.resolve();
    await Promise.resolve();
    expect(closed).toBe(true);
  });

  it('captures a transcript that only arrives once the session is asked to finish', async () => {
    // The bug this guards: the round used to read the transcript on its own
    // clock, so the answer the owner actually gave was recorded as 聞き取れず.
    const { runner, judged } = lateSetup('わんわん');
    runner.start();

    // Step 2 is the first scored step at N=2.
    for (let step = 0; step < 3; step++) {
      runner.tick(); // A -> B
      await runner.readyToClose();
      runner.tick(); // B -> next A
      await runner.readyToClose();
    }

    expect(judged).toHaveLength(1);
    expect(judged[0]).toMatchObject({ index: 2, transcript: 'わんわん' });
  });

  it('does not settle the listener while phase A is open', async () => {
    const { runner, listener } = lateSetup('わんわん');
    runner.start();
    await runner.readyToClose();
    expect(listener.settles).toBe(0);
  });
});

describe('RoundRunner answer window timing', () => {
  it('records on-time when the answer window duration is within budget', () => {
    let now = 0;
    const plan = buildRound(1, BANK, () => 0);
    const engine = new RoundEngine(plan);
    const runner = new RoundRunner({
      plan,
      engine,
      speaker: new FakeSpeaker(),
      listener: new FakeListener(),
      onJudge: () => {},
      clock: () => now,
    });

    runner.start();
    now = 1000;
    runner.tick();   // A -> B, window opens at 1000
    now = 4500;
    runner.tick();   // B closes at 4500
    now = 5000;
    runner.tick();   // A -> B for step 1, opens at 5000
    now = 6000;
    runner.tick();   // B closes at 6000, elapsed = 1000ms

    const rows = engine.review;
    expect(rows[0].index).toBe(1);
    // Step 1 is the first scored step at n=1. BANK has accept values like
    // "答え0", "答え1", ... which are 3-4 code points each, budgeting 7000-8000ms.
    // At 1000ms elapsed, well within budget, onTime should be true.
    expect(rows[0].onTime).toBe(true);
  });

  it('records late when the answer window duration exceeds budget', () => {
    let now = 0;
    const plan = buildRound(1, BANK, () => 0);
    const engine = new RoundEngine(plan);
    const runner = new RoundRunner({
      plan,
      engine,
      speaker: new FakeSpeaker(),
      listener: new FakeListener(),
      onJudge: () => {},
      clock: () => now,
    });

    runner.start();
    now = 1000;
    runner.tick();   // A -> B, window opens at 1000
    now = 4500;
    runner.tick();   // B closes at 4500
    now = 5000;
    runner.tick();   // A -> B for step 1, opens at 5000
    now = 14000;
    runner.tick();   // B closes at 14000, elapsed = 9000ms

    const rows = engine.review;
    expect(rows[0].index).toBe(1);
    // With 9000ms elapsed, exceeding any budget from BANK's accept values
    // (maximum ~8000ms for "答え19"), onTime should be false.
    expect(rows[0].onTime).toBe(false);
  });

  /** Without a clock the engine must see no elapsed time at all. */
  it('leaves the window untimed when no clock is given', () => {
    const plan = buildRound(1, BANK, () => 0);
    const engine = new RoundEngine(plan);
    const runner = new RoundRunner({
      plan,
      engine,
      speaker: new FakeSpeaker(),
      listener: new FakeListener(),
      onJudge: () => {},
    });

    runner.start();
    runner.tick();
    runner.tick();
    runner.tick();
    runner.tick();

    expect(engine.review.every((row) => row.onTime === null)).toBe(true);
  });
});

/**
 * Typed mode has no microphone, so the reason for the two-phase split — never
 * letting the recognizer hear the synthesizer — does not apply. `merged` puts
 * the question and the answer window in the same phase.
 */
describe('RoundRunner merged steps', () => {
  function mergedSetup(
    n = 2,
    speaker: FakeSpeaker | SlowFakeSpeaker = new FakeSpeaker(),
  ) {
    const plan = buildRound(n, BANK, Math.random);
    const engine = new RoundEngine(plan);
    const listener = new FakeListener();
    const runner = new RoundRunner({
      plan,
      engine,
      speaker,
      listener,
      onJudge: () => {},
      merged: true,
    });
    return { plan, engine, speaker, listener, runner };
  }

  it('opens the answer window in the same breath as the question', () => {
    const { runner, listener, speaker, plan } = mergedSetup();
    runner.start();
    expect(runner.state).toMatchObject({ stepIndex: 0, phase: 'AB' });
    expect(speaker.spoken).toEqual([plan.steps[0].question!.q]);
    expect(listener.sessions).toBe(1);
  });

  it('keeps the block lit for the whole step, not just its first half', () => {
    const { runner, plan } = mergedSetup();
    runner.start();
    expect(runner.state.flashPosition).toBe(plan.steps[0].position);
  });

  it('closes the whole step on a single tick', () => {
    const { runner, listener, plan, speaker } = mergedSetup();
    runner.start();
    runner.tick();
    expect(runner.state).toMatchObject({ stepIndex: 1, phase: 'AB' });
    expect(listener.sessions).toBe(2);
    expect(speaker.spoken).toEqual([
      plan.steps[0].question!.q,
      plan.steps[1].question!.q,
    ]);
  });

  it('finishes after 9 + N ticks rather than twice that', () => {
    const { runner } = mergedSetup(2);
    runner.start();
    for (let i = 0; i < 11; i++) runner.tick();
    expect(runner.finished).toBe(true);
  });

  /** Whether a promise has settled, without blocking on it. */
  async function settled(promise: Promise<void>): Promise<boolean> {
    let done = false;
    void promise.then(() => {
      done = true;
    });
    for (let i = 0; i < 4; i++) await Promise.resolve();
    return done;
  }

  /**
   * The reason phase A used to wait out the utterance has not gone away: a
   * question clipped mid-way is unanswerable N steps later. Answering fast
   * must not be able to cut it off.
   */
  /** The real listener of this mode: settle() resolves when 送る is pressed. */
  function typedSetup(speaker: FakeSpeaker | SlowFakeSpeaker) {
    const plan = buildRound(2, BANK, Math.random);
    const listener = new TypedListener();
    const runner = new RoundRunner({
      plan,
      engine: new RoundEngine(plan),
      speaker,
      listener,
      onJudge: () => {},
      merged: true,
    });
    return { runner, listener };
  }

  it('will not close on the answer alone while the question is still being said', async () => {
    const speaker = new SlowFakeSpeaker();
    const { runner, listener } = typedSetup(speaker);
    runner.start();

    listener.push('こたえ');
    listener.submit(); // 送る
    expect(await settled(runner.readyToClose())).toBe(false);

    speaker.resolveSpeak();
    expect(await settled(runner.readyToClose())).toBe(true);
  });

  it('will not close on the question alone while the answer is still owed', async () => {
    const { runner, listener } = typedSetup(new FakeSpeaker());
    runner.start();
    expect(await settled(runner.readyToClose())).toBe(false);
    listener.submit();
    expect(await settled(runner.readyToClose())).toBe(true);
  });

  it('times the window from the step opening, not from a phase B that never comes', () => {
    let now = 0;
    const plan = buildRound(1, BANK, () => 0);
    const engine = new RoundEngine(plan);
    const runner = new RoundRunner({
      plan,
      engine,
      speaker: new FakeSpeaker(),
      listener: new FakeListener(),
      onJudge: () => {},
      clock: () => now,
      merged: true,
    });

    runner.start();          // step 0 opens at 0
    now = 3000;
    runner.tick();           // step 0 closes; step 1 opens at 3000
    now = 20_000;
    runner.tick();           // step 1 closes: 17s on a step that owes an answer

    const rows = engine.review;
    expect(rows[0].index).toBe(1);
    expect(rows[0].onTime).toBe(false);
  });
});

/**
 * The warm-up tap unlocks the synthesizer and starts the round in the same
 * breath. A stop() anywhere between the two cancels the unlock utterance,
 * and iOS goes silent for the whole round.
 */
describe('RoundRunner start', () => {
  it.each([false, true])('never silences the synthesizer on start (merged: %s)', (merged) => {
    const plan = buildRound(2, BANK, Math.random);
    const speaker = new FakeSpeaker();
    const runner = new RoundRunner({
      plan,
      engine: new RoundEngine(plan),
      speaker,
      listener: new FakeListener(),
      onJudge: () => {},
      merged,
    });
    runner.start();
    expect(speaker.stopped).toBe(0);
  });
});
