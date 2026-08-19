import Anthropic from '@anthropic-ai/sdk';
import type { Question } from '../engine/types';
import type { JudgeClient, Verdict } from './types';

export const JUDGE_MODEL = 'claude-opus-5';

/** Per-request ceiling. Grading is off the critical path; a slow call is 未判定. */
export const JUDGE_TIMEOUT_MS = 8_000;

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
  private client: Anthropic | null = null;
  private clientKey = '';

  /**
   * Takes a provider rather than a key string so the credential can live in
   * settings instead of the bundle: it is resolved on every judge, so editing
   * it takes effect on the next round with no rebuild and no restart.
   */
  constructor(private readonly getApiKey: () => Promise<string>) {}

  private async resolveClient(): Promise<Anthropic> {
    const apiKey = (await this.getApiKey()).trim();
    if (!apiKey) {
      // Thrown before any network call, so an unset key lands in the same
      // 未判定 path as a dead network instead of paying a round trip to be
      // told 401.
      throw new Error('APIキーが設定されていません');
    }

    // Rebuilt only when the value actually changes — a round makes up to nine
    // calls and they should share one client.
    if (!this.client || this.clientKey !== apiKey) {
      this.client = new Anthropic({
        apiKey,
        // The SDK defaults to a 10 minute timeout and 2 retries; a stalled
        // connection would then hold the results screen for tens of minutes.
        // An unanswered call is 未判定, which the engine already handles.
        timeout: JUDGE_TIMEOUT_MS,
        maxRetries: 1,
        // React Native's fetch environment is detected as browser-like by the
        // SDK's guard. This is a private development build, not a web page.
        dangerouslyAllowBrowser: true,
      });
      this.clientKey = apiKey;
    }
    return this.client;
  }

  async judge(question: Question, transcript: string): Promise<Verdict> {
    const client = await this.resolveClient();
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: JUDGE_MODEL,
      // Thinking is on by default on this model and max_tokens caps thinking
      // plus response text together: too small a budget truncates the JSON and
      // the answer silently becomes 未判定. effort:"low" keeps the spend small.
      max_tokens: 4096,
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
    };
    const response = await client.messages.create(params);

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      throw new Error('judge response contained no text block');
    }
    return parseVerdict(block.text);
  }
}
