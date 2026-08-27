import {
  findSemanticDuplicates,
  parseDuplicateGroups,
  parseReview,
  reviewQuestion,
} from '../review';
import type { Question } from '../../engine/types';

const mockCreate = jest.fn(async (_params: Record<string, unknown>) => ({
  content: [{ type: 'text', text: '{"ok":true,"issues":[]}' }],
}));

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: class {
    messages: unknown;
    constructor() {
      this.messages = { create: mockCreate };
    }
  },
}));

const NAV: Question = {
  id: 'nav_01',
  tier: 0,
  q: '資産の時価から負債を引いた純資産価値は？',
  accept: ['NAV', 'エヌエーブイ', '純資産価値'],
};

describe('parseReview', () => {
  it('parses a clean verdict with no issues', () => {
    expect(
      parseReview('{"ok":true,"issues":[]}'),
    ).toEqual({ ok: true, issues: [] });
  });

  it('parses a flagged verdict with issue reasons', () => {
    expect(
      parseReview('{"ok":false,"issues":["問いと答えが対応していない"]}'),
    ).toEqual({ ok: false, issues: ['問いと答えが対応していない'] });
  });

  it('throws on malformed JSON rather than guessing', () => {
    expect(() => parseReview('not json')).toThrow(/review/i);
  });

  it('throws when ok is missing', () => {
    expect(() => parseReview('{"issues":[]}')).toThrow(/review/i);
  });
});

describe('reviewQuestion', () => {
  beforeEach(() => {
    mockCreate.mockClear();
  });

  it('sends the question and its accepted answers to the model', async () => {
    await reviewQuestion(NAV, async () => 'sk-test');
    const params = mockCreate.mock.calls[0][0] as unknown as {
      messages: Array<{ content: string }>;
    };
    expect(params.messages[0].content).toContain(NAV.q);
    expect(params.messages[0].content).toContain('NAV');
    expect(params.messages[0].content).toContain('エヌエーブイ');
  });

  it('returns the parsed verdict from the response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        { type: 'text', text: '{"ok":false,"issues":["問いと答えが対応していない"]}' },
      ],
    });
    expect(await reviewQuestion(NAV, async () => 'sk-test')).toEqual({
      ok: false,
      issues: ['問いと答えが対応していない'],
    });
  });

  it('throws on an unset key without spending a network call', async () => {
    await expect(reviewQuestion(NAV, async () => '   ')).rejects.toThrow(/APIキー/);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('parseDuplicateGroups', () => {
  it('parses an empty duplicate list', () => {
    expect(parseDuplicateGroups('{"duplicates":[]}')).toEqual([]);
  });

  it('parses grouped concepts with their locations', () => {
    expect(
      parseDuplicateGroups(
        '{"duplicates":[{"concept":"MFN条項","locations":["a/1","b/2"]}]}',
      ),
    ).toEqual([{ concept: 'MFN条項', locations: ['a/1', 'b/2'] }]);
  });

  it('throws on malformed JSON rather than guessing', () => {
    expect(() => parseDuplicateGroups('not json')).toThrow(/duplicate/i);
  });

  it('throws when duplicates is missing', () => {
    expect(() => parseDuplicateGroups('{}')).toThrow(/duplicate/i);
  });
});

describe('findSemanticDuplicates', () => {
  beforeEach(() => {
    mockCreate.mockClear();
  });

  const MFN_A = { location: 'capital-call/cc_06', q: '他のLPと同等の条件を保証する条項は？', accept: ['MFN'] };
  const MFN_B = {
    location: 'ffdd-03/ffdd-03_02',
    q: 'ある LP が他の LP より有利な条件を得た場合、自分も同等の条件を要求できる権利を定めた条項を何と呼ぶか？',
    accept: ['最恵国待遇'],
  };

  it('sends every question location, text, and accepted answers to the model', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"duplicates":[]}' }],
    });
    await findSemanticDuplicates([MFN_A, MFN_B], async () => 'sk-test');
    const params = mockCreate.mock.calls[0][0] as unknown as {
      messages: Array<{ content: string }>;
    };
    expect(params.messages[0].content).toContain(MFN_A.location);
    expect(params.messages[0].content).toContain(MFN_B.location);
    expect(params.messages[0].content).toContain('最恵国待遇');
  });

  it('returns concept groups even when accept[0] strings differ', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            duplicates: [{ concept: 'MFN条項', locations: [MFN_A.location, MFN_B.location] }],
          }),
        },
      ],
    });
    expect(await findSemanticDuplicates([MFN_A, MFN_B], async () => 'sk-test')).toEqual([
      { concept: 'MFN条項', locations: [MFN_A.location, MFN_B.location] },
    ]);
  });

  it('throws on an unset key without spending a network call', async () => {
    await expect(findSemanticDuplicates([MFN_A, MFN_B], async () => '   ')).rejects.toThrow(
      /APIキー/,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
