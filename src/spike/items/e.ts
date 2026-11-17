/**
 * Spike item (e): speechSynthesis availability and voice quality (Requirements 6.1 to 6.5).
 *
 * What it answers: can Capri speak dynamic text with the browser's own voice (tier 2), or must it
 * fall back to a speech bubble and a chirp (tier 3)? "The API exists" is not enough, so the probe
 * separates three outcomes and puts the answer in `measurements.availability`:
 *   - missing:                  no `speechSynthesis` object (6.1);
 *   - available but unusable:   it exists, but every tested voice was rated Robotic or Silent,
 *                               or nothing could be rated;
 *   - available and usable:     at least one tested voice was rated Good.
 * The verdict is `works` only for the third. The first two are `does_not_work`, and the failure
 * reason says which one it was.
 *
 * Flow (all inside the AR session):
 * 1. Check `'speechSynthesis' in window` and `SpeechSynthesisUtterance`.
 * 2. The first line is spoken at once, inside the Start pinch, with no voice set (the system
 *    default). Then the probe waits for `voiceschanged` (at most `VOICES_WAIT_MS`) and lists every
 *    voice with name, language, `localService`, and `default`.
 * 3. Every English voice (up to `MAX_VOICES_TESTED` trials in total, default voice first) speaks
 *    one short Capri-style line. Each following line is spoken inside the rating pinch of the
 *    previous one, so the probe also measures whether the browser lets a pinch inside the AR
 *    session start speech. The trigger of each trial is recorded.
 * 4. Per trial the probe records `onstart` and `onend` (with timing), `onerror`, boundary events,
 *    and the `speaking`, `pending`, and `paused` flags. A watchdog moves on when an event never
 *    arrives, so a silent engine cannot hang the item.
 * 5. After each line the user rates it with pinches (as in item (b), by hand):
 *      RIGHT pinch = Good. LEFT pinch = not good, then RIGHT pinch = Robotic, LEFT pinch = Silent.
 *    The rating tells apart "events fired but nothing was heard" (Silent) from "heard and bad"
 *    (Robotic), which the events alone cannot.
 *
 * Allocation: the XR frame callback only compares numbers. Scene text is rebuilt four times per
 * second by a timer, not per frame.
 */
import type { SpikeContext, SpikeResult } from '../types.js';

/** Short lines for a playful hacker-girl character. Plain ASCII. */
const LINES: readonly string[] = [
  'Hey, it is Capri. I just rewired your lamp. You are welcome.',
  'Okay, lights on. Tiny hack, huge glow.',
];

const VOICES_WAIT_MS = 4000;
/** No `onstart` this long after `speak()` means the engine is not starting. */
const START_TIMEOUT_MS = 5000;
/** The lines take about 4 s to say. No `onend` this long after `onstart` means it is stuck. */
const END_TIMEOUT_MS = 20000;
const RATE_TIMEOUT_MS = 60000;
/** Ignore pinches right after Start, so the pinch that pressed the button does not count. */
const PINCH_GUARD_MS = 800;
/** Ignore a pinch this soon after the previous accepted one (one pinch can fire twice). */
const PINCH_DEBOUNCE_MS = 700;
/** The default-voice trial plus listed English voices. Keeps the headset time short. */
const MAX_VOICES_TESTED = 6;
/** Stop asking when the user did not answer this many prompts in a row. */
const MAX_UNRATED_IN_ROW = 2;
const TICK_MS = 250;
const MAX_VOICES_LISTED = 30;

type Measurements = Record<string, number | string>;
type Rating = 'good' | 'robotic' | 'silent' | 'unrated';
type Trigger = 'start-pinch' | 'rating-pinch' | 'timer';
type Stage = 'speaking' | 'rate-first' | 'rate-second' | 'waiting-voices' | 'done';

interface Candidate {
  /** Shown to the user and in the report. */
  label: string;
  /** `undefined` means "do not set a voice", so the browser picks its default. */
  voice: SpeechSynthesisVoice | undefined;
}

interface Trial {
  candidate: Candidate;
  line: string;
  trigger: Trigger;
  /** Held here so the utterance is not garbage collected before its events fire. */
  utterance: SpeechSynthesisUtterance;
  spokenAt: number;
  startMs: number;
  endMs: number;
  boundaries: number;
  errorCode: string;
  watchdog: 'none' | 'no-start' | 'no-end';
  cancelledByUs: boolean;
  threw: string;
  flagsAfterCall: string;
  rating: Rating;
}

function ratingText(rating: Rating): string {
  switch (rating) {
    case 'good':
      return 'Good';
    case 'robotic':
      return 'Robotic';
    case 'silent':
      return 'Silent';
    default:
      return 'not rated';
  }
}

/** `en`, `en-US`, and Android's `en_US` are all English. */
function isEnglish(voice: SpeechSynthesisVoice): boolean {
  return /^en([-_]|$)/iu.test(voice.lang);
}

function voiceLabel(voice: SpeechSynthesisVoice): string {
  return `${voice.name} [${voice.lang}, ${voice.localService ? 'local' : 'network'}${voice.default ? ', default' : ''}]`;
}

/** The default voice first, then US English, then on-device voices, then by name. */
function compareVoices(first: SpeechSynthesisVoice, second: SpeechSynthesisVoice): number {
  const rank = (voice: SpeechSynthesisVoice): number =>
    (voice.default ? 0 : 4) + (/^en[-_]us$/iu.test(voice.lang) ? 0 : 2) + (voice.localService ? 0 : 1);
  return rank(first) - rank(second) || first.name.localeCompare(second.name);
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

export function runItemE(ctx: SpikeContext): Promise<SpikeResult> {
  const world = ctx.world;
  const session = world.xrSession;
  if (session === undefined) {
    return Promise.resolve({
      item: 'e',
      verdict: 'does_not_work',
      failureReason: 'No WebXR session is active. Press Enter AR on the page first.',
    });
  }

  const measurements: Measurements = {
    secureContext: window.isSecureContext ? 'yes' : 'no',
    userAgent: navigator.userAgent.slice(0, 160),
  };

  // ---- Step 1 (Requirement 6.1): does the API exist? ----
  const hasSynth = 'speechSynthesis' in window && window.speechSynthesis !== undefined;
  const hasUtterance = typeof SpeechSynthesisUtterance === 'function';
  measurements.speechSynthesisObject = hasSynth ? 'present' : 'missing';
  measurements.speechSynthesisUtteranceClass = hasUtterance ? 'present' : 'missing';
  if (!hasSynth || !hasUtterance) {
    measurements.availability = 'missing';
    return Promise.resolve({
      item: 'e',
      verdict: 'does_not_work',
      failureReason: !hasSynth
        ? 'window.speechSynthesis does not exist in this browser, so the browser cannot speak text.'
        : 'SpeechSynthesisUtterance does not exist in this browser, so speechSynthesis cannot be used.',
      measurements,
    });
  }
  const synth = window.speechSynthesis;

  // ---- State ----
  const trials: Trial[] = [];
  const queue: Candidate[] = [];
  let allVoices: SpeechSynthesisVoice[] = [];
  let englishVoices: SpeechSynthesisVoice[] = [];
  let voicesReady = false;
  let voicesMs = -1;
  let voicesEventFired = false;
  let voicesTimedOut = false;
  let wantAdvance = false;
  let nextQueueIndex = 0;
  let current: Trial | undefined;
  let stage: Stage = 'speaking';
  let finished = false;
  let unratedInRow = 0;
  let ratePromptAt = 0;
  let lastPinchAt = 0;
  let acceptedPinches = 0;
  const startedAt = performance.now();

  let xrFrames = 0;
  let maxGapMsWhileSpeaking = 0;
  let timer: number | undefined;
  let voicesTimer: number | undefined;
  let stopFrames: () => void = () => undefined;
  let removeVoicesListener: () => void = () => undefined;

  const totalPlanned = (): string => (voicesReady ? String(1 + queue.length) : '?');

  const flagsText = (): string =>
    `speaking=${synth.speaking} pending=${synth.pending} paused=${synth.paused}`;

  const describeTrial = (trial: Trial): string => {
    const start = trial.startMs >= 0 ? `yes at ${Math.round(trial.startMs)} ms` : 'NO';
    const end =
      trial.endMs >= 0
        ? `yes after ${seconds(trial.endMs - Math.max(trial.startMs, 0))} s of speech`
        : 'NO';
    const parts = [
      `trigger ${trial.trigger}`,
      `onstart ${start}`,
      `onend ${end}`,
      `boundary events ${trial.boundaries}`,
      `error ${trial.errorCode === '' ? 'none' : trial.errorCode}`,
      `after speak(): ${trial.flagsAfterCall}`,
    ];
    if (trial.watchdog !== 'none') parts.push(`watchdog ${trial.watchdog}`);
    if (trial.threw !== '') parts.push(`speak() threw ${trial.threw}`);
    parts.push(`rated ${ratingText(trial.rating)}`);
    return parts.join('; ');
  };

  // ---- Result building ----
  const buildResult = (): SpikeResult => {
    const good = trials.filter((trial) => trial.rating === 'good');
    const robotic = trials.filter((trial) => trial.rating === 'robotic').length;
    const silent = trials.filter((trial) => trial.rating === 'silent').length;
    const unrated = trials.filter((trial) => trial.rating === 'unrated').length;
    const withStart = trials.filter((trial) => trial.startMs >= 0).length;
    const withEnd = trials.filter((trial) => trial.endMs >= 0).length;

    measurements.voicesChangedEvent = voicesEventFired
      ? 'fired'
      : voicesTimedOut
        ? `did not fire within ${VOICES_WAIT_MS} ms`
        : 'not needed (voices were already listed)';
    measurements.voicesListedAfterMs = voicesMs >= 0 ? Math.round(voicesMs) : 'never';
    measurements.voicesTotal = allVoices.length;
    measurements.englishVoicesTotal = englishVoices.length;
    measurements.englishVoices =
      englishVoices.length === 0
        ? 'none listed'
        : englishVoices
            .slice(0, MAX_VOICES_LISTED)
            .map(voiceLabel)
            .join(' | ');
    const otherLanguages = new Set<string>();
    for (const voice of allVoices) if (!isEnglish(voice)) otherLanguages.add(voice.lang);
    measurements.otherLanguageVoices = `${allVoices.length - englishVoices.length} voices in ${otherLanguages.size} languages`;
    const flaggedDefault = allVoices.find((voice) => voice.default);
    measurements.defaultVoiceFlagged = flaggedDefault === undefined ? 'none flagged' : voiceLabel(flaggedDefault);
    measurements.trialsRun = `${trials.length} of ${totalPlanned()} planned (cap ${MAX_VOICES_TESTED})`;

    trials.forEach((trial, index) => {
      const voice = trial.candidate.voice;
      const who = voice === undefined ? trial.candidate.label : voiceLabel(voice);
      measurements[`trial ${index + 1}`] = `${who}: ${describeTrial(trial)}`;
    });

    measurements.ratingsGood = good.length;
    measurements.ratingsRobotic = robotic;
    measurements.ratingsSilent = silent;
    measurements.ratingsNotRated = unrated;
    measurements.trialsWithOnstart = `${withStart} of ${trials.length}`;
    measurements.trialsWithOnend = `${withEnd} of ${trials.length}`;
    const eventsButSilent = trials.filter((trial) => trial.rating === 'silent' && trial.startMs >= 0).length;
    if (eventsButSilent > 0) {
      measurements.eventsFiredButHeardNothing = `${eventsButSilent} trials fired onstart but were rated Silent (volume, muted audio, or an engine with no output)`;
    }
    const heardButNoEvents = trials.filter(
      (trial) => (trial.rating === 'good' || trial.rating === 'robotic') && trial.startMs < 0,
    ).length;
    if (heardButNoEvents > 0) {
      measurements.heardButNoOnstart = `${heardButNoEvents} trials were heard but fired no onstart (do not depend on events)`;
    }
    const triggerCounts = new Map<Trigger, { spoke: number; total: number }>();
    for (const trial of trials) {
      const entry = triggerCounts.get(trial.trigger) ?? { spoke: 0, total: 0 };
      entry.total += 1;
      if (trial.startMs >= 0) entry.spoke += 1;
      triggerCounts.set(trial.trigger, entry);
    }
    for (const [trigger, entry] of triggerCounts) {
      measurements[`speechStartedWhenTriggeredBy ${trigger}`] = `${entry.spoke} of ${entry.total} trials fired onstart`;
    }
    measurements.pinchesAccepted = acceptedPinches;
    measurements.xrFrames = xrFrames;
    measurements.maxXrFrameGapMsWhileSpeaking = Math.round(maxGapMsWhileSpeaking);

    const first = good[0];
    if (first !== undefined) {
      const voice = first.candidate.voice;
      measurements.availability = 'available and usable';
      measurements.usableVoice = voice === undefined ? 'system default voice (no voice set)' : voiceLabel(voice);
      measurements.usableVoiceURI = voice === undefined ? '(none, leave the voice unset)' : voice.voiceURI;
      measurements.usableVoiceCount = `${good.length} of ${trials.length} tested voices rated Good`;
      return { item: 'e', verdict: 'works', measurements };
    }

    let reason: string;
    if (trials.length === 0) {
      measurements.availability = 'available, nothing tested';
      reason = 'speechSynthesis exists, but no line could be spoken.';
    } else if (unrated === trials.length) {
      measurements.availability = 'available, not rated';
      reason = `speechSynthesis exists and ${withStart} of ${trials.length} lines fired onstart, but nothing was rated, so quality is unknown. Run item (e) again and rate the voices.`;
    } else {
      measurements.availability = 'available but unusable';
      const notStarted = trials.length - withStart;
      reason = `speechSynthesis exists, but no tested voice was rated Good (${robotic} Robotic, ${silent} Silent, ${unrated} not rated, of ${trials.length}). onstart fired for ${withStart} of ${trials.length}${notStarted === trials.length ? ', so the engine accepts speak() but never starts speaking (likely a stub)' : ''}.`;
    }
    return { item: 'e', verdict: 'does_not_work', failureReason: reason, measurements };
  };

  return new Promise<SpikeResult>((resolve) => {
    const cleanup = (): void => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
      if (voicesTimer !== undefined) window.clearTimeout(voicesTimer);
      voicesTimer = undefined;
      removeVoicesListener();
      removeVoicesListener = () => undefined;
      stopFrames();
      stopFrames = () => undefined;
      session.removeEventListener('selectstart', onSelectStart);
      for (const trial of trials) {
        trial.utterance.onstart = null;
        trial.utterance.onend = null;
        trial.utterance.onerror = null;
        trial.utterance.onboundary = null;
      }
      try {
        synth.cancel();
      } catch {
        // Nothing is speaking.
      }
    };

    const finish = (result: SpikeResult): void => {
      if (finished) return;
      finished = true;
      stage = 'done';
      ctx.setNeedsUser(false);
      const goodCount = trials.filter((trial) => trial.rating === 'good').length;
      ctx.setDetail(`Done. ${trials.length} voices tried, ${goodCount} rated Good. Pinch Next.`);
      cleanup();
      resolve(result);
    };

    ctx.signal.addEventListener(
      'abort',
      () => {
        if (finished) return;
        // The runner ignores this result. Keep what was measured so far.
        finish({
          item: 'e',
          verdict: 'does_not_work',
          failureReason: 'The item was stopped or the AR session ended before it finished.',
          measurements,
        });
      },
      { once: true },
    );

    // ---- Speaking ----

    const beginRating = (): void => {
      // Only a line that is still being spoken can start the rating (late events are ignored).
      if (finished || stage !== 'speaking') return;
      stage = 'rate-first';
      ratePromptAt = performance.now();
      ctx.setNeedsUser(true);
      refreshText();
    };

    const speak = (candidate: Candidate, trigger: Trigger): void => {
      const line = LINES[trials.length % LINES.length];
      const utterance = new SpeechSynthesisUtterance(line);
      if (candidate.voice === undefined) {
        utterance.lang = 'en-US';
      } else {
        utterance.voice = candidate.voice;
        utterance.lang = candidate.voice.lang;
      }
      const trial: Trial = {
        candidate,
        line,
        trigger,
        utterance,
        spokenAt: performance.now(),
        startMs: -1,
        endMs: -1,
        boundaries: 0,
        errorCode: '',
        watchdog: 'none',
        cancelledByUs: false,
        threw: '',
        flagsAfterCall: 'not read',
        rating: 'unrated',
      };
      trials.push(trial);
      current = trial;
      stage = 'speaking';
      ctx.setNeedsUser(false);

      utterance.onstart = (): void => {
        if (trial.startMs < 0) trial.startMs = performance.now() - trial.spokenAt;
      };
      utterance.onboundary = (): void => {
        trial.boundaries += 1;
      };
      utterance.onend = (): void => {
        if (trial.endMs < 0) trial.endMs = performance.now() - trial.spokenAt;
        if (current === trial) beginRating();
      };
      utterance.onerror = (event: SpeechSynthesisErrorEvent): void => {
        // Cancels that this probe asked for are not errors of the engine.
        if (trial.cancelledByUs) return;
        trial.errorCode = event.error;
        if (current === trial) beginRating();
      };

      try {
        // A queue left over from earlier speech would delay this line. Clear it, and note it.
        if (synth.speaking || synth.pending) {
          measurements.queueWasBusyBeforeSpeak = 'yes, cancelled it first';
          synth.cancel();
        }
        synth.speak(utterance);
        // Some engines start paused after the first call.
        if (synth.paused) {
          measurements.startedPaused = 'yes, resume() was called';
          synth.resume();
        }
        trial.flagsAfterCall = flagsText();
      } catch (error) {
        trial.threw = error instanceof Error ? `${error.name}: ${error.message.slice(0, 100)}` : String(error);
        beginRating();
      }
      refreshText();
    };

    /** Move to the next voice, or finish. `trigger` says whether a pinch started it. */
    const advance = (trigger: Trigger): void => {
      if (finished) return;
      if (!voicesReady) {
        // The voice list is still loading. Continue as soon as it arrives.
        stage = 'waiting-voices';
        wantAdvance = true;
        ctx.setNeedsUser(false);
        refreshText();
        return;
      }
      const candidate = queue[nextQueueIndex];
      if (candidate === undefined) {
        finish(buildResult());
        return;
      }
      nextQueueIndex += 1;
      speak(candidate, trigger);
    };

    // ---- Rating by pinch ----

    const rate = (rating: Rating, trigger: Trigger): void => {
      if (current !== undefined) current.rating = rating;
      unratedInRow = rating === 'unrated' ? unratedInRow + 1 : 0;
      if (unratedInRow >= MAX_UNRATED_IN_ROW) {
        finish(buildResult());
        return;
      }
      // The next line is spoken inside this call, so it is started from the pinch event.
      advance(trigger);
    };

    function onSelectStart(event: XRInputSourceEvent): void {
      if (finished) return;
      const handedness = event.inputSource.handedness;
      if (handedness !== 'left' && handedness !== 'right') return;
      const now = performance.now();
      if (now - startedAt < PINCH_GUARD_MS || now - lastPinchAt < PINCH_DEBOUNCE_MS) return;
      if (stage === 'rate-first') {
        lastPinchAt = now;
        acceptedPinches += 1;
        if (handedness === 'right') {
          rate('good', 'rating-pinch');
        } else {
          stage = 'rate-second';
          ratePromptAt = now;
          refreshText();
        }
      } else if (stage === 'rate-second') {
        lastPinchAt = now;
        acceptedPinches += 1;
        rate(handedness === 'right' ? 'robotic' : 'silent', 'rating-pinch');
      }
    }
    session.addEventListener('selectstart', onSelectStart);

    // ---- Scene text ----

    const progressText = (): string => `${trials.length} of ${totalPlanned()}`;

    /** Ratings of the earlier voices. The last trial is the one being rated now. */
    const lastRatingsText = (): string => {
      const earlier = trials.slice(0, -1);
      return earlier.length === 0 ? '' : `  So far: ${earlier.map((trial) => ratingText(trial.rating)).join(', ')}.`;
    };

    function refreshText(): void {
      if (finished) return;
      const trial = current;
      const name = trial === undefined ? '' : trial.candidate.label;
      switch (stage) {
        case 'speaking': {
          const lag = trial === undefined ? 0 : performance.now() - trial.spokenAt;
          const note =
            trial !== undefined && trial.startMs < 0 && lag > 1500
              ? '  (no start event yet, listen anyway)'
              : '';
          ctx.setDetail(`LISTEN (${progressText()}): ${name}.${note}  Turn the headset volume up if you hear nothing.`);
          break;
        }
        case 'rate-first': {
          const left = Math.max(RATE_TIMEOUT_MS - (performance.now() - ratePromptAt), 0) / 1000;
          ctx.setDetail(
            `RATE NOW (${progressText()}, ${name}): RIGHT pinch = Good. LEFT pinch = not good.  Aim your hand away from the panel. ${left.toFixed(0)} s left.${lastRatingsText()}`,
          );
          break;
        }
        case 'rate-second': {
          const left = Math.max(RATE_TIMEOUT_MS - (performance.now() - ratePromptAt), 0) / 1000;
          ctx.setDetail(
            `NOT GOOD, which? RIGHT pinch = Robotic (heard it, sounds bad). LEFT pinch = Silent (heard nothing). ${left.toFixed(0)} s left.`,
          );
          break;
        }
        case 'waiting-voices':
          ctx.setDetail('Loading the voice list...');
          break;
        default:
          break;
      }
    }

    // ---- Timer: watchdogs and scene text, not per frame ----

    const tick = (): void => {
      if (finished) return;
      const trial = current;
      const now = performance.now();
      if (stage === 'speaking' && trial !== undefined) {
        const sinceSpeak = now - trial.spokenAt;
        if (trial.startMs < 0 && sinceSpeak > START_TIMEOUT_MS) {
          trial.watchdog = 'no-start';
          trial.cancelledByUs = true;
          try {
            synth.cancel();
          } catch {
            // Nothing to cancel.
          }
          beginRating();
        } else if (trial.startMs >= 0 && trial.endMs < 0 && sinceSpeak - trial.startMs > END_TIMEOUT_MS) {
          trial.watchdog = 'no-end';
          trial.cancelledByUs = true;
          try {
            synth.cancel();
          } catch {
            // Nothing to cancel.
          }
          beginRating();
        }
      } else if ((stage === 'rate-first' || stage === 'rate-second') && now - ratePromptAt > RATE_TIMEOUT_MS) {
        rate('unrated', 'timer');
      }
      refreshText();
    };
    timer = window.setInterval(tick, TICK_MS);

    // XR frame statistics: does speech playback starve the render loop?
    stopFrames = ctx.onFrame((_frame, deltaSeconds) => {
      xrFrames += 1;
      const gapMs = deltaSeconds * 1000;
      if (stage === 'speaking' && xrFrames > 1 && gapMs > maxGapMsWhileSpeaking) maxGapMsWhileSpeaking = gapMs;
    });

    // ---- Step 2: the first line, spoken inside the Start pinch with no voice set. ----
    speak({ label: 'system default voice', voice: undefined }, 'start-pinch');

    // ---- Step 2 (continued): wait for the voice list, then queue the English voices. ----
    const loadVoices = (): void => {
      if (voicesReady || finished) return;
      voicesReady = true;
      voicesMs = performance.now() - startedAt;
      removeVoicesListener();
      removeVoicesListener = () => undefined;
      if (voicesTimer !== undefined) window.clearTimeout(voicesTimer);
      voicesTimer = undefined;
      allVoices = synth.getVoices().slice();
      englishVoices = allVoices.filter(isEnglish).sort(compareVoices);
      // The default voice is already covered by the first trial. Skip repeated names.
      const seen = new Set<string>();
      for (const voice of englishVoices) {
        if (voice.default) continue;
        const key = `${voice.name}|${voice.lang}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (queue.length >= MAX_VOICES_TESTED - 1) break;
        queue.push({ label: voice.name, voice });
      }
      if (wantAdvance) {
        wantAdvance = false;
        // Not inside a pinch, so the trigger is recorded as a timer.
        advance('timer');
      } else {
        refreshText();
      }
    };

    if (synth.getVoices().length > 0) {
      loadVoices();
    } else {
      const onVoicesChanged = (): void => {
        if (synth.getVoices().length === 0) return;
        voicesEventFired = true;
        loadVoices();
      };
      synth.addEventListener('voiceschanged', onVoicesChanged);
      removeVoicesListener = () => synth.removeEventListener('voiceschanged', onVoicesChanged);
      voicesTimer = window.setTimeout(() => {
        voicesTimedOut = true;
        loadVoices();
      }, VOICES_WAIT_MS);
    }
  });
}
