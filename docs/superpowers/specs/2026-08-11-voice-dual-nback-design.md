# Voice Dual N-Back — Design

Date: 2026-08-11
Status: approved (design), not yet implemented

## 1. What this is

An iPhone brain-training app implementing a **dual N-back** task where both response
channels lag by N:

- **Visual channel** — a block flashes in a 3×3 grid. The user taps the position the
  block occupied N steps ago.
- **Verbal channel** — a short Japanese question is spoken. The user says aloud the
  answer to the question asked N steps ago.

The verbal channel replaces the simple arithmetic used as the interference load in
conventional dual n-back. Answers are one-word Japanese (「犬の鳴き声は？」→「わん」),
recognized on-device and graded by Claude.

v1 is a polished single-player app for the owner's own iPhone, architected so an App
Store release is a follow-on rather than a rewrite.

## 2. Non-goals for v1

- No accounts, sync, or backend of our own.
- No monetization, onboarding flow, or streak mechanics.
- No Android. (Expo makes it reachable later; nothing in v1 should preclude it, but it
  is not tested or supported.)
- No App Store submission. See §9 for the one architectural item that gates it.

## 3. Platform and delivery

Expo (React Native) + TypeScript, built and served from Windows/WSL.

Speech recognition is a native module, so the stock **Expo Go app cannot run this** —
delivery is an **EAS development build**: built in Expo's cloud from Windows, installed
once on the iPhone, after which JS updates stream over QR exactly like Expo Go.

| Concern | Choice |
|---|---|
| Speech → text | `expo-speech-recognition` (Apple `SFSpeechRecognizer`, `ja-JP`), on-device, ¥0 |
| Text → speech | `expo-speech` (Apple `AVSpeechSynthesizer`, `ja-JP`), ¥0, no shipped audio assets |
| Storage | `AsyncStorage` |
| Answer grading | Anthropic TypeScript SDK, `claude-opus-5` |

Considered and rejected for v1: Kyutai **Pocket TTS** — English-only as of 2026-08
(roadmap is es/fr/de/pt/it; Japanese not listed) and no official iOS/Swift build. The
`Speaker` interface leaves the door open to swap it, or to pre-render the whole bank on
the RTX 5070 with a Japanese model, if Apple's voice proves inadequate.

## 4. Game loop

N is adaptive, starting at 2.

A round presents **9 stimuli**, then **N trailing recall-only steps** so that all 9
questions receive an answer. Total steps = `9 + N`. Steps 1…N are observe-only (there is
nothing N back yet); the trailing steps present no new block and ask no new question.

```
N=2

step   1    2    3    4  …  9   10   11
flash  ■    ■    ■    ■      ■    -    -     9 stimuli
ask    Q1   Q2   Q3   Q4     Q9   -    -
tap    -    -    p1   p2     p7   p8   p9    lags by N
say    -    -    A1   A2     A7   A8   A9    lags by N
                 |______ 9 scored responses ______|
```

### 4.1 Step structure — two phases

The mic must not hear the synthesizer: the app speaks Q₅ while the user is saying A₃.
Rather than rely on echo cancellation across the RN module boundary, each step is split:

```
one step (default 5s, configurable 3-8s)
  phase A  ~2s   flash block + speak question       mic OFF
  phase B  ~3s   answer window                      mic ON
  tap is accepted during either phase
```

The transcript present at the close of phase B is the answer for that step. No
end-of-utterance detection, no VAD tuning. During trailing recall-only steps phase A is
silent and shortened.

### 4.2 Scoring and adaptive N

Two independent channels per round, 9 responses each:

- **Position score** = correct taps / 9
- **Answer score** = correct answers / *resolved* answers, where an answer is resolved if
  it matched locally or received a Claude verdict. Answers still 未判定 at round end
  (§6.2) are excluded from **both** numerator and denominator — never counted wrong. If
  zero answers resolved, the answer channel is omitted and the round score is the
  position score alone.
- **Round score** = mean of the available channels

Adaptive rule, applied at round end:

| Round score | Next N |
|---|---|
| ≥ 80% | N + 1 |
| ≤ 50% | N − 1 (floor 1) |
| otherwise | unchanged |

## 5. Module boundaries

The game rules are deliberately isolated from anything that touches a device, so the
whole engine is testable under plain Jest with no phone, mic, or network.

| Module | Responsibility | Depends on |
|---|---|---|
| `engine/` | Pure TypeScript: sequence generation, step state machine, scoring, adaptive N. **No React Native imports.** | nothing |
| `speech/` | `Speaker` and `Listener` interfaces over `expo-speech` / `expo-speech-recognition`. | native modules |
| `judge/` | Answer correctness: local synonym match, then Claude fallback. Async; never blocks the step timer. | network |
| `content/` | `bank.json` — questions, accepted answers, difficulty tier. | nothing |
| `store/` | AsyncStorage: current N, round history, settings. | device |
| `ui/` | Grid, step HUD, results screen, settings. | all of the above |

**The engine is fed in two stages, because grading is asynchronous.** At each step close
it receives `submitStep({ tap, transcript })` and scores the *position* channel
immediately; the transcript is recorded as pending. Answer verdicts arrive later via
`resolveAnswer(stepIndex, correct)` — possibly after the round has ended — and the engine
recomputes the answer score and adaptive N on each arrival. This makes the ordering
explicit and keeps it deterministic under test: a test can deliver verdicts in any order,
or not at all, and assert the 未判定 handling in §4.2.

Interfaces:

```ts
interface Speaker  { speak(text: string, opts?: {lang?: string}): Promise<void>; stop(): void }
interface Listener { start(lang: string): void; stop(): string /* final transcript */ }
interface JudgeClient { judge(q: Question, transcript: string): Promise<Verdict> }
```

`JudgeClient` is the seam that v2 replaces with a proxy-backed implementation (§9).

## 6. Answer judging

Per answer, fired asynchronously at phase-B close:

1. **Normalize** the transcript — kana folding, strip trailing 「です」「だと思う」and
   filler.
2. **Local match** against `bank[q].accept[]`. Hit ⇒ correct, instantly, ¥0.
3. **Miss ⇒ Claude call**, in the background. The verdict lands on the results screen;
   if it returns before the round ends, the live score updates.
4. **Learn** — an answer Claude accepts that was not in `accept[]` is appended to that
   question's list on device. The same answer is free thereafter.

Because both channels already lag by N, background grading costs no perceived latency:
step 5's answer is graded while the user is working on step 6.

### 6.1 Claude call

- Model `claude-opus-5`, `output_config: {effort: "low"}`.
- Structured output pinned to `{ correct: boolean, matched: string | null }`.
- Tiny prompt: the question, its canonical answer, and the transcript.

Cost, at ~160 input / ~25 output tokens × 9 answers per round:

| | per round | 10 rounds/day |
|---|---|---|
| `claude-opus-5` ($5 / $25 per MTok) | ≈ ¥2 | ≈ ¥20/day |
| `claude-haiku-4-5` ($1 / $5 per MTok) | ≈ ¥0.4 | ≈ ¥4/day |

Default is Opus 5; the model id is a single config constant, so switching tiers after
measuring real accuracy is a one-line change.

### 6.2 Degradation

If the network is unavailable, the judge queue falls back to local matching only.
Unmatched answers are surfaced on the results screen as **未判定** — explicitly not
counted wrong. The round still completes and still adapts N, using the answers it could
resolve.

## 7. Content

`content/bank.json`, authored offline by Claude (¥0 at runtime):

```json
{ "id": "q042", "tier": 2, "q": "犬の鳴き声は？",
  "accept": ["わん", "ワン", "わんわん", "ばうばう"] }
```

- `tier` 1 = trivially known, 2 = general knowledge, 3 = one-step inference. v1 draws
  from tiers 1–2; tier 3 exists for later difficulty scaling.
- Questions are Japanese; answers are one word.
- The learned-synonym additions from §6 step 4 are stored separately in AsyncStorage and
  merged over the shipped bank at load, so a bank update never discards learning.

## 8. Persistence

| Key | Contents |
|---|---|
| `nback.n` | Current adaptive N |
| `nback.history` | Per round: ISO date, N, position score, answer score |
| `nback.settings` | Step duration, N mode (adaptive/fixed), difficulty tier |
| `nback.learned` | `{ [questionId]: string[] }` — accepted answers discovered at runtime |

## 9. Path to the App Store (v2, not built here)

An Expo app ships its API key on the device. For a personal development build that is
acceptable (EAS secret → `expo-constants`). It is **not** acceptable for a public
release: a released binary's key is extractable.

v2 therefore needs a minimal proxy between the app and Anthropic. `judge/` talks to one
`JudgeClient` interface, so v2 swaps that implementation and nothing else in the codebase
moves. An Apple Developer account (≈¥15,000/yr) is also required.

## 10. Testing

| Layer | Approach |
|---|---|
| `engine/` | Real unit tests, plain Jest, no RN. Lag correctness (step *i* scores against stimulus *i−N*), the trailing-N tail, position/answer scoring, adaptive-N transitions at the 80% and 50% boundaries, N floor at 1. |
| `judge/` | Fake `JudgeClient`; normalization table tests; forced-offline path asserts 未判定 rather than wrong. |
| `speech/` | Fake `Speaker`/`Listener`. No test opens a mic. |
| Device | Manual smoke test on the iPhone — cannot be automated from Windows. Checklist: mic permission prompt, ja-JP recognition accuracy, no TTS bleed into phase B, background grading updates the results screen. |

## 11. Decisions on record

| Decision | Rationale |
|---|---|
| Both channels lag by N | Owner's explicit choice; makes the task a true dual n-back rather than n-back plus a concurrent distractor. |
| Tap the remembered position, not a yes/no match call | Owner's explicit choice; recall rather than recognition. |
| Live per-answer AI grading | Owner's explicit choice. The lag structure makes it free of perceived latency. |
| Apple TTS over Pocket TTS | Pocket TTS is English-only with no iOS build as of 2026-08. |
| Two-phase step | Only reliable way to keep the synthesizer out of the mic without echo cancellation. |
| 9 + N steps, not 9 | Guarantees all 9 questions are answered; "9 questions" stays literally true. |
| Adaptive N | Matches the protocol that shows working-memory transfer; keeps difficulty at the edge of ability. |
