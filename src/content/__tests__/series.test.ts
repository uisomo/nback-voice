import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CATEGORIES,
  CUSTOM_SERIES_ID,
  STANDARD_SERIES_ID,
  findSeries,
  groupSeries,
  listSeries,
  type CustomDeck,
} from '../series';
import { normalizeTranscript } from '../normalize';
import { MIN_QUESTIONS } from '../pool';
import type { Question } from '../../engine/types';

const CUSTOM: Question[] = [
  { id: 'user_1', tier: 0, q: '自作1', accept: ['あ'] },
  { id: 'user_2', tier: 0, q: '自作2', accept: ['い'] },
];

const all = () => listSeries({ custom: CUSTOM, learned: {}, maxTier: 2 });

const DECK: CustomDeck = {
  id: 'deck_1',
  title: '自作デッキ',
  category: 'sub-finance',
  questions: [{ id: 'deck_2', tier: 0, q: '自作問1', accept: ['う'] }],
};

describe('series.json data contract', () => {
  const authored = JSON.parse(
    readFileSync(join(__dirname, '..', 'series.json'), 'utf8'),
  ) as { id: string; category: string; questions: Question[] }[];

  const bank = JSON.parse(
    readFileSync(join(__dirname, '..', 'bank.json'), 'utf8'),
  ) as Question[];

  it('gives every question a globally unique id', () => {
    // nback.learned is keyed by question id: a collision would leak one
    // question's learned synonyms into another.
    const ids = [...bank, ...authored.flatMap((s) => s.questions)].map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never collides with the custom-question id scheme', () => {
    for (const series of authored) {
      for (const question of series.questions) {
        expect(question.id).not.toMatch(/^user_/);
      }
    }
  });

  it('puts every series in a declared category', () => {
    const known = CATEGORIES.map((c) => c.id);
    for (const series of authored) {
      expect(known).toContain(series.category);
    }
  });

  it('gives every series at least one question', () => {
    for (const series of authored) {
      expect(series.questions.length).toBeGreaterThanOrEqual(MIN_QUESTIONS);
    }
  });

  it('marks every series question tier 0 so maxTier cannot filter it', () => {
    for (const series of authored) {
      for (const question of series.questions) {
        expect(question.tier).toBe(0);
      }
    }
  });

  it('gives every question at least one answer that survives normalization', () => {
    for (const series of authored) {
      for (const question of series.questions) {
        expect(question.accept.length).toBeGreaterThan(0);
        for (const answer of question.accept) {
          expect(normalizeTranscript(answer)).not.toBe('');
        }
      }
    }
  });

  it('never repeats an answer inside one series', () => {
    // A round draws 9 of these and asks which answer went with which
    // question. Two questions sharing an answer makes a step unscoreable
    // through no fault of the player.
    for (const series of authored) {
      const firsts = series.questions.map((q) => normalizeTranscript(q.accept[0]));
      expect(new Set(firsts).size).toBe(firsts.length);
    }
  });
});

describe('listSeries language switch', () => {
  it('defaults to Japanese category labels and series titles', () => {
    const result = listSeries({ custom: CUSTOM, learned: {}, maxTier: 2 });
    expect(result.find((s) => s.id === STANDARD_SERIES_ID)!.title).toBe('標準問題');
  });

  it('serves English category labels and series titles when language is en', () => {
    const ja = listSeries({ custom: CUSTOM, learned: {}, maxTier: 2 });
    const en = listSeries({ custom: CUSTOM, learned: {}, maxTier: 2, language: 'en' });
    // Same series ids in the same order — only titles/content differ.
    expect(en.map((s) => s.id)).toEqual(ja.map((s) => s.id));
    expect(en.find((s) => s.id === STANDARD_SERIES_ID)!.title).toBe('Standard Questions');
    // An authored series' title must differ between ja and en (proves the
    // English file, not the Japanese one, was actually loaded).
    const authoredId = ja.find((s) => s.id !== STANDARD_SERIES_ID && s.id !== CUSTOM_SERIES_ID)!.id;
    const jaTitle = ja.find((s) => s.id === authoredId)!.title;
    const enTitle = en.find((s) => s.id === authoredId)!.title;
    expect(enTitle).not.toBe(jaTitle);
  });

  it('groups English series under the English category labels', () => {
    const en = listSeries({ custom: CUSTOM, learned: {}, maxTier: 2, language: 'en' });
    const grouped = groupSeries(en, 'en');
    expect(grouped.map((g) => g.label)).toEqual([
      'Brain training for fluid intelligence, through funds finance',
      'Changing how you explain it',
      'Anyone can answer',
    ]);
  });
});

describe('listSeries', () => {
  it('synthesizes the standard series from the built-in bank', () => {
    const standard = all().find((s) => s.id === STANDARD_SERIES_ID);
    expect(standard).toBeDefined();
    expect(standard!.questions.length).toBeGreaterThan(MIN_QUESTIONS);
  });

  it('tier-filters the standard series only', () => {
    const atOne = listSeries({ custom: CUSTOM, learned: {}, maxTier: 1 });
    const atTwo = listSeries({ custom: CUSTOM, learned: {}, maxTier: 2 });
    const count = (list: ReturnType<typeof listSeries>, id: string) =>
      list.find((s) => s.id === id)!.questions.length;

    expect(count(atOne, STANDARD_SERIES_ID)).toBeLessThan(
      count(atTwo, STANDARD_SERIES_ID),
    );
    expect(count(atOne, 'capital-call')).toBe(count(atTwo, 'capital-call'));
  });

  it('carries the custom questions through untouched', () => {
    const custom = all().find((s) => s.id === CUSTOM_SERIES_ID);
    expect(custom!.questions.map((q) => q.id)).toEqual(['user_1', 'user_2']);
  });

  it('merges learned synonyms onto authored series, not just the bank', () => {
    const learned = { cc_01: ['よびだし'] };
    const list = listSeries({ custom: CUSTOM, learned, maxTier: 2 });
    const question = list
      .find((s) => s.id === 'capital-call')!
      .questions.find((q) => q.id === 'cc_01')!;
    expect(question.accept).toContain('よびだし');
  });

  it('merges learned synonyms onto custom questions too', () => {
    const list = listSeries({
      custom: CUSTOM,
      learned: { user_1: ['ええ'] },
      maxTier: 2,
    });
    const question = list
      .find((s) => s.id === CUSTOM_SERIES_ID)!
      .questions.find((q) => q.id === 'user_1')!;
    expect(question.accept).toEqual(['あ', 'ええ']);
  });

  it('orders series by category declaration order', () => {
    const categories = all().map((s) => s.category);
    const rank = (c: string) => CATEGORIES.findIndex((x) => x.id === c);
    const ranks = categories.map(rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});

describe('listSeries with custom decks', () => {
  it('turns each custom deck into its own series under the custom-decks category', () => {
    const list = listSeries({ custom: [], learned: {}, maxTier: 2, customDecks: [DECK] });
    const series = list.find((s) => s.id === DECK.id)!;
    expect(series).toBeDefined();
    expect(series.title).toBe(DECK.title);
    expect(series.category).toBe('custom-decks');
    expect(series.questions.map((q) => q.id)).toEqual(['deck_2']);
  });

  it('carries the funds-finance category id through for filtering', () => {
    const list = listSeries({ custom: [], learned: {}, maxTier: 2, customDecks: [DECK] });
    const series = list.find((s) => s.id === DECK.id)!;
    expect(series.fundsCategory).toBe('sub-finance');
  });

  it('merges learned synonyms onto custom deck questions', () => {
    const list = listSeries({
      custom: [],
      learned: { deck_2: ['ええ'] },
      maxTier: 2,
      customDecks: [DECK],
    });
    const series = list.find((s) => s.id === DECK.id)!;
    expect(series.questions[0].accept).toEqual(['う', 'ええ']);
  });

  it('omits the custom-decks category when there are no custom decks', () => {
    const list = listSeries({ custom: [], learned: {}, maxTier: 2 });
    expect(list.some((s) => s.category === 'custom-decks')).toBe(false);
  });
});

describe('groupSeries', () => {
  it('labels each group and skips categories with no series', () => {
    const groups = groupSeries(all());
    expect(groups.map((g) => g.id)).toContain('finance');
    expect(groups.map((g) => g.id)).toContain('basics');
    for (const group of groups) {
      expect(group.series.length).toBeGreaterThan(0);
      expect(group.label).not.toBe('');
    }
  });

  it('drops a category whose series are all absent', () => {
    const onlyFinance = all().filter((s) => s.category === 'finance');
    expect(groupSeries(onlyFinance).map((g) => g.id)).toEqual(['finance']);
  });
});

describe('findSeries', () => {
  it('finds by id', () => {
    expect(findSeries(all(), 'capital-call').id).toBe('capital-call');
  });

  it('falls back to standard for an unknown id', () => {
    // Renaming or dropping a series must not brick the app on launch for
    // someone whose stored seriesId no longer exists.
    expect(findSeries(all(), 'no-such-series').id).toBe(STANDARD_SERIES_ID);
  });
});

describe('the shipped catalogue', () => {
  it('offers the authored series across two purpose categories', () => {
    const list = listSeries({ custom: [], learned: {}, maxTier: 2 });
    const ids = list.map((s) => s.id);
    expect(ids).toEqual([
      'capital-call',
      'nav-finance',
      'fund-cast',
      'ffdd-01',
      'ffdd-02',
      'ffdd-03',
      'ffdd-04',
      'ffdd-05',
      'ffdd-06',
      'ffdd-07',
      'ffdd-08',
      'ffdd-09',
      'ffdd-10',
      'ffdd-11',
      'ffdd-12',
      'ffdd-13',
      'ffdd-14',
      'ffdd-15',
      'ffdd-16',
      'ffdd-17',
      'ffdd-18',
      'ffdd-19',
      'ffdd-20',
      'ffdd-21',
      'persuasion', // 'delivery' category, so it sorts after all 'finance' series
      STANDARD_SERIES_ID,
      CUSTOM_SERIES_ID,
    ]);
  });

  it('credits every authored series to the manuscript it came from', () => {
    const list = listSeries({ custom: [], learned: {}, maxTier: 2 });
    for (const series of list) {
      const synthesized =
        series.id === STANDARD_SERIES_ID || series.id === CUSTOM_SERIES_ID;
      if (synthesized) {
        expect(series.credit).toBeUndefined();
      } else {
        expect(series.credit).toMatch(/より$/);
      }
    }
  });

  it('tags every finance-category authored series with a funds-finance sub-category', () => {
    const list = listSeries({ custom: [], learned: {}, maxTier: 2 });
    for (const series of list) {
      if (series.category !== 'finance') continue;
      expect(series.fundsCategory).toMatch(
        /^(sub-finance|nav-finance|hybrid-pref|gp-facility|fund-covenants)$/,
      );
    }
  });

  it('leaves the delivery-category series without a funds-finance tag', () => {
    const list = listSeries({ custom: [], learned: {}, maxTier: 2 });
    expect(list.find((s) => s.id === 'persuasion')!.fundsCategory).toBeUndefined();
  });
});

describe('MIN_QUESTIONS', () => {
  it('is 1, since a round repeats questions to fill 9 stimuli', () => {
    expect(MIN_QUESTIONS).toBe(1);
  });
});
