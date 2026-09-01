import Anthropic from '@anthropic-ai/sdk';
import type { Question } from '../engine/types';

export interface ReviewVerdict {
  ok: boolean;
  issues: string[];
}

export interface DuplicateGroup {
  concept: string;
  locations: string[];
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

export function parseDuplicateGroups(text: string): DuplicateGroup[] {
  let data: unknown;
  try {
    data = JSON.parse(text.trim());
  } catch {
    throw new Error(`could not parse duplicate check: ${text.slice(0, 120)}`);
  }
  const v = data as { duplicates?: unknown };
  if (!Array.isArray(v.duplicates)) {
    throw new Error(`duplicate check missing "duplicates": ${text.slice(0, 120)}`);
  }
  return v.duplicates.map((d) => {
    const group = d as Partial<DuplicateGroup>;
    if (typeof group.concept !== 'string' || !Array.isArray(group.locations)) {
      throw new Error(`malformed duplicate group: ${JSON.stringify(d).slice(0, 120)}`);
    }
    return { concept: group.concept, locations: group.locations as string[] };
  });
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
  '出題と、正解として受理する表記の一覧が与えられます。次の点を確認してください。',
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
  '4. 「ILPAが公開した事例で」「本書の事例では」のように、特定の書籍・報告書中の一事例だけが',
  '   持つ具体的な数値（IRRが何%からいくらに変化したか、など）を暗記していないと答えられない',
  '   問題になっていないか。一般に通用する概念・定義・計算方法を問うのではなく、出典資料の',
  '   一節を読んだことがある人にしか解けない出題は、読者にとって再現性・汎用性がないため指摘する。',
  '5. 答えが「Grade A」「レベル3」のような格付け・分類ラベルの場合、それが業界標準・規制・',
  '   会計基準など外部で裏付けられる実在の用語か、それとも出典書籍がその本の中だけで独自に',
  '   定義した格付け・スケール・命名か。後者（出典元の本を読んだ人にしか答えられない、',
  '   その本オリジナルの分類・ラベル）は指摘する。前者（Level 3 = ASC 820/IFRS 13の公正',
  '   価値ヒエラルキーのように、書籍が解説しているだけで実在する規格・規制・業界慣行）は',
  '   指摘しない。判断に迷う場合は指摘しない方に倒す。',
  '6. 答えが、論文・書籍・レポートの題名や掲載誌名、データセット・データベース名、著者名、',
  '   発表年など、概念そのものではなく「どの資料に載っていたか」という出典メタ情報になって',
  '   いないか。学習者が身につけるべきは概念・用語・仕組みであって、ある事実がどの雑誌に載った',
  '   かは暗記に値しないため、こうした出題は指摘する。',
  '7. 答えが、市場規模・取引高・価格・金利水準・順位など、時とともに変化し特定時点でしか',
  '   正しくない数値になっていないか。「2025年にいくらに達したか」のような、翌年には古くなる',
  '   数値は暗記に値しないため指摘する。数学的に不変な定数（円周率、臨界値、計算式）は指摘しない。',
  '8. 答えが一意に定まるか。「弱まった／低下した」「良くなった／改善した」のように、同じ意味を',
  '   worse・weaker・deteriorate のごとく何通りにも言い表せてしまう答えは、正解一覧をいくら',
  '   増やしても取りこぼしが出るため、そもそも出題として不適切。指摘する。専門用語・固有名詞・',
  '   数値のように答えが一語に定まるものは指摘しない。',
  '9. 問いが、それ単体で答えの確定する一問一答になっているか。「〜という仮説は？」「〜はどう変化',
  '   したか？」のように、用語を答えさせた後に「で、それは正しかったのか？」といった新たな疑問を',
  '   残す聞き方や、真偽・賛否・優劣といった開かれた論点を答えさせる出題は指摘する。',
  '10. 日本語として自然で、専門家でなくても読んで意味の取れる文になっているか。直訳調・不自然な',
  '    語順・過度に専門的で何を問われているか掴みにくい問題文は指摘する。',
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

export interface LocatedQuestion {
  /** e.g. "ffdd-03/ffdd-03_02" — opaque to this module, echoed back verbatim. */
  location: string;
  q: string;
  accept: string[];
}

const DUPLICATE_MODEL = 'claude-opus-5';

const DUPLICATE_SCHEMA = {
  type: 'object',
  properties: {
    duplicates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          concept: { type: 'string' },
          locations: { type: 'array', items: { type: 'string' } },
        },
        required: ['concept', 'locations'],
        additionalProperties: false,
      },
    },
  },
  required: ['duplicates'],
  additionalProperties: false,
};

const DUPLICATE_SYSTEM = [
  'あなたは日本語の一問一答クイズの編集者です。',
  '問題一覧が渡されます。正解の表記が完全に同じでなくても、問われている概念・用語が',
  '実質的に同じ問題（例: 「MFN」「最恵国待遇」「最恵国待遇条項」「MFN条項」はすべて同じ',
  '条項を指す）をグループ化してください。言い換え・略語・日英表記の違い・定義文言の違いは',
  '別概念として扱わず、同じ概念とみなしてください。',
  '2問以上が同じ概念を問うている場合のみ、そのグループを duplicates に含めてください。',
  '概念が異なる問題（例: MFNとキーパーソン条項）は絶対に同じグループにしないでください。',
  '重複が無ければ duplicates を空配列にしてください。',
  '各グループの concept には概念名を日本語で、locations には該当する問題の location を',
  'すべてそのまま入れてください。',
].join('\n');

/**
 * Exact-string accept[0] matching (see the review script's history) misses
 * synonyms: "MFN" and "最恵国待遇" never collide as strings but are the same
 * clause, so two questions asking for it in different series looked distinct
 * to a literal dedup pass. This asks the model to group by underlying
 * concept instead, which is the only way to catch that class of duplicate.
 */
export async function findSemanticDuplicates(
  questions: LocatedQuestion[],
  getApiKey: () => Promise<string>,
): Promise<DuplicateGroup[]> {
  const apiKey = (await getApiKey()).trim();
  if (!apiKey) {
    throw new Error('APIキーが設定されていません');
  }

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const response = await client.messages.create({
    model: DUPLICATE_MODEL,
    max_tokens: 4096,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: DUPLICATE_SCHEMA },
    },
    system: DUPLICATE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: questions
          .map((q) => `location: ${q.location}\n問題: ${q.q}\n正解一覧: ${q.accept.join(' / ')}`)
          .join('\n\n'),
      },
    ],
  });

  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') {
    throw new Error('duplicate check response contained no text block');
  }
  return parseDuplicateGroups(block.text);
}
