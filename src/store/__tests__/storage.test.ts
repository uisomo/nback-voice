import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_SETTINGS,
  addCustom,
  addCustomDeck,
  addLearned,
  appendHistory,
  clearLearned,
  deleteCustom,
  deleteCustomDeck,
  loadCustom,
  loadCustomDecks,
  loadApiKey,
  loadHistory,
  loadLearned,
  loadN,
  loadSettings,
  localDate,
  phaseDurations,
  saveApiKey,
  saveN,
  saveSettings,
  updateCustom,
  updateCustomDeck,
} from '../storage';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('settings', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips saved settings', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, stepDurationMs: 7000 });
    expect((await loadSettings()).stepDurationMs).toBe(7000);
  });

  it('fills in missing keys from defaults when the stored shape is older', async () => {
    await AsyncStorage.setItem('nback.settings', JSON.stringify({ stepDurationMs: 4000 }));
    const s = await loadSettings();
    expect(s.stepDurationMs).toBe(4000);
    expect(s.adaptive).toBe(DEFAULT_SETTINGS.adaptive);
  });

  it('defaults language to ja', async () => {
    expect((await loadSettings()).language).toBe('ja');
  });

  it('round-trips a saved language', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, language: 'en' });
    expect((await loadSettings()).language).toBe('en');
  });

  it('defaults language to ja when loading settings stored before it existed', async () => {
    await AsyncStorage.setItem('nback.settings', JSON.stringify({ stepDurationMs: 4000 }));
    expect((await loadSettings()).language).toBe('ja');
  });
});

describe('adaptive N per series', () => {
  it('starts at 1 for a series never played', async () => {
    // The lag is the whole difficulty of the exercise. A finance series is
    // heavy on its own, so it must not inherit the standard series' lag.
    expect(await loadN('capital-call')).toBe(1);
  });

  it('round-trips per series', async () => {
    await saveN('standard', 4);
    expect(await loadN('standard')).toBe(4);
  });

  it('keeps series independent', async () => {
    await saveN('standard', 3);
    await saveN('persuasion', 2);
    expect(await loadN('standard')).toBe(3);
    expect(await loadN('persuasion')).toBe(2);
    expect(await loadN('fund-cast')).toBe(1);
  });

  it('seeds the standard series from the legacy single-value key', async () => {
    await AsyncStorage.setItem('nback.n', JSON.stringify(3));
    expect(await loadN('standard')).toBe(3);
    expect(await loadN('capital-call')).toBe(1);
  });

  it('leaves the legacy key in place after seeding', async () => {
    await AsyncStorage.setItem('nback.n', JSON.stringify(3));
    await loadN('standard');
    expect(await AsyncStorage.getItem('nback.n')).toBe('3');
  });
});

describe('history', () => {
  it('starts empty', async () => {
    expect(await loadHistory()).toEqual([]);
  });

  it('appends newest last', async () => {
    await appendHistory({ date: '2026-08-11', n: 2, positionScore: 1, answerScore: 0.5, unresolved: 1 });
    await appendHistory({ date: '2026-08-12', n: 3, positionScore: 0.5, answerScore: null, unresolved: 9 });
    const history = await loadHistory();
    expect(history).toHaveLength(2);
    expect(history[1].n).toBe(3);
  });
});

describe('learned synonyms', () => {
  it('starts empty', async () => {
    expect(await loadLearned()).toEqual({});
  });

  it('accumulates per question without duplicating', async () => {
    await addLearned('q042', 'わんこ');
    await addLearned('q042', 'わんこ');
    await addLearned('q042', 'ばうわう');
    expect(await loadLearned()).toEqual({ q042: ['わんこ', 'ばうわう'] });
  });

  it('keeps both answers when two writes are started together', async () => {
    // Read-modify-write over one key: unserialized, the second write would read
    // the pre-first-write map and drop 'わんこ'. A round can learn several
    // synonyms at once, so this is the real concurrency, not a contrived one.
    await Promise.all([
      addLearned('q042', 'わんこ'),
      addLearned('q100', 'にゃんこ'),
    ]);
    expect(await loadLearned()).toEqual({
      q042: ['わんこ'],
      q100: ['にゃんこ'],
    });
  });

  it('keeps both answers for the same question written together', async () => {
    await Promise.all([
      addLearned('q042', 'わんこ'),
      addLearned('q042', 'ばうわう'),
    ]);
    expect((await loadLearned()).q042.sort()).toEqual(
      ['ばうわう', 'わんこ'].sort(),
    );
  });
});

describe('localDate', () => {
  it('uses the device calendar date, not UTC', () => {
    // 2026-08-12 06:30 JST is still 2026-08-11 in UTC. Filing the round under
    // the UTC day would misdate every morning session.
    const morningInJst = new Date(2026, 7, 12, 6, 30, 0);
    expect(localDate(morningInJst)).toBe('2026-08-12');
  });

  it('zero-pads month and day', () => {
    expect(localDate(new Date(2026, 0, 3))).toBe('2026-01-03');
  });
});

describe('phaseDurations', () => {
  it('splits the step 40 / 60', () => {
    expect(phaseDurations({ ...DEFAULT_SETTINGS, stepDurationMs: 5000 })).toEqual({
      a: 2000,
      b: 3000,
    });
  });
});

describe('settings defaults for the new fields', () => {
  it('defaults to dual mode and the built-in bank', async () => {
    const s = await loadSettings();
    expect(s.mode).toBe('dual');
    expect(s.seriesId).toBe('standard');
  });

  it('still fills missing new keys from an older stored shape', async () => {
    await AsyncStorage.setItem(
      'nback.settings',
      JSON.stringify({ stepDurationMs: 4000 }),
    );
    const s = await loadSettings();
    expect(s.stepDurationMs).toBe(4000);
    expect(s.mode).toBe('dual');
    expect(s.seriesId).toBe('standard');
  });
});

describe('custom questions', () => {
  it('starts empty', async () => {
    expect(await loadCustom()).toEqual([]);
  });

  it('adds a question with tier 0 and the single answer', async () => {
    const created = await addCustom('犬の鳴き声は？', 'わん');
    expect(created).toMatchObject({
      tier: 0,
      q: '犬の鳴き声は？',
      accept: ['わん'],
    });
    expect(await loadCustom()).toHaveLength(1);
  });

  it('never reuses an id, even after a delete', async () => {
    const first = await addCustom('一問目', 'あ');
    await deleteCustom(first.id);
    const second = await addCustom('二問目', 'い');
    expect(second.id).not.toBe(first.id);
  });

  it('updates both fields in place', async () => {
    const created = await addCustom('元の問題', 'もと');
    await updateCustom(created.id, '新しい問題', 'あたらしい');
    const [stored] = await loadCustom();
    expect(stored).toMatchObject({
      id: created.id,
      q: '新しい問題',
      accept: ['あたらしい'],
    });
  });

  it('deletes only the named question', async () => {
    const a = await addCustom('残る', 'あ');
    const b = await addCustom('消える', 'い');
    await deleteCustom(b.id);
    expect((await loadCustom()).map((q) => q.id)).toEqual([a.id]);
  });
});

describe('learned synonyms follow the question', () => {
  it('drops learned synonyms when a question is edited', async () => {
    const created = await addCustom('犬の鳴き声は？', 'わん');
    await addLearned(created.id, 'ワンワン');
    await updateCustom(created.id, '猫の鳴き声は？', 'にゃー');
    expect(await loadLearned()).toEqual({});
  });

  it('drops learned synonyms when a question is deleted', async () => {
    const created = await addCustom('犬の鳴き声は？', 'わん');
    await addLearned(created.id, 'ワンワン');
    await deleteCustom(created.id);
    expect(await loadLearned()).toEqual({});
  });

  it('leaves other questions untouched', async () => {
    const a = await addCustom('一問目', 'あ');
    const b = await addCustom('二問目', 'い');
    await addLearned(a.id, 'えー');
    await addLearned(b.id, 'びー');
    await deleteCustom(a.id);
    expect(await loadLearned()).toEqual({ [b.id]: ['びー'] });
  });

  it('serializes against concurrent learning so a clear cannot be undone', async () => {
    const created = await addCustom('問題', 'こたえ');
    // Both writes touch the same key; without the shared chain the add could
    // land after the clear and resurrect the synonym.
    await Promise.all([
      addLearned(created.id, 'べつかい'),
      clearLearned(created.id),
    ]);
    const learned = await loadLearned();
    expect(learned[created.id] ?? []).toEqual([]);
  });
});

describe('settings migration to seriesId', () => {
  it('defaults to the standard series', async () => {
    expect((await loadSettings()).seriesId).toBe('standard');
  });

  it('migrates questionSource "custom" to the custom series', async () => {
    await AsyncStorage.setItem(
      'nback.settings',
      JSON.stringify({ questionSource: 'custom' }),
    );
    expect((await loadSettings()).seriesId).toBe('custom');
  });

  it('migrates "builtin" and "both" to the standard series', async () => {
    // 'both' has no equivalent: the mixed pool is gone and 自分の問題 is now
    // its own series. This is deliberately lossy.
    for (const source of ['builtin', 'both']) {
      await AsyncStorage.setItem(
        'nback.settings',
        JSON.stringify({ questionSource: source }),
      );
      expect((await loadSettings()).seriesId).toBe('standard');
    }
  });

  it('drops the obsolete key from the returned settings', async () => {
    await AsyncStorage.setItem(
      'nback.settings',
      JSON.stringify({ questionSource: 'custom' }),
    );
    expect(await loadSettings()).not.toHaveProperty('questionSource');
  });

  it('prefers an explicit seriesId over the legacy key', async () => {
    await AsyncStorage.setItem(
      'nback.settings',
      JSON.stringify({ questionSource: 'custom', seriesId: 'persuasion' }),
    );
    expect((await loadSettings()).seriesId).toBe('persuasion');
  });
});

describe('history carries the series', () => {
  it('round-trips seriesId', async () => {
    await appendHistory({
      date: '2026-08-19',
      n: 2,
      positionScore: 1,
      answerScore: 0.5,
      unresolved: 0,
      seriesId: 'persuasion',
    });
    expect((await loadHistory())[0].seriesId).toBe('persuasion');
  });

  it('records the on-time score, and reads rounds saved before it existed', async () => {
    await AsyncStorage.setItem(
      'nback.history',
      JSON.stringify([{ date: '2026-08-01', n: 2, positionScore: 1, answerScore: 1, unresolved: 0 }]),
    );
    await appendHistory({
      date: '2026-08-20',
      n: 2,
      positionScore: 1,
      answerScore: 1,
      unresolved: 0,
      seriesId: 'standard',
      onTimeScore: 0.5,
    });
    const history = await loadHistory();
    expect(history[0].onTimeScore).toBeUndefined();
    expect(history[history.length - 1].onTimeScore).toBe(0.5);
  });
});

describe('judge API key', () => {
  it('starts empty when nothing is stored and no env var is set', async () => {
    expect(await loadApiKey()).toBe('');
  });

  it('round-trips a stored key', async () => {
    await saveApiKey('sk-ant-stored');
    expect(await loadApiKey()).toBe('sk-ant-stored');
  });

  it('trims surrounding whitespace from a pasted key', async () => {
    await saveApiKey('  sk-ant-pasted\n');
    expect(await loadApiKey()).toBe('sk-ant-pasted');
  });

  it('falls back to the build-time env var when nothing is stored', async () => {
    process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY = 'sk-ant-from-env';
    try {
      expect(await loadApiKey()).toBe('sk-ant-from-env');
      // A stored key wins: settings are how you change it without a rebuild.
      await saveApiKey('sk-ant-stored');
      expect(await loadApiKey()).toBe('sk-ant-stored');
      // Clearing the field falls back to the build-time value rather than
      // leaving the app with no key at all.
      await saveApiKey('');
      expect(await loadApiKey()).toBe('sk-ant-from-env');
    } finally {
      delete process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
    }
  });

  it('keeps the key out of the settings object', async () => {
    // loadSettings() results get dumped wholesale in tests and logs; a secret
    // must not ride along.
    await saveApiKey('sk-ant-secret');
    expect(JSON.stringify(await loadSettings())).not.toContain('sk-ant-secret');
  });
});

describe('custom decks', () => {
  it('starts empty', async () => {
    expect(await loadCustomDecks()).toEqual([]);
  });

  it('creates a deck with a title, category, and questions', async () => {
    const created = await addCustomDeck('サブスク基礎', 'sub-finance', [
      { q: 'キャピタルコールとは？', accept: ['出資請求'] },
      { q: 'アドバンスレートとは？', accept: ['前貸し率'] },
    ]);
    expect(created).toMatchObject({
      title: 'サブスク基礎',
      category: 'sub-finance',
    });
    expect(created.questions).toHaveLength(2);
    expect(created.questions[0]).toMatchObject({
      tier: 0,
      q: 'キャピタルコールとは？',
      accept: ['出資請求'],
    });
    expect(await loadCustomDecks()).toHaveLength(1);
  });

  it('gives every question in every deck a globally unique id', async () => {
    const deckA = await addCustomDeck('デッキA', 'sub-finance', [
      { q: 'Q1', accept: ['A1'] },
      { q: 'Q2', accept: ['A2'] },
    ]);
    const deckB = await addCustomDeck('デッキB', 'nav-finance', [
      { q: 'Q3', accept: ['A3'] },
    ]);
    const ids = [...deckA.questions, ...deckB.questions].map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never reuses an id, even after a delete', async () => {
    const first = await addCustomDeck('一つ目', 'sub-finance', [{ q: 'Q', accept: ['A'] }]);
    await deleteCustomDeck(first.id);
    const second = await addCustomDeck('二つ目', 'sub-finance', [{ q: 'Q', accept: ['A'] }]);
    expect(second.questions[0].id).not.toBe(first.questions[0].id);
  });

  it('deletes only the named deck', async () => {
    const a = await addCustomDeck('残る', 'sub-finance', [{ q: 'Q', accept: ['A'] }]);
    const b = await addCustomDeck('消える', 'nav-finance', [{ q: 'Q', accept: ['A'] }]);
    await deleteCustomDeck(b.id);
    expect((await loadCustomDecks()).map((d) => d.id)).toEqual([a.id]);
  });

  it('rejects a deck with more than 10 questions', async () => {
    const drafts = Array.from({ length: 11 }, (_, i) => ({ q: `Q${i}`, accept: [`A${i}`] }));
    await expect(addCustomDeck('多すぎ', 'sub-finance', drafts)).rejects.toThrow();
    expect(await loadCustomDecks()).toEqual([]);
  });

  it('accepts a deck with exactly 10 questions', async () => {
    const drafts = Array.from({ length: 10 }, (_, i) => ({ q: `Q${i}`, accept: [`A${i}`] }));
    const created = await addCustomDeck('ちょうど10', 'sub-finance', drafts);
    expect(created.questions).toHaveLength(10);
  });

  it('rejects an 11th deck', async () => {
    for (let i = 0; i < 10; i++) {
      await addCustomDeck(`デッキ${i}`, 'sub-finance', [{ q: 'Q', accept: ['A'] }]);
    }
    await expect(
      addCustomDeck('11個目', 'sub-finance', [{ q: 'Q', accept: ['A'] }]),
    ).rejects.toThrow();
    expect(await loadCustomDecks()).toHaveLength(10);
  });

  it('allows an 11th deck after one is deleted', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push((await addCustomDeck(`デッキ${i}`, 'sub-finance', [{ q: 'Q', accept: ['A'] }])).id);
    }
    await deleteCustomDeck(ids[0]);
    await addCustomDeck('新しい11個目', 'sub-finance', [{ q: 'Q', accept: ['A'] }]);
    expect(await loadCustomDecks()).toHaveLength(10);
  });

  it('updates title, category, and questions in place', async () => {
    const created = await addCustomDeck('元の名前', 'sub-finance', [{ q: 'Q1', accept: ['A1'] }]);
    const updated = await updateCustomDeck(created.id, '新しい名前', 'nav-finance', [
      { q: 'Q2', accept: ['A2'] },
      { q: 'Q3', accept: ['A3'] },
    ]);
    expect(updated).toMatchObject({ id: created.id, title: '新しい名前', category: 'nav-finance' });
    expect(updated.questions.map((q) => q.q)).toEqual(['Q2', 'Q3']);

    const [stored] = await loadCustomDecks();
    expect(stored).toEqual(updated);
  });

  it('rejects updating a deck to more than 10 questions', async () => {
    const created = await addCustomDeck('デッキ', 'sub-finance', [{ q: 'Q', accept: ['A'] }]);
    const drafts = Array.from({ length: 11 }, (_, i) => ({ q: `Q${i}`, accept: [`A${i}`] }));
    await expect(updateCustomDeck(created.id, 'デッキ', 'sub-finance', drafts)).rejects.toThrow();
    const [stored] = await loadCustomDecks();
    expect(stored.questions).toHaveLength(1);
  });

  it('drops learned synonyms for questions removed by the edit', async () => {
    const created = await addCustomDeck('デッキ', 'sub-finance', [{ q: 'Q1', accept: ['A1'] }]);
    const oldQuestionId = created.questions[0].id;
    await addLearned(oldQuestionId, 'べつのこたえ');
    await updateCustomDeck(created.id, 'デッキ', 'sub-finance', [{ q: 'Q2', accept: ['A2'] }]);
    expect(await loadLearned()).toEqual({});
  });

  it('leaves other decks untouched', async () => {
    const a = await addCustomDeck('A', 'sub-finance', [{ q: 'Q', accept: ['A'] }]);
    const b = await addCustomDeck('B', 'nav-finance', [{ q: 'Q', accept: ['A'] }]);
    await updateCustomDeck(a.id, 'A改', 'sub-finance', [{ q: 'Q改', accept: ['A改'] }]);
    const decks = await loadCustomDecks();
    expect(decks.find((d) => d.id === b.id)!.title).toBe('B');
  });
});

describe('answer input settings', () => {
  it('defaults to typed — voice is the mode you opt into', () => {
    expect(DEFAULT_SETTINGS.answerInput).toBe('typed');
    expect(DEFAULT_SETTINGS.budgetBaseMs).toBe(4000);
  });

  it('fills both in for settings stored before they existed', async () => {
    await AsyncStorage.setItem(
      'nback.settings',
      JSON.stringify({ stepDurationMs: 7000, mode: 'question' }),
    );
    const settings = await loadSettings();
    expect(settings.stepDurationMs).toBe(7000);
    expect(settings.mode).toBe('question');
    expect(settings.answerInput).toBe('typed');
    expect(settings.budgetBaseMs).toBe(4000);
  });

  it('round-trips a stored choice', async () => {
    await saveSettings({
      ...DEFAULT_SETTINGS,
      answerInput: 'voice',
      budgetBaseMs: 6000,
    });
    const settings = await loadSettings();
    expect(settings.answerInput).toBe('voice');
    expect(settings.budgetBaseMs).toBe(6000);
  });
});
