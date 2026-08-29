# Subscription Tier Enforcement & Paywall Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unenforced `SubscriptionTier` placeholder with three real tiers (Starter/free, Funds Finance Pro, Funds Finance God) that actually gate custom-deck creation and daily play count, redesign the paywall modal to fit on one mobile screen with real pricing, and remove the two hardcoded "standard"/"persuasion" series.

**Architecture:** All limits and tier state live in `src/store/storage.ts` (the app's existing single source of truth for `AsyncStorage`-backed state). `addCustomDeck`/`updateCustomDeck` take the caller's tier and throw when a per-tier quota is exceeded — the exact pattern they already use for the flat quotas being replaced. `GameScreen` gains a parallel daily-round-count gate using the same "load, check, refuse before starting" shape it already uses for `MIN_QUESTIONS`. Content removal (`standard`/`persuasion`/`delivery`) touches only `series.ts`/`series.json`/`series.en.json`/`translate.ts` and their fallback logic. The paywall is a self-contained rewrite of `SubscriptionModal.tsx`'s JSX and styles; no new files.

**Tech Stack:** React Native (Expo, 0.86.2) + TypeScript, Jest + `@testing-library/react-native`, `AsyncStorage`.

**Spec:** `docs/superpowers/specs/2026-08-30-subscription-tier-enforcement-design.md`

## Global Constraints

- `SubscriptionTier` becomes `'free' | 'pro' | 'god'` — `'enterprise'` no longer exists as a value anywhere in the codebase.
- Per-tier limits (from the spec): `free` = 0 decks / 0 questions-per-deck / 3 rounds-per-day; `pro` = 5 decks / 3 questions-per-deck / unlimited rounds; `god` = 20 decks / 10 questions-per-deck / unlimited rounds.
- `DEFAULT_SETTINGS.subscriptionTier` is `'free'` (was `'pro'`).
- Thrown `Error` messages from `storage.ts` stay in plain English, matching the existing `"A deck holds at most..."` / `"You can keep at most..."` convention — do not localize these through `Strings`.
- `tierLimits(tier)` is the only way limits are read; never index `TIER_LIMITS` directly, so an unrecognized stored tier value (e.g. a lingering `'enterprise'`) safely falls back to `free`'s limits instead of crashing.
- Pricing/copy exactly as specified: Starter $0; Funds Finance Pro monthly $10/mo, annual $5/mo ("コーヒー一杯分"); Funds Finance God monthly $20/mo, annual $10/mo ("昼食一回分" — not 昆虫/昆食, a typo corrected mid-conversation). No Enterprise tier.
- Every existing passing test must still pass after this plan, adjusted only where the spec requires a behavior change.

---

## Task 1: Tier limits and daily-round-count helper in storage.ts

**Files:**
- Modify: `src/store/storage.ts:11` (`SubscriptionTier` type), `:53-66` (`DEFAULT_SETTINGS`), `:271-274` (deck/question constants)
- Test: `src/store/__tests__/storage.test.ts`

**Interfaces:**
- Produces: `SubscriptionTier = 'free' | 'pro' | 'god'`; `interface TierLimits { maxDecks: number; maxQuestionsPerDeck: number; maxRoundsPerDay: number }`; `function tierLimits(tier: SubscriptionTier): TierLimits`; `function roundsPlayedToday(history: RoundRecord[]): number`. `DEFAULT_SETTINGS.subscriptionTier === 'free'`.

- [ ] **Step 1: Write the failing tests**

Add to `src/store/__tests__/storage.test.ts` (find the existing `import` block at the top and add `tierLimits`, `roundsPlayedToday`, `TIER_LIMITS` to the named imports from `'../storage'`; add this new `describe` block after the `describe('custom decks', ...)` block, i.e. after line 497):

```ts
describe('tier limits', () => {
  it('gives free tier zero decks, zero questions, three rounds a day', () => {
    expect(tierLimits('free')).toEqual({
      maxDecks: 0,
      maxQuestionsPerDeck: 0,
      maxRoundsPerDay: 3,
    });
  });

  it('gives pro tier five decks of three questions, unlimited rounds', () => {
    expect(tierLimits('pro')).toEqual({
      maxDecks: 5,
      maxQuestionsPerDeck: 3,
      maxRoundsPerDay: Infinity,
    });
  });

  it('gives god tier twenty decks of ten questions, unlimited rounds', () => {
    expect(tierLimits('god')).toEqual({
      maxDecks: 20,
      maxQuestionsPerDeck: 10,
      maxRoundsPerDay: Infinity,
    });
  });

  it('falls back to free limits for an unrecognized stored tier value', () => {
    // A settings blob saved before 'enterprise' was removed as a value.
    expect(tierLimits('enterprise' as SubscriptionTier)).toEqual(tierLimits('free'));
  });

  it('defaults new installs to the free tier', () => {
    expect(DEFAULT_SETTINGS.subscriptionTier).toBe('free');
  });
});

describe('roundsPlayedToday', () => {
  it('counts only records dated today', () => {
    const today = localDate();
    const history: RoundRecord[] = [
      { date: today, n: 1, positionScore: 1, answerScore: 1, unresolved: 0 },
      { date: today, n: 2, positionScore: 1, answerScore: 1, unresolved: 0 },
      { date: '2020-01-01', n: 1, positionScore: 1, answerScore: 1, unresolved: 0 },
    ];
    expect(roundsPlayedToday(history)).toBe(2);
  });

  it('is zero for empty history', () => {
    expect(roundsPlayedToday([])).toBe(0);
  });
});
```

Also add `TierLimits`, `tierLimits`, `roundsPlayedToday`, `TIER_LIMITS` to the existing `import { ... } from '../storage'` statement at the top of the test file, and add `RoundRecord` if it is not already imported as a type (check first — grep the file for `RoundRecord`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest storage.test.ts -t "tier limits"` and `npx jest storage.test.ts -t "roundsPlayedToday"`
Expected: FAIL — `tierLimits`/`roundsPlayedToday`/`TIER_LIMITS` are not exported yet, and `DEFAULT_SETTINGS.subscriptionTier` is still `'pro'`.

- [ ] **Step 3: Implement**

In `src/store/storage.ts`, change line 11:

```ts
export type SubscriptionTier = 'free' | 'pro' | 'god';
```

Change line 63 (inside `DEFAULT_SETTINGS`):

```ts
  subscriptionTier: 'free',
```

Replace lines 271-274 (the `MAX_DECK_QUESTIONS`/`MAX_CUSTOM_DECKS` constants) with:

```ts
export interface TierLimits {
  maxDecks: number;
  maxQuestionsPerDeck: number;
  /** Rounds playable per local calendar day. Infinity means no cap. */
  maxRoundsPerDay: number;
}

export const TIER_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: { maxDecks: 0, maxQuestionsPerDeck: 0, maxRoundsPerDay: 3 },
  pro: { maxDecks: 5, maxQuestionsPerDeck: 3, maxRoundsPerDay: Infinity },
  god: { maxDecks: 20, maxQuestionsPerDeck: 10, maxRoundsPerDay: Infinity },
};

/**
 * The only way limits should be read. A settings blob saved before a tier
 * value was removed (e.g. the old 'enterprise') must not crash the app —
 * it is treated as free rather than migrated, since the stored value is
 * otherwise harmless.
 */
export function tierLimits(tier: SubscriptionTier): TierLimits {
  return TIER_LIMITS[tier] ?? TIER_LIMITS.free;
}
```

Add `roundsPlayedToday` right after the existing `appendHistory` function (after line 164):

```ts
/** How many rounds have been recorded under today's local date. */
export function roundsPlayedToday(history: RoundRecord[]): number {
  const today = localDate();
  return history.filter((record) => record.date === today).length;
}
```

Note: `roundsPlayedToday` calls `localDate()`, which is defined later in the file (line 365) — this is fine in JS/TS since function declarations are hoisted, but place `roundsPlayedToday` as a `function` declaration (not a `const` arrow function) to rely on that hoisting safely, exactly as written above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest storage.test.ts -t "tier limits"` and `npx jest storage.test.ts -t "roundsPlayedToday"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/storage.ts src/store/__tests__/storage.test.ts
git commit -m "feat(storage): add per-tier limits and daily round counter"
```

---

## Task 2: Tier-aware deck/question limits in addCustomDeck and updateCustomDeck

**Files:**
- Modify: `src/store/storage.ts:285-359` (`addCustomDeck`, `updateCustomDeck`)
- Test: `src/store/__tests__/storage.test.ts` (the `describe('custom decks', ...)` block, lines 380-497)

**Interfaces:**
- Consumes: `tierLimits(tier)` from Task 1.
- Produces: `addCustomDeck(tier: SubscriptionTier, title: string, category: string, drafts: {q: string; accept: string[]}[]): Promise<CustomDeck>`; `updateCustomDeck(tier: SubscriptionTier, id: string, title: string, category: string, drafts: {...}[]): Promise<CustomDeck>`. `tier` is the new first parameter on both.

- [ ] **Step 1: Update existing tests to pass a tier, and add new tier-boundary tests**

Every existing call to `addCustomDeck(...)`/`updateCustomDeck(...)` in `src/store/__tests__/storage.test.ts` (lines 386, 404, 408, 416, 418, 423, 424, 431, 437, 443, 446, 454, 457, 462, 463, 475, 477, 483, 486, 491, 492, 493 — 22 call sites in the `describe('custom decks', ...)` block) currently exercises the old flat `MAX_DECK_QUESTIONS = 10` / `MAX_CUSTOM_DECKS = 10` limits. The `god` tier (`maxDecks: 20, maxQuestionsPerDeck: 10`) preserves the exact "10 questions per deck" boundary these tests rely on. Add `'god'` as the first argument to every one of these call sites, e.g.:

```ts
const created = await addCustomDeck('god', 'サブスク基礎', 'sub-finance', [
  { q: 'キャピタルコールとは？', accept: ['出資請求'] },
  { q: 'アドバンスレートとは？', accept: ['前貸し率'] },
]);
```

and

```ts
const updated = await updateCustomDeck('god', created.id, '新しい名前', 'nav-finance', [
  { q: 'Q2', accept: ['A2'] },
  { q: 'Q3', accept: ['A3'] },
]);
```

Do this for all 22 call sites — `addCustomDeck` calls get `'god'` inserted as the first argument before the title string; `updateCustomDeck` calls get `'god'` inserted as the first argument before the id string.

Two of these tests specifically assert the old flat *deck-count* boundary (10/11 decks), which no longer exists as a single number now that the limit is tier-specific — delete both entirely rather than just adding `'god'` to them, since the new tests added below already cover the equivalent per-tier boundaries (`god` at 20/21 decks, `pro` at 5/6 decks):

- Delete `it('rejects an 11th deck', ...)` (currently lines 441-449).
- Delete `it('allows an 11th deck after one is deleted', ...)` (currently lines 451-459).

The two *per-deck question-count* boundary tests just above those (`'rejects a deck with more than 10 questions'` at lines 429-433, and `'accepts a deck with exactly 10 questions'` at lines 435-439) stay — with `'god'` inserted, they remain exactly correct, since `god`'s `maxQuestionsPerDeck` is still 10. The new tests below add the `free`/`pro` boundaries and the `pro`/`god` deck-count boundaries, without duplicating that already-covered 10-questions-per-deck case.

Then add these new tests at the end of the `describe('custom decks', ...)` block, right before its closing `});` (currently line 497):

```ts
  it('rejects any deck at all on the free tier', async () => {
    await expect(
      addCustomDeck('free', 'デッキ', 'sub-finance', [{ q: 'Q', accept: ['A'] }]),
    ).rejects.toThrow();
    expect(await loadCustomDecks()).toEqual([]);
  });

  it('rejects a pro-tier deck with more than three questions', async () => {
    const drafts = Array.from({ length: 4 }, (_, i) => ({ q: `Q${i}`, accept: [`A${i}`] }));
    await expect(
      addCustomDeck('pro', '多すぎ', 'sub-finance', drafts),
    ).rejects.toThrow();
    expect(await loadCustomDecks()).toEqual([]);
  });

  it('accepts a pro-tier deck with exactly three questions', async () => {
    const drafts = Array.from({ length: 3 }, (_, i) => ({ q: `Q${i}`, accept: [`A${i}`] }));
    const created = await addCustomDeck('pro', 'ちょうど3', 'sub-finance', drafts);
    expect(created.questions).toHaveLength(3);
  });

  it('rejects a pro tier user creating a sixth deck', async () => {
    for (let i = 0; i < 5; i++) {
      await addCustomDeck('pro', `デッキ${i}`, 'sub-finance', [{ q: 'Q', accept: ['A'] }]);
    }
    await expect(
      addCustomDeck('pro', '6個目', 'sub-finance', [{ q: 'Q', accept: ['A'] }]),
    ).rejects.toThrow();
    expect(await loadCustomDecks()).toHaveLength(5);
  });

  it('rejects a god tier user creating a 21st deck', async () => {
    for (let i = 0; i < 20; i++) {
      await addCustomDeck('god', `デッキ${i}`, 'sub-finance', [{ q: 'Q', accept: ['A'] }]);
    }
    await expect(
      addCustomDeck('god', '21個目', 'sub-finance', [{ q: 'Q', accept: ['A'] }]),
    ).rejects.toThrow();
    expect(await loadCustomDecks()).toHaveLength(20);
  });

  it('rejects updating a pro-tier deck to more than three questions', async () => {
    const created = await addCustomDeck('pro', 'デッキ', 'sub-finance', [{ q: 'Q', accept: ['A'] }]);
    const drafts = Array.from({ length: 4 }, (_, i) => ({ q: `Q${i}`, accept: [`A${i}`] }));
    await expect(
      updateCustomDeck('pro', created.id, 'デッキ', 'sub-finance', drafts),
    ).rejects.toThrow();
    const [stored] = await loadCustomDecks();
    expect(stored.questions).toHaveLength(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest storage.test.ts -t "custom decks"`
Expected: FAIL — `addCustomDeck`/`updateCustomDeck` do not yet accept a `tier` argument, so the new tier-string first argument is currently being read as the deck title.

- [ ] **Step 3: Implement**

In `src/store/storage.ts`, replace the `addCustomDeck` function (lines 285-309):

```ts
export async function addCustomDeck(
  tier: SubscriptionTier,
  title: string,
  category: string,
  drafts: { q: string; accept: string[] }[],
): Promise<CustomDeck> {
  const limits = tierLimits(tier);
  if (drafts.length > limits.maxQuestionsPerDeck) {
    throw new Error(`Your plan allows at most ${limits.maxQuestionsPerDeck} questions per deck. Upgrade for more.`);
  }

  const decks = await loadCustomDecks();
  if (decks.length >= limits.maxDecks) {
    throw new Error(`Your plan allows at most ${limits.maxDecks} decks. Upgrade for more.`);
  }

  let seq = await readJson<number>(KEY_CUSTOM_DECK_SEQ, 0);
  const questions: Question[] = drafts.map((draft) => {
    seq += 1;
    return { id: `deck_${seq}`, tier: 0, q: draft.q, accept: draft.accept };
  });
  const deck: CustomDeck = { id: `deck_${++seq}`, title, category, questions };

  await AsyncStorage.setItem(KEY_CUSTOM_DECKS, JSON.stringify([...decks, deck]));
  await AsyncStorage.setItem(KEY_CUSTOM_DECK_SEQ, JSON.stringify(seq));
  return deck;
}
```

Replace the `updateCustomDeck` function (lines 329-359 — note this changes only its signature and the length check, not the id-regeneration/learned-clearing logic):

```ts
export async function updateCustomDeck(
  tier: SubscriptionTier,
  id: string,
  title: string,
  category: string,
  drafts: { q: string; accept: string[] }[],
): Promise<CustomDeck> {
  const limits = tierLimits(tier);
  if (drafts.length > limits.maxQuestionsPerDeck) {
    throw new Error(`Your plan allows at most ${limits.maxQuestionsPerDeck} questions per deck. Upgrade for more.`);
  }

  const decks = await loadCustomDecks();
  const existing = decks.find((deck) => deck.id === id);

  let seq = await readJson<number>(KEY_CUSTOM_DECK_SEQ, 0);
  const questions: Question[] = drafts.map((draft) => {
    seq += 1;
    return { id: `deck_${seq}`, tier: 0, q: draft.q, accept: draft.accept };
  });
  const updated: CustomDeck = { id, title, category, questions };

  await AsyncStorage.setItem(
    KEY_CUSTOM_DECKS,
    JSON.stringify(decks.map((deck) => (deck.id === id ? updated : deck))),
  );
  await AsyncStorage.setItem(KEY_CUSTOM_DECK_SEQ, JSON.stringify(seq));

  for (const question of existing?.questions ?? []) {
    await clearLearned(question.id);
  }
  return updated;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest storage.test.ts`
Expected: PASS — full file, since this task's signature change affects every test in the `custom decks` block.

- [ ] **Step 5: Commit**

```bash
git add src/store/storage.ts src/store/__tests__/storage.test.ts
git commit -m "feat(storage): enforce per-tier deck and question limits"
```

---

## Task 3: Wire tier limits into QuestionsScreen

**Files:**
- Modify: `src/ui/QuestionsScreen.tsx`
- Test: `src/ui/__tests__/QuestionsScreen.test.tsx`

**Interfaces:**
- Consumes: `addCustomDeck(tier, title, category, drafts)`, `updateCustomDeck(tier, id, title, category, drafts)` from Task 2; `loadSettings()` (existing, from `storage.ts`); `tierLimits(tier)` from Task 1.
- Produces: `QuestionsScreen` now loads `Settings` on mount and passes `settings.subscriptionTier` into both storage calls. `addDeckQuestion`'s cap check and the "add question" button's visibility condition switch from the removed `MAX_DECK_QUESTIONS` constant to `tierLimits(tier).maxQuestionsPerDeck`.

- [ ] **Step 1: Write the failing tests**

In `src/ui/__tests__/QuestionsScreen.test.tsx`, add `import { saveSettings, DEFAULT_SETTINGS } from '../../store/storage';` if not already present (check the existing imports first — it currently imports `addCustomDeck`, `loadCustomDecks`, `CUSTOM_DECK_CATEGORY` from `'../../store/storage'`; add `saveSettings` and `DEFAULT_SETTINGS` to that same import line).

Add this new `describe` block at the end of the file:

```ts
describe('QuestionsScreen tier limits', () => {
  it('shows an upgrade message when a free-tier user tries to save a deck', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, subscriptionTier: 'free' });
    const { getByText, getByPlaceholderText, getAllByPlaceholderText, findByText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.press(getByText('新しいデッキ'));
    fireEvent.changeText(getByPlaceholderText('デッキ名'), 'テスト');
    fireEvent.changeText(getAllByPlaceholderText('問題')[0], '問1');
    fireEvent.changeText(getAllByPlaceholderText('答え')[0], '答1');
    fireEvent.press(getByText('デッキを保存'));

    expect(await findByText(/Upgrade/)).toBeTruthy();
    expect(await loadCustomDecks()).toEqual([]);
  });

  it('lets a pro-tier user save up to three questions but not a fourth', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, subscriptionTier: 'pro' });
    const { getByText, getByPlaceholderText, getAllByPlaceholderText, queryByText } = render(
      <QuestionsScreen onClose={() => {}} />,
    );
    await waitFor(() => {});
    fireEvent.press(getByText('新しいデッキ'));
    fireEvent.changeText(getByPlaceholderText('デッキ名'), 'プロデッキ');
    fireEvent.changeText(getAllByPlaceholderText('問題')[0], '問1');
    fireEvent.changeText(getAllByPlaceholderText('答え')[0], '答1');
    fireEvent.press(getByText('質問を追加'));
    fireEvent.changeText(getAllByPlaceholderText('問題')[1], '問2');
    fireEvent.changeText(getAllByPlaceholderText('答え')[1], '答2');
    fireEvent.press(getByText('質問を追加'));
    fireEvent.changeText(getAllByPlaceholderText('問題')[2], '問3');
    fireEvent.changeText(getAllByPlaceholderText('答え')[2], '答3');

    // The add-question button must be gone at the pro-tier cap of 3.
    expect(queryByText('質問を追加')).toBeNull();

    fireEvent.press(getByText('デッキを保存'));
    await waitFor(async () => {
      const decks = await loadCustomDecks();
      expect(decks).toHaveLength(1);
      expect(decks[0].questions).toHaveLength(3);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest QuestionsScreen.test.tsx -t "tier limits"`
Expected: FAIL — `QuestionsScreen` doesn't load settings yet, so `addCustomDeck` is called with the wrong argument shape (no tier), and the add-question button still uses the flat cap of 10 (not 3), so it won't disappear at 3 questions.

- [ ] **Step 3: Implement**

In `src/ui/QuestionsScreen.tsx`, update the imports (currently lines 10-19):

```ts
import {
  CUSTOM_DECK_CATEGORY,
  addCustomDeck,
  deleteCustomDeck,
  loadCustomDecks,
  loadSettings,
  tierLimits,
  updateCustomDeck,
  type CustomDeck,
  type SubscriptionTier,
} from '../store/storage';
```

(`MAX_DECK_QUESTIONS` is removed from this import list — it no longer exists in `storage.ts` after Task 1.)

Add a `tier` state and load it alongside decks. Replace the `refresh` callback and its effect (currently lines 42-48):

```ts
  const [tier, setTier] = useState<SubscriptionTier>('free');

  const refresh = useCallback(async () => {
    const [loadedDecks, settings] = await Promise.all([loadCustomDecks(), loadSettings()]);
    setDecks(loadedDecks);
    setTier(settings.subscriptionTier);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);
```

Replace `addDeckQuestion` (currently lines 78-82):

```ts
  const addDeckQuestion = () => {
    const max = tierLimits(tier).maxQuestionsPerDeck;
    setDeckDrafts((prev) => (prev.length >= max ? prev : [...prev, emptyDraft()]));
  };
```

Replace `submitDeck`'s body where it calls the storage functions (currently lines 95-99, inside the `try` block):

```ts
      if (editingDeckId) {
        await updateCustomDeck(tier, editingDeckId, title, CUSTOM_DECK_CATEGORY, drafts);
      } else {
        await addCustomDeck(tier, title, CUSTOM_DECK_CATEGORY, drafts);
      }
```

Replace the add-question button's visibility condition (currently line 157, `{deckDrafts.length < MAX_DECK_QUESTIONS && (`):

```tsx
        {deckDrafts.length < tierLimits(tier).maxQuestionsPerDeck && (
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest QuestionsScreen.test.tsx`
Expected: PASS — full file.

- [ ] **Step 5: Commit**

```bash
git add src/ui/QuestionsScreen.tsx src/ui/__tests__/QuestionsScreen.test.tsx
git commit -m "feat(ui): gate deck creation on the user's subscription tier"
```

---

## Task 4: Daily round cap in GameScreen

**Files:**
- Modify: `src/ui/GameScreen.tsx:259-289`
- Test: `src/ui/__tests__/GameScreen.test.tsx`

**Interfaces:**
- Consumes: `roundsPlayedToday(history)`, `tierLimits(tier)` from Tasks 1; `loadHistory()` (existing, from `storage.ts`); `strings.game.dailyLimitReached` (new string, added in this task).
- Produces: `GameScreen` refuses to start a round and sets `label` to the localized limit message when `roundsPlayedToday(history) >= tierLimits(settings.subscriptionTier).maxRoundsPerDay`.

- [ ] **Step 1: Add the new string keys**

In `src/strings/index.ts`, add `dailyLimitReached: string;` to the `game` interface block (after `notEnoughQuestions: string;`, i.e. after line 52):

```ts
    notEnoughQuestions: string;
    dailyLimitReached: string;
```

Add the Japanese value to `ja.game` (after line 159, `notEnoughQuestions: '問題が足りません',`):

```ts
    notEnoughQuestions: '問題が足りません',
    dailyLimitReached: '本日の上限（3回）に達しました。アップグレードすると無制限になります',
```

Add the English value to `en.game` (after line 267, `notEnoughQuestions: 'Not enough questions',`):

```ts
    notEnoughQuestions: 'Not enough questions',
    dailyLimitReached: "You've reached today's limit (3 rounds). Upgrade for unlimited play.",
```

- [ ] **Step 2: Write the failing tests**

In `src/ui/__tests__/GameScreen.test.tsx`, find the existing imports from `'../../store/storage'` and add `saveSettings`, `DEFAULT_SETTINGS`, `appendHistory`, `localDate` if any are not already imported (check first — the file already uses `loadN`/`loadHistory` per the earlier grep, so `appendHistory` and `localDate` may already be present; add only what's missing).

Add this new `describe` block after the existing `describe('GameScreen series', ...)` block (after line 587):

```ts
describe('GameScreen daily round limit', () => {
  it('blocks a free-tier player after three rounds today', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, subscriptionTier: 'free' });
    const today = localDate();
    for (let i = 0; i < 3; i++) {
      await appendHistory({
        date: today,
        n: 1,
        positionScore: 1,
        answerScore: 1,
        unresolved: 0,
      });
    }
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    expect(await screen.findByText(/上限|limit/)).toBeTruthy();
  });

  it('does not block a pro-tier player regardless of rounds played today', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, subscriptionTier: 'pro' });
    const today = localDate();
    for (let i = 0; i < 5; i++) {
      await appendHistory({
        date: today,
        n: 1,
        positionScore: 1,
        answerScore: 1,
        unresolved: 0,
      });
    }
    const { deps } = makeDefaultDeps(alwaysCorrect);
    render(<GameScreen seriesId="capital-call" onFinished={jest.fn()} deps={deps} />);
    expect(await screen.findByTestId('warmup-series')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest GameScreen.test.tsx -t "daily round limit"`
Expected: FAIL — `GameScreen` does not check the daily count yet, so the free-tier case never shows a limit message (it proceeds straight to the warm-up screen).

- [ ] **Step 4: Implement**

In `src/ui/GameScreen.tsx`, update the import from `'../store/storage'` (currently lines 28-40) to add `loadHistory`, `roundsPlayedToday`, and `tierLimits`:

```ts
import {
  addLearned,
  type AnswerInput,
  appendHistory,
  loadApiKey,
  loadCustom,
  loadHistory,
  loadLearned,
  loadN,
  loadSettings,
  localDate,
  phaseDurations,
  roundsPlayedToday,
  saveN,
  tierLimits,
} from '../store/storage';
```

Add the daily-cap check right after the existing `MIN_QUESTIONS` check (currently lines 284-289):

```ts
        // Questions can be deleted after the source was chosen, so re-check
        // here rather than trusting the settings screen's guard alone.
        if (pool.length < MIN_QUESTIONS) {
          setLabel(strings.game.notEnoughQuestions);
          return;
        }

        const history = await loadHistory();
        if (cancelled) return;
        const limit = tierLimits(settings.subscriptionTier).maxRoundsPerDay;
        if (roundsPlayedToday(history) >= limit) {
          setLabel(strings.game.dailyLimitReached);
          return;
        }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest GameScreen.test.tsx`
Expected: PASS — full file (this touches the shared setup path, so run the whole suite, not just the new block).

- [ ] **Step 6: Commit**

```bash
git add src/ui/GameScreen.tsx src/ui/__tests__/GameScreen.test.tsx src/strings/index.ts
git commit -m "feat(game): cap free-tier players at three rounds per day"
```

---

## Task 5: Remove the standard/persuasion/delivery content and fix findSeries' fallback

**Files:**
- Modify: `src/content/series.ts`, `src/content/series.json`, `src/content/series.en.json`, `src/content/translate.ts`, `src/store/storage.ts:59` (default `seriesId`)
- Test: `src/content/__tests__/series.test.ts`, `src/ui/__tests__/SeriesScreen.test.tsx`, `src/ui/__tests__/GameScreen.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `listSeries(...)` output no longer contains a `'standard'`-id or `'persuasion'`-id series, nor a `'delivery'`-category group. `findSeries(all, unknownId)` now falls back to the `CUSTOM_SERIES_ID` series (or `all[0]` if that too is somehow absent) instead of `STANDARD_SERIES_ID`. `DEFAULT_SETTINGS.seriesId` is `CUSTOM_SERIES_ID` instead of `STANDARD_SERIES_ID`.

- [ ] **Step 1: Remove the persuasion entry from the content JSON files**

Run this from the repo root — it removes the array element with `id: "persuasion"` from both files using `jq` (safer than manual line-range edits, since it re-serializes valid JSON regardless of exact formatting):

```bash
jq 'map(select(.id != "persuasion"))' src/content/series.json > /tmp/series.json && mv /tmp/series.json src/content/series.json
jq 'map(select(.id != "persuasion"))' src/content/series.en.json > /tmp/series.en.json && mv /tmp/series.en.json src/content/series.en.json
```

If `jq` is not available, use Python instead:

```bash
python3 -c "
import json
for path in ['src/content/series.json', 'src/content/series.en.json']:
    with open(path) as f:
        data = json.load(f)
    data = [s for s in data if s['id'] != 'persuasion']
    with open(path, 'w') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
"
```

Verify both files parse and no longer contain `persuasion`:

```bash
python3 -c "
import json
for path in ['src/content/series.json', 'src/content/series.en.json']:
    data = json.load(open(path))
    assert not any(s['id'] == 'persuasion' for s in data), path
    print(path, 'OK', len(data), 'series')
"
```

Expected output: both files print `OK 24 series` (one less than the previous 25).

- [ ] **Step 2: Remove the delivery category and the standard series from series.ts**

In `src/content/series.ts`, remove the `delivery` entry from `CATEGORIES` (currently line 14):

```ts
export const CATEGORIES = [
  { id: 'finance', label: 'ファンドファイナンスでFluid Intelligenceを鍛える脳トレ' },
  { id: 'basics', label: 'だれでも答えられる' },
  { id: 'custom-decks', label: '自分のデッキ' },
] as const;
```

Remove the `loadBank` import (currently line 2, `import { loadBank, mergeLearned } from './bank';`) since after this task it has no remaining caller in this file:

```ts
import { mergeLearned } from './bank';
```

Remove the `STANDARD_TITLE` map (currently lines 217-220):

```ts
const CUSTOM_TITLE: Record<'ja' | 'en', string> = {
  ja: '自分の問題',
  en: 'My Questions',
};
```

(this deletes the `STANDARD_TITLE` block entirely and leaves `CUSTOM_TITLE` as the first title map in the file)

Replace the `synthesized` array inside `listSeries` (currently lines 268-281) to drop the standard series:

```ts
  const synthesized: Series[] = [
    {
      id: CUSTOM_SERIES_ID,
      category: 'basics',
      title: CUSTOM_TITLE[language],
      questions: mergeLearned(custom, learned),
    },
  ];
```

Remove the now-unused `maxTier` parameter usage note is fine to leave (the `maxTier` field stays on `SeriesInput` and the function signature — it's harmless if temporarily unused by content, and removing it would be a wider API change than this task's scope; instead, keep accepting `maxTier` in the destructured parameters to avoid breaking every call site, but note it: since ESLint/TS may flag an unused parameter, prefix it with `_` only if the type-check step in this task actually fails on it — check with `npx tsc --noEmit` after this edit before deciding whether to rename it).

Replace `findSeries` (currently lines 307-316):

```ts
/**
 * Resolve a stored id. Falls back to the custom series rather than
 * throwing: a renamed or removed series must not make the app unlaunchable.
 * `all[0]` is a last-resort guard against an empty list, which should never
 * happen in practice since `custom` is always synthesized.
 */
export function findSeries(all: Series[], id: string): Series {
  return (
    all.find((series) => series.id === id) ??
    all.find((series) => series.id === CUSTOM_SERIES_ID) ??
    all[0]
  );
}
```

Note: `STANDARD_SERIES_ID` itself (the string constant on line 201) is NOT removed — `storage.ts` still references it in two legacy migration code paths (see Step 3 below), so it must keep existing as an exported constant even though nothing in `series.ts` builds a series with that id anymore.

- [ ] **Step 3: Repoint the default seriesId in storage.ts**

In `src/store/storage.ts`, `DEFAULT_SETTINGS` currently sets (line 59):

```ts
  seriesId: STANDARD_SERIES_ID,
```

Change it to:

```ts
  seriesId: CUSTOM_SERIES_ID,
```

This requires importing `CUSTOM_SERIES_ID` alongside the existing `STANDARD_SERIES_ID` import at the top of the file (currently line 2, `import { STANDARD_SERIES_ID } from '../content/series';`):

```ts
import { CUSTOM_SERIES_ID, STANDARD_SERIES_ID } from '../content/series';
```

`STANDARD_SERIES_ID` stays imported and used at lines 106 and 139 (the legacy `questionSource` migration and the legacy-N seeding) — do not remove those two usages, they are unrelated to which series is default and must keep producing the same id for existing installs' migrated data.

- [ ] **Step 4: Remove the delivery label from translate.ts**

In `src/content/translate.ts`, remove the `delivery` key from `CATEGORIES_EN` (currently line 26, `delivery: 'Changing how you explain it',`) — delete that line entirely from the object.

- [ ] **Step 5: Update series.test.ts**

Rewrite `src/content/__tests__/series.test.ts` to match the new content shape. Apply these changes:

Remove `STANDARD_SERIES_ID` from the import list (currently line 6) since it's no longer exported for use by content-level tests as a real series id (it's still exported from `series.ts`... actually it is NOT re-exported from `series.ts` after this task removes nothing about its export — check: `export const STANDARD_SERIES_ID = 'standard';` on line 201 was never removed, only the series built from it. So `STANDARD_SERIES_ID` **is still importable** — keep the import, but stop asserting a series with that id exists in `listSeries()`'s output.

Replace the `describe('listSeries language switch', ...)` block (currently lines 97-126):

```ts
describe('listSeries language switch', () => {
  it('defaults to Japanese category labels and series titles', () => {
    const result = listSeries({ custom: CUSTOM, learned: {}, maxTier: 2 });
    expect(result.find((s) => s.id === CUSTOM_SERIES_ID)!.title).toBe('自分の問題');
  });

  it('serves English category labels and series titles when language is en', () => {
    const ja = listSeries({ custom: CUSTOM, learned: {}, maxTier: 2 });
    const en = listSeries({ custom: CUSTOM, learned: {}, maxTier: 2, language: 'en' });
    // Same series ids in the same order — only titles/content differ.
    expect(en.map((s) => s.id)).toEqual(ja.map((s) => s.id));
    expect(en.find((s) => s.id === CUSTOM_SERIES_ID)!.title).toBe('My Questions');
    // An authored series' title must differ between ja and en (proves the
    // English file, not the Japanese one, was actually loaded).
    const authoredId = ja.find((s) => s.id !== CUSTOM_SERIES_ID)!.id;
    const jaTitle = ja.find((s) => s.id === authoredId)!.title;
    const enTitle = en.find((s) => s.id === authoredId)!.title;
    expect(enTitle).not.toBe(jaTitle);
  });

  it('groups English series under the English category labels', () => {
    const en = listSeries({ custom: CUSTOM, learned: {}, maxTier: 2, language: 'en' });
    const grouped = groupSeries(en, 'en');
    expect(grouped.map((g) => g.label)).toEqual([
      'Brain training for fluid intelligence, through funds finance',
      'Anyone can answer',
    ]);
  });
});
```

Replace the `describe('listSeries', ...)` block's first two tests (currently lines 128-145, `'synthesizes the standard series...'` and `'tier-filters the standard series only'`) — both are removed entirely since there is no more standard series to synthesize or tier-filter. The block becomes:

```ts
describe('listSeries', () => {
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
```

Replace the `describe('findSeries', ...)` block (currently lines 231-241):

```ts
describe('findSeries', () => {
  it('finds by id', () => {
    expect(findSeries(all(), 'capital-call').id).toBe('capital-call');
  });

  it('falls back to the custom series for an unknown id', () => {
    // Renaming or dropping a series must not brick the app on launch for
    // someone whose stored seriesId no longer exists.
    expect(findSeries(all(), 'no-such-series').id).toBe(CUSTOM_SERIES_ID);
  });
});
```

Replace `describe('the shipped catalogue', ...)`'s first test, `'offers the authored series across two purpose categories'` (currently lines 244-276). The title itself must change too, not just the body: with `delivery` gone, every remaining authored series is `finance`-category — there is only one purpose category left, not two — so rename it to `'offers the authored series under the finance category'`:

```ts
  it('offers the authored series under the finance category', () => {
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
      CUSTOM_SERIES_ID,
    ]);
  });
```

Replace the `'credits every authored series...'` test right after it (currently lines 278-289) to drop the `STANDARD_SERIES_ID` half of the `synthesized` check:

```ts
  it('credits every authored series to the manuscript it came from', () => {
    const list = listSeries({ custom: [], learned: {}, maxTier: 2 });
    for (const series of list) {
      if (series.id === CUSTOM_SERIES_ID) {
        expect(series.credit).toBeUndefined();
      } else {
        expect(series.credit).toMatch(/より$/);
      }
    }
  });
```

Delete the `'leaves the delivery-category series without a funds-finance tag'` test entirely (currently lines 301-304) — there is no more delivery-category series to make this assertion about.

- [ ] **Step 6: Update SeriesScreen.test.tsx**

In `src/ui/__tests__/SeriesScreen.test.tsx`:

Replace the `'lists categories in declaration order'` test (currently lines 12-19) to drop the deleted `delivery` category label assertion:

```ts
  it('lists categories in declaration order', async () => {
    render(<SeriesScreen onSelect={jest.fn()} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('ファンドファイナンスでFluid Intelligenceを鍛える脳トレ')).toBeTruthy();
    });
    expect(screen.getByText('だれでも答えられる')).toBeTruthy();
  });
```

Replace the `'selects a series on press'` test's use of `persuasion` (currently lines 32-40) with `capital-call`, which is not otherwise used as the "press and assert onSelect" target in this file (it IS used for `series-count-capital-call` and `series-lag-capital-call` assertions in other tests, which is fine — those are independent tests with their own fresh render):

```ts
  it('selects a series on press', async () => {
    const onSelect = jest.fn();
    render(<SeriesScreen onSelect={onSelect} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('series-capital-call')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('series-capital-call'));
    expect(onSelect).toHaveBeenCalledWith('capital-call');
  });
```

Replace the `'shows the stored lag for each series independently'` test's second series from `persuasion` to `nav-finance` (currently lines 53-60), since this test needs two distinct series with two distinct lag values and `capital-call` is already the "lag 2" one in this same test:

```ts
  it('shows the stored lag for each series independently', async () => {
    await saveN('capital-call', 2);
    render(<SeriesScreen onSelect={jest.fn()} onOpenSettings={jest.fn()} />);
    await waitFor(() => {
      expect(screen.getByTestId('series-lag-capital-call')).toHaveTextContent('2-back');
    });
    expect(screen.getByTestId('series-lag-nav-finance')).toHaveTextContent('1-back');
  });
```

- [ ] **Step 7: Update GameScreen.test.tsx**

In `src/ui/__tests__/GameScreen.test.tsx`, replace every `seriesId="persuasion"` with `seriesId="capital-call"` (4 occurrences, at the current lines 521, 556, 569, 581), and update the assertions tied to `persuasion`'s specific content:

At the current line 525-528 (inside `'draws from an authored series without any settings change'`), the assertion already checks `toMatch(/？$/)`, which holds for `capital-call` too — no change needed there beyond the `seriesId` prop itself.

At the current lines 558-560 (inside `'names the series on the warm-up screen before the mic opens'`):

```ts
    expect(await screen.findByTestId('warmup-series')).toHaveTextContent(
      'コミットメントとキャピタルコール ／ 14問',
    );
```

At the current lines 573 and 585 (`loadN('persuasion')` and `.seriesId).toBe('persuasion')`), change the string literal `'persuasion'` to `'capital-call'` in both places — these assert against whatever `seriesId` prop the test rendered with, so they must track the same replacement made to that render call above them in the same test.

- [ ] **Step 8: Run the full test suite and typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If an unused-`maxTier`-parameter error appears in `series.ts`, that confirms the note in Step 2 — in that case, prefix the destructured parameter with an underscore (`_maxTier`) only in the function signature, not in `SeriesInput`'s type, and remove its use inside the function body (there should be none left after removing the standard series' `loadBank(...).filter(...)` line).

Run: `npx jest`
Expected: PASS — every test file, including the ones not touched by this task (to confirm no cross-file breakage from the content removal).

- [ ] **Step 9: Commit**

```bash
git add src/content/series.ts src/content/series.json src/content/series.en.json src/content/translate.ts src/store/storage.ts src/content/__tests__/series.test.ts src/ui/__tests__/SeriesScreen.test.tsx src/ui/__tests__/GameScreen.test.tsx
git commit -m "content: remove the standard and persuasion series and the delivery category"
```

---

## Task 6: SeriesScreen default tier and paywall redesign

**Files:**
- Modify: `src/ui/SeriesScreen.tsx:17,135` (default tier fallback), `src/ui/SubscriptionModal.tsx` (full rewrite of tier UI)
- Test: `src/ui/__tests__/SubscriptionModal.test.tsx` (new file)

**Interfaces:**
- Consumes: `SubscriptionTier` (now `'free' | 'pro' | 'god'`) from `storage.ts`.
- Produces: `SubscriptionModal` renders a tab row (`Starter` / `Funds Finance Pro` / `Funds Finance God`) with only the selected tab's card visible; `handleSelectPlan` persists one of the three new tier ids.

- [ ] **Step 1: Fix SeriesScreen's stale 'pro' default**

In `src/ui/SeriesScreen.tsx`, line 135 currently reads:

```ts
  const subscriptionTier = settings?.subscriptionTier || 'pro';
```

Change to:

```ts
  const subscriptionTier = settings?.subscriptionTier || 'free';
```

This is a one-line fix with no new test needed on its own — `settings` is only ever `null` for the single render before `loadSettings()` resolves, and Task 1's `DEFAULT_SETTINGS.subscriptionTier` change already covers the stored-value case; this just keeps the transient fallback consistent with it.

- [ ] **Step 2: Write the failing test for the new paywall structure**

Create `src/ui/__tests__/SubscriptionModal.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SubscriptionModal } from '../SubscriptionModal';

describe('SubscriptionModal', () => {
  it('shows all three tier tabs', () => {
    render(<SubscriptionModal visible onClose={jest.fn()} currentTier="free" />);
    expect(screen.getByText('Starter')).toBeTruthy();
    expect(screen.getByText('Funds Finance Pro')).toBeTruthy();
    expect(screen.getByText('Funds Finance God')).toBeTruthy();
  });

  it('shows only the selected tier card at a time', () => {
    render(<SubscriptionModal visible onClose={jest.fn()} currentTier="free" />);
    // Starter is selected by default (currentTier="free").
    expect(screen.getByText('$0')).toBeTruthy();
    expect(screen.queryByText('$5')).toBeNull();
    expect(screen.queryByText('$10')).toBeNull();

    fireEvent.press(screen.getByText('Funds Finance Pro'));
    expect(screen.getByText('$5')).toBeTruthy();
    expect(screen.queryByText('$0')).toBeNull();

    fireEvent.press(screen.getByText('Funds Finance God'));
    expect(screen.getByText('$10')).toBeTruthy();
    expect(screen.queryByText('$5')).toBeNull();
  });

  it('shows the coffee/lunch annual copy for Pro and God', () => {
    render(<SubscriptionModal visible onClose={jest.fn()} currentTier="free" />);
    fireEvent.press(screen.getByText('Funds Finance Pro'));
    expect(screen.getByText(/コーヒー一杯分/)).toBeTruthy();

    fireEvent.press(screen.getByText('Funds Finance God'));
    expect(screen.getByText(/昼食一回分/)).toBeTruthy();
  });

  it('switches to monthly pricing within the selected tier', () => {
    render(<SubscriptionModal visible onClose={jest.fn()} currentTier="free" />);
    fireEvent.press(screen.getByText('Funds Finance Pro'));
    expect(screen.getByText('$5')).toBeTruthy();
    fireEvent.press(screen.getByText('月額'));
    expect(screen.getByText('$10')).toBeTruthy();
  });

  it('persists the chosen tier and calls onTierChanged', () => {
    const onTierChanged = jest.fn();
    render(
      <SubscriptionModal
        visible
        onClose={jest.fn()}
        currentTier="free"
        onTierChanged={onTierChanged}
      />,
    );
    fireEvent.press(screen.getByText('Funds Finance God'));
    fireEvent.press(screen.getByText('このプランにする'));
    expect(onTierChanged).toHaveBeenCalledWith('god');
  });

  it('renders nothing when not visible', () => {
    render(<SubscriptionModal visible={false} onClose={jest.fn()} currentTier="free" />);
    expect(screen.queryByText('Starter')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest SubscriptionModal.test.tsx`
Expected: FAIL — the current modal has no tab row, uses `'pro'`/`'enterprise'` tier ids, and old $19.99/$29.99/$79/$99 pricing.

- [ ] **Step 4: Rewrite SubscriptionModal.tsx**

Replace the entire contents of `src/ui/SubscriptionModal.tsx`:

```tsx
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { loadSettings, saveSettings, type SubscriptionTier, type ThemeVariety } from '../store/storage';
import { getTheme } from './theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  currentTier?: SubscriptionTier;
  themeVariety?: ThemeVariety;
  onTierChanged?: (newTier: SubscriptionTier) => void;
}

interface TierCopy {
  tier: SubscriptionTier;
  tabLabel: string;
  title: string;
  monthlyPrice: string;
  annualPrice: string;
  annualNote: string;
  description: string;
  selectLabel: string;
  activeLabel: string;
}

const TIERS: TierCopy[] = [
  {
    tier: 'free',
    tabLabel: 'Starter',
    title: 'Starter',
    monthlyPrice: '$0',
    annualPrice: '$0',
    annualNote: '',
    description: '自作問題不可・教材は1日3回まで。',
    selectLabel: 'このプランにする',
    activeLabel: '現在のプラン',
  },
  {
    tier: 'pro',
    tabLabel: 'Funds Finance Pro',
    title: 'Funds Finance Pro',
    monthlyPrice: '$10',
    annualPrice: '$5',
    annualNote: 'コーヒー一杯分',
    description: '解回数無制限・自作問題は最大5デッキ×3問まで。',
    selectLabel: 'このプランにする',
    activeLabel: '現在のプラン',
  },
  {
    tier: 'god',
    tabLabel: 'Funds Finance God',
    title: 'Funds Finance God',
    monthlyPrice: '$20',
    annualPrice: '$10',
    annualNote: '昼食一回分',
    description: '解回数無制限・自作問題は最大20デッキ×10問まで。',
    selectLabel: 'このプランにする',
    activeLabel: '現在のプラン',
  },
];

export function SubscriptionModal({
  visible,
  onClose,
  currentTier = 'free',
  themeVariety = 'terminal',
  onTierChanged,
}: Props) {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [activeTab, setActiveTab] = useState<SubscriptionTier>(currentTier);
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier>(currentTier);
  const theme = getTheme(themeVariety);

  const handleSelectPlan = async (tier: SubscriptionTier) => {
    setSelectedTier(tier);
    const settings = await loadSettings();
    await saveSettings({ ...settings, subscriptionTier: tier });
    if (onTierChanged) onTierChanged(tier);
  };

  if (!visible) return null;

  const active = TIERS.find((t) => t.tier === activeTab)!;
  const price =
    active.tier === 'free' ? active.monthlyPrice : billingCycle === 'annual' ? active.annualPrice : active.monthlyPrice;

  return (
    <View style={[styles.overlay, { backgroundColor: 'rgba(5, 8, 17, 0.85)' }]}>
      <View
        style={[
          styles.modalContainer,
          { backgroundColor: theme.cardBg, borderColor: theme.cardBorder },
        ]}
      >
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>
            Financial Pro Membership
          </Text>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeButton,
              { backgroundColor: theme.bg },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.closeText, { color: theme.textSecondary }]}>✕</Text>
          </Pressable>
        </View>

        <View style={styles.tabRow}>
          {TIERS.map((t) => (
            <Pressable
              key={t.tier}
              onPress={() => setActiveTab(t.tier)}
              style={[
                styles.tab,
                {
                  backgroundColor: activeTab === t.tier ? theme.accentGold : theme.bg,
                  borderColor: theme.cardBorder,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: activeTab === t.tier ? '#000' : theme.textPrimary },
                ]}
              >
                {t.tabLabel}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView style={styles.content}>
          <View
            style={[
              styles.tierCard,
              { backgroundColor: theme.bg, borderColor: theme.cardBorder },
            ]}
          >
            <Text style={[styles.tierTitle, { color: theme.textPrimary }]}>{active.title}</Text>

            {active.tier !== 'free' && (
              <View style={[styles.cycleContainer, { backgroundColor: theme.cardBg }]}>
                <Pressable
                  onPress={() => setBillingCycle('annual')}
                  style={[
                    styles.cycleTab,
                    billingCycle === 'annual' && { backgroundColor: theme.badgeBg },
                  ]}
                >
                  <Text
                    style={[
                      styles.cycleText,
                      { color: billingCycle === 'annual' ? theme.accentGold : theme.textMuted },
                    ]}
                  >
                    年間
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setBillingCycle('monthly')}
                  style={[
                    styles.cycleTab,
                    billingCycle === 'monthly' && { backgroundColor: theme.badgeBg },
                  ]}
                >
                  <Text
                    style={[
                      styles.cycleText,
                      { color: billingCycle === 'monthly' ? theme.accentGold : theme.textMuted },
                    ]}
                  >
                    月額
                  </Text>
                </Pressable>
              </View>
            )}

            <View style={styles.priceRow}>
              <Text style={[styles.price, { color: theme.accentGold }]}>{price}</Text>
              <Text style={[styles.priceUnit, { color: theme.textSecondary }]}>/ month</Text>
            </View>
            {active.tier !== 'free' && billingCycle === 'annual' && (
              <Text style={[styles.annualNote, { color: theme.textMuted }]}>
                {active.annualNote}
              </Text>
            )}

            <Text style={[styles.tierDesc, { color: theme.textSecondary }]}>
              {active.description}
            </Text>

            <Pressable
              onPress={() => void handleSelectPlan(active.tier)}
              style={[
                styles.planButton,
                {
                  backgroundColor:
                    selectedTier === active.tier ? theme.cardBorder : theme.accentGold,
                },
              ]}
            >
              <Text style={[styles.planButtonText, { color: '#000', fontWeight: 'bold' }]}>
                {selectedTier === active.tier ? active.activeLabel : active.selectLabel}
              </Text>
            </Pressable>
          </View>
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: theme.cardBorder }]}>
          <Text style={[styles.footerNote, { color: theme.textMuted }]}>
            🔒 Secure SSL Encrypted. Cancel or modify subscription anytime.
          </Text>
          <Pressable onPress={onClose} style={styles.doneButton}>
            <Text style={[styles.doneText, { color: theme.accentPrimary }]}>Done</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    zIndex: 100,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: 'bold',
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  tabRow: {
    flexDirection: 'row',
    gap: 6,
    padding: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  content: {
    paddingHorizontal: 16,
  },
  tierCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 18,
    marginBottom: 16,
  },
  tierTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  cycleContainer: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 3,
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  cycleTab: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  cycleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  price: {
    fontSize: 30,
    fontWeight: 'bold',
  },
  priceUnit: {
    fontSize: 13,
    marginLeft: 6,
  },
  annualNote: {
    fontSize: 12,
    marginTop: 2,
  },
  tierDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 10,
    marginBottom: 14,
  },
  planButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  planButtonText: {
    fontSize: 14,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderTopWidth: 1,
  },
  footerNote: {
    fontSize: 11,
    flex: 1,
  },
  doneButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  doneText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest SubscriptionModal.test.tsx`
Expected: PASS

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx tsc --noEmit`
Expected: no errors — check specifically for any other file referencing `SubscriptionTier`'s old `'enterprise'` value or `SubscriptionModal`'s removed props/exports (there should be none outside what this plan already touched; grep to confirm: `grep -rn "enterprise" src/` should return nothing).

Run: `npx jest`
Expected: PASS — full suite.

- [ ] **Step 7: Commit**

```bash
git add src/ui/SeriesScreen.tsx src/ui/SubscriptionModal.tsx src/ui/__tests__/SubscriptionModal.test.tsx
git commit -m "feat(ui): redesign the paywall as a single-screen tier tab switcher"
```

---

## Task 7: Manual verification in the browser

**Files:** none (verification only)

- [ ] **Step 1: Start the Expo web dev server**

```bash
npx expo start --web --port 8099
```

- [ ] **Step 2: Verify the free-tier deck limit**

With a fresh install (clear site data / use a private window so `AsyncStorage` starts empty), open 作成 → 新しいデッキ, fill in a deck name and one question, and press デッキを保存. Confirm an upgrade-flavored error message appears and no deck is saved (the decks list stays empty on 作成's main screen).

- [ ] **Step 3: Verify the daily round cap**

While still on the free tier, play three rounds of any series to completion (or use the running dev server's React DevTools / a quick script to call `appendHistory` three times for today via the browser console, if playing three full rounds is too slow). Attempt to start a fourth round and confirm the label shows the "本日の上限" message instead of the warm-up screen.

- [ ] **Step 4: Verify the paywall redesign**

Tap the "PRO MEMBER"/"FREE TIER" badge in the header to open the subscription modal. Confirm: all three tabs (Starter / Funds Finance Pro / Funds Finance God) are visible without scrolling; tapping each tab swaps the card content; the Pro tab shows $5 (annual, "コーヒー一杯分") by default and $10 when switched to 月額; the God tab shows $10 (annual, "昼食一回分") by default and $20 when switched to 月額; selecting a plan and reopening the modal shows it as the active/current plan.

- [ ] **Step 5: Verify standard/persuasion are gone**

On the 教材 series-picker screen, confirm there is no "標準問題" card and no "説得のデザイン" card anywhere, and that the "伝え方を変える" category heading no longer appears.

- [ ] **Step 6: Stop the dev server**

```bash
pkill -f "expo start --web --port 8099"
```

No commit for this task — it produces no file changes, only confirms the prior six tasks' behavior end-to-end.
