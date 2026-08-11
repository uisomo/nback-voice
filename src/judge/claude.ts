import Anthropic from '@anthropic-ai/sdk';
import type { Question } from '../engine/types';
import type { JudgeClient, Verdict } from './types';

export const JUDGE_MODEL = 'claude-opus-5';

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    correct: { type: 'boolean' },
    matched: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['correct', 'matched'],
  additionalProperties: false,
};

const SYSTEM = [
  'あなたは日本語の一問一答クイズの採点者です。',
  '出題と、想定される正答例と、利用者が音声で答えた内容が与えられます。',
  '音声認識の誤りや言い回しの違いは許容し、意味が合っていれば正解としてください。',
  'correct には正誤を、matched には正解と判断した場合にその答えの標準的な表記を入れてください。',
  '不正解の場合 matched は null にしてください。',
].join('\n');

export function parseVerdict(text: string): Verdict {
  let data: unknown;
  try {
    data = JSON.parse(text.trim());
  } catch {
    throw new Error(`could not parse verdict: ${text.slice(0, 120)}`);
  }
  const v = data as Partial<Verdict>;
  if (typeof v.correct !== 'boolean') {
    throw new Error(`verdict missing "correct": ${text.slice(0, 120)}`);
  }
  return { correct: v.correct, matched: v.matched ?? null };
}

export class ClaudeJudgeClient implements JudgeClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({
      apiKey,
      // React Native's fetch environment is detected as browser-like by the
      // SDK's guard. This is a private development build, not a web page.
      dangerouslyAllowBrowser: true,
    });
  }

  async judge(question: Question, transcript: string): Promise<Verdict> {
    const response = await this.client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 1024,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: VERDICT_SCHEMA },
      },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            `問題: ${question.q}`,
            `正答例: ${question.accept.join(' / ')}`,
            `利用者の回答: ${transcript}`,
          ].join('\n'),
        },
      ],
    } as Anthropic.MessageCreateParamsNonStreaming);

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      throw new Error('judge response contained no text block');
    }
    return parseVerdict(block.text);
  }
}
