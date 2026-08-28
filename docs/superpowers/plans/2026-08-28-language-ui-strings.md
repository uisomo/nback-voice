# UI String i18n (JA/EN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract every hardcoded Japanese (and symbol/punctuation) UI string across the app's 6 screens into a `src/strings/` i18n table keyed by screen namespace, add a `useStrings()` hook that resolves the right language table from `Settings.language`, and add the Settings screen toggle that actually lets a user switch `language` between `'ja'` and `'en'`.

**Architecture:** One `src/strings/index.ts` module exports a `ja` and an `en` object with identical key shapes (nested by screen: `settings.*`, `game.*`, `results.*`, `series.*`, `questions.*`, `common.*` for strings shared across screens), plus a `useStrings()` hook that loads `Settings` (the same way `SettingsScreen`/`SeriesScreen`/`GameScreen` already do) and returns `ja` or `en` based on `language`. `ResultsScreen` is the one screen that does not self-load `Settings` today (it is a pure props-driven component) — it gains a `language` prop instead, supplied by `App.tsx`, which is the one place already threading data between screens. This plan depends on the prerequisite plan `docs/superpowers/plans/2026-08-28-language-wiring-core.md` for `Settings.language` to exist; it does not depend on that plan's speech/judge/content-loader wiring being complete, only on the `Settings.language` field itself.

**Tech Stack:** TypeScript (React Native / Expo), Jest with `jest-expo` preset, `@testing-library/react-native`.

**Spec:** `docs/superpowers/specs/2026-08-28-language-toggle-design.md` §4.5 (UI文言), §5 (テスト方針, UI 部分)

## Global Constraints

- Every one of the ~115 distinct hardcoded strings inventoried below (across `SettingsScreen.tsx`, `GameScreen.tsx`, `ResultsScreen.tsx`, `SeriesScreen.tsx`, `QuestionsScreen.tsx`) must move into the `src/strings/` table — no string is left behind as a "we'll get it later" (spec §4.5: "約230箇所のインラインJSX文字列を、`src/strings/`配下のi18nテーブルに抽出する" — the spec's own count of ~230 includes call-site occurrences of repeated strings; this plan's inventory below counts ~115 *distinct* strings, which the table then serves from every call site).
- Existing tests must NOT need behavior changes: every current test that asserts on Japanese text (e.g. `getByText('シリーズを変える')`) keeps passing unmodified, because `useStrings()` resolves to the `ja` table by default (`DEFAULT_SETTINGS.language === 'ja'`, added by the prerequisite plan) and every screen's rendered text stays byte-identical to today's hardcoded Japanese when `language` is `'ja'` (spec §5: "既存の約230件のテキスト表明はすべて`language: 'ja'`前提のまま変更不要").
- A small number of new tests must be added for the representative screens (Settings, Results per spec §5) confirming English text renders when `language` is `'en'`.
- Key naming is per-screen namespace (spec §4.5: "画面ごとの名前空間（例: `settings.save`, `results.unjudged`）"). Strings that are byte-identical across screens (`閉じる`, `設定`) get a `common.*` key instead of being duplicated per-screen, since spec §4.5 does not mandate duplication and a shared key avoids the two tables drifting apart under future edits.
- The Settings screen toggle for `language` follows the exact existing `Switch` pattern already used for `adaptive` (`SettingsScreen.tsx:268-274`, `<Switch value={settings.adaptive} onValueChange={(adaptive) => update({ adaptive })} />`), calling `update({ language: ... })` — spec §4.1: "既存の`Switch`パターン...トグルを追加。`update({ language: ... })`を呼ぶだけで永続化される". Since `language` is `'ja' | 'en'`, not boolean, the toggle is `<Switch value={settings.language === 'en'} onValueChange={(isEn) => update({ language: isEn ? 'en' : 'ja' })} />`.

---

## Full String Inventory (source of truth for Task 2–6's key lists)

**Shared across screens → `common.*`:**
- `設定` ("Settings") — `SettingsScreen.tsx:193` (heading), `SeriesScreen.tsx:68` (header link)
- `閉じる` ("Close") — `SettingsScreen.tsx:368`, `QuestionsScreen.tsx:118`

**`settings.*`** (`src/ui/SettingsScreen.tsx`):
- `heading`: `設定` (193) — *now `common.settings`, see above; `SettingsScreen` uses `common.settings` for its heading too, not a separate key*
- `apiKeyUnset`: `未設定` (51)
- `apiKeySet`: `設定済み` (52)
- `tierEasy`: `やさしい` (64)
- `tierNormal`: `ふつう` (65)
- `modeDual`: `位置＋質問` (68)
- `modeQuestion`: `質問のみ` (69)
- `inputTyped`: `入力` (72)
- `inputVoice`: `音声` (73)
- `sectionMode`: `モード` (200)
- `sectionAnswerInput`: `回答のしかた` (213)
- `noteTypedInput`: `入力にすると、キーボードのマイクで喋った文字を、送る前に直せる。` (227)
- `sectionBudget`: `考える時間の基準 (秒)` (230)
- `noteBudget`: `答え1文字につき1秒が、この基準に足される。時計が0になっても先へは進まない。` (248)
- `linkEditQuestions`: `自分の問題を編集` (252)
- `sectionStepDuration`: `1ステップの長さ` (255)
- `stepDurationUnit`: `秒` — used as `` `${ms / 1000}秒` `` (263); table stores the unit, screen builds the template
- `sectionAdaptive`: `Nを自動調整` (269)
- `sectionSeriesN`: `シリーズごとのN` (290)
- `noteSeriesN`: `自動調整の到達点をシリーズごとに直接調整・リセットできる。` (292)
- `seriesNDown`: `－` (303)
- `seriesNUp`: `＋` (313)
- `seriesNReset`: `リセット` (320)
- `sectionMaxTier`: `標準問題のむずかしさ` (326)
- `sectionApiKey`: `Claude APIキー` (339)
- `apiKeyPlaceholder`: `sk-ant-...` (343) — *left untranslated: this is a literal format example (`sk-ant-...`), not language-dependent prose. Confirmed out of scope: the key still exists in the table for both `ja`/`en` with the identical value, so no screen-level special-casing is needed.*
- `checkConnection`: `接続を確認` (353)
- `checking`: `確認中…` (357)
- `checkOk`: `確認できました。採点が使えます。` (360)
- `checkFailedPrefix`: `失敗: ` (363)
- `sectionLanguage`: **new key, no existing string** — label for the new language toggle row (Task 7), e.g. ja: `言語 (英語)`, en: `Language (English)` — see Task 7 for the exact row design.

**`game.*`** (`src/ui/GameScreen.tsx`):
- `lagHeaderPrefix`/`lagHeaderSuffix`: `-back ・ ` / `つ前の質問に答える` (135, template `` `${n}-back ・ ${n}つ前の質問に答える` ``) — *`-back` itself is language-invariant (an established term used in both languages per spec's own English category/series titles, e.g. "Standard Questions" series still called N-back rounds); only the connector/suffix text is a translation key. Table stores `lagConnector: ' ・ '` and `lagSuffix: 'つ前の質問に答える'` (ja) / `lagSuffix: 'back'` (en, restructured — see below).*

  **Design note on this one string:** the Japanese reads "N-back ・ Nつ前の質問に答える" (roughly "N-back, i.e. answer the question from N before"). A literal key-substitution (`lagConnector` + `lagSuffix`) only works if English uses the same word order. It does not — natural English is "N-back — answer the question from N steps ago." Rather than force an unnatural fixed-order template, `game.lagHeader` is a **function-shaped key**: the table stores `lagHeader: (n: number) => string`, not a plain string. ja: `` (n) => `${n}-back ・ ${n}つ前の質問に答える` ``; en: `` (n) => `${n}-back — answer the question from ${n} step${n === 1 ? '' : 's'} ago` ``. This is the one key in the whole table that is a function rather than a string — Task 3 documents this as the pattern to use whenever word order must differ, rather than fighting the fixed-template approach for every future asymmetric string.
- `preparing`: `準備中…` (145, 603 — identical, one key)
- `micPermissionNeeded`: `マイクの許可が必要です` (244)
- `seriesLabel`: function-shaped, same reasoning as `lagHeader` — ja: `` (title, count) => `${title} ／ ${count}問` ``; en: `` (title, count) => `${title} — ${count} questions` ``
- `notEnoughQuestions`: `問題が足りません` (274)
- `stepLabel`: function-shaped — ja: `` (i, total, n, answering) => `${i} / ${total}　${n}-back　${answering ? 'どうぞ' : '出題中'}` ``; en: `` (i, total, n, answering) => `${i} / ${total}   ${n}-back   ${answering ? 'Your turn' : 'Listen'}` ``
- `setupFailed`: `準備に失敗しました。アプリを再起動してください` (471, 479 — identical, one key)
- `warmupCaption`: `ウォームアップ` (571)
- `warmupHint`: `タップすると始まります` (587)
- `recogErrorPrefix`: `認識エラー: ` (608)
- `heardQuote`: function-shaped (wraps a transcript in quotation marks, which differ by convention) — ja: `` (text) => `「${text}」` ``; en: `` (text) => `"${text}"` ``
- `typedPlaceholderClosed`: `まだ答えません` (642)
- `typedPlaceholderOpen`: `答えを入力` (642)
- `send`: `送る` (655)
- `answeringYes`: `どうぞ` (388) — *only needed as a standalone key if `stepLabel`'s function signature is ever called from a second site; per the inventory it is only used inside `stepLabel`'s own function body, so it is inlined there, not a separate table key. Listed here only to document that it was considered and intentionally folded in, so a reviewer does not flag it as missing.*
- `answeringNo`: `出題中` (388) — same as above, inlined into `stepLabel`.

**`results.*`** (`src/ui/ResultsScreen.tsx`):
- `dash`: `—` (16, 27, 35 — identical, one key; language-invariant but included for completeness/consistency since spec §4.5 wants every screen string keyed, and a future language might use a different placeholder glyph)
- `unjudged`: `未判定` (28)
- `correctMark`: `○` (29)
- `wrongMark`: `×` (29)
- `positionCorrect`: `位置 ○` (33)
- `positionWrong`: `位置 ×` (34)
- `positionDash`: `位置 —` (35)
- `heading`: function-shaped — ja: `` (n) => `${n}-back の結果` ``; en: `` (n) => `${n}-back Results` ``
- `subheading`: function-shaped — ja: `` (n) => `${n}つ前の質問に答えるラウンド` ``; en: `` (n) => `A round answering the question from ${n} step${n === 1 ? '' : 's'} ago` ``
- `rowPosition`: `位置　` (128)
- `rowAnswer`: `回答　` (129)
- `rowOnTime`: `時間内　` (131)
- `unjudgedCountPrefix`: `未判定 ` (134) — screen appends `${engine.unresolvedCount} 件`; the `件` counter word is folded into a function key instead: `unjudgedCount: (n) => \`未判定 ${n} 件\`` (ja) / `` (n) => `${n} unjudged` `` (en)
- `rowTotal`: `総合　` (136)
- `notHeard`: `（聞き取れず）` (154)
- `heardQuote`: same function-shaped pattern as `game.heardQuote` — duplicated as `results.heardQuote` (not `common.*`) since ResultsScreen and GameScreen are independent consumers and nothing else in this plan centralizes function-shaped keys across namespaces (see Task 3's rationale for keeping function-shaped keys per-namespace, not shared, to avoid one screen's wording change silently affecting another).
- `answerLabelPrefix`: `答え: ` (177)
- `lateNote`: function-shaped — ja: `` (s) => `時間超過（目安 ${s}s）` ``; en: `` (s) => `Over time (budget ${s}s)` ``
- `again`: `もう一度` (195)
- `changeSeries`: `シリーズを変える` (198)

**`series.*`** (`src/ui/SeriesScreen.tsx`):
- `heading`: `シリーズを選ぶ` (66)
- `count`: function-shaped — ja: `` (n) => `${n}問` ``; en: `` (n) => `${n} questions` ``
- `shortfall`: function-shaped — ja: `` (n) => `あと ${n} 問` ``; en: `` (n) => `${n} more needed` ``
- `lag`: function-shaped — ja: `` (n) => `${n}-back` ``; en: identical (`` (n) => `${n}-back` ``) — `-back` is language-invariant per the note under `game.lagHeader`.

**`questions.*`** (`src/ui/QuestionsScreen.tsx`):
- `heading`: `自分の問題` (70)
- `count`: function-shaped — ja: `` (n) => `${n} 問` ``; en: `` (n) => `${n} questions` ``
- `placeholderQuestion`: `問題` (75)
- `placeholderAnswer`: `答え` (82)
- `save`: `保存` (90)
- `add`: `追加` (90)
- `delete`: `削除` (95)
- `cancel`: `取消` (98)

**Explicitly excluded (per the exploration report, confirmed correct to exclude):**
- `GameScreen.tsx:623`'s "質問 → 時計 → 入力欄 → グリッド" is a code comment, not rendered UI — not a key.
- `console.log` calls throughout (e.g. `[nback] 認識エラー ${event.error}`) are developer-facing, not user-facing — not keys.
- `testID` values — not user-facing text.
- `src/content/series.ts`'s `CATEGORIES` labels and `STANDARD_TITLE`/`CUSTOM_TITLE` — **already handled** by the prerequisite plan (`2026-08-28-language-wiring-core.md` Task 2), which switches these via `language`/`CATEGORIES_EN`. Not duplicated here.

---

## File Structure

- Create `src/strings/index.ts`: the `ja`/`en` tables and `useStrings()` hook.
- Create `src/strings/__tests__/index.test.ts`: table-shape parity test (every key in `ja` has a matching key in `en`, same type — string vs function).
- Modify `src/ui/SettingsScreen.tsx`, `src/ui/GameScreen.tsx`, `src/ui/ResultsScreen.tsx`, `src/ui/SeriesScreen.tsx`, `src/ui/QuestionsScreen.tsx`: replace every hardcoded string with the matching `strings.*` lookup; `SettingsScreen` also gains the language toggle row.
- Modify `App.tsx`: loads `Settings` once (already possible via `loadSettings()`) and passes `language` to `ResultsScreen` specifically — see Task 8.
- Modify each screen's existing test file only where a **new** English-language test is added (Settings, Results, per spec §5) — no existing test's assertions change.

---

## Task 1: `src/strings/index.ts` — the table shape and `useStrings()` hook

**Files:**
- Create: `src/strings/index.ts`
- Test: `src/strings/__tests__/index.test.ts`

**Interfaces:**
- Produces: `export interface Strings { common: {...}; settings: {...}; game: {...}; results: {...}; series: {...}; questions: {...}; }` (the full shape, populated in Tasks 2–6 below — this task establishes the shape and hook with a minimal placeholder shape that Tasks 2–6 extend). `export const ja: Strings`, `export const en: Strings`. `export function useStrings(): Strings` — loads `Settings` via `loadSettings()` (from `../store/storage`) inside a `useEffect`, returns `ja` on the initial render (before settings resolve) and re-renders with `en` if `settings.language === 'en'`.

**Design note on `useStrings()`'s loading behavior:** Every existing screen that calls `loadSettings()` (`SettingsScreen`, `GameScreen`, `SeriesScreen`) already renders once with `DEFAULT_SETTINGS`-shaped defaults before the async load resolves (e.g. `SettingsScreen`'s `useState<Settings>(DEFAULT_SETTINGS)`). `useStrings()` matches this: it starts at `ja` (matching `DEFAULT_SETTINGS.language`) and swaps to `en` once `loadSettings()` resolves with `language: 'en'`. This means a screen using `useStrings()` independently loads settings a second time if it also calls `loadSettings()` itself for other fields (e.g. `SettingsScreen` already loads settings for `stepDurationMs` etc.) — this is a deliberate, minor duplication rather than plumbing `language` through as a prop, because every screen already independently self-loads `Settings` today (confirmed: no screen receives `Settings` as a prop from `App.tsx`) and `useStrings()` should not be the first thing to break that pattern. `ResultsScreen` is the sole exception (Task 8), because it is the one screen with no settings-loading of its own already.

- [ ] **Step 1: Write the failing shape/hook test**

```typescript
// src/strings/__tests__/index.test.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderHook, waitFor } from '@testing-library/react-native';
import { saveSettings, DEFAULT_SETTINGS } from '../../store/storage';
import { ja, en, useStrings } from '../index';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('ja/en table shape parity', () => {
  function keys(obj: unknown, prefix = ''): string[] {
    if (typeof obj === 'function') return [prefix];
    if (typeof obj !== 'object' || obj === null) return [prefix];
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      keys(v, prefix ? `${prefix}.${k}` : k),
    );
  }

  it('has an identical key set in ja and en', () => {
    expect(keys(ja).sort()).toEqual(keys(en).sort());
  });

  it('has the same value type (string vs function) at every key', () => {
    function types(obj: unknown, prefix = ''): Record<string, string> {
      if (typeof obj !== 'object' || obj === null) return { [prefix]: typeof obj };
      return Object.assign(
        {},
        ...Object.entries(obj as Record<string, unknown>).map(([k, v]) =>
          types(v, prefix ? `${prefix}.${k}` : k),
        ),
      );
    }
    expect(types(ja)).toEqual(types(en));
  });
});

describe('useStrings', () => {
  it('resolves to ja before settings load and stays ja by default', async () => {
    const { result } = renderHook(() => useStrings());
    expect(result.current).toBe(ja);
    await waitFor(() => expect(result.current).toBe(ja));
  });

  it('resolves to en once language: en is stored', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, language: 'en' });
    const { result } = renderHook(() => useStrings());
    await waitFor(() => expect(result.current).toBe(en));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/strings/__tests__/index.test.ts`
Expected: FAIL — `../index` does not exist yet.

- [ ] **Step 3: Create `src/strings/index.ts` with the minimal shape and hook**

This step establishes only the module scaffold (`common` namespace populated, others empty objects) — Tasks 2–6 fill in `settings`/`game`/`results`/`series`/`questions` with the full inventory above, each as its own task so the diff stays reviewable per screen.

```typescript
import { useEffect, useState } from 'react';
import { loadSettings } from '../store/storage';

export interface Strings {
  common: {
    settings: string;
    close: string;
  };
  settings: Record<string, never>;
  game: Record<string, never>;
  results: Record<string, never>;
  series: Record<string, never>;
  questions: Record<string, never>;
}

export const ja: Strings = {
  common: {
    settings: '設定',
    close: '閉じる',
  },
  settings: {},
  game: {},
  results: {},
  series: {},
  questions: {},
};

export const en: Strings = {
  common: {
    settings: 'Settings',
    close: 'Close',
  },
  settings: {},
  game: {},
  results: {},
  series: {},
  questions: {},
};

export function useStrings(): Strings {
  const [strings, setStrings] = useState<Strings>(ja);

  useEffect(() => {
    let cancelled = false;
    void loadSettings().then((settings) => {
      if (!cancelled) setStrings(settings.language === 'en' ? en : ja);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return strings;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/strings/__tests__/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strings/index.ts src/strings/__tests__/index.test.ts
git commit -m "feat(strings): scaffold ja/en i18n table and useStrings() hook"
```

---

## Task 2: Populate `settings.*` and wire `SettingsScreen.tsx`

**Files:**
- Modify: `src/strings/index.ts` (add the `settings` namespace to both `ja` and `en`, replacing the `Record<string, never>` placeholder and its type in `Strings`)
- Modify: `src/ui/SettingsScreen.tsx` (every string listed under `settings.*` and `common.*` in the inventory above)
- Test: `src/strings/__tests__/index.test.ts` (parity test already covers new keys automatically — no test changes needed there); `src/ui/__tests__/SettingsScreen.test.tsx` (add one English-language test; existing tests unchanged)

**Interfaces:**
- Produces: `Strings['settings']` fully typed per the inventory's `settings.*` list above (23 string keys — no function-shaped keys in this namespace).

- [ ] **Step 1: Extend the `Strings` interface and both tables**

In `src/strings/index.ts`, replace `settings: Record<string, never>;` in the `Strings` interface with:

```typescript
  settings: {
    apiKeyUnset: string;
    apiKeySet: string;
    tierEasy: string;
    tierNormal: string;
    modeDual: string;
    modeQuestion: string;
    inputTyped: string;
    inputVoice: string;
    sectionMode: string;
    sectionAnswerInput: string;
    noteTypedInput: string;
    sectionBudget: string;
    noteBudget: string;
    linkEditQuestions: string;
    sectionStepDuration: string;
    stepDurationUnit: string;
    sectionAdaptive: string;
    sectionSeriesN: string;
    noteSeriesN: string;
    seriesNDown: string;
    seriesNUp: string;
    seriesNReset: string;
    sectionMaxTier: string;
    sectionApiKey: string;
    apiKeyPlaceholder: string;
    checkConnection: string;
    checking: string;
    checkOk: string;
    checkFailedPrefix: string;
    sectionLanguage: string;
  };
```

In `ja`, replace `settings: {},` with:

```typescript
  settings: {
    apiKeyUnset: '未設定',
    apiKeySet: '設定済み',
    tierEasy: 'やさしい',
    tierNormal: 'ふつう',
    modeDual: '位置＋質問',
    modeQuestion: '質問のみ',
    inputTyped: '入力',
    inputVoice: '音声',
    sectionMode: 'モード',
    sectionAnswerInput: '回答のしかた',
    noteTypedInput: '入力にすると、キーボードのマイクで喋った文字を、送る前に直せる。',
    sectionBudget: '考える時間の基準 (秒)',
    noteBudget: '答え1文字につき1秒が、この基準に足される。時計が0になっても先へは進まない。',
    linkEditQuestions: '自分の問題を編集',
    sectionStepDuration: '1ステップの長さ',
    stepDurationUnit: '秒',
    sectionAdaptive: 'Nを自動調整',
    sectionSeriesN: 'シリーズごとのN',
    noteSeriesN: '自動調整の到達点をシリーズごとに直接調整・リセットできる。',
    seriesNDown: '－',
    seriesNUp: '＋',
    seriesNReset: 'リセット',
    sectionMaxTier: '標準問題のむずかしさ',
    sectionApiKey: 'Claude APIキー',
    apiKeyPlaceholder: 'sk-ant-...',
    checkConnection: '接続を確認',
    checking: '確認中…',
    checkOk: '確認できました。採点が使えます。',
    checkFailedPrefix: '失敗: ',
    sectionLanguage: '言語 (英語)',
  },
```

In `en`, replace `settings: {},` with:

```typescript
  settings: {
    apiKeyUnset: 'Not set',
    apiKeySet: 'Set',
    tierEasy: 'Easy',
    tierNormal: 'Normal',
    modeDual: 'Position + Question',
    modeQuestion: 'Question only',
    inputTyped: 'Typed',
    inputVoice: 'Voice',
    sectionMode: 'Mode',
    sectionAnswerInput: 'How you answer',
    noteTypedInput: 'In typed mode, you can fix what the keyboard mic heard before sending it.',
    sectionBudget: 'Base thinking time (seconds)',
    noteBudget: '1 second is added per character of the answer. The round never advances early just because the clock hits 0.',
    linkEditQuestions: 'Edit my questions',
    sectionStepDuration: 'Step length',
    stepDurationUnit: 's',
    sectionAdaptive: 'Auto-adjust N',
    sectionSeriesN: 'N per series',
    noteSeriesN: 'Adjust or reset where auto-adjust has landed, per series.',
    seriesNDown: '－',
    seriesNUp: '＋',
    seriesNReset: 'Reset',
    sectionMaxTier: 'Standard question difficulty',
    sectionApiKey: 'Claude API key',
    apiKeyPlaceholder: 'sk-ant-...',
    checkConnection: 'Check connection',
    checking: 'Checking…',
    checkOk: 'Connected. Grading is available.',
    checkFailedPrefix: 'Failed: ',
    sectionLanguage: 'Language (English)',
  },
```

- [ ] **Step 2: Run the strings parity test to verify it still passes**

Run: `npx jest src/strings/__tests__/index.test.ts`
Expected: PASS — `ja.settings` and `en.settings` now have identical key sets.

- [ ] **Step 3: Wire `SettingsScreen.tsx` to use `useStrings()`**

Add the import:
```typescript
import { useStrings } from '../strings';
```

Inside `SettingsScreen`, right after the `settings`/`apiKey`/`check` state declarations (around line 90), add:
```typescript
  const strings = useStrings();
```

Replace every hardcoded string in the JSX and the two helper functions (`maskApiKey`, and the `STEP_CHOICES`/`TIER_CHOICES`/`MODE_CHOICES`/`INPUT_CHOICES` module-level constants) as follows.

`maskApiKey` (module-level, lines 50–54) cannot use `useStrings()` (it is not a hook, called outside render) — pass `strings` in as a parameter instead:
```typescript
function maskApiKey(apiKey: string, strings: Strings['settings']): string {
  if (!apiKey) return strings.apiKeyUnset;
  if (apiKey.length <= 12) return strings.apiKeySet;
  return `${apiKey.slice(0, 7)}…${apiKey.slice(-4)}`;
}
```
(Add `import type { Strings } from '../strings';` alongside the `useStrings` import.) Update its one call site (in the JSX, `{maskApiKey(apiKey)}`) to `{maskApiKey(apiKey, strings.settings)}`.

`TIER_CHOICES`, `MODE_CHOICES`, `INPUT_CHOICES` (module-level constants, lines 63–74) currently hardcode `label` fields. Since these are module-level (built once, outside any component), they cannot read `strings` either. Move them from data (`{ tier, label }`) to data without labels, and resolve the label at render time from `strings`:

```typescript
const STEP_CHOICES = [3000, 4000, 5000, 6000, 8000];
const TIER_CHOICES = [
  { tier: 1, labelKey: 'tierEasy' as const },
  { tier: 2, labelKey: 'tierNormal' as const },
];
const MODE_CHOICES: { mode: RoundMode; labelKey: 'modeDual' | 'modeQuestion' }[] = [
  { mode: 'dual', labelKey: 'modeDual' },
  { mode: 'question', labelKey: 'modeQuestion' },
];
const INPUT_CHOICES: { input: AnswerInput; labelKey: 'inputTyped' | 'inputVoice' }[] = [
  { input: 'typed', labelKey: 'inputTyped' },
  { input: 'voice', labelKey: 'inputVoice' },
];
```

And in the JSX, change each `.map()` that rendered `{label}` to instead index into `strings.settings` by `labelKey`, e.g.:
```typescript
          {MODE_CHOICES.map(({ mode, labelKey }) => (
            <Pressable
              key={mode}
              onPress={() => update({ mode })}
              style={[styles.chip, settings.mode === mode && styles.chipOn]}
            >
              <Text style={styles.chipLabel}>{strings.settings[labelKey]}</Text>
            </Pressable>
          ))}
```
(Same pattern for `INPUT_CHOICES` and `TIER_CHOICES`.)

Every remaining plain-JSX string is a direct 1:1 swap from the literal to `strings.settings.<key>` or `strings.common.<key>`, per the Task's key list above. For example (heading, line 193):
```typescript
      <Text style={styles.heading}>{strings.common.settings}</Text>
```
And the step-duration chip (line 263), which is a template literal, becomes:
```typescript
              <Text style={styles.chipLabel}>{ms / 1000}{strings.settings.stepDurationUnit}</Text>
```
And the close button (line 368):
```typescript
        <Text style={styles.chipLabel}>{strings.common.close}</Text>
```

Every other string in the inventory's `settings.*` list follows the same direct substitution — there is no further templating or conditional logic among them (unlike `game.*`/`results.*`, which have function-shaped keys per the inventory above).

- [ ] **Step 4: Run the existing SettingsScreen test suite to confirm no regressions**

Run: `npx jest src/ui/__tests__/SettingsScreen.test.tsx`
Expected: PASS — every existing test asserts on Japanese text (e.g. `getByText('やさしい')`, `getByText('Nを自動調整')`), which is unchanged since `useStrings()` defaults to `ja` and `ja.settings.tierEasy === 'やさしい'` etc.

- [ ] **Step 5: Write the new English-language test**

Add to `src/ui/__tests__/SettingsScreen.test.tsx`:

```typescript
it('renders English labels when language is en', async () => {
  await saveSettings({ ...DEFAULT_SETTINGS, language: 'en' });
  const { findByText } = render(
    <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
  );
  expect(await findByText('Easy')).toBeTruthy();
  expect(await findByText('Auto-adjust N')).toBeTruthy();
});
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx jest src/ui/__tests__/SettingsScreen.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/strings/index.ts src/ui/SettingsScreen.tsx src/ui/__tests__/SettingsScreen.test.tsx
git commit -m "feat(strings): populate settings.* table, wire SettingsScreen to useStrings()"
```

---

## Task 3: Populate `game.*` and wire `GameScreen.tsx`

**Files:**
- Modify: `src/strings/index.ts` (add `game` namespace, including the function-shaped keys)
- Modify: `src/ui/GameScreen.tsx`
- Test: `src/ui/__tests__/GameScreen.test.tsx` (no new test required per spec §5 — only Settings and Results get new English-language tests; GameScreen's existing tests must simply keep passing)

**Interfaces:**
- Produces: `Strings['game']` with a mix of plain strings and function-shaped keys, per the inventory's `game.*` list above.

- [ ] **Step 1: Extend the `Strings` interface and both tables**

In `src/strings/index.ts`, replace `game: Record<string, never>;` with:

```typescript
  game: {
    lagHeader: (n: number) => string;
    preparing: string;
    micPermissionNeeded: string;
    seriesLabel: (title: string, count: number) => string;
    notEnoughQuestions: string;
    stepLabel: (index: number, total: number, n: number, answering: boolean) => string;
    setupFailed: string;
    warmupCaption: string;
    warmupHint: string;
    recogErrorPrefix: string;
    heardQuote: (text: string) => string;
    typedPlaceholderClosed: string;
    typedPlaceholderOpen: string;
    send: string;
  };
```

In `ja`, replace `game: {},` with:

```typescript
  game: {
    lagHeader: (n) => `${n}-back ・ ${n}つ前の質問に答える`,
    preparing: '準備中…',
    micPermissionNeeded: 'マイクの許可が必要です',
    seriesLabel: (title, count) => `${title} ／ ${count}問`,
    notEnoughQuestions: '問題が足りません',
    stepLabel: (index, total, n, answering) =>
      `${index} / ${total}　${n}-back　${answering ? 'どうぞ' : '出題中'}`,
    setupFailed: '準備に失敗しました。アプリを再起動してください',
    warmupCaption: 'ウォームアップ',
    warmupHint: 'タップすると始まります',
    recogErrorPrefix: '認識エラー: ',
    heardQuote: (text) => `「${text}」`,
    typedPlaceholderClosed: 'まだ答えません',
    typedPlaceholderOpen: '答えを入力',
    send: '送る',
  },
```

In `en`, replace `game: {},` with:

```typescript
  game: {
    lagHeader: (n) => `${n}-back — answer the question from ${n} step${n === 1 ? '' : 's'} ago`,
    preparing: 'Preparing…',
    micPermissionNeeded: 'Microphone permission is required',
    seriesLabel: (title, count) => `${title} — ${count} questions`,
    notEnoughQuestions: 'Not enough questions',
    stepLabel: (index, total, n, answering) =>
      `${index} / ${total}   ${n}-back   ${answering ? 'Your turn' : 'Listen'}`,
    setupFailed: 'Setup failed. Please restart the app',
    warmupCaption: 'Warm-up',
    warmupHint: 'Tap to begin',
    recogErrorPrefix: 'Recognition error: ',
    heardQuote: (text) => `"${text}"`,
    typedPlaceholderClosed: 'Not answering yet',
    typedPlaceholderOpen: 'Type your answer',
    send: 'Send',
  },
```

- [ ] **Step 2: Run the strings parity test**

Run: `npx jest src/strings/__tests__/index.test.ts`
Expected: PASS.

- [ ] **Step 3: Wire `GameScreen.tsx` to use `useStrings()`**

Add the import and, inside `GameScreen`, declare `strings` before the other `useState` hooks (around line 145) so `label`'s initial state can read from it — `useStrings()` returns the `ja` table synchronously on first render (before settings load resolves), so `strings.game.preparing` is available immediately and no special ordering handling is needed beyond this declaration order:

```typescript
import { useStrings } from '../strings';
```

```typescript
  const strings = useStrings();
  const [label, setLabel] = useState(strings.game.preparing);
```

Every other hardcoded string becomes a `strings.game.*` reference at its call site:

- Line 135 (`LagHeader`): this is a separate function component, not inside `GameScreen`, so it cannot call `useStrings()` internally without becoming its own hook consumer — instead, pass `strings` in as a prop:
  ```typescript
  function LagHeader({ n, strings }: { n: number | null; strings: Strings['game'] }) {
    if (n === null) return null;
    return <Text style={styles.lag}>{strings.lagHeader(n)}</Text>;
  }
  ```
  (Add `import type { Strings } from '../strings';`.) Update both JSX call sites of `<LagHeader n={lag} />` (lines 567, 601 area) to `<LagHeader n={lag} strings={strings.game} />`.
- `setLabel('マイクの許可が必要です')` → `setLabel(strings.game.micPermissionNeeded)`.
- `` setSeriesLabel(`${series.title} ／ ${pool.length}問`) `` → `setSeriesLabel(strings.game.seriesLabel(series.title, pool.length))`.
- `setLabel('問題が足りません')` → `setLabel(strings.game.notEnoughQuestions)`.
- The step-label template (line 386–389) → `setLabel(strings.game.stepLabel(stepIndex + 1, plan.steps.length, n, answering))`.
- Both `console.error(...)` + `setLabel('準備に失敗しました。アプリを再起動してください')` call sites → `setLabel(strings.game.setupFailed)` (the `console.error` calls themselves are developer-facing and stay as-is, untranslated, per the Global Constraints' exclusion of console output).
- `<Text style={styles.warmupCaption}>ウォームアップ</Text>` → `{strings.game.warmupCaption}`.
- `<Text style={styles.warmupHint}>タップすると始まります</Text>` → `{strings.game.warmupHint}`.
- `<Text style={styles.warmupCaption}>準備中…</Text>` (the second occurrence, warmup-tapped state) → `{strings.game.preparing}`.
- `` `認識エラー: ${recogError}` `` → `` `${strings.game.recogErrorPrefix}${recogError}` `` (kept as a plain template since `recogError` is a raw error code, not something worth a function-shaped key).
- `` `「${answer.text}」${verdictMark(answer)}` `` → `` `${strings.game.heardQuote(answer.text)}${verdictMark(answer)}` ``.
- `placeholder={remainingMs === null ? 'まだ答えません' : '答えを入力'}` → `placeholder={remainingMs === null ? strings.game.typedPlaceholderClosed : strings.game.typedPlaceholderOpen}`.
- `<Text style={styles.typedSend}>送る</Text>` → `{strings.game.send}`.

- [ ] **Step 4: Run the existing GameScreen test suite to confirm no regressions**

Run: `npx jest src/ui/__tests__/GameScreen.test.tsx`
Expected: PASS — every existing assertion on Japanese text is unchanged (`strings` defaults to `ja`, and every `ja.game.*` value matches the previously-hardcoded literal exactly, including the `lagHeader`/`seriesLabel`/`stepLabel` function outputs, which were written to reproduce the original template literals byte-for-byte).

- [ ] **Step 5: Commit**

```bash
git add src/strings/index.ts src/ui/GameScreen.tsx
git commit -m "feat(strings): populate game.* table, wire GameScreen to useStrings()"
```

---

## Task 4: Populate `results.*`, wire `ResultsScreen.tsx` to a `language` prop (not `useStrings()`), add the English regression test

**Files:**
- Modify: `src/strings/index.ts` (add `results` namespace)
- Modify: `src/ui/ResultsScreen.tsx`
- Test: `src/ui/__tests__/ResultsScreen.test.tsx`

**Interfaces:**
- Produces: `Strings['results']` per the inventory. `ResultsScreen`'s `Props` gains `language?: 'ja' | 'en'` (optional, defaulting to `'ja'`, so every existing test — which constructs `<ResultsScreen engine={...} n={...} onAgain={...} onChangeSeries={...} />` with no `language` — keeps rendering Japanese unchanged).

**Why a prop instead of `useStrings()` here:** `ResultsScreen` (confirmed by reading the file in full) takes no settings-derived data today — it is fed entirely by `engine`/`n`/two callbacks from `App.tsx`. Giving it `useStrings()` would make it the only screen that loads `Settings` via a side-channel hook while every other screen either already self-loads `Settings` directly (`SettingsScreen`, `GameScreen`, `SeriesScreen`) or doesn't need language at all (`QuestionsScreen`, per Task 6). Since `App.tsx` is the one place already assembling every screen's props, and this plan's Task 8 has `App.tsx` load `Settings` once anyway (to also gate speech/content — no, that's the *other* plan; here it is solely to read `language`), passing `language` as a prop is more consistent with `ResultsScreen`'s existing "purely props-driven" shape than introducing its own settings load. `strings.results.*` functions are still resolved from the shared `ja`/`en` tables (`ja`/`en` exports from Task 1), just selected by the prop instead of by an internal hook.

- [ ] **Step 1: Extend the `Strings` interface and both tables**

In `src/strings/index.ts`, replace `results: Record<string, never>;` with:

```typescript
  results: {
    dash: string;
    unjudged: string;
    correctMark: string;
    wrongMark: string;
    positionCorrect: string;
    positionWrong: string;
    positionDash: string;
    heading: (n: number) => string;
    subheading: (n: number) => string;
    rowPosition: string;
    rowAnswer: string;
    rowOnTime: string;
    unjudgedCount: (n: number) => string;
    rowTotal: string;
    notHeard: string;
    heardQuote: (text: string) => string;
    answerLabelPrefix: string;
    lateNote: (s: string) => string;
    again: string;
    changeSeries: string;
  };
```

In `ja`, replace `results: {},` with:

```typescript
  results: {
    dash: '—',
    unjudged: '未判定',
    correctMark: '○',
    wrongMark: '×',
    positionCorrect: '位置 ○',
    positionWrong: '位置 ×',
    positionDash: '位置 —',
    heading: (n) => `${n}-back の結果`,
    subheading: (n) => `${n}つ前の質問に答えるラウンド`,
    rowPosition: '位置　',
    rowAnswer: '回答　',
    rowOnTime: '時間内　',
    unjudgedCount: (n) => `未判定 ${n} 件`,
    rowTotal: '総合　',
    notHeard: '（聞き取れず）',
    heardQuote: (text) => `「${text}」`,
    answerLabelPrefix: '答え: ',
    lateNote: (s) => `時間超過（目安 ${s}s）`,
    again: 'もう一度',
    changeSeries: 'シリーズを変える',
  },
```

In `en`, replace `results: {},` with:

```typescript
  results: {
    dash: '—',
    unjudged: 'Ungraded',
    correctMark: '○',
    wrongMark: '×',
    positionCorrect: 'Position ○',
    positionWrong: 'Position ×',
    positionDash: 'Position —',
    heading: (n) => `${n}-back Results`,
    subheading: (n) => `A round answering the question from ${n} step${n === 1 ? '' : 's'} ago`,
    rowPosition: 'Position   ',
    rowAnswer: 'Answer   ',
    rowOnTime: 'On time   ',
    unjudgedCount: (n) => `${n} ungraded`,
    rowTotal: 'Total   ',
    notHeard: '(not heard)',
    heardQuote: (text) => `"${text}"`,
    answerLabelPrefix: 'Answer: ',
    lateNote: (s) => `Over time (budget ${s}s)`,
    again: 'Again',
    changeSeries: 'Change series',
  },
```

- [ ] **Step 2: Run the strings parity test**

Run: `npx jest src/strings/__tests__/index.test.ts`
Expected: PASS.

- [ ] **Step 3: Wire `ResultsScreen.tsx` to the `language` prop**

Add the import:
```typescript
import { ja, en } from '../strings';
```

Change `Props` (lines 5–10) to add `language`:
```typescript
interface Props {
  engine: RoundEngine;
  n: number;
  onAgain: () => void;
  onChangeSeries: () => void;
  language?: 'ja' | 'en';
}
```

At the top of the `ResultsScreen` function body:
```typescript
export function ResultsScreen({ engine, n, onAgain, onChangeSeries, language = 'ja' }: Props) {
  const strings = (language === 'en' ? en : ja).results;
  return (
    // ...
```

The module-level helper functions `pct`, `answerColor`, `verdictLabel`, `positionMark`, `answerForms`, `answerDisplay` are called from inside the component body already (not from other modules), so — like `LagHeader` in Task 3 — the ones that need translated text (`verdictLabel`, `positionMark`) take `strings` as a parameter rather than closing over module scope:

```typescript
function verdictLabel(row: AnswerReview, strings: Strings['results']): string {
  if (row.transcript === null) return strings.dash;
  if (row.correct === null) return strings.unjudged;
  return row.correct ? strings.correctMark : strings.wrongMark;
}

function positionMark(row: AnswerReview, strings: Strings['results']): { label: string; color: string } {
  if (row.position === 'correct') return { label: strings.positionCorrect, color: CORRECT };
  if (row.position === 'wrong') return { label: strings.positionWrong, color: WRONG };
  return { label: strings.positionDash, color: NEUTRAL };
}

function pct(v: number | null, strings: Strings['results']): string {
  return v === null ? strings.dash : `${Math.round(v * 100)}%`;
}
```

(Add `import type { Strings } from '../strings';`.) Update every call site inside the component body to pass `strings` (e.g. `pct(engine.positionScore)` → `pct(engine.positionScore, strings)`, `verdictLabel(item)` → `verdictLabel(item, strings)`, `positionMark(item)` → `positionMark(item, strings)`).

`answerForms`/`answerDisplay` are untouched — they operate purely on `accept[]` content (the question's own answer text, which is data, not UI chrome) and have no hardcoded UI strings per the inventory.

Every remaining plain-JSX string is a direct swap, e.g.:
```typescript
      <Text style={styles.heading}>{strings.heading(n)}</Text>
      <Text style={styles.lag}>{strings.subheading(n)}</Text>
      <Text style={styles.row}>{strings.rowPosition}{pct(engine.positionScore, strings)}</Text>
      <Text style={styles.row}>{strings.rowAnswer}{pct(engine.answerScore, strings)}</Text>
      {engine.onTimeScore !== null && (
        <Text style={styles.row}>{strings.rowOnTime}{pct(engine.onTimeScore, strings)}</Text>
      )}
      {engine.unresolvedCount > 0 && (
        <Text style={styles.note}>{strings.unjudgedCount(engine.unresolvedCount)}</Text>
      )}
      <Text style={styles.row}>{strings.rowTotal}{pct(engine.roundScore, strings)}</Text>
```
and similarly for `notHeard`/`heardQuote`, `answerLabelPrefix`, `lateNote`, `again`, `changeSeries`, following the same pattern as Tasks 2–3.

- [ ] **Step 4: Run the existing ResultsScreen test suite to confirm no regressions**

Run: `npx jest src/ui/__tests__/ResultsScreen.test.tsx`
Expected: PASS — no existing test passes `language`, so every render defaults to `'ja'` and every assertion (e.g. `getByText(/位置.*100%/)`) matches unchanged.

- [ ] **Step 5: Write the new English-language test**

```typescript
it('renders English text when language is en', () => {
  const { getByText } = render(
    <ResultsScreen
      engine={finishedEngine(9)}
      n={2}
      onAgain={() => {}}
      onChangeSeries={() => {}}
      language="en"
    />,
  );
  expect(getByText(/2-back Results/)).toBeTruthy();
  expect(getByText('Change series')).toBeTruthy();
});
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx jest src/ui/__tests__/ResultsScreen.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/strings/index.ts src/ui/ResultsScreen.tsx src/ui/__tests__/ResultsScreen.test.tsx
git commit -m "feat(strings): populate results.* table, wire ResultsScreen to a language prop"
```

---

## Task 5: Populate `series.*` and wire `SeriesScreen.tsx`

**Files:**
- Modify: `src/strings/index.ts` (add `series` namespace)
- Modify: `src/ui/SeriesScreen.tsx`
- Test: `src/ui/__tests__/SeriesScreen.test.tsx` (no new test required — existing tests must keep passing; Settings and Results are the two spec-mandated representative screens for new English tests, per spec §5)

**Interfaces:**
- Produces: `Strings['series']` per the inventory.

- [ ] **Step 1: Extend the `Strings` interface and both tables**

In `src/strings/index.ts`, replace `series: Record<string, never>;` with:

```typescript
  series: {
    heading: string;
    count: (n: number) => string;
    shortfall: (n: number) => string;
    lag: (n: number) => string;
  };
```

In `ja`, replace `series: {},` with:

```typescript
  series: {
    heading: 'シリーズを選ぶ',
    count: (n) => `${n}問`,
    shortfall: (n) => `あと ${n} 問`,
    lag: (n) => `${n}-back`,
  },
```

In `en`, replace `series: {},` with:

```typescript
  series: {
    heading: 'Choose a series',
    count: (n) => `${n} questions`,
    shortfall: (n) => `${n} more needed`,
    lag: (n) => `${n}-back`,
  },
```

- [ ] **Step 2: Run the strings parity test**

Run: `npx jest src/strings/__tests__/index.test.ts`
Expected: PASS.

- [ ] **Step 3: Wire `SeriesScreen.tsx` to use `useStrings()`**

Add the import and, inside `SeriesScreen` (right after the `groups` state, around line 28):
```typescript
import { useStrings } from '../strings';
```
```typescript
  const strings = useStrings();
```

Replace the JSX strings:
```typescript
        <Text style={styles.heading}>{strings.series.heading}</Text>
        <Pressable onPress={onOpenSettings}>
          <Text style={styles.settings}>{strings.common.settings}</Text>
        </Pressable>
```
and:
```typescript
                    <Text testID={`series-count-${row.id}`} style={styles.count}>
                      {usable ? strings.series.count(row.count) : strings.series.shortfall(shortfall)}
                    </Text>
                    {usable && (
                      <Text testID={`series-lag-${row.id}`} style={styles.lag}>
                        {strings.series.lag(row.n)}
                      </Text>
                    )}
```

Note: `groupSeries(all, settings.language)` (from the prerequisite plan's Task 2 Step 5) already switches the `group.label` text for each `CategoryGroup` — that value is rendered as-is at `<Text style={styles.category}>{group.label}</Text>`, which needs NO change here since it already carries translated text from `content/series.ts`'s `CATEGORIES`/`CATEGORIES_EN`, not from this plan's `strings` table.

- [ ] **Step 4: Run the existing SeriesScreen test suite to confirm no regressions**

Run: `npx jest src/ui/__tests__/SeriesScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strings/index.ts src/ui/SeriesScreen.tsx
git commit -m "feat(strings): populate series.* table, wire SeriesScreen to useStrings()"
```

---

## Task 6: Populate `questions.*` and wire `QuestionsScreen.tsx`

**Files:**
- Modify: `src/strings/index.ts` (add `questions` namespace)
- Modify: `src/ui/QuestionsScreen.tsx`
- Test: `src/ui/__tests__/QuestionsScreen.test.tsx` (no new test required — existing tests must keep passing)

**Interfaces:**
- Produces: `Strings['questions']` per the inventory.

- [ ] **Step 1: Extend the `Strings` interface and both tables**

In `src/strings/index.ts`, replace `questions: Record<string, never>;` with:

```typescript
  questions: {
    heading: string;
    count: (n: number) => string;
    placeholderQuestion: string;
    placeholderAnswer: string;
    save: string;
    add: string;
    delete: string;
    cancel: string;
  };
```

In `ja`, replace `questions: {},` with:

```typescript
  questions: {
    heading: '自分の問題',
    count: (n) => `${n} 問`,
    placeholderQuestion: '問題',
    placeholderAnswer: '答え',
    save: '保存',
    add: '追加',
    delete: '削除',
    cancel: '取消',
  },
```

In `en`, replace `questions: {},` with:

```typescript
  questions: {
    heading: 'My Questions',
    count: (n) => `${n} questions`,
    placeholderQuestion: 'Question',
    placeholderAnswer: 'Answer',
    save: 'Save',
    add: 'Add',
    delete: 'Delete',
    cancel: 'Cancel',
  },
```

- [ ] **Step 2: Run the strings parity test**

Run: `npx jest src/strings/__tests__/index.test.ts`
Expected: PASS.

- [ ] **Step 3: Wire `QuestionsScreen.tsx` to use `useStrings()`**

Add the import and, inside `QuestionsScreen` (right after the existing `useState` declarations, around line 26):
```typescript
import { useStrings } from '../strings';
```
```typescript
  const strings = useStrings();
```

Replace the JSX strings — every one is a direct swap:
```typescript
      <Text style={styles.heading}>{strings.questions.heading}</Text>
      <Text style={styles.count}>{strings.questions.count(questions.length)}</Text>

      <TextInput
        style={styles.input}
        placeholder={strings.questions.placeholderQuestion}
        placeholderTextColor="#8e8e93"
        value={draftQ}
        onChangeText={setDraftQ}
      />
      <TextInput
        style={styles.input}
        placeholder={strings.questions.placeholderAnswer}
        placeholderTextColor="#8e8e93"
        value={draftAnswer}
        onChangeText={setDraftAnswer}
      />

      <View style={styles.formRow}>
        <Pressable style={styles.primary} onPress={() => void submit()}>
          <Text style={styles.label}>{editingId ? strings.questions.save : strings.questions.add}</Text>
        </Pressable>
        {editingId && (
          <>
            <Pressable style={styles.secondary} onPress={() => void remove()}>
              <Text style={styles.label}>{strings.questions.delete}</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={resetForm}>
              <Text style={styles.label}>{strings.questions.cancel}</Text>
            </Pressable>
          </>
        )}
      </View>
```
and the close button:
```typescript
      <Pressable style={styles.secondary} onPress={onClose}>
        <Text style={styles.label}>{strings.common.close}</Text>
      </Pressable>
```

- [ ] **Step 4: Run the existing QuestionsScreen test suite to confirm no regressions**

Run: `npx jest src/ui/__tests__/QuestionsScreen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/strings/index.ts src/ui/QuestionsScreen.tsx
git commit -m "feat(strings): populate questions.* table, wire QuestionsScreen to useStrings()"
```

---

## Task 7: The Settings screen language toggle

**Files:**
- Modify: `src/ui/SettingsScreen.tsx` (add the toggle row)
- Test: `src/ui/__tests__/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `settings.language`, `update()` (both already exist on `SettingsScreen` — `update` is the existing `Partial<Settings>` patcher at line 183–188), `strings.settings.sectionLanguage` (added in Task 2).
- Produces: a toggle row that persists `language` via the existing `update()` → `saveSettings()` path, following the exact `adaptive` `Switch` pattern.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/__tests__/SettingsScreen.test.tsx`:

```typescript
it('persists the language toggle', async () => {
  const { getByTestId } = render(
    <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
  );
  await waitFor(() => {});
  fireEvent(getByTestId('language-switch'), 'valueChange', true);
  await waitFor(async () => {
    expect((await loadSettings()).language).toBe('en');
  });
});

it('defaults the language switch to off (ja)', async () => {
  const { getByTestId } = render(
    <SettingsScreen onClose={() => {}} onEditQuestions={() => {}} />,
  );
  await waitFor(() => {});
  expect(getByTestId('language-switch').props.value).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/ui/__tests__/SettingsScreen.test.tsx -t "language"`
Expected: FAIL — no element with `testID="language-switch"` exists yet.

- [ ] **Step 3: Add the toggle row**

In `src/ui/SettingsScreen.tsx`, add a new row immediately after the existing adaptive-N `Switch` row (after line 274's closing `</View>`, before the `{!settings.adaptive && (...)}` block):

```typescript
        <View style={styles.row}>
          <Text style={styles.label}>{strings.settings.sectionLanguage}</Text>
          <Switch
            testID="language-switch"
            value={settings.language === 'en'}
            onValueChange={(isEn) => update({ language: isEn ? 'en' : 'ja' })}
          />
        </View>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/ui/__tests__/SettingsScreen.test.tsx`
Expected: PASS — including the 2 new tests and every pre-existing test (the new row does not shift any existing `getByText`/`getByRole` lookups, since it uses a distinct `testID` and its own label text not referenced by other tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/SettingsScreen.tsx src/ui/__tests__/SettingsScreen.test.tsx
git commit -m "feat(ui): add the Settings screen language toggle"
```

---

## Task 8: Thread `language` from `App.tsx` into `ResultsScreen`

**Files:**
- Modify: `App.tsx`
- Test: none new (this is prop-plumbing with no independent logic; covered by Task 4's `ResultsScreen` tests plus manual verification in Step 3 below)

**Interfaces:**
- Consumes: `loadSettings()` (from `src/store/storage`, already used by every other screen). `ResultsScreen`'s `language` prop (added in Task 4).

- [ ] **Step 1: Load `Settings` once in `App.tsx` and pass `language` to `ResultsScreen`**

`App.tsx` currently has no state for `Settings` at all — every screen loads it independently. Add a minimal load, mirroring the pattern already used inside each screen (`useState` + `useEffect` + `loadSettings()`):

Add the import:
```typescript
import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, loadSettings, type Settings } from './src/store/storage';
```
(Merge with the existing `import { useState } from 'react';` line — `useEffect` is new.)

Inside `App()`, alongside the existing `screen` state:
```typescript
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);
```

**Why load-once-at-mount, not re-loaded on every screen transition:** `language` only changes via the toggle inside `SettingsScreen`, and `App.tsx` re-renders whenever `screen` changes — but returning from Settings to the series list goes through `onClose={() => setScreen({ name: 'series' })}`, not through `App.tsx` re-reading storage. This means `App.tsx`'s `settings.language` can go stale immediately after a toggle. Fix: re-load whenever the screen becomes `'results'` specifically (the only place this prop is consumed), rather than only once at mount:

```typescript
  useEffect(() => {
    if (screen.name === 'results') void loadSettings().then(setSettings);
  }, [screen]);
```

(Replace the mount-only effect above with this one — a single effect, keyed on `screen`, that reloads every time the results screen is reached. This is deliberately narrower than making every screen re-derive from a shared `App`-level `settings` — the other screens already have their own independent, already-correct `loadSettings()` calls from Tasks 2–6's `useStrings()` wiring and Plan-prerequisite Task 2/5's direct `settings.language` reads; only `ResultsScreen` has no such mechanism of its own, which is precisely why it takes a prop instead.)

Update the `ResultsScreen` JSX (around line 55–65):
```typescript
      {screen.name === 'results' && (
        <ResultsScreen
          engine={screen.engine}
          n={screen.plan.n}
          language={settings.language}
          onAgain={() =>
            setScreen({
              name: 'game',
              seriesId: screen.seriesId,
              key: Date.now(),
            })
          }
          onChangeSeries={() => setScreen({ name: 'series' })}
        />
      )}
```

- [ ] **Step 2: Run the full test suite**

Run: `npx jest`
Expected: PASS. `App.tsx` has no dedicated test file (confirmed absent from the earlier file listing of `src/ui/__tests__/`) — this change is verified by the full suite staying green plus the manual check in Step 3.

- [ ] **Step 3: Manual verification**

Run: `npm run web` (or `npm start` and open in a simulator/device). Toggle the language switch in Settings to English, close Settings, play a round to completion (or use whatever fastest path reaches the Results screen), and confirm the Results screen renders in English (heading reads "N-back Results", buttons read "Again"/"Change series"). Toggle back to Japanese and confirm Results reverts. This is a UI/feature-behavior check that automated tests cannot fully substitute for, per this project's standing practice of manually verifying UI changes in a running app before considering them complete.

- [ ] **Step 4: Commit**

```bash
git add App.tsx
git commit -m "feat(ui): thread settings.language from App into ResultsScreen"
```

---

## Self-Review Notes

- **Spec coverage:** §4.5 (i18n table under `src/strings/`, `ja`/`en` objects, `useStrings()` hook reading `Settings.language`, per-screen key namespaces) → Tasks 1–6. §4.1's Settings-screen toggle portion (not §4.1's storage portion, which the prerequisite plan already covers) → Task 7. §5's UI test policy (existing ~230 assertions unchanged; new tests for Settings and Results specifically) → every task's "confirm no regressions" step plus Tasks 2 and 4's new English-language tests.
- **Placeholder scan:** no `TBD`/`TODO`/"implement later" strings; every task's code blocks are complete, copy-pasteable, and include the actual Japanese/English text rather than describing it.
- **Type consistency:** `Strings` interface (Task 1) is extended incrementally by Tasks 2–6, each replacing exactly one `Record<string, never>` placeholder — an implementer executing tasks out of order would still produce a type-correct `Strings` shape at every intermediate commit, since each task's `Strings` interface edit is additive and self-contained to its own namespace. Function-shaped keys (`lagHeader`, `seriesLabel`, `stepLabel`, `heardQuote`, `heading`, `subheading`, `unjudgedCount`, `lateNote`, `count`, `shortfall`, `lag`) use consistent parameter names/order between `ja` and `en` within each key (verified by Task 1's parity test, which checks key *shape* — string vs function — but not arity; an implementer should double check each function pair takes the same parameters when filling in Tasks 2–6, since the parity test as written does not catch an arity mismatch — this is a known gap in the test's coverage, accepted because the inventory table above fixes every function signature in prose ahead of the code, giving the implementer a single source to copy from rather than inventing signatures per-language).
- **Out of scope confirmed:** `src/content/series.ts`'s `CATEGORIES`/`STANDARD_TITLE`/`CUSTOM_TITLE` strings are the prerequisite plan's responsibility (already switches via `language`), not duplicated into `src/strings/` here — `SeriesScreen`'s `group.label` rendering (Task 5) reads directly from `content/series.ts`'s output, not from this plan's table.
- **Dependency on the prerequisite plan:** Tasks 1–8 all reference `Settings.language`, which does not exist until `docs/superpowers/plans/2026-08-28-language-wiring-core.md` Task 1 lands. This plan cannot start before that one task (not that whole plan) is complete — flagged here so an executor does not attempt Task 1 of this plan against a `Settings` interface that has no `language` field yet.
