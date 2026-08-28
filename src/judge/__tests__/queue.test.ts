import { JudgeQueue } from '../queue';
import type { JudgeClient, Verdict } from '../types';
import type { Question } from '../../engine/types';

const DOG: Question = {
  id: 'q042',
  tier: 2,
  q: '犬の鳴き声は？',
  accept: ['わん', 'わんわん'],
};

function makeQueue(client: JudgeClient) {
  const verdicts: Array<[number, boolean]> = [];
  const learned: Array<[string, string]> = [];
  const queue = new JudgeQueue(client, {
    onVerdict: (i, c) => verdicts.push([i, c]),
    onLearn: (id, a) => learned.push([id, a]),
  });
  return { queue, verdicts, learned };
}

const neverCalled: JudgeClient = {
  judge: async () => {
    throw new Error('should not have called the API');
  },
};

describe('JudgeQueue', () => {
  it('resolves a locally matched answer without calling the API', async () => {
    const { queue, verdicts } = makeQueue(neverCalled);
    queue.enqueue({ index: 2, question: DOG, transcript: 'ワンワン' });
    await queue.drain();
    expect(verdicts).toEqual([[2, true]]);
  });

  it('calls the API only when the local match misses', async () => {
    const calls: string[] = [];
    const client: JudgeClient = {
      judge: async (_q, t): Promise<Verdict> => {
        calls.push(t);
        return { correct: true, matched: 'わんこ' };
      },
    };
    const { queue, verdicts } = makeQueue(client);
    queue.enqueue({ index: 3, question: DOG, transcript: 'わんこ' });
    await queue.drain();
    expect(calls).toEqual(['わんこ']);
    expect(verdicts).toEqual([[3, true]]);
  });

  it('learns an accepted answer that was not in the bank', async () => {
    const client: JudgeClient = {
      judge: async (): Promise<Verdict> => ({ correct: true, matched: 'わんこ' }),
    };
    const { queue, learned } = makeQueue(client);
    queue.enqueue({ index: 3, question: DOG, transcript: 'わんこ' });
    await queue.drain();
    expect(learned).toEqual([['q042', 'わんこ']]);
  });

  /**
   * The bug this guards: verdict.matched is Claude restating what it
   * understood in whatever words it picks — not a phrasing anyone actually
   * typed or spoke. Learning it let an LLM paraphrase (e.g. "Subscription
   * Facility" for a bank entry that only ever said "Subscription Line") get
   * saved as a synonym nobody used, so the same term's spelling drifted over
   * time. Only what the owner actually said is real signal worth learning.
   */
  it('learns the transcript the owner actually gave, never the judge’s own paraphrase', async () => {
    const client: JudgeClient = {
      judge: async (): Promise<Verdict> => ({
        correct: true,
        matched: 'サブスクリプション・ファシリティ',
      }),
    };
    const { queue, learned } = makeQueue(client);
    queue.enqueue({
      index: 3,
      question: DOG,
      transcript: 'サブスクリプションライン',
    });
    await queue.drain();
    expect(learned).toEqual([['q042', 'サブスクリプションライン']]);
  });

  it('does not learn from a rejected answer', async () => {
    const client: JudgeClient = {
      judge: async (): Promise<Verdict> => ({ correct: false, matched: null }),
    };
    const { queue, learned, verdicts } = makeQueue(client);
    queue.enqueue({ index: 3, question: DOG, transcript: 'にゃー' });
    await queue.drain();
    expect(learned).toEqual([]);
    expect(verdicts).toEqual([[3, false]]);
  });

  it('leaves the answer 未判定 when the API fails — never marks it wrong', async () => {
    const client: JudgeClient = {
      judge: async () => {
        throw new Error('network down');
      },
    };
    const { queue, verdicts } = makeQueue(client);
    queue.enqueue({ index: 3, question: DOG, transcript: 'わんこ' });
    await queue.drain();
    expect(verdicts).toEqual([]);
  });

  it('does not disguise a throwing callback as 未判定', async () => {
    // .then().catch() would swallow this and leave the answer unresolved,
    // indistinguishable from a dead network. Only the API call's own rejection
    // means 未判定.
    const client: JudgeClient = {
      judge: async (): Promise<Verdict> => ({ correct: true, matched: null }),
    };
    const queue = new JudgeQueue(client, {
      onVerdict: () => {
        throw new Error('bug in the caller');
      },
      onLearn: () => {},
    });
    queue.enqueue({ index: 3, question: DOG, transcript: 'わんこ' });
    await expect(queue.drain()).rejects.toThrow('bug in the caller');
  });

  it('keeps grading later answers after one fails', async () => {
    let call = 0;
    const client: JudgeClient = {
      judge: async (): Promise<Verdict> => {
        call++;
        if (call === 1) throw new Error('network blip');
        return { correct: true, matched: null };
      },
    };
    const { queue, verdicts } = makeQueue(client);
    queue.enqueue({ index: 3, question: DOG, transcript: 'あ' });
    queue.enqueue({ index: 4, question: DOG, transcript: 'い' });
    await queue.drain();
    expect(verdicts).toEqual([[4, true]]);
  });

  it('passes the configured language to the judge client', async () => {
    const judged: Array<string | undefined> = [];
    const client: JudgeClient = {
      judge: async (_q, _t, language): Promise<Verdict> => {
        judged.push(language);
        return { correct: true, matched: null };
      },
    };
    const queue = new JudgeQueue(
      client,
      { onVerdict: () => {}, onLearn: () => {} },
      'en',
    );
    queue.enqueue({ index: 3, question: DOG, transcript: 'わんこ' });
    await queue.drain();
    expect(judged).toEqual(['en']);
  });

  it('defaults to ja when no language is given to the constructor', async () => {
    const judged: Array<string | undefined> = [];
    const client: JudgeClient = {
      judge: async (_q, _t, language): Promise<Verdict> => {
        judged.push(language);
        return { correct: true, matched: null };
      },
    };
    const { queue } = makeQueue(client);
    queue.enqueue({ index: 3, question: DOG, transcript: 'わんこ' });
    await queue.drain();
    expect(judged).toEqual(['ja']);
  });
});
