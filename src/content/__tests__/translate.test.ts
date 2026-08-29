import { parseTranslatedSeries, translateSeries, CATEGORIES_EN } from '../translate';

const SOURCE = {
  id: 'cc-test',
  category: 'finance',
  title: 'コミットメントとキャピタルコール',
  credit: '『ファンドファイナンスの教科書』より',
  questions: [
    { id: 'cc_01', tier: 0, q: 'GPがLPに出資の払込を求めることは？', accept: ['キャピタルコール', 'Capital Call'] },
    { id: 'cc_02', tier: 0, q: 'サブラインの返済原資になる未払込の資金は？', accept: ['未コールコミットメント', 'Uncalled Commitment'] },
  ],
};

describe('parseTranslatedSeries', () => {
  it('parses a well-formed translation matching every source question id', () => {
    const text = JSON.stringify({
      id: 'cc-test',
      category: 'finance',
      title: 'Commitments and Capital Calls',
      credit: 'Based on *Fund Finance no Kyokasho*',
      questions: [
        { id: 'cc_01', tier: 0, q: 'What is it called when a GP asks an LP to fund a commitment?', accept: ['Capital Call'] },
        { id: 'cc_02', tier: 0, q: 'What is the uncalled capital that backs subline repayment called?', accept: ['Uncalled Commitment'] },
      ],
    });
    const result = parseTranslatedSeries(text, SOURCE);
    expect(result.id).toBe('cc-test');
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].id).toBe('cc_01');
    expect(result.questions[0].q).toBe('What is it called when a GP asks an LP to fund a commitment?');
  });

  it('throws when a source question id is missing from the response', () => {
    const text = JSON.stringify({
      id: 'cc-test',
      category: 'finance',
      title: 'Commitments and Capital Calls',
      questions: [
        { id: 'cc_01', tier: 0, q: 'What is a Capital Call?', accept: ['Capital Call'] },
      ],
    });
    expect(() => parseTranslatedSeries(text, SOURCE)).toThrow(/cc_02/);
  });

  it('throws when the response has an id not present in the source', () => {
    const text = JSON.stringify({
      id: 'cc-test',
      category: 'finance',
      title: 'Commitments and Capital Calls',
      questions: [
        { id: 'cc_01', tier: 0, q: 'What is a Capital Call?', accept: ['Capital Call'] },
        { id: 'cc_02', tier: 0, q: 'x', accept: ['y'] },
        { id: 'cc_99', tier: 0, q: 'z', accept: ['w'] },
      ],
    });
    expect(() => parseTranslatedSeries(text, SOURCE)).toThrow(/cc_99/);
  });

  it('throws on malformed JSON rather than guessing', () => {
    expect(() => parseTranslatedSeries('not json', SOURCE)).toThrow(/translat/i);
  });

  it('strips a ```json code fence some models wrap structured output in', () => {
    const payload = {
      id: 'cc-test',
      category: 'finance',
      title: 'Commitments and Capital Calls',
      questions: [
        { id: 'cc_01', tier: 0, q: 'What is a Capital Call?', accept: ['Capital Call'] },
        { id: 'cc_02', tier: 0, q: 'What is Uncalled Commitment?', accept: ['Uncalled Commitment'] },
      ],
    };
    const fenced = '```json\n' + JSON.stringify(payload) + '\n```';
    const result = parseTranslatedSeries(fenced, SOURCE);
    expect(result.title).toBe('Commitments and Capital Calls');
  });
});

describe('CATEGORIES_EN', () => {
  it('has an English label for every category id', () => {
    expect(CATEGORIES_EN.finance).toBe('Brain training for fluid intelligence, through funds finance');
    expect(CATEGORIES_EN.basics).toBe('Anyone can answer');
  });
});

const mockFetch = jest.fn(async (_url: string, _init: RequestInit) => ({
  ok: true,
  status: 200,
  json: async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            id: 'cc-test',
            category: 'finance',
            title: 'Commitments and Capital Calls',
            credit: 'Based on *Fund Finance no Kyokasho*',
            questions: [
              { id: 'cc_01', tier: 0, q: 'What is a Capital Call?', accept: ['Capital Call'] },
              { id: 'cc_02', tier: 0, q: 'What is Uncalled Commitment?', accept: ['Uncalled Commitment'] },
            ],
          }),
        },
      },
    ],
  }),
}));

global.fetch = mockFetch as unknown as typeof fetch;

describe('translateSeries', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('sends the whole series as one request and returns a parsed translation', async () => {
    const result = await translateSeries(SOURCE, async () => 'sk-test');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMessage = body.messages.find((m) => m.role === 'user');
    expect(userMessage?.content).toContain('cc_01');
    expect(userMessage?.content).toContain('cc_02');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(result.title).toBe('Commitments and Capital Calls');
  });

  it('throws when no API key is available', async () => {
    await expect(translateSeries(SOURCE, async () => '')).rejects.toThrow(/API/);
  });

  it('throws with the status code when the request fails', async () => {
    mockFetch.mockImplementationOnce(async () => ({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    } as Awaited<ReturnType<typeof fetch>>));
    await expect(translateSeries(SOURCE, async () => 'sk-test')).rejects.toThrow(/401/);
  });
});
