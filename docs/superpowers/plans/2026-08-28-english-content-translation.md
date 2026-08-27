# English Content Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce `src/content/series.en.json`, a complete English translation of all 283 authored questions across 25 series, generated via Claude and passed through the existing Japanese review tooling's English-language equivalent checks.

**Architecture:** A new `scripts/translate-questions.ts` script (mirrors the compile/run pattern of `scripts/review-questions.ts`) reads `src/content/series.json`, translates each series in one batched request (so terminology stays consistent within a series), and writes `src/content/series.en.json` with identical series/question `id`s. `scripts/review-questions.ts` gains a `--file <path>` override so the same `reviewQuestion`/`findSemanticDuplicates` audit can run against the English file. This plan does **not** touch Settings, the content loader, speech, judge, or any UI — that is a separate follow-up plan (docs/superpowers/plans/ — English UI wiring) that consumes `series.en.json` once it exists.

**Tech Stack:** TypeScript compiled via `tsc` (no ts-node/tsx — see the existing `review-questions` npm script and `wsl-npm-rename-race` project memory), `@anthropic-ai/sdk`, Jest for tests.

**Spec:** `docs/superpowers/specs/2026-08-28-language-toggle-design.md` §3 (英訳)

## Global Constraints

- No ts-node/tsx dependency — new scripts must compile with plain `tsc` the same way `scripts/review-questions.ts` does (see its npm script in `package.json`).
- Translation must produce natural fund-finance English terminology, not literal machine translation (spec §3.2).
- `accept[]` in the English output must preserve the same answer diversity as the Japanese original (abbreviation + full name + common phrasing), e.g. `["MFN", "Most Favored Nation", "Most Favored Nation clause"]` (spec §3.2).
- Series ids and question ids in `series.en.json` must exactly match `series.json` — only `title`, `credit`, `questions[].q`, `questions[].accept[]` are translated (spec §3.1).
- `credit` translates to the form `Based on *<romanized title>*` rather than inventing or looking up a real English edition title (spec §3.2, as amended).
- The English file must pass the same `reviewQuestion` and `findSemanticDuplicates` checks the Japanese file already passes (spec §3.3).
- `CATEGORIES` labels need an English counterpart (`CATEGORIES_EN`), covering exactly the 3 entries in `src/content/series.ts:10-14` (spec §3.1).

---

## Task 1: `translateSeries` — the pure translation-request builder and response parser

**Files:**
- Create: `src/content/translate.ts`
- Test: `src/content/__tests__/translate.test.ts`

**Interfaces:**
- Consumes: `LocatedQuestion`-style shape is not reused here — this task defines its own `AuthoredSeries` input shape matching `series.json`'s structure: `{ id: string; category: string; title: string; credit?: string; questions: Array<{ id: string; tier: number; accept: string[]; q: string }> }`.
- Produces (used by Task 2 and by `scripts/translate-questions.ts`):
  - `export interface TranslatedSeries { id: string; category: string; title: string; credit?: string; questions: Array<{ id: string; tier: number; q: string; accept: string[] }> }`
  - `export function parseTranslatedSeries(text: string, expected: AuthoredSeries): TranslatedSeries` — parses the model's JSON response, validates that every input question id is present exactly once in the output and no extra/missing ids exist, throws a descriptive error otherwise.
  - `export async function translateSeries(series: AuthoredSeries, getApiKey: () => Promise<string>): Promise<TranslatedSeries>` — sends one request per series (batched at series granularity, per spec §3.2), calls `parseTranslatedSeries` on the result.
  - `export const CATEGORIES_EN: Record<string, string>` — maps the 3 category ids to English labels: `{ finance: 'Building financial vocabulary', delivery: 'Changing how you explain it', basics: 'Anyone can answer' }`.

- [ ] **Step 1: Write the failing tests for `parseTranslatedSeries`**

```typescript
// src/content/__tests__/translate.test.ts
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
});

describe('CATEGORIES_EN', () => {
  it('has an English label for every category id', () => {
    expect(CATEGORIES_EN.finance).toBe('Building financial vocabulary');
    expect(CATEGORIES_EN.delivery).toBe('Changing how you explain it');
    expect(CATEGORIES_EN.basics).toBe('Anyone can answer');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/content/__tests__/translate.test.ts`
Expected: FAIL — `Cannot find module '../translate'` (file does not exist yet).

- [ ] **Step 3: Write `src/content/translate.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';

export interface AuthoredQuestion {
  id: string;
  tier: number;
  q: string;
  accept: string[];
}

export interface AuthoredSeries {
  id: string;
  category: string;
  title: string;
  credit?: string;
  questions: AuthoredQuestion[];
}

export interface TranslatedSeries {
  id: string;
  category: string;
  title: string;
  credit?: string;
  questions: AuthoredQuestion[];
}

export const CATEGORIES_EN: Record<string, string> = {
  finance: 'Building financial vocabulary',
  delivery: 'Changing how you explain it',
  basics: 'Anyone can answer',
};

export function parseTranslatedSeries(
  text: string,
  expected: AuthoredSeries,
): TranslatedSeries {
  let data: unknown;
  try {
    data = JSON.parse(text.trim());
  } catch {
    throw new Error(`could not parse translation for ${expected.id}: ${text.slice(0, 200)}`);
  }
  const v = data as Partial<TranslatedSeries>;
  if (typeof v.title !== 'string' || !Array.isArray(v.questions)) {
    throw new Error(`malformed translation for ${expected.id}: ${text.slice(0, 200)}`);
  }

  const expectedIds = new Set(expected.questions.map((q) => q.id));
  const seenIds = new Set<string>();
  for (const q of v.questions) {
    const question = q as Partial<AuthoredQuestion>;
    if (
      typeof question.id !== 'string' ||
      typeof question.tier !== 'number' ||
      typeof question.q !== 'string' ||
      !Array.isArray(question.accept)
    ) {
      throw new Error(`malformed question in translation for ${expected.id}: ${JSON.stringify(q).slice(0, 200)}`);
    }
    if (!expectedIds.has(question.id)) {
      throw new Error(`translation for ${expected.id} has unexpected question id "${question.id}"`);
    }
    seenIds.add(question.id);
  }
  const missing = [...expectedIds].filter((id) => !seenIds.has(id));
  if (missing.length > 0) {
    throw new Error(`translation for ${expected.id} is missing question ids: ${missing.join(', ')}`);
  }

  return {
    id: expected.id,
    category: expected.category,
    title: v.title,
    credit: v.credit,
    questions: v.questions as AuthoredQuestion[],
  };
}

const TRANSLATE_MODEL = 'claude-opus-5';

const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    category: { type: 'string' },
    title: { type: 'string' },
    credit: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tier: { type: 'number' },
          q: { type: 'string' },
          accept: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'tier', 'q', 'accept'],
        additionalProperties: false,
      },
    },
  },
  required: ['id', 'category', 'title', 'questions'],
  additionalProperties: false,
};

const TRANSLATE_SYSTEM = [
  'You are translating a Japanese fund-finance quiz series into English.',
  'Use natural, idiomatic fund-finance English terminology — not literal',
  'machine translation. Each question must read as something a native',
  'English-speaking practitioner would actually be asked.',
  'For each question, translate "q" and "accept". "accept" must keep the',
  'same variety the Japanese original has: abbreviation, full name, and',
  'common alternate phrasing, e.g. ["MFN", "Most Favored Nation",',
  '"Most Favored Nation clause"]. Do not collapse it to a single term.',
  'Translate "title". If "credit" is present, translate it to the form',
  '"Based on *<romanized title>*" — do not invent or look up a real',
  'English edition title.',
  'Keep every question\'s "id" and "tier" unchanged from the input.',
  'Return exactly the same set of question ids as the input, no more, no',
  'fewer.',
].join('\n');

export async function translateSeries(
  series: AuthoredSeries,
  getApiKey: () => Promise<string>,
): Promise<TranslatedSeries> {
  const apiKey = (await getApiKey()).trim();
  if (!apiKey) {
    throw new Error('APIキーが設定されていません');
  }

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const response = await client.messages.create({
    model: TRANSLATE_MODEL,
    max_tokens: 8192,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: TRANSLATE_SCHEMA },
    },
    system: TRANSLATE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: JSON.stringify(series),
      },
    ],
  });

  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') {
    throw new Error(`translation response for ${series.id} contained no text block`);
  }
  return parseTranslatedSeries(block.text, series);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/content/__tests__/translate.test.ts`
Expected: PASS (4 tests in `parseTranslatedSeries`, 1 in `CATEGORIES_EN`). Note `translateSeries` itself is not directly unit-tested here since it's a thin wrapper over `parseTranslatedSeries` plus a network call — Task 2 exercises it through the script with a mocked SDK, following the same pattern `review.test.ts` uses for `reviewQuestion`.

- [ ] **Step 5: Add an SDK-mocked test for `translateSeries` request shape**

```typescript
// append to src/content/__tests__/translate.test.ts

const mockCreate = jest.fn(async (_params: Record<string, unknown>) => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify({
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
  ],
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

describe('translateSeries', () => {
  beforeEach(() => {
    mockCreate.mockClear();
  });

  it('sends the whole series as one request and returns a parsed translation', async () => {
    const result = await translateSeries(SOURCE, async () => 'sk-test');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const params = mockCreate.mock.calls[0][0] as unknown as {
      messages: Array<{ content: string }>;
    };
    expect(params.messages[0].content).toContain('cc_01');
    expect(params.messages[0].content).toContain('cc_02');
    expect(result.title).toBe('Commitments and Capital Calls');
  });

  it('throws when no API key is available', async () => {
    await expect(translateSeries(SOURCE, async () => '')).rejects.toThrow(/API/);
  });
});
```

Move the `SOURCE` constant to the top of the file (shared by both describe blocks) if not already there from Step 1.

- [ ] **Step 6: Run all translate tests to verify they pass**

Run: `npx jest src/content/__tests__/translate.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 7: Commit**

```bash
git add src/content/translate.ts src/content/__tests__/translate.test.ts
git commit -m "feat(content): add series-to-English translation request/parse logic"
```

---

## Task 2: `scripts/translate-questions.ts` — the batch-translation CLI script

**Files:**
- Create: `scripts/translate-questions.ts`
- Modify: `package.json` (add npm script)

**Interfaces:**
- Consumes: `translateSeries`, `AuthoredSeries`, `TranslatedSeries`, `CATEGORIES_EN` from `src/content/translate.ts` (Task 1).
- Produces: `src/content/series.en.json` (translated 25-series array on disk) — consumed by Task 3's review pass and by the follow-up UI-wiring plan's content loader.

- [ ] **Step 1: Write `scripts/translate-questions.ts`**

```typescript
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
```

- [ ] **Step 2: Add the npm script**

In `package.json`, in the `"scripts"` block, add a line after `"review-questions"` (mirrors its exact compile invocation, swapping the entry file and adding `translate.ts` to the compile list):

```json
    "translate-questions": "tsc scripts/translate-questions.ts src/content/translate.ts src/engine/types.ts --outDir .translate-build --module commonjs --target es2020 --esModuleInterop --resolveJsonModule --skipLibCheck --strict false --ignoreConfig && node -e \"require('fs').copyFileSync('src/content/series.json','.translate-build/src/content/series.json')\" && node .translate-build/scripts/translate-questions.js"
```

- [ ] **Step 3: Verify the script compiles**

Run: `npm run translate-questions 2>&1 | head -20`
Expected: Either it starts translating (prints `translating <id> (...)...` lines) if `EXPO_PUBLIC_ANTHROPIC_API_KEY` is set to a real key, or fails cleanly with the "APIキーが設定されていません" error from `translateSeries` — NOT a TypeScript compile error. If there's a compile error, fix it before proceeding (check the `.translate-build` output for the exact `tsc` diagnostic).

- [ ] **Step 4: Run the actual translation (requires a real API key)**

This step needs a real `EXPO_PUBLIC_ANTHROPIC_API_KEY` in the environment — not the `.env` placeholder. Confirm with the user which key to use before running, since this makes ~25 paid API calls (one per series).

Run: `EXPO_PUBLIC_ANTHROPIC_API_KEY=<real key> npm run translate-questions`
Expected: `src/content/series.en.json` is created with 25 series, ~283 questions total. Spot-check a few entries manually — e.g. `grep -A5 '"id": "cc_01"' src/content/series.en.json` — to confirm the translation reads naturally, not as literal MT.

- [ ] **Step 5: Verify series/question id parity between the two files**

Run:
```bash
node -e "
const ja = require('./src/content/series.json');
const en = require('./src/content/series.en.json');
const jaIds = ja.map(s => s.id).sort();
const enIds = en.map(s => s.id).sort();
console.log('series match:', JSON.stringify(jaIds) === JSON.stringify(enIds));
for (const s of ja) {
  const match = en.find(e => e.id === s.id);
  const jaQ = s.questions.map(q => q.id).sort();
  const enQ = match ? match.questions.map(q => q.id).sort() : [];
  if (JSON.stringify(jaQ) !== JSON.stringify(enQ)) {
    console.log('MISMATCH in', s.id, jaQ, enQ);
  }
}
console.log('done');
"
```
Expected: `series match: true` and no `MISMATCH` lines printed.

- [ ] **Step 6: Commit**

```bash
git add scripts/translate-questions.ts package.json src/content/series.en.json
git commit -m "feat(content): generate series.en.json via batched Claude translation"
```

---

## Task 3: Extend `review-questions.ts` to audit an arbitrary series file, then run it against `series.en.json`

**Files:**
- Modify: `scripts/review-questions.ts`
- Test: none (this script has no existing test file — `review.ts`, which it calls into, is already tested; the script itself is exercised manually per its existing convention)

**Interfaces:**
- Consumes: `reviewQuestion`, `findSemanticDuplicates` from `src/content/review.ts` (unchanged).
- Produces: nothing new consumed by later tasks — this is the terminal quality gate for Plan A's output.

- [ ] **Step 1: Add a `--file` flag to `auditAll`**

In `scripts/review-questions.ts`, change the `SERIES_PATH` constant and `auditAll` function to accept an override path. Locate the existing declaration:

```typescript
const SERIES_PATH = join(__dirname, '../src/content/series.json');
```

Replace it and update `auditAll`'s signature:

```typescript
const DEFAULT_SERIES_PATH = join(__dirname, '../src/content/series.json');

function resolveSeriesPath(argv: string[]): string {
  const i = argv.indexOf('--file');
  if (i === -1) return DEFAULT_SERIES_PATH;
  const file = argv[i + 1];
  if (!file) throw new Error('--file requires a path');
  return join(__dirname, '..', file);
}
```

Then change `auditAll`'s body from:
```typescript
async function auditAll(): Promise<void> {
  const series = JSON.parse(readFileSync(SERIES_PATH, 'utf-8')) as AuthoredSeries[];
```
to:
```typescript
async function auditAll(seriesPath: string): Promise<void> {
  const series = JSON.parse(readFileSync(seriesPath, 'utf-8')) as AuthoredSeries[];
```

And update the bottom dispatch:
```typescript
const hasFlags = process.argv.slice(2).some((a) => a.startsWith('--'));
const run = hasFlags ? generate() : auditAll();
```
to:
```typescript
const argv = process.argv.slice(2);
const hasGenerateFlags = argv.includes('--series') || argv.includes('--topic');
const run = hasGenerateFlags ? generate() : auditAll(resolveSeriesPath(argv));
```

(`generate()`'s own `parseArgs` already throws a clear usage error if invoked without `--series`/`--topic`/`--count`, so routing on presence of those two flags specifically — rather than "any `--` flag" — keeps `--file` from being misrouted into `generate()`.)

Also update `generate()`'s internal reads of `SERIES_PATH` (there are two: one in `generate()` itself) to use `DEFAULT_SERIES_PATH`, since `--file` is audit-only — English question *generation* (new candidate questions) is out of scope for this plan.

- [ ] **Step 2: Verify the Japanese default path still works**

Run: `EXPO_PUBLIC_ANTHROPIC_API_KEY=<real key> npm run review-questions 2>&1 | tail -5`
Expected: Same output shape as before this change — audits `series.json` by default, prints `<N>問中<M>問に指摘あり` at the end. This should already be passing clean (no flags) per the last commit on master before this plan started; if it now flags something new, the flag-routing change broke argument parsing — fix before proceeding.

- [ ] **Step 3: Run the review against `series.en.json`**

Run: `EXPO_PUBLIC_ANTHROPIC_API_KEY=<real key> npm run review-questions -- --file src/content/series.en.json`
Expected: Prints per-question review findings (if any) and semantic-duplicate findings against the English content, ending with `<N>問中<M>問に指摘あり`. If `flagged > 0`, the script exits 1 — read the printed issues, fix the corresponding entries directly in `src/content/series.en.json` (hand-edit the JSON; do not re-run the full translation), and re-run this step until it exits 0.

- [ ] **Step 4: Commit the review-script change and any content fixes**

```bash
git add scripts/review-questions.ts src/content/series.en.json
git commit -m "feat(content): audit series.en.json with the existing review pipeline"
```

---

## Self-Review Notes

- **Spec coverage:** §3.1 (data model, `series.en.json` parity, `CATEGORIES_EN`) → Task 1 + Task 2 Step 5. §3.2 (batched-per-series generation, terminology/accept diversity, credit format) → Task 1's `TRANSLATE_SYSTEM` + Task 2. §3.3 (review pass on English content) → Task 3. §6 implementation order item 1 (`series.en.json`生成スクリプト + 実行 + レビュー通過) is exactly this plan's three tasks.
- **Out of scope confirmed:** Settings/loader/speech/judge/UI wiring (spec §4) is explicitly deferred to the follow-up plan — this plan only produces and validates `series.en.json`.
- **Type consistency:** `AuthoredSeries`/`AuthoredQuestion`/`TranslatedSeries` defined once in Task 1's `src/content/translate.ts` and imported unchanged by Task 2's script — no redefinition drift.
