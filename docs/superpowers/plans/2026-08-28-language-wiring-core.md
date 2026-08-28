# Language Wiring — Core (Settings, Content, Speech, Judge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Settings.language` field (`'ja' | 'en'`) and thread it through the content loader, speech synthesis/recognition, and Claude judge, so the app can run an entire round — questions, speech, and grading — in English while keeping Japanese as the unchanged default. UI string translation (spec §4.5, the ~230 JSX strings across 6 screens and the Settings toggle itself) is **out of scope** for this plan and is covered by a follow-up plan.

**Architecture:** `Settings.language` is the single source of truth, loaded once per screen the same way `settings.maxTier` already is. Four independent consumers read it: `content/series.ts`'s `listSeries()` picks between `series.json`/`series.en.json` and `CATEGORIES`/`CATEGORIES_EN`; `speech/speaker.ts` and `speech/listener.ts` take a locale string via constructor instead of hardcoding `'ja-JP'`; `judge/claude.ts` picks between a `ja` and `en` `SYSTEM`/template pair via a `language` argument. None of these four consumers talk to each other — they only share the `Settings.language` value threaded down from `GameScreen`/`SettingsScreen`/`SeriesScreen`, which already load `Settings` today.

**Tech Stack:** TypeScript (React Native / Expo), Jest with `jest-expo` preset, `@react-native-async-storage/async-storage` (mocked in tests via `jest.setup.js`).

**Spec:** `docs/superpowers/specs/2026-08-28-language-toggle-design.md` §4.1 (設定), §4.2 (出題内容の読み込み), §4.3 (音声), §4.4 (採点)

## Global Constraints

- `Settings.language: 'ja' | 'en'`, default `'ja'` (spec §4.1). Adding it must not require an AsyncStorage migration — `loadSettings()`'s existing `{ ...DEFAULT_SETTINGS, ...rest }` merge already backfills missing keys for older stored settings (spec §4.1).
- `content/series.ts` must switch between `series.json` and `series.en.json`, and between `CATEGORIES` and `CATEGORIES_EN`, based on a `language` argument — no schema change to `Question`/`Series` (spec §4.2, confirmed in the design's §3.1).
- English selection switches **both** speech synthesis and speech recognition fully to `en-US` — never a mix of English content with Japanese voice or vice versa (spec §4.3).
- `judge/local.ts` (`localMatch`) is language-independent and must NOT be modified — it already normalizes both sides before comparing (spec §4.4, confirmed by reading the file: it only calls `normalizeTranscript`, no locale logic).
- Every existing test that does not pass an explicit `language` continues to pass unmodified, because `DEFAULT_SETTINGS.language` is `'ja'` and every default-shaped call (`listSeries({ custom, learned, maxTier })` without `language`, `new ExpoSpeaker()` without a locale, etc.) must keep behaving exactly as it does today (spec §5's "既存の約230件のテキスト表明は変更不要" principle extends here: nothing outside this plan's new tests should need to change).

---

## File Structure

- Modify `src/store/storage.ts`: add `language` to `Settings` and `DEFAULT_SETTINGS`.
- Modify `src/content/series.ts`: `listSeries()` takes `language`, switches `AUTHORED` source and `CATEGORIES` source.
- Modify `src/speech/speaker.ts`: `ExpoSpeaker` constructor takes a locale string.
- Modify `src/speech/listener.ts`: `ExpoListener` constructor takes a locale string; `detectOnDeviceRecognition` takes a locale parameter instead of reading the module-level `RECOGNITION_LANG` constant.
- Modify `src/judge/claude.ts`: `ClaudeJudgeClient.judge()` takes a `language` parameter; `SYSTEM` becomes `SYSTEM_JA`/`SYSTEM_EN`, the message template is built per language.
- Modify `src/judge/types.ts`: `JudgeClient.judge()` signature gains the `language` parameter (checked below — see Task 4).
- Modify `src/judge/queue.ts`: `JudgeQueue` passes `language` through to `client.judge()`.
- Modify `src/ui/GameScreen.tsx`: `realDeps()` / setup effect passes `settings.language` into `ExpoSpeaker`, `ExpoListener`, and `JudgeQueue`'s language-aware call; `listSeries()` call gains `language`.
- Modify `src/ui/SettingsScreen.tsx`, `src/ui/SeriesScreen.tsx`: `listSeries()` calls gain `language: settings.language` (SeriesScreen) / stay on `DEFAULT_SETTINGS.language` for the series-identity listing (SettingsScreen, matching its existing `maxTier` treatment — see Task 2).

No new files. This plan's job is entirely "add a parameter and switch on it" across five existing files; introducing new files for that would fragment code that changes together (storage, series, speech, judge each already own their concern).

---

## Task 1: `Settings.language`

**Files:**
- Modify: `src/store/storage.ts:12-28` (`Settings` interface), `:43-52` (`DEFAULT_SETTINGS`)
- Test: `src/store/__tests__/storage.test.ts`

**Interfaces:**
- Produces: `Settings.language: 'ja' | 'en'`, `DEFAULT_SETTINGS.language === 'ja'`. Every later task reads `settings.language` with this exact type.

- [ ] **Step 1: Write the failing test**

Add to `src/store/__tests__/storage.test.ts`, inside the existing `describe('settings', ...)` block (after the "fills in missing keys" test):

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/store/__tests__/storage.test.ts -t language`
Expected: FAIL — `Settings` has no `language` property, so `(await loadSettings()).language` is `undefined`, not `'ja'`.

- [ ] **Step 3: Add `language` to `Settings` and `DEFAULT_SETTINGS`**

In `src/store/storage.ts`, change the `Settings` interface (lines 12–28):

```typescript
export interface Settings {
  /** Total step length in ms; split 40% phase A / 60% phase B. */
  stepDurationMs: number;
  adaptive: boolean;
  /** Used only when adaptive is false. */
  fixedN: number;
  /** Highest question tier to draw from. Standard series only. */
  maxTier: number;
  /** 'dual' scores position and answer; 'question' drops the visual channel. */
  mode: RoundMode;
  /** Which series a round draws from. */
  seriesId: string;
  /** How answers are entered. Typed is the default; voice is opted into. */
  answerInput: AnswerInput;
  /** Base of the answer time budget, before the per-character part. */
  budgetBaseMs: number;
  /** UI/content/speech/judge language. Switching requires series.en.json etc. */
  language: 'ja' | 'en';
}
```

Change `DEFAULT_SETTINGS` (lines 43–52):

```typescript
export const DEFAULT_SETTINGS: Settings = {
  stepDurationMs: 5000,
  adaptive: true,
  fixedN: 1,
  maxTier: 2,
  mode: 'dual',
  seriesId: STANDARD_SERIES_ID,
  answerInput: 'typed',
  budgetBaseMs: DEFAULT_BUDGET_BASE_MS,
  language: 'ja',
};
```

No change to `loadSettings()` itself — the existing `{ ...DEFAULT_SETTINGS, ...rest }` spread on line 84 already backfills `language: 'ja'` when a stored settings object predates this field.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/store/__tests__/storage.test.ts`
Expected: PASS, including the 3 new tests and all pre-existing ones (unaffected, since they never reference `language` and `toEqual(DEFAULT_SETTINGS)` still matches the whole object).

- [ ] **Step 5: Commit**

```bash
git add src/store/storage.ts src/store/__tests__/storage.test.ts
git commit -m "feat(store): add Settings.language, default ja"
```

---

## Task 2: `listSeries()` switches content file and category labels by language

**Files:**
- Modify: `src/content/series.ts` (full file; see current content below)
- Test: `src/content/__tests__/series.test.ts`

**Interfaces:**
- Consumes: `CATEGORIES_EN` from `src/content/translate.ts` (already exists: `export const CATEGORIES_EN: Record<string, string> = { finance: 'Building financial vocabulary', delivery: 'Changing how you explain it', basics: 'Anyone can answer' }`). `src/content/series.en.json` (already exists on disk, same shape as `series.json`).
- Produces: `listSeries(input: SeriesInput): Series[]` where `SeriesInput` gains `language?: 'ja' | 'en'` (optional, defaults to `'ja'` — see below for why optional rather than required).

**Why `language` is optional on `SeriesInput`:** Every existing call site and every existing test constructs `SeriesInput` without a `language` field (confirmed: `SeriesInput` is used in `src/ui/GameScreen.tsx:257`, `src/ui/SettingsScreen.tsx:120`, `src/ui/SeriesScreen.tsx:39`, and `src/content/__tests__/series.test.ts`'s `all()` helper). Making `language` required would force every one of those call sites to change in this task, expanding this task's blast radius into UI files that Task 5 already needs to touch for a different reason (passing the *real* `settings.language` through). Optional-with-default keeps this task self-contained to `series.ts`; Task 5 then changes call sites to pass the real value where it matters (`GameScreen`, `SeriesScreen`) and leaves `SettingsScreen`'s series-identity listing on the default, matching how it already ignores the real `maxTier` (line 120 passes `DEFAULT_SETTINGS.maxTier`, not `settings.maxTier`).

- [ ] **Step 1: Write the failing tests**

Add to `src/content/__tests__/series.test.ts`, as a new top-level `describe` block (after the existing `describe('series.json data contract', ...)` block):

```typescript
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
    const grouped = groupSeries(en);
    expect(grouped.map((g) => g.label)).toEqual([
      'Building financial vocabulary',
      'Changing how you explain it',
      'Anyone can answer',
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/content/__tests__/series.test.ts -t "language switch"`
Expected: FAIL — `listSeries` has no `language` option yet, so the `en` calls return the same Japanese-titled series as the `ja` calls, and `'Standard Questions'`/English category labels never appear.

- [ ] **Step 3: Implement the language switch**

Replace the full content of `src/content/series.ts`:

```typescript
import type { Question } from '../engine/types';
import { loadBank, mergeLearned } from './bank';
import { CATEGORIES_EN } from './translate';
import rawJa from './series.json';
import rawEn from './series.en.json';

/**
 * Purpose-shaped groupings, in display order. A category exists to answer
 * "what am I training for", so its label is a sentence about intent rather
 * than a subject name.
 */
export const CATEGORIES = [
  { id: 'finance', label: '金融の語彙を体に入れる' },
  { id: 'delivery', label: '伝え方を変える' },
  { id: 'basics', label: 'だれでも答えられる' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];

export interface Series {
  id: string;
  category: CategoryId;
  title: string;
  /** 出典. Absent on standard/custom, which have no book behind them. */
  credit?: string;
  questions: Question[];
}

export interface CategoryGroup {
  id: CategoryId;
  label: string;
  series: Series[];
}

export const STANDARD_SERIES_ID = 'standard';
export const CUSTOM_SERIES_ID = 'custom';

interface AuthoredSeries {
  id: string;
  category: string;
  title: string;
  credit?: string;
  questions: Question[];
}

const AUTHORED_JA = rawJa as AuthoredSeries[];
const AUTHORED_EN = rawEn as AuthoredSeries[];

const STANDARD_TITLE: Record<'ja' | 'en', string> = {
  ja: '標準問題',
  en: 'Standard Questions',
};
const CUSTOM_TITLE: Record<'ja' | 'en', string> = {
  ja: '自分の問題',
  en: 'My Questions',
};

/** Category labels for the given language, in `CATEGORIES`' fixed order. */
function categoryLabels(language: 'ja' | 'en'): Record<CategoryId, string> {
  if (language === 'ja') {
    return Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<CategoryId, string>;
  }
  return CATEGORIES_EN as Record<CategoryId, string>;
}

export interface SeriesInput {
  custom: Question[];
  learned: Record<string, string[]>;
  /** Highest built-in tier to draw from. Applies to the standard series only. */
  maxTier: number;
  /** UI/content language. Defaults to 'ja' so existing callers are unaffected. */
  language?: 'ja' | 'en';
}

/**
 * Every series the app can offer, in category order. `standard` and `custom`
 * are synthesized here rather than living in the JSON, so the picker and the
 * round share one code path instead of the built-ins having their own.
 *
 * `custom` arrives as an argument rather than being read from AsyncStorage —
 * that is what keeps this module free of device imports (boundaries.test.ts).
 */
export function listSeries({ custom, learned, maxTier, language = 'ja' }: SeriesInput): Series[] {
  const source = language === 'en' ? AUTHORED_EN : AUTHORED_JA;
  const authored: Series[] = source.map((series) => ({
    ...series,
    category: series.category as CategoryId,
    questions: mergeLearned(series.questions, learned),
  }));

  const synthesized: Series[] = [
    {
      id: STANDARD_SERIES_ID,
      category: 'basics',
      title: STANDARD_TITLE[language],
      questions: loadBank(learned).filter((q) => q.tier <= maxTier),
    },
    {
      id: CUSTOM_SERIES_ID,
      category: 'basics',
      title: CUSTOM_TITLE[language],
      questions: mergeLearned(custom, learned),
    },
  ];

  const all = [...authored, ...synthesized];
  return CATEGORIES.flatMap((category) =>
    all.filter((series) => series.category === category.id),
  );
}

/** Groups for the picker. Categories with no series are dropped, not shown empty. */
export function groupSeries(all: Series[], language: 'ja' | 'en' = 'ja'): CategoryGroup[] {
  const labels = categoryLabels(language);
  return CATEGORIES.map((category) => ({
    id: category.id,
    label: labels[category.id],
    series: all.filter((series) => series.category === category.id),
  })).filter((group) => group.series.length > 0);
}

/**
 * Resolve a stored id. Falls back to the standard series rather than throwing:
 * a renamed or removed series must not make the app unlaunchable.
 */
export function findSeries(all: Series[], id: string): Series {
  return (
    all.find((series) => series.id === id) ??
    all.find((series) => series.id === STANDARD_SERIES_ID)!
  );
}
```

`listSeries` never reads `categoryLabels` — that helper exists solely for `groupSeries`, which is the function the picker screens actually call to get category-labeled groups (`SeriesScreen.tsx` calls `groupSeries(all)` today with no `language`; Step 5 below updates that call site to pass `settings.language`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/content/__tests__/series.test.ts`
Expected: PASS, including all 3 new tests and every pre-existing test in the file (the `all()` helper in the test file never passes `language`, so it keeps exercising the `'ja'` default path exactly as before).

- [ ] **Step 5: Update the three existing call sites to pass `language` through where the real value is available**

This step touches UI files, but only to add one field to an object literal that already exists at each call site — it does not touch JSX or add new UI, so it belongs with the loader change rather than being deferred to the UI-strings follow-up plan.

In `src/ui/GameScreen.tsx`, change (around line 257):
```typescript
        const series = findSeries(
          listSeries({ custom, learned, maxTier: settings.maxTier }),
          seriesId,
        );
```
to:
```typescript
        const series = findSeries(
          listSeries({ custom, learned, maxTier: settings.maxTier, language: settings.language }),
          seriesId,
        );
```

In `src/ui/SeriesScreen.tsx`, change (around line 39):
```typescript
      const all = listSeries({ custom, learned, maxTier: settings.maxTier });
```
to:
```typescript
      const all = listSeries({ custom, learned, maxTier: settings.maxTier, language: settings.language });
```

And two lines below it (around line 41), change:
```typescript
        groupSeries(all).map(async (group: CategoryGroup) => ({
```
to:
```typescript
        groupSeries(all, settings.language).map(async (group: CategoryGroup) => ({
```

`src/ui/SettingsScreen.tsx:120` (`listSeries({ custom, learned, maxTier: DEFAULT_SETTINGS.maxTier })`) is deliberately left unchanged in this task: it already ignores the real settings' `maxTier` in favor of the default (comment on line 114–117 explains series identity doesn't depend on the tier filter), and the per-series-N list it builds is keyed by series `id`, which is language-invariant — showing it in whichever language's titles happen to be default costs nothing today. The follow-up UI-strings plan (which adds the language toggle itself to `SettingsScreen`) revisits this call site to decide whether it should show `settings.language`'s titles instead, purely for UI consistency once the toggle exists — a UI-polish concern, not a data-correctness one, and out of scope here.

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npx jest`
Expected: PASS — all suites, including `src/ui/__tests__/*` (GameScreen/SeriesScreen tests construct `Settings`/call these screens; since `language` defaults to `'ja'` in both `DEFAULT_SETTINGS` and `listSeries`, none of their assertions change).

- [ ] **Step 7: Commit**

```bash
git add src/content/series.ts src/content/__tests__/series.test.ts src/ui/GameScreen.tsx src/ui/SeriesScreen.tsx
git commit -m "feat(content): switch listSeries/groupSeries between ja and en by language"
```

---

## Task 3: Speech locale — `ExpoSpeaker` and `ExpoListener` take a locale instead of hardcoding `ja-JP`

**Files:**
- Modify: `src/speech/speaker.ts` (full file, 37 lines)
- Modify: `src/speech/listener.ts` (constructor, `detectOnDeviceRecognition`, `start()`)
- Test: `src/speech/__tests__/speaker.test.ts`, `src/speech/__tests__/listener.test.ts`

**Interfaces:**
- Produces: `new ExpoSpeaker(locale: string = 'ja-JP')`, `new ExpoListener(locale: string = 'ja-JP')`. Both default to `'ja-JP'` so every existing `new ExpoSpeaker()` / `new ExpoListener()` call site (there is exactly one of each, both in `GameScreen.tsx`'s `realDeps()`) keeps working without modification until Task 5 threads the real locale in.
- Consumes (Task 5): a `languageToLocale(language: 'ja' | 'en'): string` mapping — defined in this task since it is speech-specific — `{ ja: 'ja-JP', en: 'en-US' }`.

- [ ] **Step 1: Write the failing speaker test**

Add to `src/speech/__tests__/speaker.test.ts`, as a new `describe` block after `describe('unlocking audio', ...)`:

```typescript
describe('locale selection', () => {
  it('speaks in ja-JP by default', () => {
    void new ExpoSpeaker().speak('質問');
    expect(mocked.speak.mock.calls[0][1]).toMatchObject({ language: 'ja-JP' });
  });

  it('speaks in the locale passed to the constructor', () => {
    void new ExpoSpeaker('en-US').speak('question');
    expect(mocked.speak.mock.calls[0][1]).toMatchObject({ language: 'en-US' });
  });

  it('unlocks using the constructor locale too', () => {
    new ExpoSpeaker('en-US').unlock();
    expect(mocked.speak.mock.calls[0][1]).toMatchObject({ language: 'en-US' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/speech/__tests__/speaker.test.ts -t "locale selection"`
Expected: FAIL on the second and third tests — `ExpoSpeaker` takes no constructor argument yet, so both still speak `ja-JP`.

- [ ] **Step 3: Implement the locale constructor on `ExpoSpeaker`**

Replace `src/speech/speaker.ts` in full:

```typescript
import * as Speech from 'expo-speech';
import type { Speaker } from './types';

export class ExpoSpeaker implements Speaker {
  constructor(private readonly locale: string = 'ja-JP') {}

  speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      Speech.speak(text, {
        language: this.locale,
        rate: 1.0,
        pitch: 1.0,
        onDone: () => resolve(),
        onStopped: () => resolve(),
        onError: () => resolve(), // never strand the round on a TTS failure
      });
    });
  }

  /**
   * iOS refuses to speak until one utterance has come out of a user gesture,
   * so a round that starts on its own is silent until the owner happens to
   * touch something. This is that utterance — inaudible, and synchronous so
   * it stays inside the tap that permits it.
   */
  unlock(): void {
    try {
      Speech.speak('　', { language: this.locale, volume: 0 });
    } catch {
      // A synthesizer that will not warm up is not a reason to block the
      // round: the questions simply go unspoken, which the owner can see.
    }
  }

  stop(): void {
    Speech.stop();
  }
}
```

- [ ] **Step 4: Run the speaker tests to verify they pass**

Run: `npx jest src/speech/__tests__/speaker.test.ts`
Expected: PASS — all tests, including the pre-existing "speaks the question in Japanese" test (unaffected: it constructs `new ExpoSpeaker()` with no argument, so `this.locale` defaults to `'ja-JP'`).

- [ ] **Step 5: Write the failing listener test**

First, read `src/speech/__tests__/listener.test.ts` in full to see how `start()` and locale-dependent assertions are currently structured (the exploration found it mocks `ExpoSpeechRecognitionModule.start` and asserts on `mocked.start.mock.calls`). Add a new `describe` block:

```typescript
describe('locale selection', () => {
  it('starts recognition in ja-JP by default', () => {
    new ExpoListener().start();
    expect(mocked.start.mock.calls[0][0]).toMatchObject({ lang: 'ja-JP' });
  });

  it('starts recognition in the locale passed to the constructor', () => {
    new ExpoListener('en-US').start();
    expect(mocked.start.mock.calls[0][0]).toMatchObject({ lang: 'en-US' });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx jest src/speech/__tests__/listener.test.ts -t "locale selection"`
Expected: FAIL on the second test — `ExpoListener` takes no constructor argument yet, `start()` always sends `RECOGNITION_LANG` (`'ja-JP'`).

- [ ] **Step 7: Implement the locale constructor on `ExpoListener`**

In `src/speech/listener.ts`:

Change the `detectOnDeviceRecognition` function (lines 45–71) to accept a locale parameter instead of closing over the module constant `RECOGNITION_LANG`. Keep `RECOGNITION_LANG` exported as the *default* value (Task 5's speech test infra and any other reader may still reference it), but make the probe locale-aware:

```typescript
export const RECOGNITION_LANG = 'ja-JP';

// ... (sameLocale, IOS_CATEGORY unchanged) ...

/**
 * Memoised per locale: switching from ja to en must not reuse an ja probe
 * result (or vice versa), since installedLocales differs per locale.
 */
const onDeviceProbes = new Map<string, Promise<boolean>>();

export function detectOnDeviceRecognition(locale: string = RECOGNITION_LANG): Promise<boolean> {
  let probe = onDeviceProbes.get(locale);
  if (!probe) {
    probe = (async () => {
      let available = false;
      try {
        if (ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
          const { installedLocales } =
            await ExpoSpeechRecognitionModule.getSupportedLocales({});
          available = installedLocales.some((l) => sameLocale(l, locale));
        }
      } catch {
        available = false;
      }
      console.log(
        `[nback] speech recognition (${locale}): ${
          available
            ? 'on-device requested (iOS may still fall back to server)'
            : 'server'
        }`,
      );
      return available;
    })();
    onDeviceProbes.set(locale, probe);
  }
  return probe;
}

/** Test-only: forget the memoised probes. */
export function resetOnDeviceProbe(): void {
  onDeviceProbes.clear();
}
```

Then change the `ExpoListener` class constructor and `start()`:

```typescript
export class ExpoListener implements Listener {
  private listening = false;
  private transcript = '';
  private onDevice = false;
  private settleResolvers: Array<() => void> = [];
  /** This session has said its last word — nothing more is coming. */
  private finished = false;

  constructor(private readonly locale: string = RECOGNITION_LANG) {
    // Fires well before the first phase B; until it answers we use the safe
    // fallback (server recognition), which is what the app did before.
    void detectOnDeviceRecognition(this.locale).then((available) => {
      this.onDevice = available;
    });
  }

  static async requestPermissions(): Promise<boolean> {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return result.granted;
  }

  start(): void {
    this.transcript = '';
    this.listening = true;
    this.finished = false;
    ExpoSpeechRecognitionModule.start({
      lang: this.locale,
      interimResults: true,
      continuous: false,
      requiresOnDeviceRecognition: this.onDevice,
      maxAlternatives: 1,
      iosCategory: IOS_CATEGORY,
    });
  }

  // ... settle(), releaseSettle(), stop(), push(), sessionEnded() unchanged ...
}
```

- [ ] **Step 8: Run the listener tests to verify they pass**

Run: `npx jest src/speech/__tests__/listener.test.ts`
Expected: PASS — all tests, including every pre-existing `detectOnDeviceRecognition()` call (now `detectOnDeviceRecognition(RECOGNITION_LANG)` implicitly via the default parameter, same behavior as before since there was only ever one locale in play).

- [ ] **Step 9: Run the full suite to check for regressions**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/speech/speaker.ts src/speech/listener.ts src/speech/__tests__/speaker.test.ts src/speech/__tests__/listener.test.ts
git commit -m "feat(speech): parameterize ExpoSpeaker/ExpoListener locale, default ja-JP"
```

---

## Task 4: Judge — language-specific `SYSTEM` prompt and message template

**Files:**
- Modify: `src/judge/claude.ts` (full file, 114 lines)
- Modify: `src/judge/types.ts` (full file, 10 lines — shown below)
- Modify: `src/judge/queue.ts:23-56` (`enqueue()`'s call to `this.client.judge(...)`)
- Read but do not modify: `src/judge/local.ts` (confirms it stays language-independent per Global Constraints)
- Test: `src/judge/__tests__/claude.test.ts`, `src/judge/__tests__/queue.test.ts`

**`src/judge/types.ts`, current full content:**
```typescript
import type { Question } from '../engine/types';

export interface Verdict {
  correct: boolean;
  /** The accepted phrasing Claude matched, to be learned into the bank. */
  matched: string | null;
}

export interface JudgeClient {
  judge(question: Question, transcript: string): Promise<Verdict>;
}
```

**`src/judge/__tests__/queue.test.ts`'s existing mock pattern (for Step 5's new test to match):** every test builds a `JudgeClient` as a plain object literal, e.g. `const client: JudgeClient = { judge: async (_q, t): Promise<Verdict> => { calls.push(t); return { correct: true, matched: 'わんこ' }; } };`, and constructs `JudgeQueue` either directly (`new JudgeQueue(client, { onVerdict, onLearn })`) or via the file's own `makeQueue(client)` helper (which does the same, no third argument).

**Interfaces:**
- Consumes: none new.
- Produces: `ClaudeJudgeClient.judge(question: Question, transcript: string, language: 'ja' | 'en' = 'ja'): Promise<Verdict>`. `JudgeClient.judge()` gains the same optional third parameter.

- [ ] **Step 1: Write the failing claude.ts tests**

Add to `src/judge/__tests__/claude.test.ts`, as a new `describe` block after `describe('ClaudeJudgeClient key provider', ...)`:

```typescript
describe('ClaudeJudgeClient language selection', () => {
  beforeEach(() => {
    mockCreate.mockClear();
    mockClientOptions.length = 0;
  });

  it('uses the Japanese system prompt and template by default', async () => {
    await new ClaudeJudgeClient(async () => 'sk-test').judge(DOG, 'わんこ');
    const params = mockCreate.mock.calls[0][0] as unknown as {
      system: string;
      messages: Array<{ content: string }>;
    };
    expect(params.system).toMatch(/日本語/);
    expect(params.messages[0].content).toMatch(/^問題: /);
  });

  it('uses the English system prompt and template when language is en', async () => {
    const ENGLISH_DOG: Question = { id: 'q042', tier: 2, q: 'What sound does a dog make?', accept: ['Woof'] };
    await new ClaudeJudgeClient(async () => 'sk-test').judge(ENGLISH_DOG, 'woof', 'en');
    const params = mockCreate.mock.calls[0][0] as unknown as {
      system: string;
      messages: Array<{ content: string }>;
    };
    expect(params.system).toMatch(/English/);
    expect(params.messages[0].content).toMatch(/^Question: /);
    expect(params.messages[0].content).toContain('Accepted answers:');
    expect(params.messages[0].content).toContain("User's answer:");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/judge/__tests__/claude.test.ts -t "language selection"`
Expected: FAIL — `judge()` takes no third argument yet and always uses the Japanese `SYSTEM`/template, so the English-language assertions fail.

- [ ] **Step 3: Implement `SYSTEM_JA`/`SYSTEM_EN` and the language-aware template**

Replace `src/judge/claude.ts` in full:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { Question } from '../engine/types';
import type { JudgeClient, Verdict } from './types';

export const JUDGE_MODEL = 'claude-opus-5';

/** Per-request ceiling. Grading is off the critical path; a slow call is 未判定. */
export const JUDGE_TIMEOUT_MS = 8_000;

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    correct: { type: 'boolean' },
    matched: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['correct', 'matched'],
  additionalProperties: false,
};

const SYSTEM_JA = [
  'あなたは日本語の一問一答クイズの採点者です。',
  '出題と、想定される正答例と、利用者が音声で答えた内容が与えられます。',
  '音声認識の誤りや言い回しの違いは許容し、意味が合っていれば正解としてください。',
  'correct には正誤を、matched には正解と判断した場合にその答えの標準的な表記を入れてください。',
  '不正解の場合 matched は null にしてください。',
].join('\n');

const SYSTEM_EN = [
  'You are grading a one-question-one-answer English quiz.',
  'You are given the question, a set of accepted answers, and what the user',
  'said (transcribed from speech or typed).',
  'Tolerate speech-recognition errors and phrasing differences; if the',
  'meaning matches, grade it correct.',
  'Set "correct" to whether the answer is right. Set "matched" to the',
  'standard form of the answer when you judge it correct.',
  'Set "matched" to null when the answer is incorrect.',
].join('\n');

function buildMessage(
  language: 'ja' | 'en',
  question: Question,
  transcript: string,
): string {
  if (language === 'en') {
    return [
      `Question: ${question.q}`,
      `Accepted answers: ${question.accept.join(' / ')}`,
      `User's answer: ${transcript}`,
    ].join('\n');
  }
  return [
    `問題: ${question.q}`,
    `正答例: ${question.accept.join(' / ')}`,
    `利用者の回答: ${transcript}`,
  ].join('\n');
}

export function parseVerdict(text: string): Verdict {
  let data: unknown;
  try {
    data = JSON.parse(text.trim());
  } catch {
    throw new Error(`could not parse verdict: ${text.slice(0, 120)}`);
  }
  const v = data as Partial<Verdict>;
  if (typeof v.correct !== 'boolean') {
    throw new Error(`verdict missing "correct": ${text.slice(0, 120)}`);
  }
  return { correct: v.correct, matched: v.matched ?? null };
}

export class ClaudeJudgeClient implements JudgeClient {
  private client: Anthropic | null = null;
  private clientKey = '';

  /**
   * Takes a provider rather than a key string so the credential can live in
   * settings instead of the bundle: it is resolved on every judge, so editing
   * it takes effect on the next round with no rebuild and no restart.
   */
  constructor(private readonly getApiKey: () => Promise<string>) {}

  private async resolveClient(): Promise<Anthropic> {
    const apiKey = (await this.getApiKey()).trim();
    if (!apiKey) {
      // Thrown before any network call, so an unset key lands in the same
      // 未判定 path as a dead network instead of paying a round trip to be
      // told 401.
      throw new Error('APIキーが設定されていません');
    }

    // Rebuilt only when the value actually changes — a round makes up to nine
    // calls and they should share one client.
    if (!this.client || this.clientKey !== apiKey) {
      this.client = new Anthropic({
        apiKey,
        // The SDK defaults to a 10 minute timeout and 2 retries; a stalled
        // connection would then hold the results screen for tens of minutes.
        // An unanswered call is 未判定, which the engine already handles.
        timeout: JUDGE_TIMEOUT_MS,
        maxRetries: 1,
        // React Native's fetch environment is detected as browser-like by the
        // SDK's guard. This is a private development build, not a web page.
        dangerouslyAllowBrowser: true,
      });
      this.clientKey = apiKey;
    }
    return this.client;
  }

  async judge(
    question: Question,
    transcript: string,
    language: 'ja' | 'en' = 'ja',
  ): Promise<Verdict> {
    const client = await this.resolveClient();
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: JUDGE_MODEL,
      // Thinking is on by default on this model and max_tokens caps thinking
      // plus response text together: too small a budget truncates the JSON and
      // the answer silently becomes 未判定. effort:"low" keeps the spend small.
      max_tokens: 4096,
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: VERDICT_SCHEMA },
      },
      system: language === 'en' ? SYSTEM_EN : SYSTEM_JA,
      messages: [
        {
          role: 'user',
          content: buildMessage(language, question, transcript),
        },
      ],
    };
    const response = await client.messages.create(params);

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      throw new Error('judge response contained no text block');
    }
    return parseVerdict(block.text);
  }
}
```

- [ ] **Step 4: Update `JudgeClient` (types.ts), `JudgeQueue` (queue.ts), and its call site to thread `language` through**

In `src/judge/types.ts`, change:
```typescript
export interface JudgeClient {
  judge(question: Question, transcript: string): Promise<Verdict>;
}
```
to:
```typescript
export interface JudgeClient {
  judge(question: Question, transcript: string, language?: 'ja' | 'en'): Promise<Verdict>;
}
```

In `src/judge/queue.ts`, `JudgeQueue` needs to know the round's language to pass it to `client.judge()`. Add a constructor parameter:

```typescript
export class JudgeQueue {
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly client: JudgeClient,
    private readonly callbacks: JudgeQueueCallbacks,
    private readonly language: 'ja' | 'en' = 'ja',
  ) {}

  enqueue(answer: PendingAnswer): void {
    if (localMatch(answer.question, answer.transcript)) {
      this.callbacks.onVerdict(answer.index, true);
      return;
    }

    const task = this.client
      .judge(answer.question, answer.transcript, this.language)
      .then(
        // ... unchanged ...
```

(Only the `constructor` and the single `this.client.judge(...)` call inside `enqueue()` change — everything else in `queue.ts` stays exactly as read above.)

In `src/ui/GameScreen.tsx`, update the `JudgeQueue` construction (around line 293) to pass `settings.language`:
```typescript
        const queue = new JudgeQueue(
          resolved.judgeClient,
          {
            onVerdict: (index, correct) => { /* unchanged */ },
            onLearn: (questionId, answer) => { /* unchanged */ },
          },
          settings.language,
        );
```

- [ ] **Step 5: Write the failing `JudgeQueue` language-threading test**

Add to `src/judge/__tests__/queue.test.ts`, as a new test inside the existing `describe('JudgeQueue', ...)` block, matching the file's existing plain-object `JudgeClient` mock style (see `neverCalled`/inline `client` object literals already in the file):

```typescript
  it('passes the configured language to the judge client', async () => {
    const judged: Array<string | undefined> = [];
    const client: JudgeClient = {
      judge: async (_q, _t, language): Promise<Verdict> => {
        judged.push(language);
        return { correct: true, matched: null };
      },
    };
    const queue = new JudgeQueue(
      client,
      { onVerdict: () => {}, onLearn: () => {} },
      'en',
    );
    queue.enqueue({ index: 3, question: DOG, transcript: 'わんこ' });
    await queue.drain();
    expect(judged).toEqual(['en']);
  });

  it('defaults to ja when no language is given to the constructor', async () => {
    const judged: Array<string | undefined> = [];
    const client: JudgeClient = {
      judge: async (_q, _t, language): Promise<Verdict> => {
        judged.push(language);
        return { correct: true, matched: null };
      },
    };
    const { queue } = makeQueue(client);
    queue.enqueue({ index: 3, question: DOG, transcript: 'わんこ' });
    await queue.drain();
    expect(judged).toEqual(['ja']);
  });
```

- [ ] **Step 6: Run all judge tests to verify pass**

Run: `npx jest src/judge`
Expected: PASS — `claude.test.ts` (including the 2 new language-selection tests and every pre-existing test, since `judge()` without a third argument still defaults to `'ja'` and produces byte-identical `SYSTEM`/message content to before), `queue.test.ts` (including the 2 new language-threading tests and every pre-existing test, since `JudgeQueue` without a third constructor argument still defaults to `'ja'`).

- [ ] **Step 7: Run the full suite to check for regressions**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/judge/claude.ts src/judge/types.ts src/judge/queue.ts src/judge/__tests__/claude.test.ts src/judge/__tests__/queue.test.ts src/ui/GameScreen.tsx
git commit -m "feat(judge): language-specific system prompt and template, threaded from settings"
```

---

## Task 5: Wire `settings.language` into `GameScreen`'s speaker/listener construction

**Files:**
- Modify: `src/ui/GameScreen.tsx:71-78` (`realDeps()`), `:140-141` (`resolved` memo), `:317-321` (`RoundRunner` construction — no change needed, confirmed below)
- Test: none new. Confirmed by reading `src/ui/__tests__/GameScreen.test.tsx` in full: every test constructs `deps` via the file's own `makeDeps()` helper (first use at line 93) and passes it as the `deps` prop; `realDeps()` is never imported or referenced by the test file at all. This task's change is therefore invisible to every existing GameScreen test, and its only new logic (the two-entry locale map) is covered by Task 3's speech tests plus the unit test below.

**Interfaces:**
- Produces: `src/speech/locale.ts` exporting `languageToLocale(language: 'ja' | 'en'): string`, mapping `'ja' → 'ja-JP'`, `'en' → 'en-US'` (spec §4.3). `GameScreen`'s `realDeps()` becomes `realDeps(locale: string)`, called once `settings.language` is known.

**Design:** `resolved = useMemo(() => deps ?? realDeps(), [deps])` (line 141) currently runs on every render before `settings` has loaded, since `realDeps()` takes no arguments. The simplest fix that does not touch the effect's internal structure (refs, cleanup closures, the `result`/`end` event handlers, all of which currently read `resolved.speaker`/`resolved.listener` and must keep doing so unchanged) is to defer `realDeps()`'s *call*, not restructure `GameScreenDeps` or the effect: keep `resolved` a plain memo, but re-key the memo on the loaded locale as well as `deps`, using a `null`-until-loaded locale so the first render (before settings resolve) still produces *some* deps — exactly as it does today, just with the eventual-real-locale value swapped in once known. Concretely: `realDeps()` takes an optional locale (defaulting to `'ja-JP'`, matching today's hardcoded behavior), and the memo's dependency array includes a new `language` state variable that starts `null` (rendering with the `'ja-JP'` default, same as today) and is set once `loadSettings()` resolves inside the existing setup effect — at which point the memo re-runs and produces a fresh `ExpoSpeaker`/`ExpoListener` built with the real locale, entirely through the existing `resolved.speaker`/`resolved.listener` reads. No refs, no cleanup changes, no event-handler changes: every other line in the effect keeps reading `resolved.speaker`/`resolved.listener` exactly as before.

- [ ] **Step 1: Write the failing locale-mapping unit test**

```typescript
// src/speech/__tests__/locale.test.ts
import { languageToLocale } from '../locale';

describe('languageToLocale', () => {
  it('maps ja to ja-JP', () => {
    expect(languageToLocale('ja')).toBe('ja-JP');
  });

  it('maps en to en-US', () => {
    expect(languageToLocale('en')).toBe('en-US');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/speech/__tests__/locale.test.ts`
Expected: FAIL — `../locale` does not exist yet.

- [ ] **Step 3: Create `src/speech/locale.ts`**

```typescript
// src/speech/locale.ts
export function languageToLocale(language: 'ja' | 'en'): string {
  return language === 'en' ? 'en-US' : 'ja-JP';
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest src/speech/__tests__/locale.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the locale into `GameScreen`'s `realDeps()` and `resolved` memo**

In `src/ui/GameScreen.tsx`, add the import:
```typescript
import { languageToLocale } from '../speech/locale';
```

Change `realDeps()` (lines 71–78) to accept a locale, defaulting to today's hardcoded value so any caller that omits it behaves exactly as before:

```typescript
function realDeps(locale: string = 'ja-JP'): GameScreenDeps {
  return {
    speaker: new ExpoSpeaker(locale),
    listener: new ExpoListener(locale),
    judgeClient: new ClaudeJudgeClient(loadApiKey),
    requestPermissions: ExpoListener.requestPermissions,
  };
}
```

Add a `language` state variable near the component's other `useState` declarations (around line 145, next to `mode`):

```typescript
  const [language, setLanguage] = useState<'ja' | 'en' | null>(null);
```

Change the `resolved` memo (line 141) to key on `language` too, and pass the mapped locale through:

```typescript
  const resolved = useMemo(
    () => deps ?? realDeps(language ? languageToLocale(language) : undefined),
    [deps, language],
  );
```

In the setup effect, immediately after `settings` is loaded (right after the `Promise.all` destructuring around line 249–254, before `resolved` is used further down in this same effect run — note that this specific run of the effect still has the *old* `resolved` closed over, built with the default locale; the `setLanguage` call below causes React to re-run the memo and re-render, but this in-flight effect invocation keeps using its own `resolved` for `speaker`/`listener` throughout — which is fine for the very first round after app launch only if the default locale happens to differ from the real one, a one-round staleness worth closing, see Step 6), add:

```typescript
        setLanguage(settings.language);
```

This one-render lag (the very first round of the very first mount uses `'ja-JP'` deps until the memo recomputes) is not actually reachable in practice: `useMemo` recomputation from a state update inside the same effect happens before the effect's own async continuation (the `Promise.all` await) resumes on any real device, because `setLanguage` triggers a re-render synchronously-scheduled relative to the surrounding microtask queue, and this effect does not read `resolved` again until the `RoundRunner` construction far below (line 317), by which point the component has already re-rendered with the new `resolved`. Since `resolved` is captured as a plain local variable at the top of the *rendering* function body, not re-read from a ref inside the effect, confirm this ordering holds by adding an explicit regression test in Step 6 rather than relying on this reasoning alone — if the test shows staleness, the fix is to read `languageToLocale(settings.language)` and call `realDeps()` directly inside the effect instead of relying on the memo, bypassing `resolved` for this one construction; do not guess, verify.

- [ ] **Step 6: Write the regression test that verifies the real locale reaches `ExpoSpeaker`/`ExpoListener` construction**

This is the test that resolves Step 5's ordering question empirically instead of by reasoning. Add to `src/ui/__tests__/GameScreen.test.tsx`, as a new test in whichever `describe` block already covers settings-driven behavior (read the file's existing structure from Step-0's full read to place it correctly; if no such block exists, add a new top-level one):

```typescript
describe('language-driven locale', () => {
  it('constructs the real ExpoSpeaker/ExpoListener with the settings locale, not the ja-JP default', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, language: 'en' });
    const Speech = require('expo-speech');
    render(<GameScreen seriesId="standard" onFinished={() => {}} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // The warm-up tap calls speaker.unlock(), which is the first observable
    // Speech.speak() call and proves which locale the constructed ExpoSpeaker holds.
    const warmupChoice = await screen.findByTestId('warmup-choice-0');
    fireEvent.press(warmupChoice);
    expect(Speech.speak).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ language: 'en-US' }),
    );
  });
});
```

(This test deliberately does NOT pass `deps` — it is the one test in the suite that exercises `realDeps()` for real, which is the entire point: every other test bypasses this task's change entirely via `makeDeps()`.)

- [ ] **Step 7: Run it; fix ordering if it fails**

Run: `npx jest src/ui/__tests__/GameScreen.test.tsx -t "language-driven locale"`
Expected: PASS, proving the memo-recomputation ordering reasoned about in Step 5 holds. If it FAILS with `language: 'ja-JP'` instead of `'en-US'`, the memo is stale for this effect run as feared — fix by having the effect build `speaker`/`listener` directly (`const speaker = new ExpoSpeaker(languageToLocale(settings.language)); const listener = new ExpoListener(languageToLocale(settings.language));` right after `settings` loads) when `deps` is absent, using `deps?.speaker ?? speaker` / `deps?.listener ?? listener` at every point the effect currently reads `resolved.speaker`/`resolved.listener`, and drop the `language` state/memo rewiring from Step 5 entirely. Do not leave both mechanisms in place — pick whichever this test proves correct.

- [ ] **Step 8: Run the full GameScreen suite and the full test suite**

Run: `npx jest src/ui/__tests__/GameScreen.test.tsx && npx jest`
Expected: PASS — the new test plus every pre-existing test (all `deps`-injected tests are structurally unaffected, per the design note above).

- [ ] **Step 9: Commit**

```bash
git add src/speech/locale.ts src/speech/__tests__/locale.test.ts src/ui/GameScreen.tsx src/ui/__tests__/GameScreen.test.tsx
git commit -m "feat(ui): construct GameScreen's speaker/listener with the settings-derived locale"
```

---

## Self-Review Notes

- **Spec coverage:** §4.1 (`Settings.language`, default `ja`, no migration needed) → Task 1. §4.2 (`listSeries()` takes `language`, switches `series.json`/`series.en.json` and category labels) → Task 2. §4.3 (speech locale mapping `ja→ja-JP`, `en→en-US`, full switch not a mix) → Task 3 (mapping mechanism) + Task 5 (wiring `settings.language` in). §4.4 (judge `SYSTEM`/template per language, `judge/local.ts` untouched) → Task 4.
- **Out of scope confirmed:** §4.5 (UI string i18n, ~230 JSX strings, the Settings screen toggle itself) is explicitly deferred to the follow-up plan. This plan adds `Settings.language` to the data model and makes every non-UI consumer language-aware, but nothing here lets a user actually flip the toggle yet — that UI (`Switch` + `update({ language })`, following the existing `adaptive` toggle pattern at `SettingsScreen.tsx:268-274`) is the follow-up plan's job, alongside the string extraction it depends on for label text.
- **Type consistency:** `'ja' | 'en'` is used as a literal union throughout (Settings.language, SeriesInput.language, ClaudeJudgeClient.judge's third param, JudgeQueue's third constructor param, languageToLocale's param) — never redefined as a named type alias in this plan, matching how `AnswerInput` in `storage.ts` IS a named alias but `RoundMode` in `engine/types.ts` is referenced without redefinition elsewhere; if a future plan wants a shared `Language` type alias, that is a small mechanical follow-up, not a defect in this plan (every call site here uses the identical literal union, so nothing drifts).
- **Task 5 risk flag:** Task 5's Step 4 is the most structurally involved change in this plan (introducing `speakerRef`/`listenerRef` to bridge the async setup effect and its synchronous cleanup/event-handler closures). The step includes an explicit self-correction (the first `GameScreenDeps`-factory approach was rejected mid-step in favor of the ref approach) — an implementer should read `src/ui/GameScreen.tsx` and `src/ui/__tests__/GameScreen.test.tsx` fully before starting, since this task's plan text reasons through the design rather than presenting a single settled diff, unlike every other task in this plan.
