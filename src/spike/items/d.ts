/**
 * Spike item (d): vosk-browser with a restricted grammar (Requirements 5.1 to 5.5).
 *
 * One run, in this order, all inside the AR session:
 * 1. Microphone. `getUserMedia` is the first call, inside the Start pinch (as in item (c)). If item
 *    (c) already got permission, no prompt appears. The audio graph is built at once, and audio is
 *    only passed to Vosk once a recognizer exists.
 * 2. Model. The same-origin `.tar.gz` is loaded and timed (load time in seconds). The probe also
 *    records whether the unpacked model was already cached in IndexedDB (cold or warm load), and the
 *    file size and encoding the server sent.
 * 3. Recognizer and accuracy. A recognizer is created with ["turn on","turn off","come here",
 *    "[unk]"] and timed. The user is prompted for each phrase `REPS_PER_PHRASE` times (round robin),
 *    then for one phrase that is not in the grammar, to see what the grammar does with it.
 * 4. Chaining probe (assumption A10). The recognizer is replaced by one with the fragment grammar
 *    ["turn off","that","[unk]"], and the user says "turn off that". If Vosk outputs the whole
 *    sequence, fragment grammars work. If not, full utterances must be listed.
 * 5. Rebuild timing (assumption A11). With no user input, `remove()` plus a new recognizer is timed
 *    several times for small grammars and for a product-sized grammar. Each time ends when the new
 *    recognizer answers its first message, so it measures a recognizer that is ready to use.
 *
 * Verdict: works when the model loads, the recognizers are created, and at least `PASS_FRACTION`
 * of the 30 in-grammar prompts were recognised correctly. Chaining and rebuild timing never fail the
 * item. They are measured results that choose the grammar strategy.
 *
 * Audio capture: an AudioWorklet (`public/audio/pcm-capture-worklet.js`) copies the microphone into
 * 4096-sample blocks on the audio thread, so a slow XR frame delays a block but never loses audio.
 * A page-thread ScriptProcessorNode is the fallback only. In headless tests it dropped audio while
 * the page was busy rendering and gave results such as "turn turn off". The report names the method
 * and the worst block delay (`maxCaptureLagMs`).
 *
 * Allocation: the per-frame callback only compares numbers. The library makes one copy per audio
 * block (about 11 per second). Scene text is rebuilt four times per second by a timer, not per frame.
 */
import type { Model } from 'vosk-browser';
import type { SpikeContext, SpikeResult } from '../types.js';
import {
  GrammarRecognizer,
  VoskProbeError,
  buildLargeGrammar,
  classifyHeard,
  clearModelCache,
  hasUnknown,
  importVosk,
  loadModel,
  median,
  normalizeHeard,
  probeModelFile,
  readModelCacheState,
  resolveModelUrl,
  type ModelFileInfo,
  type Outcome,
  type VoskModule,
} from './d-vosk.js';

// ---- The script the user follows. ----
const GRAMMAR_PHRASES = ['turn on', 'turn off', 'come here'] as const;
const SHORT_LABEL: Readonly<Record<string, string>> = {
  'turn on': 'on',
  'turn off': 'off',
  'come here': 'come',
};
const GRAMMAR_WORDS: readonly string[] = [...GRAMMAR_PHRASES, '[unk]'];
const REPS_PER_PHRASE = 10;
/** Not in the grammar. Shows what the grammar does with speech it was not built for. */
const OUT_OF_GRAMMAR_PHRASE = 'set a timer for five minutes';
const OUT_OF_GRAMMAR_REPS = 3;
const CHAIN_GRAMMAR: readonly string[] = ['turn off', 'that', '[unk]'];
const CHAIN_PHRASE = 'turn off that';
const CHAIN_ATTEMPTS = 3;
/** Chaining counts as working when at least this many attempts gave the whole sequence. */
const CHAIN_PASS_COUNT = 2;
/** Item works when this fraction of the in-grammar prompts is recognised correctly. */
const PASS_FRACTION = 0.7;

// ---- Rebuild probe. ----
const LARGE_GRAMMAR = buildLargeGrammar();
const SMALL_REBUILDS = 5;
const LARGE_REBUILDS = 2;
/** Assumption A11: a rebuild is well under this. */
const REBUILD_BUDGET_MS = 1000;

// ---- Timing. ----
const PERMISSION_TIMEOUT_MS = 60000;
const MODEL_LOAD_TIMEOUT_MS = 240000;
const RECOGNIZER_TIMEOUT_MS = 30000;
/** Time to say a phrase and get a result, counted from the moment the prompt appears. */
const PROMPT_TIMEOUT_MS = 7000;
/** After the timeout, the utterance is flushed and this long is allowed for the answer. */
const FLUSH_WAIT_MS = 2500;
/** A result this soon after the prompt belongs to earlier sound, not to the prompted phrase. */
const MIN_REACTION_MS = 600;
/** Rest between prompts, so the previous utterance has ended and the user can read the result. */
const PAUSE_MS = 1600;
/** Stop early when this many prompts in a row produce nothing at all. */
const EARLY_STOP_EMPTY_IN_ROW = 5;
const LIVE_TEXT_INTERVAL_MS = 250;
const AUDIO_BLOCK_SAMPLES = 4096;
const WORKLET_NAME = 'capri-pcm-capture';
const WORKLET_FILE = 'audio/pcm-capture-worklet.js';
/** About -34 dBFS, as in item (c). */
const SPEECH_RMS = 0.02;
const MAX_MISHEARD_LISTED = 10;

const CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
};

type Measurements = Record<string, number | string>;

/** Thrown inside the probe when the runner aborts it. Its result is ignored by the runner. */
class ItemStopped extends Error {
  constructor() {
    super('The item was stopped or the AR session ended before it finished.');
    this.name = 'ItemStopped';
  }
}

interface Step {
  phrase: string;
  /** `undefined` for a phrase that is not in the grammar. */
  expected: string | undefined;
}

interface Attempt {
  step: Step;
  heard: string;
  outcome: Outcome;
  /** Milliseconds from the prompt to the result, or -1 when the result was forced after a timeout. */
  resultMs: number;
}

interface PhraseTally {
  correct: number;
  total: number;
}

/** Forget the cached model so the next run is a cold load. Called by the page's Clear results button. */
export function clearItemDState(): void {
  clearModelCache();
}

function buildGrammarSteps(): Step[] {
  const steps: Step[] = [];
  for (let round = 0; round < REPS_PER_PHRASE; round += 1) {
    for (const phrase of GRAMMAR_PHRASES) steps.push({ phrase, expected: phrase });
  }
  for (let index = 0; index < OUT_OF_GRAMMAR_REPS; index += 1) {
    steps.push({ phrase: OUT_OF_GRAMMAR_PHRASE, expected: undefined });
  }
  return steps;
}

function buildChainSteps(): Step[] {
  const steps: Step[] = [];
  for (let index = 0; index < CHAIN_ATTEMPTS; index += 1) {
    steps.push({ phrase: CHAIN_PHRASE, expected: CHAIN_PHRASE });
  }
  return steps;
}

function dbfs(rms: number): string {
  return `${(rms > 1e-6 ? Math.max(20 * Math.log10(rms), -120) : -120).toFixed(0)} dBFS`;
}

function fixed(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

function quoted(text: string): string {
  return text === '' ? '(nothing)' : `"${text}"`;
}

function listOrNone(items: readonly string[]): string {
  return items.length === 0 ? 'none' : items.join(' | ');
}

function percent(part: number, whole: number): string {
  return whole === 0 ? 'n/a' : `${Math.round((part / whole) * 100)}%`;
}

export async function runItemD(ctx: SpikeContext): Promise<SpikeResult> {
  const world = ctx.world;
  const session = world.xrSession;
  if (session === undefined) {
    return {
      item: 'd',
      verdict: 'does_not_work',
      failureReason: 'No WebXR session is active. Press Enter AR on the page first.',
    };
  }

  const measurements: Measurements = {
    secureContext: window.isSecureContext ? 'yes' : 'no',
    grammarMain: JSON.stringify(GRAMMAR_WORDS),
    grammarChain: JSON.stringify(CHAIN_GRAMMAR),
  };

  const mediaDevices: MediaDevices | undefined = navigator.mediaDevices;
  if (mediaDevices === undefined || typeof mediaDevices.getUserMedia !== 'function') {
    return {
      item: 'd',
      verdict: 'does_not_work',
      failureReason: window.isSecureContext
        ? 'navigator.mediaDevices.getUserMedia is not available in this browser.'
        : 'navigator.mediaDevices is missing because the page is not a secure (HTTPS) context.',
      measurements,
    };
  }
  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') {
    return {
      item: 'd',
      verdict: 'does_not_work',
      failureReason: 'This browser has no WebAssembly or no Web Workers, which vosk-browser needs.',
      measurements,
    };
  }

  // ---- State that release() must clean up. ----
  let stream: MediaStream | undefined;
  let audioContext: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let captureNode: AudioWorkletNode | undefined;
  let scriptNode: ScriptProcessorNode | undefined;
  let silencer: GainNode | undefined;
  let model: Model | undefined;
  let active: GrammarRecognizer | undefined;
  let liveTimer: number | undefined;
  let stopFrames: () => void = () => undefined;
  let released = false;

  // ---- Live measurements. ----
  let phase = 0; // 0 = loading, 1 = recognising
  const maxGapMsByPhase = [0, 0];
  let xrFrames = 0;
  let peakRms = 0;
  let audioBlocks = 0;
  let audioBlocksFed = 0;
  let maxCaptureLagMs = 0;

  // ---- What the scene text shows. ----
  type DisplayMode = 'text' | 'loading' | 'prompt' | 'pause';
  let mode: DisplayMode = 'text';
  let plainText = 'Starting.';
  let lastNote = '';
  let currentPromptText = '';
  let promptStartedAt = 0;
  let loadStartedAt = 0;
  let modelMegabytes: number | undefined;
  let stepIndex = 0;
  let stepTotal = 0;
  const tallies = new Map<string, PhraseTally>();
  for (const phrase of GRAMMAR_PHRASES) tallies.set(phrase, { correct: 0, total: 0 });

  const scoreText = (): string => {
    let text = '';
    for (const phrase of GRAMMAR_PHRASES) {
      const tally = tallies.get(phrase);
      if (tally === undefined) continue;
      text += `${text === '' ? '' : '  '}${SHORT_LABEL[phrase]} ${tally.correct}/${tally.total}`;
    }
    return text;
  };

  const liveText = (): string => {
    switch (mode) {
      case 'loading': {
        const seconds = ((performance.now() - loadStartedAt) / 1000).toFixed(0);
        const size = modelMegabytes === undefined ? '' : ` (${modelMegabytes.toFixed(0)} MB)`;
        return `Loading the speech model${size}... ${seconds} s. Nothing to say yet.`;
      }
      case 'prompt': {
        const left = Math.max(PROMPT_TIMEOUT_MS - (performance.now() - promptStartedAt), 0) / 1000;
        const last = lastNote === '' ? '' : `  Last: ${lastNote}`;
        return `SAY NOW: ${currentPromptText}  (${stepIndex + 1} of ${stepTotal}, ${left.toFixed(0)} s)  ${scoreText()}${last}`;
      }
      case 'pause':
        return `${lastNote}  ${scoreText()}  Wait for the next SAY NOW.`;
      default:
        return plainText;
    }
  };

  const refresh = (): void => {
    ctx.setDetail(liveText());
  };
  const showText = (text: string): void => {
    mode = 'text';
    plainText = text;
    refresh();
  };
  const showMode = (next: DisplayMode): void => {
    mode = next;
    refresh();
  };

  // ---- Abort handling. ----
  let rejectOnAbort: (error: Error) => void = () => undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  abortPromise.catch(() => undefined);
  const onAbort = (): void => rejectOnAbort(new ItemStopped());
  ctx.signal.addEventListener('abort', onAbort, { once: true });
  if (ctx.signal.aborted) onAbort();

  const abortable = <T>(promise: Promise<T>): Promise<T> => Promise.race([promise, abortPromise]);
  const wait = (ms: number): Promise<void> =>
    abortable(new Promise<void>((resolve) => window.setTimeout(resolve, ms)));

  const release = (): void => {
    if (released) return;
    released = true;
    if (liveTimer !== undefined) window.clearInterval(liveTimer);
    liveTimer = undefined;
    stopFrames();
    stopFrames = () => undefined;
    ctx.signal.removeEventListener('abort', onAbort);
    if (captureNode !== undefined) captureNode.port.onmessage = null;
    if (scriptNode !== undefined) scriptNode.onaudioprocess = null;
    try {
      source?.disconnect();
      captureNode?.disconnect();
      scriptNode?.disconnect();
      silencer?.disconnect();
    } catch {
      // Already disconnected.
    }
    source = undefined;
    captureNode = undefined;
    scriptNode = undefined;
    silencer = undefined;
    if (stream !== undefined) {
      for (const track of stream.getTracks()) track.stop();
      stream = undefined;
    }
    if (audioContext !== undefined) {
      const closing = audioContext;
      audioContext = undefined;
      closing.close().catch(() => undefined);
    }
    active?.remove();
    active = undefined;
    try {
      model?.terminate();
    } catch {
      // The worker is already gone.
    }
    model = undefined;
  };

  // ---- The request has to be the first thing done, inside the Start pinch. ----
  ctx.setNeedsUser(true);
  ctx.setHoldOnSessionEnd(true);
  ctx.setDetail('Asking for the microphone. Allow the permission prompt if one appears.');
  let micRequest: Promise<MediaStream>;
  try {
    micRequest = mediaDevices.getUserMedia(CONSTRAINTS);
  } catch (error) {
    ctx.setHoldOnSessionEnd(false);
    ctx.setNeedsUser(false);
    release();
    return {
      item: 'd',
      verdict: 'does_not_work',
      failureReason: `The microphone request threw before it started: ${error instanceof Error ? error.message : String(error)}`,
      measurements,
    };
  }

  try {
    liveTimer = window.setInterval(refresh, LIVE_TEXT_INTERVAL_MS);

    // ---- Step 1: microphone and audio graph. ----
    const requestedAt = performance.now();
    let micTimer: number | undefined;
    const micTimeout = new Promise<never>((_resolve, reject) => {
      micTimer = window.setTimeout(
        () =>
          reject(
            new VoskProbeError(
              `No answer to the microphone prompt within ${PERMISSION_TIMEOUT_MS / 1000} s. The prompt may be hidden behind the AR view.`,
            ),
          ),
        PERMISSION_TIMEOUT_MS,
      );
    });
    micTimeout.catch(() => undefined);
    try {
      stream = await abortable(Promise.race([micRequest, micTimeout]));
    } catch (error) {
      // A stream that arrives after the wait ended must still be released.
      micRequest.then(
        (late) => {
          for (const track of late.getTracks()) track.stop();
        },
        () => undefined,
      );
      if (error instanceof ItemStopped || error instanceof VoskProbeError) throw error;
      measurements.permissionResult = error instanceof Error ? error.name : 'error';
      throw new VoskProbeError(describeMicFailure(error));
    } finally {
      if (micTimer !== undefined) window.clearTimeout(micTimer);
    }
    ctx.setHoldOnSessionEnd(false);
    measurements.permissionResult = 'granted';
    measurements.secondsToMicrophone = fixed((performance.now() - requestedAt) / 1000, 1);

    const track = stream.getAudioTracks()[0];
    if (track === undefined) {
      throw new VoskProbeError('getUserMedia succeeded but returned a stream with no audio track.');
    }
    const settings = track.getSettings();
    measurements.trackSampleRateHz = settings.sampleRate ?? 'not reported';
    measurements.noiseSuppressionApplied = String(settings.noiseSuppression ?? 'not reported');
    measurements.echoCancellationApplied = String(settings.echoCancellation ?? 'not reported');
    track.addEventListener('ended', () => {
      rejectOnAbort(new VoskProbeError('The microphone track ended while recognising (the system or browser took the microphone away).'));
    });

    const AudioContextClass: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass === undefined) {
      throw new VoskProbeError('The Web Audio API (AudioContext) is not available.');
    }
    audioContext = new AudioContextClass();
    const sampleRate = audioContext.sampleRate;
    measurements.audioContextSampleRateHz = sampleRate;
    source = audioContext.createMediaStreamSource(stream);
    // Both capture paths end here. `lagMs` is how late the block arrived, or -1 when unknown.
    const onBlock = (samples: Float32Array, lagMs: number): void => {
      let sumSquares = 0;
      for (let index = 0; index < samples.length; index += 1) sumSquares += samples[index] * samples[index];
      const rms = Math.sqrt(sumSquares / samples.length);
      if (rms > peakRms) peakRms = rms;
      if (lagMs > maxCaptureLagMs) maxCaptureLagMs = lagMs;
      audioBlocks += 1;
      const recognizer = active;
      if (recognizer !== undefined) {
        recognizer.feedFloat(samples, sampleRate);
        audioBlocksFed += 1;
      }
    };
    // The output is silent and goes through a zero gain, so nothing is played and there is no feedback.
    silencer = audioContext.createGain();
    silencer.gain.value = 0;
    silencer.connect(audioContext.destination);
    try {
      const moduleUrl = new URL(`${import.meta.env.BASE_URL}${WORKLET_FILE}`, window.location.href).href;
      await abortable(audioContext.audioWorklet.addModule(moduleUrl));
      const node = new AudioWorkletNode(audioContext, WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: { blockSize: AUDIO_BLOCK_SAMPLES },
      });
      const context = audioContext;
      node.port.onmessage = (event: MessageEvent<{ samples: Float32Array; endFrame: number }>): void => {
        const lateFrames = context.currentTime * sampleRate - event.data.endFrame;
        onBlock(event.data.samples, Math.max((lateFrames / sampleRate) * 1000, 0));
      };
      source.connect(node);
      node.connect(silencer);
      captureNode = node;
      measurements.captureMethod = 'AudioWorklet (audio thread)';
    } catch (error) {
      if (error instanceof ItemStopped) throw error;
      // Fall back to the page-thread node. It can drop audio when a frame runs long.
      const node = audioContext.createScriptProcessor(AUDIO_BLOCK_SAMPLES, 1, 1);
      node.onaudioprocess = (event: AudioProcessingEvent): void => {
        onBlock(event.inputBuffer.getChannelData(0), -1);
      };
      source.connect(node);
      node.connect(silencer);
      scriptNode = node;
      measurements.captureMethod = `ScriptProcessor (page thread), AudioWorklet failed: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`;
    }
    if (audioContext.state !== 'running') await abortable(audioContext.resume().catch(() => undefined));
    measurements.audioContextState = audioContext.state;

    // ---- XR frame statistics: does loading or recognising starve the render loop? ----
    stopFrames = ctx.onFrame((_frame, deltaSeconds) => {
      xrFrames += 1;
      const gapMs = deltaSeconds * 1000;
      if (xrFrames > 1 && gapMs > maxGapMsByPhase[phase]) maxGapMsByPhase[phase] = gapMs;
    });

    // ---- Step 2: the model. ----
    ctx.setNeedsUser(false);
    phase = 0;
    loadStartedAt = performance.now();
    showMode('loading');
    const modelUrl = resolveModelUrl();
    measurements.modelUrl = modelUrl;
    measurements.modelCache = await abortable(readModelCacheState());
    const fileInfo: ModelFileInfo = await abortable(probeModelFile(modelUrl, ctx.signal));
    modelMegabytes = fileInfo.sizeMegabytes;
    measurements.modelFile = `${fileInfo.sizeMegabytes === undefined ? 'size unknown' : `${fileInfo.sizeMegabytes.toFixed(1)} MB`}, ${fileInfo.contentType}, content-encoding ${fileInfo.contentEncoding}`;

    const imported: { vosk: VoskModule; importMs: number } = await abortable(importVosk());
    measurements.libraryImportMs = Math.round(imported.importMs);

    loadStartedAt = performance.now();
    const loaded = await loadModel(imported.vosk, modelUrl, MODEL_LOAD_TIMEOUT_MS, ctx.signal);
    model = loaded.model;
    measurements.loadSeconds = fixed(loaded.loadMs / 1000, 2);
    lastNote = '';

    // ---- Step 3: first recognizer, then accuracy. ----
    showText(`Model loaded in ${(loaded.loadMs / 1000).toFixed(1)} s. Building the recognizer...`);
    const first = await abortable(
      GrammarRecognizer.create(model, sampleRate, GRAMMAR_WORDS, RECOGNIZER_TIMEOUT_MS),
    );
    active = first.recognizer;
    measurements.recognizerCreateMs = Math.round(first.readyMs);
    phase = 1;

    const attempts: Attempt[] = [];
    let emptyInRow = 0;
    let earlyResults = 0;

    const ask = async (step: Step, index: number, total: number): Promise<Attempt> => {
      const recognizer = active;
      if (recognizer === undefined) throw new VoskProbeError('No recognizer is active.');
      stepIndex = index;
      stepTotal = total;
      currentPromptText = `"${step.phrase}"`;
      recognizer.resetPartialFlag();
      promptStartedAt = performance.now();
      ctx.setNeedsUser(true);
      showMode('prompt');

      let heard: string | undefined;
      let resultMs = -1;
      for (;;) {
        const remaining = PROMPT_TIMEOUT_MS - (performance.now() - promptStartedAt);
        if (remaining <= 0) break;
        const text = await abortable(recognizer.nextFinalText(remaining, false));
        if (text === undefined) break;
        if (performance.now() - promptStartedAt < MIN_REACTION_MS) {
          earlyResults += 1;
          continue;
        }
        heard = text;
        resultMs = performance.now() - promptStartedAt;
        break;
      }
      if (heard === undefined) {
        recognizer.flush();
        heard = (await abortable(recognizer.nextFinalText(FLUSH_WAIT_MS, true))) ?? '';
      }
      ctx.setNeedsUser(false);
      return { step, heard: normalizeHeard(heard), outcome: classifyHeard(heard, step.expected), resultMs };
    };

    const describeAttempt = (attempt: Attempt): string => {
      if (attempt.step.expected === undefined) {
        return attempt.outcome === 'wrong'
          ? `heard ${quoted(attempt.heard)} (accepted by mistake)`
          : `heard ${quoted(attempt.heard)} (rejected, as wanted)`;
      }
      switch (attempt.outcome) {
        case 'correct':
          return `heard ${quoted(attempt.heard)} OK`;
        case 'unk':
          return `heard [unk] MISS`;
        case 'empty':
          return 'heard nothing MISS';
        default:
          return `heard ${quoted(attempt.heard)} MISS`;
      }
    };

    const runSteps = async (steps: readonly Step[], tally: boolean): Promise<void> => {
      for (let index = 0; index < steps.length; index += 1) {
        const attempt = await ask(steps[index], index, steps.length);
        attempts.push(attempt);
        const phraseTally = tally ? tallies.get(attempt.step.phrase) : undefined;
        if (phraseTally !== undefined) {
          phraseTally.total += 1;
          if (attempt.outcome === 'correct') phraseTally.correct += 1;
        }
        emptyInRow = attempt.outcome === 'empty' ? emptyInRow + 1 : 0;
        if (emptyInRow >= EARLY_STOP_EMPTY_IN_ROW) {
          throw new VoskProbeError(
            `Vosk returned nothing for ${EARLY_STOP_EMPTY_IN_ROW} prompts in a row. Microphone peak ${dbfs(peakRms)}, ${audioBlocks} audio blocks captured, ${audioBlocksFed} passed to Vosk, recognizer error: ${active?.error ?? 'none'}. Either nothing was said, or the audio never reached the recognizer.`,
          );
        }
        lastNote = describeAttempt(attempt);
        showMode('pause');
        await wait(PAUSE_MS);
      }
    };

    await runSteps(buildGrammarSteps(), true);

    // ---- Step 4: chaining probe with the fragment grammar. ----
    const chainStartIndex = attempts.length;
    const chainRecreateMs: number[] = [];
    const swap = async (grammar: readonly string[], sink: number[]): Promise<void> => {
      const previous = active;
      active = undefined; // Stop feeding before the old recognizer is removed.
      const startedAt = performance.now();
      previous?.remove();
      const created = await abortable(
        GrammarRecognizer.create(model as Model, sampleRate, grammar, RECOGNIZER_TIMEOUT_MS),
      );
      sink.push(performance.now() - startedAt);
      active = created.recognizer;
    };

    lastNote = '';
    showText('Switching to the second grammar...');
    await swap(CHAIN_GRAMMAR, chainRecreateMs);
    await runSteps(buildChainSteps(), false);
    const chainAttempts = attempts.slice(chainStartIndex);

    // ---- Step 5: rebuild timing, no user input. ----
    ctx.setNeedsUser(false);
    showText('Timing grammar rebuilds. Nothing to say.');
    const smallMs: number[] = [...chainRecreateMs];
    const largeMs: number[] = [];
    for (let index = 0; index < SMALL_REBUILDS; index += 1) {
      await swap(index % 2 === 0 ? GRAMMAR_WORDS : CHAIN_GRAMMAR, smallMs);
    }
    for (let index = 0; index < LARGE_REBUILDS; index += 1) {
      await swap(LARGE_GRAMMAR, largeMs);
    }

    // ---- Results. ----
    const grammarAttempts = attempts.slice(0, chainStartIndex);
    const inGrammar = grammarAttempts.filter((attempt) => attempt.step.expected !== undefined);
    const outOfGrammar = grammarAttempts.filter((attempt) => attempt.step.expected === undefined);
    const correctTotal = inGrammar.filter((attempt) => attempt.outcome === 'correct').length;

    for (const phrase of GRAMMAR_PHRASES) {
      const tally = tallies.get(phrase);
      measurements[`accuracy "${phrase}"`] = `${tally?.correct ?? 0}/${tally?.total ?? 0}`;
    }
    const paddedCorrect = inGrammar.filter(
      (attempt) => attempt.outcome === 'correct' && hasUnknown(attempt.heard),
    ).length;
    measurements.correctWithExtraUnk = `${paddedCorrect} of ${correctTotal} correct results also carried a stray [unk] (ignored when judging)`;
    measurements.accuracyOverall = `${correctTotal}/${inGrammar.length} (${percent(correctTotal, inGrammar.length)})`;

    const misheard = inGrammar
      .filter((attempt) => attempt.outcome !== 'correct')
      .map((attempt) => `${attempt.step.phrase} -> ${attempt.outcome === 'unk' ? '[unk]' : quoted(attempt.heard)}`);
    measurements.misheard = listOrNone(misheard.slice(0, MAX_MISHEARD_LISTED));

    const rejected = outOfGrammar.filter((attempt) => attempt.outcome !== 'wrong').length;
    measurements[`outOfGrammar "${OUT_OF_GRAMMAR_PHRASE}"`] =
      `${rejected}/${outOfGrammar.length} rejected as [unk] or nothing; heard ${listOrNone(outOfGrammar.map((attempt) => quoted(attempt.heard)))}`;

    const chainWhole = chainAttempts.filter((attempt) => attempt.outcome === 'correct').length;
    const chains = chainWhole >= CHAIN_PASS_COUNT;
    measurements.chainingResult = chains
      ? `fragments chain (${chainWhole}/${chainAttempts.length} gave "${CHAIN_PHRASE}")`
      : `fragments do NOT chain (${chainWhole}/${chainAttempts.length} gave "${CHAIN_PHRASE}")`;
    measurements.chainingHeard = listOrNone(chainAttempts.map((attempt) => quoted(attempt.heard)));
    measurements.grammarStrategySuggested = chains ? 'fragments' : 'utterances';

    const timedResults = attempts.filter((attempt) => attempt.resultMs >= 0).map((attempt) => attempt.resultMs);
    if (timedResults.length > 0) measurements.promptToResultMedianMs = Math.round(median(timedResults));
    measurements.promptsWithNoResult = `${attempts.filter((attempt) => attempt.outcome === 'empty').length} prompts gave no result`;
    measurements.strayResults = `${active?.strayResults ?? 0} (final results outside a prompt), ${earlyResults} arrived too early and were skipped`;

    const rounded = (list: readonly number[]): string => list.map((value) => Math.round(value)).join(', ');
    measurements.recreateSmallGrammarMs = rounded(smallMs);
    measurements.recreateSmallGrammarMedianMs = Math.round(median(smallMs));
    measurements.recreateSmallGrammarMaxMs = Math.round(Math.max(...smallMs));
    measurements.recreateLargeGrammarMs = `${rounded(largeMs)} (${LARGE_GRAMMAR.length} phrases)`;
    measurements.recreateUnderBudget = Math.max(...smallMs, ...largeMs) < REBUILD_BUDGET_MS
      ? `yes, all under ${REBUILD_BUDGET_MS} ms`
      : `NO, at least one rebuild took ${REBUILD_BUDGET_MS} ms or more`;

    measurements.micPeakLevel = dbfs(peakRms);
    measurements.audioBlocks = `${audioBlocks} captured, ${audioBlocksFed} passed to Vosk`;
    measurements.maxCaptureLagMs = Math.round(maxCaptureLagMs);
    measurements.xrFrames = xrFrames;
    measurements.maxXrFrameGapMsWhileLoading = Math.round(maxGapMsByPhase[0]);
    measurements.maxXrFrameGapMsWhileRecognising = Math.round(maxGapMsByPhase[1]);

    const passed = inGrammar.length > 0 && correctTotal / inGrammar.length >= PASS_FRACTION;
    release();
    if (passed) return { item: 'd', verdict: 'works', measurements };
    const weak = GRAMMAR_PHRASES.filter((phrase) => {
      const tally = tallies.get(phrase);
      return tally === undefined || tally.correct / Math.max(tally.total, 1) < PASS_FRACTION;
    });
    return {
      item: 'd',
      verdict: 'does_not_work',
      failureReason: `Vosk loaded and ran, but only ${correctTotal} of ${inGrammar.length} grammar phrases (${percent(correctTotal, inGrammar.length)}) were recognised, below the ${Math.round(PASS_FRACTION * 100)}% bar. Weak phrases: ${weak.join(', ')}.`,
      measurements,
    };
  } catch (error) {
    ctx.setHoldOnSessionEnd(false);
    ctx.setNeedsUser(false);
    measurements.microphonePeakLevel = dbfs(peakRms);
    measurements.accuracySoFar = scoreText();
    measurements.maxCaptureLagMs = Math.round(maxCaptureLagMs);
    measurements.xrFrames = xrFrames;
    measurements.maxXrFrameGapMsWhileLoading = Math.round(maxGapMsByPhase[0]);
    measurements.maxXrFrameGapMsWhileRecognising = Math.round(maxGapMsByPhase[1]);
    release();
    return {
      item: 'd',
      verdict: 'does_not_work',
      failureReason: error instanceof Error ? error.message : String(error),
      measurements,
    };
  }
}

/** Plain-words reason for a failed `getUserMedia` call. */
function describeMicFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : 'Error';
  const detail =
    error instanceof Error && error.message !== '' ? ` (${error.message.slice(0, 120)})` : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return `Microphone permission was denied (NotAllowedError).${detail} Item (c) shows the same cause.`;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return `No microphone was found (NotFoundError).${detail}`;
    case 'NotReadableError':
    case 'TrackStartError':
      return `The microphone could not be started, it may be in use by another app (NotReadableError).${detail}`;
    default:
      return `Microphone capture did not start (${name}).${detail}`;
  }
}
