import Anthropic from '@anthropic-ai/sdk';
import type { Question } from '../engine/types';

export interface ReviewVerdict {
  ok: boolean;
  issues: string[];
}

export function parseReview(text: string): ReviewVerdict {
  let data: unknown;
  try {
    data = JSON.parse(text.trim());
  } catch {
    throw new Error(`could not parse review: ${text.slice(0, 120)}`);
  }
  const v = data as Partial<ReviewVerdict>;
  if (typeof v.ok !== 'boolean') {
    throw new Error(`review missing "ok": ${text.slice(0, 120)}`);
  }
  return { ok: v.ok, issues: v.issues ?? [] };
}

const REVIEW_MODEL = 'claude-opus-5';

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'issues'],
  additionalProperties: false,
};

const SYSTEM = [
  'あなたは日本語の一問一答クイズの編集者です。',
  '出題と、正解として受理する表記の一覧が与えられます。次の3点を確認してください。',
  '1. 問いと答えが意味的に対応しているか。曖昧・無関係・広すぎる答えは指摘する。',
  '2. 答えが英語の略語・頭字語、または法律用語（例: MFN, LPA, NAV, 表明保証条項など）を',
  '   指すとき、正解一覧に次の3つが揃っているか:',
  '   (a) 英語の原表記（例: MFN）',
  '   (b) その英語が何の略か分かる正式名称・展開形（例: Most Favored Nation）',
  '   (c) 日本語表記（カタカナ音写または訳語。例: 最恵国優遇条項）',
  '   略語や専門用語である答えは、英語・専門用語だからという理由で(a)(b)(c)のいずれかを',
  '   省略してはいけない。1つでも欠けていれば指摘する。',
  '3. 問題文だけを読んで意味が通じるか。「その状況」「この場合」のように問題文の外にある',
  '   前提や文脈に依存していて、問題文単独では何を問われているか分からないものは指摘する。',
  '問題なければ ok を true、issues を空配列にしてください。',
  '問題があれば ok を false にし、issues に日本語で具体的な理由を入れてください。',
].join('\n');

/**
 * Reuses ClaudeJudgeClient's key-resolution shape (a provider function, not a
 * stored key) so callers — the review script and, later, any UI — share the
 * same "unset key fails before any network call" behavior.
 */
export async function reviewQuestion(
  question: Question,
  getApiKey: () => Promise<string>,
): Promise<ReviewVerdict> {
  const apiKey = (await getApiKey()).trim();
  if (!apiKey) {
    throw new Error('APIキーが設定されていません');
  }

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const response = await client.messages.create({
    model: REVIEW_MODEL,
    max_tokens: 4096,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: REVIEW_SCHEMA },
    },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          `問題: ${question.q}`,
          `正解一覧: ${question.accept.join(' / ')}`,
        ].join('\n'),
      },
    ],
  });

  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') {
    throw new Error('review response contained no text block');
  }
  return parseReview(block.text);
}
