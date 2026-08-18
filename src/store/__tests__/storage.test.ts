import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_SETTINGS,
  addCustom,
  addLearned,
  appendHistory,
  clearLearned,
  deleteCustom,
  loadCustom,
  loadHistory,
  loadLearned,
  loadN,
  loadSettings,
  localDate,
  phaseDurations,
  saveN,
  saveSettings,
  updateCustom,
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
});
