import { RoundEngine } from '../round';
import { RoundRunner } from '../runner';
import { buildRound } from '../sequence';
import { FakeListener, FakeSpeaker } from '../../speech/fakes';
import type { PendingAnswer } from '../round';
import type { Question } from '../types';

const BANK: Question[] = Array.from({ length: 20 }, (_, i) => ({
  id: `q${i}`,
  tier: 1,
  q: `質問${i}`,
  accept: [`答え${i}`],
}));

function setup(n = 2) {
  const plan = buildRound(n, BANK, Math.random);
  const engine = new RoundEngine(plan);
  const speaker = new FakeSpeaker();
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
    await runner.start();
    expect(runner.state).toMatchObject({ stepIndex: 0, phase: 'A' });
    expect(speaker.spoken).toEqual([plan.steps[0].question!.q]);
  });

  it('exposes the flash position during phase A', async () => {
    const { runner, plan } = setup();
    await runner.start();
    expect(runner.state.flashPosition).toBe(plan.steps[0].position);
  });

  it('does not open the mic during phase A', async () => {
    const { runner, listener } = setup();
    await runner.start();
    expect(listener.sessions).toBe(0);
  });

  it('opens the mic on the first tick, entering phase B', async () => {
    const { runner, listener } = setup();
    await runner.start();
    await runner.tick();
    expect(runner.state.phase).toBe('B');
    expect(listener.sessions).toBe(1);
  });

  it('closes the mic and advances to the next step on the second tick', async () => {
    const { runner, plan, speaker } = setup();
    await runner.start();
    await runner.tick(); // A -> B
    await runner.tick(); // B -> next step A
    expect(runner.state).toMatchObject({ stepIndex: 1, phase: 'A' });
    expect(speaker.spoken).toEqual([
      plan.steps[0].question!.q,
      plan.steps[1].question!.q,
    ]);
  });

  it('speaks nothing on trailing recall-only steps', async () => {
    const { runner, speaker, plan } = setup(2);
    await runner.start();
    // Advance through all 9 stimulus steps (2 ticks each).
    for (let i = 0; i < 9 * 2; i++) await runner.tick();
    expect(runner.state.stepIndex).toBe(9);
    expect(speaker.spoken).toHaveLength(9);
    expect(runner.state.flashPosition).toBeNull();
    expect(plan.steps[9].question).toBeNull();
  });

  it('finishes after 9 + N steps', async () => {
    const { runner } = setup(2);
    await runner.start();
    for (let i = 0; i < 11 * 2; i++) await runner.tick();
    expect(runner.finished).toBe(true);
    expect(runner.state.phase).toBe('done');
  });
});

describe('RoundRunner scoring integration', () => {
  it('submits the tap taken during the step to the engine', async () => {
    const { runner, engine, plan } = setup(2);
    await runner.start();
    await runner.tick(); // step 0 B
    await runner.tick(); // step 1 A
    await runner.tick(); // step 1 B
    await runner.tick(); // step 2 A  (first scored step)
    runner.onTap(plan.steps[0].position!);
    await runner.tick(); // step 2 B
    await runner.tick(); // step 2 closes
    expect(engine.positionScore).toBeCloseTo(1 / 9);
  });

  it('accepts a tap during phase B as well as phase A', async () => {
    const { runner, engine, plan } = setup(2);
    await runner.start();
    for (let i = 0; i < 4; i++) await runner.tick(); // into step 2 phase A
    await runner.tick(); // step 2 phase B
    runner.onTap(plan.steps[0].position!);
    await runner.tick(); // step 2 closes
    expect(engine.positionScore).toBeCloseTo(1 / 9);
  });

  it('sends the heard transcript for judging when a step closes', async () => {
    const { runner, listener, judged, plan } = setup(2);
    await runner.start();
    for (let i = 0; i < 5; i++) await runner.tick(); // into step 2 phase B
    listener.push('わん');
    await runner.tick(); // step 2 closes
    expect(judged).toHaveLength(1);
    expect(judged[0].index).toBe(2);
    expect(judged[0].transcript).toBe('わん');
    expect(judged[0].question).toBe(plan.steps[0].question);
  });

  it('queues nothing for judging when the user said nothing', async () => {
    const { runner, judged } = setup(2);
    await runner.start();
    for (let i = 0; i < 6; i++) await runner.tick();
    expect(judged).toHaveLength(0);
  });

  it('clears the tap between steps', async () => {
    const { runner, engine, plan } = setup(2);
    await runner.start();
    for (let i = 0; i < 4; i++) await runner.tick(); // step 2 phase A
    runner.onTap(plan.steps[0].position!);
    await runner.tick();
    await runner.tick(); // step 2 closes, correct
    await runner.tick(); // step 3 phase B, no tap this time
    await runner.tick(); // step 3 closes
    expect(engine.positionScore).toBeCloseTo(1 / 9);
  });
});
