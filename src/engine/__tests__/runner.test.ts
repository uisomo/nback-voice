import { RoundEngine } from '../round';
import { RoundRunner, SPEAK_TIMEOUT_MS } from '../runner';
import { buildRound } from '../sequence';
import {
  FakeListener,
  FakeSpeaker,
  LateFinalListener,
  SlowFakeSpeaker,
} from '../../speech/fakes';
import type { PendingAnswer } from '../round';
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
      const { runner, listener } = setup(2, speaker);
      runner.start();

      let closed = false;
      void runner.readyToClose().then(() => {
        closed = true;
      });

      await jest.advanceTimersByTimeAsync(SPEAK_TIMEOUT_MS - 1);
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
      const { runner } = setup(2, speaker);
      runner.start();

      let settled = false;
      void runner.utterance.then(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(SPEAK_TIMEOUT_MS + 1);
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
  it('reports how long phase B took when given a clock', () => {
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
    runner.tick();

    const rows = engine.review;
    expect(rows[0].index).toBe(1);
    // Step 1 is the first scored step at n=1; its window ran 5000 -> 6000.
    expect(rows[0].onTime).not.toBeNull();
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
