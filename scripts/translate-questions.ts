/**
 * npm run translate-questions
 *   translates every series in src/content/series.json to English via
 *   translateSeries, one request per series, and writes the result to
 *   src/content/series.en.json. Requires OPENROUTER_API_KEY in the
 *   environment. Alternates each series between two free OpenRouter
 *   models so neither model's shared rate-limit pool takes the full
 *   25-request run; retries once per series on a 429 from either.
 *
 * No tsx/ts-node dependency: the npm script compiles this file with the
 * already-installed tsc and runs the plain JS, same as review-questions.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { translateSeries, type AuthoredSeries } from '../src/content/translate';

const SERIES_PATH = join(__dirname, '../src/content/series.json');
const OUTPUT_PATH = join(__dirname, '../src/content/series.en.json');

const MODELS = ['minimax/minimax-m3:free'];
const RETRY_DELAY_MS = 10_000;

async function getApiKey(): Promise<string> {
  return process.env.OPENROUTER_API_KEY ?? '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const series = JSON.parse(readFileSync(SERIES_PATH, 'utf-8')) as AuthoredSeries[];
  const translated = [];

  for (const [index, s] of series.entries()) {
    const model = MODELS[index % MODELS.length];
    process.stderr.write(`translating ${s.id} (${s.questions.length} questions) via ${model}...\n`);
    try {
      translated.push(await translateSeries(s, getApiKey, model));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes(' 429 ')) throw error;
      process.stderr.write(`  rate-limited, retrying ${s.id} in ${RETRY_DELAY_MS / 1000}s...\n`);
      await sleep(RETRY_DELAY_MS);
      translated.push(await translateSeries(s, getApiKey, model));
    }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(translated, null, 2) + '\n', 'utf-8');
  console.log(`wrote ${translated.length} series to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
