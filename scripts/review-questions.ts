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
import { findSemanticDuplicates, reviewQuestion } from '../src/content/review';
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

/**
 * Two different questions asking for the same underlying term (e.g. one
 * series' "資産価値に対する借入金の比率は？" and another's "借入残高を担保
 * 価値で割った指標は？", both answered "LTV") is invisible to a per-question
 * review: each question looks fine in isolation. This only shows up as a
 * repeated canonical answer across the whole pool, so it has to be checked
 * pool-wide rather than per-question. accept[0] is the canonical form (see
 * ResultsScreen's answerDisplay) — a shared accept[0] across two questions
 * means the same fact is being asked about twice, in different series or
 * the same one, which the round then repeats without the player ever
 * knowing it was the same answer both times.
 */
function findDuplicateAnswers(
  series: AuthoredSeries[],
): Array<{ answer: string; locations: string[] }> {
  const bySeries = new Map<string, string[]>();
  for (const s of series) {
    for (const q of s.questions) {
      const canonical = q.accept[0];
      if (canonical === undefined) continue;
      const locations = bySeries.get(canonical) ?? [];
      locations.push(`${s.id}/${q.id}`);
      bySeries.set(canonical, locations);
    }
  }
  return [...bySeries.entries()]
    .filter(([, locations]) => locations.length > 1)
    .map(([answer, locations]) => ({ answer, locations }));
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

  const duplicates = findDuplicateAnswers(series);
  for (const { answer, locations } of duplicates) {
    flagged += 1;
    console.log(`[重複回答] "${answer}" が複数の問題で正解になっています: ${locations.join(', ')}`);
  }

  // Exact-string matching above only catches a shared literal accept[0]
  // ("MFN" === "MFN"); it cannot see that "MFN" and "最恵国待遇" name the
  // same clause. This pass asks the model to group by underlying concept
  // across the whole pool, which is the only way to catch that class.
  const located = series.flatMap((s) =>
    s.questions.map((q) => ({ location: `${s.id}/${q.id}`, q: q.q, accept: q.accept })),
  );
  const semanticDuplicates = await findSemanticDuplicates(located, getApiKey);
  for (const { concept, locations } of semanticDuplicates) {
    flagged += 1;
    console.log(`[概念重複] "${concept}" を複数の問題が問うています: ${locations.join(', ')}`);
  }

  console.log(`\n${checked}問中${flagged}問に指摘あり`);
  if (duplicates.length > 0) {
    console.log(`（うち${duplicates.length}件は同じ答えを問う重複問題）`);
  }
  if (semanticDuplicates.length > 0) {
    console.log(`（うち${semanticDuplicates.length}件は表記違いの概念重複問題）`);
  }
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
  existingAnswers: string[],
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
      '既存の正解一覧に挙げた用語は、たとえ問題文の言い回しを変えても正解として再利用しないでください。',
      'これは表記が完全一致する場合に限りません。「MFN」「最恵国待遇」「最恵国待遇条項」のように',
      '略語・正式名称・日本語訳が異なるだけで同じ概念を指す場合も、既存の用語の再利用とみなして',
      '避けてください。',
      '同じ用語を別の聞き方で問い直すことは、プレイヤーには同じ問題が繰り返し出ているように見えます。',
      '「ILPAが公開した事例で」「本書の事例では」のように、特定の書籍・報告書中の一事例だけが',
      '持つ具体的な数値（IRRが何%からいくらに変化したか、など）を答えさせる問題は作らないでください。',
      '一般に通用する概念・定義・計算方法・基準を問う問題にし、出典資料の一節を読んだ人にしか',
      '解けない出題は避けてください。',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `トピック: ${topic}`,
          `作る数: ${count}`,
          `既存の問題: ${existing.map((q) => q.q).join(' / ')}`,
          // The whole pool's answers, not just this series' — a term already
          // used as the answer in a different series is exactly as much a
          // repeat to the player as one reused within the same series.
          `既存の正解一覧（シリーズ全体、これらを正解にしないでください）: ${existingAnswers.join(' / ')}`,
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
  // Pool-wide, not just the target series: a term already used as the
  // answer anywhere in the corpus must not be reused, even under a
  // differently worded question in a different series (see the ffdd
  // duplicate-answer cleanup this guards against).
  const existingAnswers = series.flatMap((s) =>
    s.questions.map((q) => q.accept[0]).filter((a): a is string => a !== undefined),
  );

  const candidates = await generateCandidates(topic, count, target.questions, existingAnswers);
  const existingAnswerSet = new Set(existingAnswers);
  const accepted: Question[] = [];

  for (const candidate of candidates) {
    // The prompt already asks the model to avoid this, but a generated
    // batch is not trusted on its own say-so — checked in code the same way
    // findDuplicateAnswers checks the existing pool, against every answer
    // already accepted in THIS run too, so two candidates in one batch
    // cannot both slip through with the same canonical answer.
    const canonical = candidate.accept[0];
    if (canonical !== undefined && existingAnswerSet.has(canonical)) {
      console.error(`却下（既存の答えと重複）: ${candidate.q} -> ${canonical}`);
      continue;
    }

    const probe: Question = { id: '', tier: 0, q: candidate.q, accept: candidate.accept };
    const verdict = await reviewQuestion(probe, getApiKey);
    if (verdict.ok) {
      accepted.push(probe);
      if (canonical !== undefined) existingAnswerSet.add(canonical);
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
