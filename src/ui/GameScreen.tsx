import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { RoundEngine, RoundRunner, buildRound } from '../engine';
import { answerBudgetMs } from '../engine/budget';
import type { PositionOutcome } from '../engine/round';
import type { Position, RoundMode, RoundPlan } from '../engine/types';
import { MIN_QUESTIONS } from '../content/pool';
import { findSeries, listSeries } from '../content/series';
import { ClaudeJudgeClient } from '../judge/claude';
import { JudgeQueue } from '../judge/queue';
import type { JudgeClient } from '../judge/types';
import { ExpoListener } from '../speech/listener';
import { languageToLocale } from '../speech/locale';
import { ExpoSpeaker } from '../speech/speaker';
import { TypedListener } from '../speech/typed';
import type { Listener, Speaker } from '../speech/types';
import { useStrings } from '../strings';
import type { Strings } from '../strings';
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
import { Grid } from './Grid';
import { useVisualViewportHeight } from './useVisualViewport';

/**
 * Hard cap on waiting for background grading at round end. Answers still in
 * flight are handled as 未判定 (spec §4.2), so the results screen must never be
 * held hostage by a stalled request.
 */
const DRAIN_TIMEOUT_MS = 15_000;

/** N choices offered on the warm-up screen — matches the fixed-N range in Settings. */
const N_CHOICES = [1, 2, 3, 4, 5];

function within<T>(promise: Promise<T>, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    void promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export interface GameScreenDeps {
  speaker: Speaker;
  listener: Listener;
  judgeClient: JudgeClient;
  requestPermissions(): Promise<boolean>;
}

function realDeps(locale: string = 'ja-JP'): GameScreenDeps {
  return {
    speaker: new ExpoSpeaker(locale),
    listener: new ExpoListener(locale),
    judgeClient: new ClaudeJudgeClient(loadApiKey),
    requestPermissions: ExpoListener.requestPermissions,
  };
}

interface LiveAnswer {
  /** The step whose mic window produced this, so a late verdict lands right. */
  index: number;
  text: string;
  /** null until the judge answers — 判定待ち is not 不正解. */
  correct: boolean | null;
}

const CORRECT = '#4caf7d';
const WRONG = '#e5534b';
const NEUTRAL = '#8e8e93';

interface Props {
  /** Which series this round draws from. */
  seriesId: string;
  onFinished: (engine: RoundEngine, plan: RoundPlan) => void;
  /** Overridden in tests; defaults to the real Expo and Claude implementations. */
  deps?: GameScreenDeps;
}

/**
 * How a tap scores against the stimulus N steps back — known the moment it
 * lands, unlike the spoken answer, which has to go to the judge first. null on
 * the first N steps, which recall nothing.
 */
function scoreTap(
  plan: RoundPlan | null,
  runner: RoundRunner | null,
  tap: Position,
): PositionOutcome | null {
  if (!plan || !runner || plan.mode === 'question') return null;
  const step = plan.steps[runner.state.stepIndex];
  if (!step || step.recallTarget === null) return null;
  return tap === plan.steps[step.recallTarget].position ? 'correct' : 'wrong';
}

function answerColor(answer: LiveAnswer): string {
  if (answer.correct === null) return NEUTRAL;
  return answer.correct ? CORRECT : WRONG;
}

function verdictMark(answer: LiveAnswer): string {
  if (answer.correct === null) return '';
  return answer.correct ? '　○' : '　×';
}

/**
 * Which lag this round runs at, in both the name and the instruction — the
 * label alone ("2-back") does not say whether that means the question just
 * asked or the one before it, and getting it wrong costs a whole round.
 */
function LagHeader({
  n,
  strings,
  typed,
}: {
  n: number | null;
  strings: Strings['game'];
  /** Typed rounds run on whatever the keyboard leaves; the header shrinks with it. */
  typed?: boolean;
}) {
  if (n === null) return null;
  return (
    <Text style={[styles.lag, typed && styles.lagTyped]}>{strings.lagHeader(n)}</Text>
  );
}

/**
 * The biggest the grid is allowed to get. Without it a tall phone with the
 * keyboard down stretches the 3×3 across the whole screen, which reads as a
 * different game from one step to the next.
 */
const MAX_GRID = 320;

export function GameScreen({ seriesId, onFinished, deps }: Props) {
  const strings = useStrings();
  const viewportHeight = useVisualViewportHeight();
  const [language, setLanguage] = useState<'ja' | 'en' | null>(null);
  const resolved = useMemo(
    () => deps ?? realDeps(language ? languageToLocale(language) : undefined),
    [deps, language],
  );
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState<Position | null>(null);
  const [selected, setSelected] = useState<Position | null>(null);
  const [label, setLabel] = useState(strings.game.preparing);
  const [mode, setMode] = useState<RoundMode>('dual');
  const [tapVerdict, setTapVerdict] = useState<PositionOutcome | null>(null);
  /** The answer on screen: what was heard, and how it was judged once known. */
  const [answer, setAnswer] = useState<LiveAnswer | null>(null);
  const [recogError, setRecogError] = useState<string | null>(null);
  const [seriesLabel, setSeriesLabel] = useState('');
  /** True from setup until the warm-up start tap; gates the warm-up screen. */
  const [warmup, setWarmup] = useState(false);
  const [warmupStarted, setWarmupStarted] = useState(false);
  /** The round's N, known before it starts so the owner can be told. */
  const [lag, setLag] = useState<number | null>(null);
  /** The N chosen in the warm-up dropdown, defaulting to the loaded/fixed N. */
  const [selectedN, setSelectedN] = useState<number | null>(null);
  /**
   * How this round is answered. null until settings resolve: rendering either
   * layout before then paints a grid the round may not be using at all.
   * State, because the render output depends on it.
   */
  const [answerInput, setAnswerInput] = useState<AnswerInput | null>(null);
  /** The same listener, for the imperative push/submit calls. */
  const typedRef = useRef<TypedListener | null>(null);
  const [typedText, setTypedText] = useState('');
  /**
   * The question being memorised right now — never the one being recalled:
   * showing that one deletes the N-back (spec §7). Empty on trailing steps.
   */
  const [question, setQuestion] = useState('');
  /** null when the field is closed for this step; the countdown otherwise. */
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [gridBox, setGridBox] = useState(300);

  const runnerRef = useRef<RoundRunner | null>(null);
  const planRef = useRef<RoundPlan | null>(null);
  /** Starts the prepared round; set once setup finishes, called by the tap. */
  const beginRef = useRef<(() => void) | null>(null);
  /** Rebuilds plan/engine/runner for a chosen N; set once setup finishes. */
  const buildForNRef = useRef<((n: number) => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Clears the just-judged answer off screen a moment after its ○/× lands.
   * Kept on screen through the next question used to be the design (so a
   * verdict arriving late still had somewhere to land), but seeing a solved
   * answer linger through the whole of the following question read as
   * broken rather than helpful — a brief flash of the colour is enough.
   */
  const verdictClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** How long the ○/× stays on screen before it clears itself. */
  const VERDICT_DISPLAY_MS = 1500;
  /** Drives the on-screen countdown during a timed typed answer window. */
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * The step index the open typed answer window belongs to, or null when
   * none is open. `remainingMs` alone cannot gate handleTypedSubmit: it is
   * React state, so a second press queued from a rapid double-tap on 送る can
   * still read the pre-submit value after the first press has already
   * resolved readyToClose() and advanced the round to the *next* window —
   * submitting that new window instantly and reading as a skipped question.
   * This ref is set the instant a window opens and cleared the instant a
   * submit is accepted, both synchronously, so the second press always sees
   * the update the first press made.
   */
  const openStepRef = useRef<number | null>(null);

  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript;
    if (!transcript) return;
    // isFinal marks the recognizer's last word for this session; the step
    // closes on it rather than waiting out the settle bound.
    resolved.listener.push(transcript, event.isFinal);
    // Hearing anything at all means whatever went wrong is over.
    setRecogError(null);
    // Shown as-is, and tagged with the step it belongs to: the owner needs to
    // see a mis-hear as a mis-hear, before the judge has said anything.
    setAnswer({
      index: runnerRef.current?.state.stepIndex ?? -1,
      text: transcript,
      correct: null,
    });
  });

  // A session can end with nothing said at all. Without this the step would
  // sit out the whole settle bound waiting for a result that is not coming.
  useSpeechRecognitionEvent('end', () => {
    resolved.listener.sessionEnded();
  });

  // A refused microphone, an unsupported language or a dead network look
  // exactly like silence from inside the round. Say which it was, on screen:
  // by the time the owner notices, the console is long gone.
  useSpeechRecognitionEvent('error', (event) => {
    // Saying nothing on one step is ordinary — that is 聞き取れず, not a fault.
    if (event.error === 'no-speech') return;
    console.log(`[nback] 認識エラー ${event.error}: ${event.message}`);
    setRecogError(event.error);
  });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const granted = await resolved.requestPermissions();
      if (cancelled) return;
      if (!granted) {
        setLabel(strings.game.micPermissionNeeded);
        return;
      }

      try {
        const [settings, learned, custom] = await Promise.all([
          loadSettings(),
          loadLearned(),
          loadCustom(),
        ]);
        if (cancelled) return;

        setLanguage(settings.language);

        const series = findSeries(
          listSeries({ custom, learned, maxTier: settings.maxTier, language: settings.language }),
          seriesId,
        );
        const storedN = await loadN(series.id);
        if (cancelled) return;

        const defaultN = settings.adaptive ? storedN : settings.fixedN;
        const pool = series.questions;

        // Named before the mic opens: the lag alone does not say which set of
        // questions is about to be asked, and picking the wrong one costs a
        // whole round.
        setSeriesLabel(strings.game.seriesLabel(series.title, pool.length));

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

        setMode(settings.mode);
        const typed = settings.answerInput === 'typed' ? new TypedListener() : null;
        typedRef.current = typed;
        setAnswerInput(settings.answerInput);

        const { a, b } = phaseDurations(settings);
        // A merged step starts its clock while the question is still being
        // read, so the budget absorbs the length that reading used to have to
        // itself. Without this every typed answer would silently go late.
        const budgetBaseMs = typed
          ? settings.budgetBaseMs + a
          : settings.budgetBaseMs;

        /**
         * Builds the plan/engine/runner for a given N and wires beginRef to
         * start it. Re-run from the warm-up screen if the owner changes the
         * N dropdown there, so the tap that unlocks audio always starts a
         * round at the N actually chosen — not the one loaded before the
         * warm-up screen appeared.
         */
        const buildForN = (n: number) => {
          const plan = buildRound(n, pool, Math.random, settings.mode);
          planRef.current = plan;
          const engine = new RoundEngine(plan, { budgetBaseMs });
          const queue = new JudgeQueue(
            resolved.judgeClient,
            {
              onVerdict: (index, correct) => {
                engine.resolveAnswer(index, correct);
                // Colours the answer only while it is still the one on screen —
                // a verdict that arrives after the owner has spoken again belongs
                // to a step they are no longer looking at.
                setAnswer((current) =>
                  current && current.index === index ? { ...current, correct } : current,
                );
                // Briefly shows the ○/× and then clears it, rather than leaving
                // a solved answer on screen through the whole of the next
                // question. Guarded the same way the colour above is: only
                // clears if this verdict's answer is still the one showing.
                if (verdictClearRef.current) clearTimeout(verdictClearRef.current);
                verdictClearRef.current = setTimeout(() => {
                  verdictClearRef.current = null;
                  setAnswer((current) => (current?.index === index ? null : current));
                }, VERDICT_DISPLAY_MS);
              },
              onLearn: (questionId, answer) => {
                void addLearned(questionId, answer);
              },
            },
            settings.language,
          );

          const runner = new RoundRunner({
            plan,
            engine,
            speaker: resolved.speaker,
            listener: typed ?? resolved.listener,
            onJudge: (answer) => queue.enqueue(answer),
            clock: typed ? () => Date.now() : undefined,
            // Typed mode has no microphone to keep the synthesizer out of, so
            // the question and the answer window run together (spec §7).
            merged: typed !== null,
          });
          runnerRef.current = runner;

          // Invoked from schedule(), long after this setup block has returned, so
          // it owns its error handling — and always reaches the results screen.
          const finish = async () => {
            try {
              await within(queue.drain(), DRAIN_TIMEOUT_MS);
              if (!cancelled) {
                if (settings.adaptive) await saveN(series.id, engine.nextN(n));
                await appendHistory({
                  date: localDate(),
                  n,
                  positionScore: engine.positionScore,
                  answerScore: engine.answerScore,
                  unresolved: engine.unresolvedCount,
                  seriesId: series.id,
                  onTimeScore: engine.onTimeScore,
                });
              }
            } catch (error) {
              console.error('[nback] ラウンド終了処理に失敗しました', error);
            }
            if (!cancelled) onFinished(engine, plan);
          };

          const schedule = () => {
            if (cancelled) return;
            const { phase, stepIndex, flashPosition } = runner.state;

            if (phase === 'done') {
              // The round is over: nothing is owed, so the countdown must not
              // freeze on screen and the field must not stay typable through
              // the grading drain (up to DRAIN_TIMEOUT_MS).
              setRemainingMs(null);
              setTypedText('');
              setQuestion('');
              void finish();
              return;
            }

            setFlash(flashPosition);
            // 'AB' is a step opening too — a merged step has no separate A.
            if (phase !== 'B') {
              setSelected(null);
              setTapVerdict(null);
            }
            // The mic reopening is the owner's turn again, so the previous
            // answer clears here rather than at the step boundary — it stays up
            // through the next question, which is when its verdict arrives.
            // Merged steps have no such boundary to clear on: there the submit
            // itself replaces what is on screen (see handleTypedSubmit).
            if (phase === 'B') setAnswer(null);

            const step = plan.steps[stepIndex];
            const owesAnswer = step.recallTarget !== null;
            // Merged steps are always the owner's turn, so they say so — except
            // on the opening steps, which ask for nothing yet.
            const answering = phase === 'AB' ? owesAnswer : phase === 'B';
            setLabel(strings.game.stepLabel(stepIndex + 1, plan.steps.length, n, answering));

            // Spoken and shown both: the question stays up through its own
            // answer window, and the trailing steps show nothing at all.
            setQuestion(step.question?.q ?? '');
            // Whether the field is live this phase — from the merged step's
            // start, or from phase B in the two-phase round.
            const windowOpen = phase === 'B' || phase === 'AB';

            if (windowOpen && typed && owesAnswer) {
              const target = plan.steps[step.recallTarget!];
              const budget = answerBudgetMs(
                target.question?.accept[0] ?? '',
                budgetBaseMs,
              );
              openStepRef.current = stepIndex;
              setTypedText('');
              setRemainingMs(budget);
              const startedAt = Date.now();
              clockRef.current = setInterval(() => {
                const left = budget - (Date.now() - startedAt);
                setRemainingMs(left);
                // The target is reached; the window itself stays open until the
                // answer is sent. Painting 0.0s once and then stopping keeps an
                // idle step from re-rendering the screen every 200ms forever.
                if (left <= 0 && clockRef.current) {
                  clearInterval(clockRef.current);
                  clockRef.current = null;
                }
              }, 200);
            } else {
              setRemainingMs(null);
              // RoundRunner always opens the TypedListener on phase B and
              // readyToClose() always waits on settle(), even on a step that
              // owes no answer — the runner does not know about steps. Nothing
              // is shown to submit here, so the UI submits on the step's
              // behalf: the outer timer below still paces the step normally,
              // this just keeps readyToClose() from waiting on input nobody
              // will ever give.
              if (windowOpen && typed) {
                typed.submit();
              }
            }

            const advance = () => {
              void runner.readyToClose().then(() => {
                if (cancelled) return;
                if (clockRef.current) {
                  clearInterval(clockRef.current);
                  clockRef.current = null;
                }
                // tick() transitions synchronously, so the repaint lands with
                // the transition rather than chaining off another promise.
                runner.tick();
                schedule();
              });
            };

            // Typed answer windows close on submit, not on a timer: that is what
            // makes the round submit-driven. Everything else keeps its timer,
            // including typed steps that owe no answer.
            if (windowOpen && typed && owesAnswer) {
              advance();
            } else {
              // A merged step is both halves at once, so it is paced by both.
              const span = phase === 'A' ? a : phase === 'AB' ? a + b : b;
              timerRef.current = setTimeout(advance, span);
            }
          };

          // Prepared but not started: the round waits for the warm-up tap,
          // which is what lets iOS speak at all.
          beginRef.current = () => {
            // Runs from the tap handler, outside this block's try, so it owns
            // its failures — a synthesizer that cannot start must not leave the
            // owner on a screen that looks ready.
            try {
              runner.start();
              setReady(true);
              schedule();
            } catch (error) {
              console.error('[nback] ラウンドの開始に失敗しました', error);
              setLabel(strings.game.setupFailed);
            }
          };
        };

        if (cancelled) return;
        buildForNRef.current = buildForN;
        setLag(defaultN);
        setSelectedN(defaultN);
        buildForN(defaultN);
        setWarmup(true);
      } catch (error) {
        console.error('[nback] ラウンドの準備に失敗しました', error);
        if (!cancelled) setLabel(strings.game.setupFailed);
      }
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (clockRef.current) clearInterval(clockRef.current);
      if (verdictClearRef.current) clearTimeout(verdictClearRef.current);
      resolved.listener.stop();
      typedRef.current?.stop();
      resolved.speaker.stop();
    };
  }, [resolved, onFinished, seriesId]);

  /**
   * The warm-up start tap. The unlock has to happen here, synchronously: it
   * is the gesture itself that permits speech, and anything awaited first
   * lands outside it. If the dropdown's N differs from what the round was
   * built with, it is rebuilt for the chosen N before starting — the tap
   * that unlocks audio always starts a round at the N actually chosen.
   */
  const handleWarmupStart = useCallback(() => {
    resolved.speaker.unlock();
    if (selectedN !== null && selectedN !== lag) {
      buildForNRef.current?.(selectedN);
      setLag(selectedN);
    }
    setWarmupStarted(true);
    setWarmup(false);
    beginRef.current?.();
  }, [resolved, selectedN, lag]);

  /**
   * Sending the typed answer. The transcript display is driven by the
   * recognizer's `result` event in voice mode, and nothing fires that event
   * here — so the submit puts the answer on screen itself. Without it the
   * judge's verdict has nothing to colour and the default mode gives no ○/×
   * feedback at all until the results screen.
   */
  const handleTypedSubmit = useCallback(() => {
    // Guards both call sites (this button and the field's returnKeyType
    // "send") against a window that has already closed: stop() reads the
    // final transcript but deliberately leaves it in place for the UI to
    // paint, so a stale `typed.text` from the step just answered is still
    // sitting there through the whole of the next step's phase A. Without
    // this a tap here would repaint that stale text under the new step's
    // index and, worse, steal the previous step's own live-transcript slot —
    // making its genuine ○/× verdict fail to land.
    //
    // Checked and cleared here, synchronously, rather than trusting
    // `remainingMs`: that is React state, so a rapid double-tap on 送る can
    // have its second press read the pre-submit value even after the first
    // press's promise chain already opened the *next* window — submitting
    // that new window before the player has seen it, which reads as the
    // question being silently skipped.
    //
    // A time-based cooldown was tried here and reverted: a stale second
    // press from one double-tap and a fast player's genuine answer to the
    // very next question are the same shape at this layer (a press on the
    // window that is open right now, moments after the previous submit) —
    // nothing here can tell them apart. Rejecting both trades a rare,
    // cosmetic double-tap skip for silently swallowing ordinary fast play,
    // which reads as the whole round having frozen. The rarer failure is
    // the one to keep.
    if (openStepRef.current === null) return;
    openStepRef.current = null;
    const typed = typedRef.current;
    if (!typed) return;
    const text = typed.text;
    // Sending nothing is 聞き取れず for this step, so the previous step's
    // answer — still on screen through a merged step — must come down with
    // it rather than read as this step's verdict.
    setAnswer(
      text.length > 0
        ? { index: runnerRef.current?.state.stepIndex ?? -1, text, correct: null }
        : null,
    );
    typed.submit();
  }, []);

  const handleTap = useCallback((position: Position) => {
    runnerRef.current?.onTap(position);
    setSelected(position);
    setTapVerdict(scoreTap(planRef.current, runnerRef.current, position));
  }, []);

  if (warmup) {
    return (
      <View style={styles.screen}>
        <LagHeader n={lag} strings={strings.game} />
        <Text testID="warmup-series" style={styles.warmupSeries}>
          {seriesLabel}
        </Text>
        <Text style={styles.warmupCaption}>{strings.game.warmupCaption}</Text>
        <Text style={styles.warmupNLabel}>{strings.game.warmupNLabel}</Text>
        <View testID="warmup-n-select" style={styles.warmupRow}>
          {N_CHOICES.map((n) => (
            <Pressable
              key={n}
              testID={`warmup-n-choice-${n}`}
              style={[styles.warmupChoice, selectedN === n && styles.warmupChoiceSelected]}
              onPress={() => setSelectedN(n)}
            >
              <Text style={styles.warmupChoiceLabel}>{n}</Text>
            </Pressable>
          ))}
        </View>
        <Pressable testID="warmup-start" style={styles.warmupStartButton} onPress={handleWarmupStart}>
          <Text style={styles.warmupStartLabel}>{strings.game.warmupStart}</Text>
        </Pressable>
        <Text style={styles.warmupHint}>{strings.game.warmupHint}</Text>
      </View>
    );
  }

  const typed = answerInput === 'typed';

  return (
    // The keyboard stays up for the whole round (spec §7). On iOS it overlays
    // the view rather than resizing it, so without this the field, the send
    // button and the clock all sit behind it — and the transcript the player
    // is meant to correct cannot be seen at all.
    //
    // On the web build that is not enough: KeyboardAvoidingView has no native
    // keyboard metrics in a browser, and iOS Safari keeps reporting the full
    // window height with the keyboard up. Pinning the height to the visual
    // viewport is what keeps the last row of the grid on screen there.
    <KeyboardAvoidingView
      style={[
        styles.screen,
        // Typed mode is laid out from the top: with the keyboard up the column
        // is taller than what is left, and centring it would push the lag
        // header off the top as well as the grid off the bottom.
        typed && styles.screenTyped,
        viewportHeight !== null && {
          height: viewportHeight,
          maxHeight: viewportHeight,
          // `flex: 1` above compiles to `flex: 1 1 0%`, and flex-basis beats
          // height for a flex item — which #root is, at `height: 100%` of the
          // *layout* viewport that Safari never shrinks. So the height above
          // was ignored, the screen stayed the full window tall and the grid
          // grew to fill it. Opting out of flex sizing is what makes it bind.
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: 'auto',
        },
      ]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* The step label already names the lag ("4 / 10 1-back"), so the header
          repeating it is a line typed mode cannot afford — every point above
          the grid is one the keyboard has already taken. */}
      {!typed && <LagHeader n={lag} strings={strings.game} />}
      {warmupStarted && !ready && (
        <Text style={styles.warmupCaption}>{strings.game.preparing}</Text>
      )}
      {typed ? (
        // Label and clock share a row for the same reason.
        <View style={styles.typedTopRow}>
          <Text style={[styles.label, styles.labelTyped]}>{label}</Text>
          {remainingMs !== null && (
            <Text
              testID="answer-clock"
              style={[styles.clock, styles.clockTyped, remainingMs <= 0 && styles.clockOut]}
            >
              {Math.max(0, remainingMs / 1000).toFixed(1)}s
            </Text>
          )}
        </View>
      ) : (
        <Text style={styles.label}>{label}</Text>
      )}
      {recogError && (
        <Text testID="recog-error" style={styles.error}>
          {strings.game.recogErrorPrefix}
          {recogError}
        </Text>
      )}
      {/* In typed mode the slot keeps its height whether or not a verdict is
          showing. Without it the grid below resizes every time an ○/× lands
          and clears — the squares move out from under the finger that is
          trying to tap them. */}
      {typed ? (
        <View style={styles.heardSlot}>
          {answer && (
            <Text
              testID="live-transcript"
              style={[styles.heard, styles.heardTyped, { color: answerColor(answer) }]}
            >
              {`${strings.game.heardQuote(answer.text)}${verdictMark(answer)}`}
            </Text>
          )}
        </View>
      ) : (
        answer && (
          <Text
            testID="live-transcript"
            style={[styles.heard, { color: answerColor(answer) }]}
          >
            {`${strings.game.heardQuote(answer.text)}${verdictMark(answer)}`}
          </Text>
        )
      )}
      {typed && (
        // Above the grid, in spec §7's order: 質問 → 時計 → 入力欄 → グリッド.
        // Everything the keyboard could hide is the part that has to stay
        // visible, so the grid is what gives up the space.
        <View style={styles.typedBlock}>
          <Text testID="current-question" style={[styles.question, styles.questionTyped]}>
            {question}
          </Text>
          <View style={styles.typedRow}>
            <TextInput
              testID="typed-answer-input"
              style={styles.typedInput}
              value={typedText}
              editable={remainingMs !== null}
              autoCorrect={false}
              placeholder={
                remainingMs === null
                  ? strings.game.typedPlaceholderClosed
                  : strings.game.typedPlaceholderOpen
              }
              onChangeText={(text) => {
                setTypedText(text);
                typedRef.current?.push(text);
              }}
              onSubmitEditing={handleTypedSubmit}
              returnKeyType="send"
            />
            <Pressable
              testID="typed-submit"
              onPress={handleTypedSubmit}
              disabled={remainingMs === null}
            >
              <Text style={styles.typedSend}>{strings.game.send}</Text>
            </Pressable>
          </View>
        </View>
      )}
      {mode === 'dual' && typed && (
        // Typed mode only: the keyboard eats space a fixed 300 grid does not
        // account for, so size it from what onLayout finds actually left.
        // Clamped at both ends — a transient 0-height layout pass used to
        // produce negative cells, and an unbounded one stretches the grid
        // across a whole tall screen once the keyboard closes.
        <View
          testID="grid-box"
          style={styles.gridBox}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setGridBox(Math.max(0, Math.min(width, height, MAX_GRID)));
          }}
        >
          <Grid
            flashPosition={flash}
            selected={selected}
            tapVerdict={tapVerdict}
            onTap={handleTap}
            disabled={!ready}
            size={gridBox}
          />
        </View>
      )}
      {mode === 'dual' && answerInput === 'voice' && (
        // Voice mode: unchanged from before this task — no flex wrapper, no
        // explicit size, so Grid renders at its original intrinsic default.
        <Grid
          flashPosition={flash}
          selected={selected}
          tapVerdict={tapVerdict}
          onTap={handleTap}
          disabled={!ready}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', backgroundColor: '#000' },
  /* Every vertical gap above the grid is money the keyboard is already
     spending. A typed round on an iPhone has roughly 400pt of visible height,
     and the question, clock and field need ~120 of it — so the chrome is
     tightened here rather than letting the grid absorb the whole shortfall. */
  screenTyped: { justifyContent: 'flex-start', paddingTop: 8, paddingBottom: 4 },
  label: {
    color: '#f4f1ea',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 24,
  },
  labelTyped: { fontSize: 15, marginBottom: 0 },
  /* Step label and countdown on one line. Two lines of chrome is a whole row
     of grid cells on a phone with the keyboard up. */
  typedTopRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  /* The colour is applied inline: neutral until this step's verdict lands,
     because 判定待ち is not 不正解. */
  lag: {
    color: '#c96f4a',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 16,
  },
  lagTyped: { fontSize: 15, marginBottom: 4 },
  warmupCaption: {
    color: '#8e8e93',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 8,
  },
  warmupNLabel: {
    color: '#8e8e93',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  warmupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 24,
  },
  warmupChoice: {
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: 12,
    backgroundColor: '#1c1c1e',
  },
  warmupChoiceSelected: { backgroundColor: '#c96f4a' },
  warmupSeries: {
    color: '#f4f1ea',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 4,
  },
  warmupChoiceLabel: { color: '#f4f1ea', fontSize: 28 },
  warmupStartButton: {
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#c96f4a',
    alignItems: 'center',
    marginBottom: 16,
  },
  warmupStartLabel: { color: '#000', fontSize: 18, fontWeight: 'bold' },
  warmupHint: { color: '#8e8e93', fontSize: 14, textAlign: 'center' },
  error: {
    color: '#e5534b',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 12,
  },
  heard: {
    fontSize: 22,
    textAlign: 'center',
    marginBottom: 24,
  },
  heardTyped: { fontSize: 17, marginBottom: 0 },
  /* Reserved whether or not a verdict is showing, so the grid below does not
     resize under the player's finger when one lands and clears. */
  heardSlot: { minHeight: 24, justifyContent: 'center', marginBottom: 4 },
  /* minHeight:0 so the box can actually shrink below its content on web —
     without it flexbox refuses, and the grid overflows the viewport instead
     of fitting inside what the keyboard left. */
  gridBox: {
    flex: 1,
    flexShrink: 1,
    minHeight: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typedBlock: { marginBottom: 8, alignItems: 'center' },
  /* Keeps its height when a trailing step has no question, so the field and
     the grid below it do not jump. */
  question: {
    color: '#f4f1ea',
    fontSize: 20,
    textAlign: 'center',
    minHeight: 28,
    marginBottom: 8,
  },
  /* A three-line question at 20pt is ~90pt of the ~360 a keyboard leaves. */
  questionTyped: { fontSize: 17, lineHeight: 22, minHeight: 22, marginBottom: 6 },
  clock: {
    color: '#4caf7d',
    fontSize: 20,
    textAlign: 'center',
    marginBottom: 4,
  },
  clockTyped: { fontSize: 15, marginBottom: 0 },
  clockOut: { color: '#e5534b' },
  typedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  typedInput: {
    backgroundColor: '#1c1c1e',
    color: '#f4f1ea',
    fontSize: 18,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    minWidth: 200,
  },
  typedSend: {
    color: '#c96f4a',
    fontSize: 18,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
});
