import { ClaudeJudgeClient, JUDGE_TIMEOUT_MS, parseVerdict } from '../claude';
import type { Question } from '../../engine/types';

const mockCreate = jest.fn(async (_params: Record<string, unknown>) => ({
  content: [{ type: 'text', text: '{"correct":true,"matched":"わん"}' }],
}));
const mockClientOptions: Array<Record<string, unknown>> = [];

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: class {
    messages: unknown;
    constructor(options: Record<string, unknown>) {
      mockClientOptions.push(options);
      this.messages = { create: mockCreate };
    }
  },
}));

const DOG: Question = {
  id: 'q042',
  tier: 2,
  q: '犬の鳴き声は？',
  accept: ['わん'],
};

describe('parseVerdict', () => {
  it('parses a correct verdict', () => {
    expect(parseVerdict('{"correct":true,"matched":"ワンコ"}')).toEqual({
      correct: true,
      matched: 'ワンコ',
    });
  });

  it('parses an incorrect verdict with a null match', () => {
    expect(parseVerdict('{"correct":false,"matched":null}')).toEqual({
      correct: false,
      matched: null,
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseVerdict('  {"correct":true,"matched":null}\n').correct).toBe(true);
  });

  it('throws on malformed JSON rather than guessing', () => {
    expect(() => parseVerdict('not json')).toThrow(/verdict/i);
  });

  it('throws when correct is missing', () => {
    expect(() => parseVerdict('{"matched":"x"}')).toThrow(/verdict/i);
  });
});

describe('ClaudeJudgeClient request shape', () => {
  beforeEach(() => {
    mockCreate.mockClear();
    mockClientOptions.length = 0;
  });

  it('caps the request so a stalled call cannot hold up the results screen', async () => {
    await new ClaudeJudgeClient(async () => 'sk-test').judge(DOG, 'わんこ');
    expect(mockClientOptions[0]).toMatchObject({
      timeout: JUDGE_TIMEOUT_MS,
      maxRetries: 1,
    });
    expect(JUDGE_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it('leaves room for thinking tokens on top of the JSON verdict', async () => {
    const client = new ClaudeJudgeClient(async () => 'sk-test');
    await client.judge(DOG, 'わんこ');
    const params = mockCreate.mock.calls[0][0] as unknown as {
      max_tokens: number;
      output_config: { effort: string };
    };
    // Thinking is on by default and shares this budget with the response;
    // 1024 truncated the JSON and silently produced 未判定.
    expect(params.max_tokens).toBeGreaterThanOrEqual(4096);
    expect(params.output_config.effort).toBe('low');
  });

  it('returns the parsed verdict from the response text block', async () => {
    const client = new ClaudeJudgeClient(async () => 'sk-test');
    expect(await client.judge(DOG, 'わんこ')).toEqual({
      correct: true,
      matched: 'わん',
    });
  });
});

describe('ClaudeJudgeClient key provider', () => {
  beforeEach(() => {
    mockCreate.mockClear();
    mockClientOptions.length = 0;
  });

  it('resolves the key on every judge, so an edit takes effect without a restart', async () => {
    const getApiKey = jest.fn(async () => 'sk-one');
    const client = new ClaudeJudgeClient(getApiKey);
    await client.judge(DOG, 'わんこ');
    await client.judge(DOG, 'わんわん');
    expect(getApiKey).toHaveBeenCalledTimes(2);
  });

  it('reuses the SDK client while the key is unchanged', async () => {
    const client = new ClaudeJudgeClient(async () => 'sk-one');
    await client.judge(DOG, 'わんこ');
    await client.judge(DOG, 'わんわん');
    expect(mockClientOptions).toHaveLength(1);
  });

  it('rebuilds the SDK client when the key changes', async () => {
    let key = 'sk-one';
    const client = new ClaudeJudgeClient(async () => key);
    await client.judge(DOG, 'わんこ');
    key = 'sk-two';
    await client.judge(DOG, 'わんわん');
    expect(mockClientOptions.map((o) => o.apiKey)).toEqual(['sk-one', 'sk-two']);
  });

  it('throws on an unset key without spending a network call', async () => {
    // Lands in the same 未判定 path as a dead network, rather than paying a
    // round-trip to be told 401.
    const client = new ClaudeJudgeClient(async () => '   ');
    await expect(client.judge(DOG, 'わんこ')).rejects.toThrow(/APIキー/);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockClientOptions).toHaveLength(0);
  });
});
