import { RoundEngine } from '../round';
import { buildRound } from '../sequence';
import type { Question, Rng, RoundPlan } from '../types';

const BANK: Question[] = Array.from({ length: 20 }, (_, i) => ({
  id: `q${i}`,
  tier: 1,
  q: `質問${i}`,
  accept: [`答え${i}`],
}));

function plan(n = 2): RoundPlan {
  return buildRound(n, BANK, Math.random);
}

/**
 * buildRound draws position then question per stimulus step. This hands it
 * 0/9, 1/9, 2/9 … so the 9 stimuli occupy 9 *distinct* cells — the lag tests
 * below are only meaningful when the current and the N-back position differ,
 * and under Math.random they collide about 11% of the time.
 */
function distinctPositionsRng(): Rng {
  let call = 0;
  return () => {
    const isPositionDraw = call % 2 === 0;
    const step = Math.floor(call / 2);
    call++;
    return isPositionDraw ? step / 9 : 0;
  };
}

/** Submit every scored step with a correct tap and some transcript. */
function submitAllCorrectTaps(engine: RoundEngine, p: RoundPlan) {
  for (const step of p.steps) {
    if (step.recallTarget === null) {
      engine.submitStep(step.index, { tap: null, transcript: null });
      continue;
    }
    engine.submitStep(step.index, {
      tap: p.steps[step.recallTarget].position,
      transcript: 'こたえ',
    });
  }
}

describe('RoundEngine position scoring', () => {
  it('scores a tap against the stimulus N steps back, not the current one', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    expect(engine.positionScore).toBe(1);
  });

  it('marks a tap wrong when it matches the current step instead of the lagged one', () => {
    const p = buildRound(2, BANK, distinctPositionsRng());
    expect(p.steps[2].position).not.toBe(p.steps[0].position);

    const engine = new RoundEngine(p);
    // Step 2 recalls step 0. Tap step 2's own position instead.
    engine.submitStep(2, { tap: p.steps[2].position, transcript: null });
    expect(engine.positionScore).toBe(0);
  });

  it('divides by 9 scored steps, not by total steps', () => {
    const p = plan(3); // 12 total steps, 9 scored
    const engine = new RoundEngine(p);
    let done = 0;
    for (const step of p.steps) {
      if (step.recallTarget === null) continue;
      if (done++ >= 3) break;
      engine.submitStep(step.index, {
        tap: p.steps[step.recallTarget].position,
        transcript: null,
      });
    }
    expect(engine.positionScore).toBeCloseTo(3 / 9);
  });

  it('counts a null tap as wrong', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    engine.submitStep(2, { tap: null, transcript: null });
    expect(engine.positionScore).toBe(0);
  });

  it('rejects submitting the same step twice', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    engine.submitStep(2, { tap: 0, transcript: null });
    expect(() => engine.submitStep(2, { tap: 0, transcript: null })).toThrow(
      /already submitted/,
    );
  });
});

describe('RoundEngine answer scoring', () => {
  it('reports pending answers for scored steps that produced a transcript', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    const pending = engine.takePending();
    expect(pending).toHaveLength(9);
    expect(pending[0].question).toBe(p.steps[p.steps[2].recallTarget!].question);
    expect(engine.takePending()).toHaveLength(0); // buffer cleared
  });

  it('does not queue an answer when the user said nothing', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    engine.submitStep(2, { tap: 0, transcript: null });
    expect(engine.takePending()).toHaveLength(0);
  });

  it('returns null for the answer score before anything resolves', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    expect(engine.answerScore).toBeNull();
  });

  it('divides by resolved answers only, excluding 未判定', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    const pending = engine.takePending();
    engine.resolveAnswer(pending[0].index, true);
    engine.resolveAnswer(pending[1].index, true);
    engine.resolveAnswer(pending[2].index, false);
    // 3 resolved, 2 correct. The other 6 are 未判定 and must not count.
    expect(engine.answerScore).toBeCloseTo(2 / 3);
    expect(engine.unresolvedCount).toBe(6);
  });

  it('accepts verdicts in any order and after the round has ended', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    const pending = engine.takePending();
    engine.resolveAnswer(pending[8].index, true);
    engine.resolveAnswer(pending[0].index, true);
    expect(engine.answerScore).toBe(1);
  });

  it('ignores a verdict for a step that was never queued', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    engine.resolveAnswer(5, true);
    expect(engine.answerScore).toBeNull();
  });
});

describe('RoundEngine round score', () => {
  it('averages both channels when answers resolved', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p); // position 1.0
    const pending = engine.takePending();
    for (const a of pending) engine.resolveAnswer(a.index, false); // answers 0.0
    expect(engine.roundScore).toBeCloseTo(0.5);
  });

  it('falls back to the position score alone when nothing resolved', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    expect(engine.roundScore).toBe(1);
  });

  it('feeds the round score into the adaptive rule', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    expect(engine.nextN(2)).toBe(3);
  });
});
