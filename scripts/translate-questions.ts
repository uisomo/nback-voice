/**
 * npm run translate-questions
 *   translates every series in src/content/series.json to English via
 *   translateSeries, one request per series, and writes the result to
 *   src/content/series.en.json. Requires EXPO_PUBLIC_ANTHROPIC_API_KEY (a
 *   real key, not the .env placeholder) in the environment.
 *
 * No tsx/ts-node dependency: the npm script compiles this file with the
 * already-installed tsc and runs the plain JS, same as review-questions.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { translateSeries, type AuthoredSeries } from '../src/content/translate';

const SERIES_PATH = join(__dirname, '../src/content/series.json');
const OUTPUT_PATH = join(__dirname, '../src/content/series.en.json');

async function getApiKey(): Promise<string> {
  return process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
}

async function main(): Promise<void> {
  const series = JSON.parse(readFileSync(SERIES_PATH, 'utf-8')) as AuthoredSeries[];
  const translated = [];

  for (const s of series) {
    process.stderr.write(`translating ${s.id} (${s.questions.length} questions)...\n`);
    const result = await translateSeries(s, getApiKey);
    translated.push(result);
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(translated, null, 2) + '\n', 'utf-8');
  console.log(`wrote ${translated.length} series to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
