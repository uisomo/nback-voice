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
  finance: 'Brain training for fluid intelligence, through funds finance',
  delivery: 'Changing how you explain it',
  basics: 'Anyone can answer',
  'custom-decks': 'My decks',
};

/**
 * Strips a ```json ... ``` (or bare ```) fence some models wrap structured
 * output in despite response_format: json_schema. A no-op on plain JSON.
 */
function stripCodeFence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return match ? match[1] : text;
}

export function parseTranslatedSeries(
  text: string,
  expected: AuthoredSeries,
): TranslatedSeries {
  let data: unknown;
  try {
    data = JSON.parse(stripCodeFence(text).trim());
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

// The default used only when a caller doesn't pass a model explicitly (e.g.
// direct test/API use) — translate-questions.ts always passes one of MODELS.
// minimax/minimax-m3:free is what actually produced the shipped content;
// z-ai/glm-5.2:free stayed rate-limited through the whole run (see the SDD
// ledger) and was dropped from rotation, not just from this default.
const TRANSLATE_MODEL = 'minimax/minimax-m3:free';

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
  'You are a fund finance professional — the kind of practitioner who',
  'drafts LPAs, negotiates subscription and NAV facilities, and talks to',
  'GPs and LPs about this material daily — translating a Japanese',
  'fund-finance quiz series into English for other practitioners.',
  'Use natural, idiomatic fund-finance English terminology — not literal',
  'machine translation. Each question must read as something a native',
  'English-speaking practitioner would actually be asked, using the terms',
  'that practitioner would actually use in a term sheet, an LPA, or a',
  'conversation with a counterparty — not a dictionary gloss of the',
  'Japanese.',
  'For each question, translate "q" and "accept". "accept" must keep the',
  'same variety the Japanese original has: abbreviation, full name, and',
  'common alternate phrasing, e.g. ["MFN", "Most Favored Nation",',
  '"Most Favored Nation clause"]. Do not collapse it to a single term.',
  'Translate "title". If "credit" is present, translate it to the form',
  '"Based on *<romanized title>*" — do not invent or look up a real',
  'English edition title. Romanize consistently: use plain Hepburn',
  'romanization of the Japanese title with no Japanese characters, no',
  'Japanese brackets (『』), and no curly quotation marks left in — every',
  'series drawn from the same source book must use the exact same',
  'romanized title string, character for character.',
  'Every single character of every "q" and "accept" entry must be',
  'English. Never leave a bare katakana transliteration (e.g. グレードD,',
  'ダイレクトアルファ, エルエヌピーエムイー) alongside its English translation —',
  'translate it and drop the katakana form entirely. If you catch',
  'yourself about to write a Japanese character anywhere outside the',
  '"credit" field\'s already-romanized title, stop and translate it',
  'instead.',
  'Preserve technical meaning exactly — this is fund-finance domain',
  'content and a wrong term changes what counts as a correct answer.',
  'In particular:',
  '- "Advance rate" and "haircut" are inverses, not synonyms: a higher',
  '  advance rate means a LOWER haircut, and vice versa. Translate',
  '  each occurrence as whichever the Japanese source actually names',
  '  (掛け目 alone is ambiguous between them — infer from context which',
  '  one the question is really asking about and stay consistent with',
  '  it), never swap one for the other.',
  '- Do not add an accepted answer that contradicts the question\'s own',
  '  premise (e.g. do not accept "European" as a synonym for a',
  '  deal-by-deal/American-style carry mechanic the question is',
  '  describing, or vice versa) — if the Japanese source describes one',
  '  specific mechanic, only that mechanic\'s name(s) belong in accept.',
  '- Keep quantities (e.g. "five reasons", "three steps") exactly as',
  '  stated in both the question and its accepted answers — do not let',
  '  a number drift between the question text and the answer text.',
  '- Do not invert cause and effect (e.g. a clawback is triggered BY',
  '  later losses, not disabled by them) — if a translation would flip',
  '  which direction a relationship runs, that is a defect, re-word it.',
  'Keep every question\'s "id" and "tier" unchanged from the input.',
  'Return exactly the same set of question ids as the input, no more, no',
  'fewer.',
].join('\n');

export async function translateSeries(
  series: AuthoredSeries,
  getApiKey: () => Promise<string>,
  model: string = TRANSLATE_MODEL,
): Promise<TranslatedSeries> {
  const apiKey = (await getApiKey()).trim();
  if (!apiKey) {
    throw new Error('APIキーが設定されていません');
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      messages: [
        { role: 'system', content: TRANSLATE_SYSTEM },
        { role: 'user', content: JSON.stringify(series) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'translated_series', strict: true, schema: TRANSLATE_SCHEMA },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `translation request for ${series.id} failed: ${response.status} ${await response.text()}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new Error(`translation response for ${series.id} contained no message content`);
  }
  return parseTranslatedSeries(text, series);
}
