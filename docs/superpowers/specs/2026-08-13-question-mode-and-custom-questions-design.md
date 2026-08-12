# Question-Only Mode and Custom Questions — Design

Date: 2026-08-13
Status: approved (design), not yet implemented
Extends: `2026-08-11-voice-dual-nback-design.md` (the base app, already built and merged)

## 1. What this adds

Two things the owner asked for after v1 merged:

1. **A question-only mode.** The default stays the dual task — tap the position from
   N back *and* speak the answer from N back. Question-only drops the visual channel
   entirely: no grid, no block, verbal N-back alone.
2. **Owner-authored questions.** The owner can write their own questions and pick
   whether a round draws from the built-in bank, their own, or both. Their questions
   are shuffled like any others — never asked in the order they were entered.

## 2. Non-goals

- No import/export of question sets, no sharing, no cloud sync.
- No position-only mode. Nobody asked for it, and the visual N-back without the
  verbal load is a different (and much easier) exercise.
- No per-question statistics. History stays one row per round.

## 3. Question-only mode

### 3.1 The setting

`Settings.mode: 'dual' | 'question'`, default `'dual'`.

### 3.2 Scoring — make `positionScore` symmetric with `answerScore`

`RoundEngine.answerScore` is already `number | null`, where null means "this channel
has no data", and `roundScore` already averages whatever channels exist. Question-only
mode is that same shape with the *other* channel absent, so the change is to make
`positionScore` nullable too:

```
dual mode      position 7/9 · answer 6/9  → round 0.72
question mode  position —   · answer 6/9  → round 0.67
```

This is deliberately not a special case in the scoring logic. It is the existing
null-channel fallback, used symmetrically.

**Breaking change:** `RoundEngine.positionScore` becomes `number | null`, and
`RoundRecord.positionScore` with it. `ResultsScreen` already renders `—` for a null
channel, so it needs no new branch — only the type widened.

### 3.3 Both channels null

In question mode with no network, every answer is 未判定, so both channels are null
and there is no round score. **Rule: N is left unchanged and the history row records
nulls for both channels.** Not adapting on zero information is the honest behaviour,
and it falls out of the same nullable-channel logic rather than being special-cased.

`RoundEngine.roundScore` therefore becomes `number | null`, and `nextN` returns the
current N unchanged when it is null.

### 3.4 What each layer does

| Layer | Question mode |
|---|---|
| `buildRound` | emits `position: null` on every step |
| `RoundRunner` | `flashPosition` already returns `step?.position ?? null` — **no change** |
| `RoundEngine` | skips position scoring; `positionScore` is null |
| `GameScreen` | does not render `<Grid>`; no tap handler is wired |
| `ResultsScreen` | shows `—` for position (existing behaviour) |

Adaptive N runs off the answer channel alone, via the existing `roundScore` fallback.

## 4. Custom questions

### 4.1 Randomization is already handled

`buildRound` samples 9 distinct questions from the pool with an rng on every round.
Custom questions go through the same path, so they are shuffled exactly like the
built-ins and never appear in entry order. **No new code** — recorded here because it
was half the original request.

### 4.2 Storage

New key `nback.custom` holding `Question[]`. Ids come from a stored counter
(`user_1`, `user_2`, …) so they stay stable across edits and never collide.

```json
{ "id": "user_3", "tier": 0, "q": "妻の誕生日は？", "accept": ["3月4日"] }
```

`tier: 0` marks a custom question. **The difficulty filter applies only to built-ins** —
custom questions are never excluded by the やさしい/ふつう setting.

A second counter key (`nback.customSeq`) holds the last id issued.

### 4.3 Answer entry

Two fields per question: the question, and the one answer the owner would say.
Anything else spoken goes to Claude, which accepts it if it means the same thing, and
the existing learning mechanism then appends it to that question's `accept` list — so
the alternative is free from then on. Learning is keyed by question id and works for
custom questions with no change.

### 4.4 Pool selection

`Settings.questionSource: 'builtin' | 'custom' | 'both'`, default `'builtin'`.

One pure function owns the resolution, so the "not enough questions" problem is
handled once and testably rather than scattered through the UI:

```ts
resolvePool(
  source: QuestionSource,
  builtin: Question[],
  custom: Question[],
  maxTier: number,
): Question[]
```

| source | returns |
|---|---|
| `builtin` | built-ins filtered by `maxTier` |
| `custom` | all custom questions, unfiltered |
| `both` | tier-filtered built-ins concatenated with all custom |

### 4.5 The fewer-than-9 problem

A round needs 9 distinct questions. Two places guard it:

- **Settings** offers `custom` only when there are ≥ 9; below that the option is
  disabled and labelled あと N 問, so an unusable choice can't be made.
- **`GameScreen`** re-checks at round start, because questions can be deleted *after*
  the source was chosen. The error path added during v1's final review already exists;
  this gives it a specific message, 問題が足りません, instead of the generic one.

`buildRound` keeps its existing throw as the last line of defence.

### 4.6 Editing

A new `QuestionsScreen`, reachable from Settings: a list of the owner's questions with
add / edit / delete, and a two-field form for adding and editing.

**Editing or deleting a question drops its learned synonyms.** Both fields change what
counts as a correct answer — a reworded question or a corrected answer invalidates
phrasings Claude accepted against the old pair — so the learned list for that id is
cleared on any edit, and on delete so a reused id cannot inherit stale ones. The list
rebuilds itself the next time the question is answered.

## 5. Files

| File | Change |
|---|---|
| `src/store/storage.ts` | `mode` + `questionSource` in `Settings`; custom-question CRUD; nullable `positionScore` in `RoundRecord` |
| `src/content/pool.ts` | **new** — `resolvePool` |
| `src/engine/sequence.ts` | `buildRound` takes the mode; null positions in question mode |
| `src/engine/round.ts` | nullable `positionScore` and `roundScore`; `nextN` holds on null |
| `src/ui/GameScreen.tsx` | conditional `<Grid>`; pool resolution; 問題が足りません |
| `src/ui/SettingsScreen.tsx` | mode selector; source selector with the ≥9 guard; link to the editor |
| `src/ui/QuestionsScreen.tsx` | **new** — list + add/edit/delete |
| `App.tsx` | route to the new screen |

`RoundRunner` and the judge pipeline are untouched.

## 6. Testing

| Layer | Coverage |
|---|---|
| `resolvePool` | each source; tier filter applies to built-ins only; custom never filtered; insufficient-count cases |
| `storage` | custom CRUD round-trip; counter never reuses an id; delete drops learned synonyms; settings forward-compat merge still holds |
| `RoundEngine` | question mode → `positionScore` null, `roundScore` = answer alone; both-null → `roundScore` null and `nextN` holds N |
| `buildRound` | question mode emits null positions; still 9 scored steps; still shuffles |
| `QuestionsScreen` | add / edit / delete round-trip against real storage |
| `GameScreen` | full question-mode round: no grid rendered, answer channel scores, N adapts; and the 問題が足りません path |

The existing 140 tests must keep passing; the nullable-`positionScore` change will
require updating assertions in `round.test.ts`, `ResultsScreen.test.tsx`, and
`GameScreen.test.tsx`.

## 7. Decisions on record

| Decision | Rationale |
|---|---|
| Grid disappears in question mode | Owner's choice. A flashing block you must ignore is its own cognitive load, and it would muddy what the mode measures. |
| `positionScore` made nullable rather than special-cased | Mirrors the existing `answerScore` design; question mode then needs no branch in the scoring logic. |
| N unchanged when both channels are null | Adapting on zero information would be noise. |
| One answer per custom question, Claude covers the rest | Owner's choice. Two fields is what someone will actually fill in on a phone; the learning mechanism closes the gap over time at no extra cost. |
| Source is selectable rather than replace-or-merge | Owner's choice. Lets the owner drill only their own material without losing the 30 seed questions. |
| `tier: 0` for custom, exempt from the difficulty filter | The owner authored them; the app has no basis for rating their difficulty. |
