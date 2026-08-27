/**
 * npm run review-questions
 *   audits every question in src/content/series.json against reviewQuestion,
 *   printing flagged pairs with reasons. Exits 1 if anything is flagged.
 *   Requires EXPO_PUBLIC_ANTHROPIC_API_KEY (a real key, not the .env
 *   placeholder) in the environment.
 *
 * npm run review-questions -- --series <id> --topic <text> --count <n>
 *   asks Claude for <n> new questions on <topic> in the style of series <id>,
 *   reviews each candidate with the same reviewQuestion check, and prints
 *   only the ones that passed as JSON ready to paste into series.json.
 *   Candidates that failed review are printed to stderr with their reasons,
 *   not silently dropped.
 *
 * No tsx/ts-node dependency: the npm script compiles this file with the
 * already-installed tsc and runs the plain JS. See wsl-npm-rename-race in
 * project memory for why — npm install on this repo's /mnt/c path can
 * ENOTEMPTY-loop forever on a fresh devDependency.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reviewQuestion } from '../src/content/review';
import type { Question } from '../src/engine/types';

interface AuthoredSeries {
  id: string;
  title: string;
  questions: Question[];
}

const SERIES_PATH = join(__dirname, '../src/content/series.json');

async function getApiKey(): Promise<string> {
  return process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
}

async function auditAll(): Promise<void> {
  const series = JSON.parse(readFileSync(SERIES_PATH, 'utf-8')) as AuthoredSeries[];
  let flagged = 0;
  let checked = 0;

  for (const s of series) {
    for (const q of s.questions) {
      checked += 1;
      const verdict = await reviewQuestion(q, getApiKey);
      if (!verdict.ok) {
        flagged += 1;
        console.log(`[${s.id}] ${q.id}: ${q.q}`);
        console.log(`  正解一覧: ${q.accept.join(' / ')}`);
        for (const issue of verdict.issues) {
          console.log(`  - ${issue}`);
        }
      }
    }
  }

  console.log(`\n${checked}問中${flagged}問に指摘あり`);
  if (flagged > 0) process.exitCode = 1;
}

function parseArgs(argv: string[]): { series: string; topic: string; count: number } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const series = get('--series');
  const topic = get('--topic');
  const count = Number(get('--count') ?? '5');
  if (!series || !topic || !Number.isFinite(count) || count <= 0) {
    throw new Error(
      'usage: --series <id> --topic <text> --count <n>',
    );
  }
  return { series, topic, count };
}

const GENERATE_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          accept: { type: 'array', items: { type: 'string' } },
        },
        required: ['q', 'accept'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
};

async function generateCandidates(
  topic: string,
  count: number,
  existing: Question[],
): Promise<Array<{ q: string; accept: string[] }>> {
  const apiKey = await getApiKey();
  if (!apiKey.trim()) throw new Error('APIキーが設定されていません');

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4096,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: GENERATE_SCHEMA },
    },
    system: [
      'あなたは日本語の一問一答クイズの作問者です。',
      '一問一答形式で、問いと正解一覧(accept)を作ってください。',
      '英語の略語・頭字語や法律用語が答えの場合、accept には次の3つを必ず全て入れてください:',
      '(a) 英語の原表記（例: MFN）、(b) その正式名称・展開形（例: Most Favored Nation）、',
      '(c) 日本語表記（カタカナ音写または訳語。例: 最恵国優遇条項）。',
      '問題文は、それだけを読んで何を問われているか分かるように書いてください。',
      '「その場合」「この状況で」のように問題文の外の前提に依存する書き方はしないでください。',
      '既存の問題と意味が重複しないようにしてください。',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `トピック: ${topic}`,
          `作る数: ${count}`,
          `既存の問題: ${existing.map((q) => q.q).join(' / ')}`,
        ].join('\n'),
      },
    ],
  });

  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') {
    throw new Error('generate response contained no text block');
  }
  const parsed = JSON.parse(block.text) as { questions: Array<{ q: string; accept: string[] }> };
  return parsed.questions;
}

async function generate(): Promise<void> {
  const { series: seriesId, topic, count } = parseArgs(process.argv.slice(2));
  const series = JSON.parse(readFileSync(SERIES_PATH, 'utf-8')) as AuthoredSeries[];
  const target = series.find((s) => s.id === seriesId);
  if (!target) {
    throw new Error(`series not found: ${seriesId}`);
  }

  const candidates = await generateCandidates(topic, count, target.questions);
  const accepted: Question[] = [];

  for (const candidate of candidates) {
    const probe: Question = { id: '', tier: 0, q: candidate.q, accept: candidate.accept };
    const verdict = await reviewQuestion(probe, getApiKey);
    if (verdict.ok) {
      accepted.push(probe);
    } else {
      console.error(`却下: ${candidate.q}`);
      for (const issue of verdict.issues) {
        console.error(`  - ${issue}`);
      }
    }
  }

  console.log(JSON.stringify(accepted, null, 2));
  console.error(`\n${candidates.length}件中${accepted.length}件が検証を通過`);
}

const hasFlags = process.argv.slice(2).some((a) => a.startsWith('--'));
const run = hasFlags ? generate() : auditAll();
run.catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
