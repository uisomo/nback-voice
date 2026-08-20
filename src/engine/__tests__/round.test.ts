import { RoundEngine } from '../round';
import { buildRound } from '../sequence';
import type { Question, Rng, RoundPlan } from '../types';
import { DEFAULT_BUDGET_BASE_MS } from '../budget';

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

describe('RoundEngine in question mode', () => {
  function questionPlan(n = 2) {
    return buildRound(n, BANK, Math.random, 'question');
  }

  it('reports no position channel', () => {
    const p = questionPlan();
    const engine = new RoundEngine(p);
    for (const step of p.steps) {
      engine.submitStep(step.index, { tap: null, transcript: 'こたえ' });
    }
    expect(engine.positionScore).toBeNull();
  });

  it('scores the round on the answer channel alone', () => {
    const p = questionPlan();
    const engine = new RoundEngine(p);
    for (const step of p.steps) {
      engine.submitStep(step.index, { tap: null, transcript: 'こたえ' });
    }
    const pending = engine.takePending();
    pending.forEach((a, i) => engine.resolveAnswer(a.index, i < 6));
    // 6 of 9 correct; the position channel must not dilute it.
    expect(engine.answerScore).toBeCloseTo(6 / 9);
    expect(engine.roundScore).toBeCloseTo(6 / 9);
  });

  it('ignores taps entirely', () => {
    const p = questionPlan();
    const engine = new RoundEngine(p);
    for (const step of p.steps) {
      engine.submitStep(step.index, { tap: 4, transcript: null });
    }
    expect(engine.positionScore).toBeNull();
    expect(engine.roundScore).toBeNull();
  });

  it('has no round score when both channels are absent', () => {
    const p = questionPlan();
    const engine = new RoundEngine(p);
    for (const step of p.steps) {
      engine.submitStep(step.index, { tap: null, transcript: 'こたえ' });
    }
    // Nothing resolved: answers all 未判定, position absent by mode.
    expect(engine.roundScore).toBeNull();
    expect(engine.unresolvedCount).toBe(9);
  });

  it('leaves N unchanged when there is no round score', () => {
    const p = questionPlan();
    const engine = new RoundEngine(p);
    expect(engine.nextN(3)).toBe(3);
  });

  it('still adapts N from the answer channel alone', () => {
    const p = questionPlan();
    const engine = new RoundEngine(p);
    for (const step of p.steps) {
      engine.submitStep(step.index, { tap: null, transcript: 'こたえ' });
    }
    for (const a of engine.takePending()) engine.resolveAnswer(a.index, true);
    expect(engine.roundScore).toBe(1);
    expect(engine.nextN(2)).toBe(3);
  });
});

describe('RoundEngine in dual mode (unchanged)', () => {
  it('still returns a number for the position channel', () => {
    const p = buildRound(2, BANK, Math.random);
    const engine = new RoundEngine(p);
    expect(engine.positionScore).toBe(0);
    expect(p.mode).toBe('dual');
  });
});

describe('RoundEngine answer review', () => {
  it('has one row per scored step, in step order', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    expect(engine.review.map((r) => r.index)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('carries the recalled question, not the one asked on this step', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    // Step 2 recalls step 0 at N=2.
    expect(engine.review[0].question.id).toBe(p.steps[0].question!.id);
  });

  it('reports what was heard and the verdict once it lands', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    submitAllCorrectTaps(engine, p);
    const pending = engine.takePending();
    engine.resolveAnswer(pending[0].index, true);
    engine.resolveAnswer(pending[1].index, false);

    expect(engine.review[0]).toMatchObject({
      transcript: 'こたえ',
      correct: true,
    });
    expect(engine.review[1]).toMatchObject({
      transcript: 'こたえ',
      correct: false,
    });
    // No verdict yet: 未判定, not wrong.
    expect(engine.review[2].correct).toBeNull();
  });

  it('distinguishes 聞き取れず from 未判定', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    for (const step of p.steps) {
      const heard = step.index === 2 ? null : 'こたえ';
      engine.submitStep(step.index, {
        tap: null,
        transcript: step.recallTarget === null ? null : heard,
      });
    }
    // Nothing was recognised on step 2 — no transcript at all.
    expect(engine.review[0].transcript).toBeNull();
    // Step 3 was heard but never graded.
    expect(engine.review[1]).toMatchObject({ transcript: 'こたえ', correct: null });
  });

  it('does not count a step nobody heard as 未判定', () => {
    const p = plan(2);
    const engine = new RoundEngine(p);
    for (const step of p.steps) {
      engine.submitStep(step.index, { tap: null, transcript: null });
    }
    // Review still lists all 9, but the score channels stay empty.
    expect(engine.review).toHaveLength(9);
    expect(engine.unresolvedCount).toBe(0);
    expect(engine.answerScore).toBeNull();
  });

  it('reports the position outcome per step', () => {
    const p = buildRound(2, BANK, distinctPositionsRng());
    const engine = new RoundEngine(p);
    // Step 2 recalls step 0: tap it right.
    engine.submitStep(2, { tap: p.steps[0].position, transcript: null });
    // Step 3 recalls step 1: tap the wrong cell.
    engine.submitStep(3, { tap: p.steps[3].position, transcript: null });
    // Step 4: no tap at all.
    engine.submitStep(4, { tap: null, transcript: null });

    expect(engine.review[0].position).toBe('correct');
    expect(engine.review[1].position).toBe('wrong');
    expect(engine.review[2].position).toBe('none');
  });

  it('has no position outcome in question mode', () => {
    const p = buildRound(2, BANK, Math.random, 'question');
    const engine = new RoundEngine(p);
    for (const step of p.steps) {
      engine.submitStep(step.index, { tap: 4, transcript: 'こたえ' });
    }
    for (const row of engine.review) expect(row.position).toBeNull();
  });
});

describe('RoundEngine timing', () => {
  /** A plan whose every answer is 4 characters, so the budget is 8000ms. */
  const TIMED_BANK: Question[] = Array.from({ length: 12 }, (_, i) => ({
    id: `t${i}`,
    tier: 1,
    q: `質問${i}`,
    accept: ['よんもじ'],
  }));

  function timedEngine(elapsed: (index: number) => number | undefined) {
    const plan = buildRound(1, TIMED_BANK, () => 0);
    const engine = new RoundEngine(plan, { budgetBaseMs: 4000 });
    for (const step of plan.steps) {
      if (step.recallTarget === null) {
        engine.submitStep(step.index, { tap: null, transcript: null });
        continue;
      }
      engine.submitStep(step.index, {
        tap: plan.steps[step.recallTarget].position,
        transcript: 'よんもじ',
        elapsedMs: elapsed(step.index),
      });
    }
    return engine;
  }

  it('derives the budget from the recalled answer, not the shown question', () => {
    const engine = timedEngine(() => 1000);
    for (const row of engine.review) expect(row.budgetMs).toBe(8000);
  });

  it('marks an answer inside its budget as on time', () => {
    const engine = timedEngine(() => 7999);
    expect(engine.review.every((row) => row.onTime === true)).toBe(true);
    expect(engine.onTimeScore).toBe(1);
  });

  it('counts the boundary as on time', () => {
    const engine = timedEngine(() => 8000);
    expect(engine.review.every((row) => row.onTime === true)).toBe(true);
  });

  it('marks an answer past its budget as late, without failing it', () => {
    const engine = timedEngine(() => 8001);
    expect(engine.review.every((row) => row.onTime === false)).toBe(true);
    expect(engine.onTimeScore).toBe(0);
    // Late is late, not wrong: the answer channel is untouched.
    for (const row of engine.review) engine.resolveAnswer(row.index, true);
    expect(engine.answerScore).toBe(1);
  });

  /** No elapsed time means no clock, which means nothing to say — not zero. */
  it('reports null when no step was timed', () => {
    const engine = timedEngine(() => undefined);
    expect(engine.review.every((row) => row.onTime === null)).toBe(true);
    expect(engine.onTimeScore).toBeNull();
  });

  it('scores on time out of every scored step, like position does', () => {
    // n=1, so the 9 scored steps carry step.index 1..9 (index 0 is the
    // unscored lead-in). The first 5 of those — index 1..5 — land on time,
    // the remaining 4 are late.
    const engine = timedEngine((index) => (index <= 5 ? 1000 : 99999));
    expect(engine.onTimeScore).toBeCloseTo(5 / 9);
  });

  it('defaults the base to 4 seconds when none is given', () => {
    const plan = buildRound(1, TIMED_BANK, () => 0);
    const engine = new RoundEngine(plan);
    engine.submitStep(0, { tap: null, transcript: null });
    engine.submitStep(1, { tap: null, transcript: 'よんもじ', elapsedMs: 1 });
    expect(engine.review[0].budgetMs).toBe(DEFAULT_BUDGET_BASE_MS + 4000);
  });

  /** The promise of §6: time is reported, never adaptive input. */
  it('does not let lateness move roundScore or N', () => {
    const onTime = timedEngine(() => 1000);
    const late = timedEngine(() => 99999);
    for (const row of onTime.review) onTime.resolveAnswer(row.index, true);
    for (const row of late.review) late.resolveAnswer(row.index, true);

    expect(late.roundScore).toBe(onTime.roundScore);
    expect(late.nextN(2)).toBe(onTime.nextN(2));
  });
});
