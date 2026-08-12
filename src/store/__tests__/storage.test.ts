import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_SETTINGS,
  addLearned,
  appendHistory,
  loadHistory,
  loadLearned,
  loadN,
  loadSettings,
  localDate,
  phaseDurations,
  saveN,
  saveSettings,
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

describe('adaptive N', () => {
  it('starts at 2', async () => {
    expect(await loadN()).toBe(2);
  });

  it('round-trips', async () => {
    await saveN(4);
    expect(await loadN()).toBe(4);
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
