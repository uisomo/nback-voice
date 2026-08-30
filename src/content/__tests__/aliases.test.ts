import { ALIAS_GROUPS, aliasCollisions, canonicalAnswer } from '../aliases';
import seriesJa from '../series.json';
import seriesEn from '../series.en.json';

interface AuthoredSeries {
  id: string;
  questions: { id: string; q: string; accept: string[] }[];
}

const BANKS: [string, AuthoredSeries[]][] = [
  ['ja', seriesJa as AuthoredSeries[]],
  ['en', seriesEn as AuthoredSeries[]],
];

describe('alias groups', () => {
  // Membership is transitive: a term in two groups merges them, so a wrong
  // answer to one question starts grading right for the other's concept.
  it('never puts a term in two groups', () => {
    expect(aliasCollisions()).toEqual([]);
  });

  it('keeps the value and the loan taken against it apart', () => {
    expect(canonicalAnswer('NAV')).not.toBe(canonicalAnswer('NAV Facility'));
    expect(canonicalAnswer('純資産価値')).not.toBe(canonicalAnswer('NAVローン'));
  });

  it('keeps the PME family members apart', () => {
    const forms = ['PME', 'KS-PME', 'LN-PME', 'mPME', 'PME+', 'Direct Alpha'];
    const canonical = forms.map(canonicalAnswer);
    expect(new Set(canonical).size).toBe(forms.length);
  });

  it('gives every group at least two members', () => {
    for (const group of ALIAS_GROUPS) expect(group.length).toBeGreaterThan(1);
  });
});

describe('canonicalAnswer', () => {
  it('folds the market names for a subscription line together', () => {
    const line = canonicalAnswer('Subscription Line');
    for (const other of [
      'subline',
      'Sub-Line',
      'サブライン',
      'サブスクリプション・ライン',
      'Subscription Facility',
      'サブスクリプション・ファシリティ',
      'Capital Call Facility',
      'キャピタルコールファシリティ',
      'Equity Bridge Facility',
    ]) {
      expect(canonicalAnswer(other)).toBe(line);
    }
  });

  it('folds the market names for a NAV facility together', () => {
    const facility = canonicalAnswer('NAVファシリティ');
    for (const other of [
      'NAV Facility',
      'NAV loan',
      'NAVローン',
      'NAV Line',
      'net asset value facility',
      'NAVファイナンス',
    ]) {
      expect(canonicalAnswer(other)).toBe(facility);
    }
  });

  it('leaves an unknown answer as its normalized self', () => {
    expect(canonicalAnswer('まったく知らない語')).toBe('まったく知らない語');
  });
});

/**
 * Bare quantities — "1.0", "87%", "45日". Two questions can land on the same
 * number without being the same question (a coverage-ratio threshold and a
 * bias ratio are both 1.0), so they are exempt from the duplicate check that
 * named terms are held to.
 */
const QUANTITY = /^[0-9０-９.,．，]+\s*(%|％|年|日|倍|パーセント|未満|以上)?$/;

describe('the question bank', () => {
  // Two questions whose accept lists canonicalize to the same answer are the
  // same question asked twice — in a round that draws from one series, one of
  // them is dead weight that also inflates the apparent question count.
  it.each(BANKS)('has no duplicate answers in %s', (_language, bank) => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const series of bank) {
      for (const question of series.questions) {
        for (const accept of question.accept) {
          if (QUANTITY.test(accept.trim())) continue;
          const key = canonicalAnswer(accept);
          const first = seen.get(key);
          if (first === undefined) seen.set(key, `${series.id}/${question.id}`);
          else if (first !== `${series.id}/${question.id}`) {
            duplicates.push(`${first} == ${series.id}/${question.id} (${accept})`);
          }
        }
      }
    }
    expect(duplicates).toEqual([]);
  });

  it.each(BANKS)('gives every question in %s a unique id', (_language, bank) => {
    const ids = bank.flatMap((series) => series.questions.map((q) => q.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('asks the same question ids in both languages', () => {
    const ids = (bank: AuthoredSeries[]) =>
      bank.flatMap((s) => s.questions.map((q) => `${s.id}/${q.id}`)).sort();
    expect(ids(seriesEn as AuthoredSeries[])).toEqual(ids(seriesJa as AuthoredSeries[]));
  });
});
