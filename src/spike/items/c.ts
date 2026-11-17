/**
 * Spike item (c): microphone capture during an immersive session (Requirements 4.1 to 4.4).
 *
 * Flow:
 * 1. On the Start pinch, call `getUserMedia({ audio: { echoCancellation, noiseSuppression,
 *    channelCount: 1 } })`. The call is the first thing `run` does, with no `await` before it, so
 *    it still runs inside the user's pinch (a transient activation) as the browser may require.
 * 2. While the permission prompt is open the item asks the runner to survive the AR session ending.
 *    If the headset browser drops the immersive session for its prompt, the item stays open, a
 *    note is saved, and pressing Start after entering AR again runs the item with the permission
 *    already decided. The note is added to the measurements so the report shows what happened.
 * 3. After the stream arrives, an `AnalyserNode` (not connected to the speakers, so no feedback)
 *    feeds a level bar in the live text. The level is read once per XR frame, so the probe also
 *    proves that XR frames keep arriving while the microphone is open.
 * 4. The user says "turn that off". The item works once speech-level sound has been heard for
 *    `VOICED_SECONDS_NEEDED` seconds in total. It fails when permission is denied, capture does not
 *    start, the track ends, or `LISTEN_TIMEOUT_SECONDS` pass without speech-level sound.
 * 5. The microphone is released when the item ends (tracks stopped, audio context closed), so
 *    items that follow in the same AR session can open it themselves.
 *
 * Allocation: the analyser buffer is created once. The live text string is rebuilt about ten times
 * per second, not per frame.
 */
import type { SpikeContext, SpikeResult } from '../types.js';

/** The phrase the user is asked to say. Also the first phrase item (d) will use. */
const PROMPT_PHRASE = 'turn that off';

/** Time the user has to answer the permission prompt. */
const PERMISSION_TIMEOUT_MS = 60000;
/** Time after capture starts in which speech-level sound must be heard. */
const LISTEN_TIMEOUT_SECONDS = 30;
/** Total time with the level at or above `SPEECH_RMS` that counts as the user speaking. */
const VOICED_SECONDS_NEEDED = 0.5;
/** About -34 dBFS. Normal speech near a headset microphone is well above this. */
const SPEECH_RMS = 0.02;
/** Skip the first moments of capture when estimating the quietest level (start-up transient). */
const WARMUP_SECONDS = 0.3;
const MAX_FRAME_DELTA_SECONDS = 0.5;
const LIVE_TEXT_INTERVAL_SECONDS = 0.1;
const ANALYSER_FFT_SIZE = 1024;
const BAR_WIDTH = 24;
/** The bar spans this range in dBFS: empty at the bottom, full at the top. */
const BAR_FLOOR_DB = -60;
const BAR_CEIL_DB = -10;
const MIN_DB = -120;

const INTERIM_KEY = 'capri.spike.c.interim';
/** A note from a previous attempt older than this is ignored. */
const INTERIM_MAX_AGE_MS = 30 * 60 * 1000;

const CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
};

type Measurements = Record<string, number | string>;

/** Forget the note from an earlier attempt. Also called by the page's Clear results button. */
export function clearItemCState(storage: Storage): void {
  try {
    storage.removeItem(INTERIM_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Read and remove the note that an earlier attempt lost its AR session on the prompt. */
function takePriorAttemptNote(): string | undefined {
  try {
    const raw = window.localStorage.getItem(INTERIM_KEY);
    window.localStorage.removeItem(INTERIM_KEY);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const savedAt = (parsed as { savedAt?: unknown }).savedAt;
    if (typeof savedAt !== 'number' || Date.now() - savedAt > INTERIM_MAX_AGE_MS) return undefined;
    return 'An earlier attempt lost the AR session while the microphone permission prompt was open.';
  } catch {
    return undefined;
  }
}

function writePriorAttemptNote(): void {
  try {
    window.localStorage.setItem(INTERIM_KEY, JSON.stringify({ savedAt: Date.now() }));
  } catch {
    // Storage blocked: the next run just will not mention the earlier attempt.
  }
}

/** Plain-words reason for a failed `getUserMedia` call. */
export function describeMicError(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : 'Error';
  const detail =
    error instanceof Error && error.message !== '' ? ` (${error.message.slice(0, 120)})` : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return `Microphone permission was denied (NotAllowedError). The user pressed Block, the site setting is Block, the browser blocked it inside the immersive session, or the page was not allowed to ask.${detail}`;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return `No microphone was found (NotFoundError).${detail}`;
    case 'NotReadableError':
    case 'TrackStartError':
      return `The microphone could not be started, it may be in use by another app or blocked by the system (NotReadableError).${detail}`;
    case 'OverconstrainedError':
      return `The microphone cannot meet the requested settings (OverconstrainedError).${detail}`;
    case 'SecurityError':
      return `The browser refused microphone access for security reasons, for example a page that is not HTTPS (SecurityError).${detail}`;
    case 'AbortError':
      return `Microphone capture was aborted by the browser or the system (AbortError).${detail}`;
    case 'NotSupportedError':
      return `The browser cannot capture audio in this context (NotSupportedError), for example when it cannot show a permission prompt.${detail}`;
    case 'TypeError':
      return `The microphone request was malformed or not available here (TypeError).${detail}`;
    default:
      return `Microphone capture did not start (${name}).${detail}`;
  }
}

function levelToDb(rms: number): number {
  return rms > 1e-6 ? Math.max(20 * Math.log10(rms), MIN_DB) : MIN_DB;
}

function levelBar(rms: number): string {
  const fraction = (levelToDb(rms) - BAR_FLOOR_DB) / (BAR_CEIL_DB - BAR_FLOOR_DB);
  const filled = Math.round(Math.min(Math.max(fraction, 0), 1) * BAR_WIDTH);
  return `[${'#'.repeat(filled)}${'-'.repeat(BAR_WIDTH - filled)}]`;
}

function dbText(rms: number): string {
  return `${levelToDb(rms).toFixed(0)} dBFS`;
}

async function readPermissionState(): Promise<string> {
  try {
    const permissions = navigator.permissions;
    if (permissions === undefined) return 'unknown (Permissions API missing)';
    const status = await permissions.query({ name: 'microphone' as PermissionName });
    return status.state;
  } catch {
    return 'unknown (query failed)';
  }
}

export function runItemC(ctx: SpikeContext): Promise<SpikeResult> {
  const world = ctx.world;
  const session = world.xrSession;
  if (session === undefined) {
    return Promise.resolve({
      item: 'c',
      verdict: 'does_not_work',
      failureReason: 'No WebXR session is active. Press Enter AR on the page first.',
    });
  }

  const measurements: Measurements = {
    secureContext: window.isSecureContext ? 'yes' : 'no',
    sessionVisibilityAtStart: session.visibilityState ?? 'unknown',
    requestedConstraints: 'echoCancellation=true noiseSuppression=true channelCount=1',
  };
  const priorNote = takePriorAttemptNote();
  if (priorNote !== undefined) measurements.priorAttempt = priorNote;

  const mediaDevices: MediaDevices | undefined = navigator.mediaDevices;
  if (mediaDevices === undefined || typeof mediaDevices.getUserMedia !== 'function') {
    return Promise.resolve({
      item: 'c',
      verdict: 'does_not_work',
      failureReason: window.isSecureContext
        ? 'navigator.mediaDevices.getUserMedia is not available in this browser.'
        : 'navigator.mediaDevices is missing because the page is not a secure (HTTPS) context.',
      measurements,
    });
  }

  // ---- Allocated once, before the first frame. ----
  const samples = new Float32Array(ANALYSER_FFT_SIZE);

  let stream: MediaStream | undefined;
  let audioContext: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  let stopFrames: () => void = () => undefined;
  let permissionTimer: number | undefined;
  let finished = false;
  let captureStarted = false;
  let trackEnded = false;

  // Frame statistics. `elapsed` counts seconds since capture started.
  let elapsed = 0;
  let xrFrames = 0;
  let maxFrameGapMs = 0;
  let voicedSeconds = 0;
  let secondsToFirstVoice = -1;
  let peakRms = 0;
  let quietestRms = Number.POSITIVE_INFINITY;
  let liveClock = LIVE_TEXT_INTERVAL_SECONDS;

  const release = (): void => {
    if (permissionTimer !== undefined) window.clearTimeout(permissionTimer);
    permissionTimer = undefined;
    stopFrames();
    stopFrames = () => undefined;
    source?.disconnect();
    analyser?.disconnect();
    source = undefined;
    analyser = undefined;
    if (stream !== undefined) {
      for (const track of stream.getTracks()) track.stop();
      stream = undefined;
    }
    if (audioContext !== undefined) {
      const closing = audioContext;
      audioContext = undefined;
      closing.close().catch(() => undefined);
    }
  };

  return new Promise<SpikeResult>((resolve) => {
    const finish = (result: SpikeResult): void => {
      if (finished) return;
      finished = true;
      ctx.setHoldOnSessionEnd(false);
      ctx.setNeedsUser(false);
      measurements.sessionVisibilityAtEnd = world.xrSession?.visibilityState ?? 'session gone';
      measurements.sessionObjectUnchanged = world.xrSession === session ? 'yes' : 'no';
      if (captureStarted) {
        measurements.xrFramesDuringCapture = xrFrames;
        measurements.maxXrFrameGapMs = Number(maxFrameGapMs.toFixed(0));
        measurements.peakLevel = `${dbText(peakRms)} (rms ${peakRms.toFixed(4)})`;
        if (Number.isFinite(quietestRms)) {
          measurements.quietestLevel = `${dbText(quietestRms)} (rms ${quietestRms.toFixed(4)})`;
        }
        measurements.voicedSeconds = Number(voicedSeconds.toFixed(2));
        measurements.secondsToFirstVoice = secondsToFirstVoice >= 0 ? Number(secondsToFirstVoice.toFixed(1)) : 'none';
        measurements.captureSeconds = Number(elapsed.toFixed(1));
        measurements.trackEnded = trackEnded ? 'yes' : 'no';
      }
      release();
      resolve({ ...result, measurements });
    };

    const fail = (reason: string): void => {
      finish({ item: 'c', verdict: 'does_not_work', failureReason: reason });
    };

    ctx.signal.addEventListener(
      'abort',
      () => {
        if (ctx.signal.reason === 'session-ended' && !captureStarted && !finished) {
          // The AR session ended while the permission prompt was open. The runner keeps the item
          // open and ignores this result. Leave a note so the next run can report it.
          writePriorAttemptNote();
        }
        fail('The item was stopped or the AR session ended before it finished.');
      },
      { once: true },
    );

    // ---- Step 1: the request, issued synchronously inside the Start pinch. ----
    ctx.setNeedsUser(true);
    ctx.setHoldOnSessionEnd(true);
    ctx.setDetail('Asking for the microphone. Allow the permission prompt if one appears.');
    const requestedAt = performance.now();
    let request: Promise<MediaStream>;
    try {
      request = mediaDevices.getUserMedia(CONSTRAINTS);
    } catch (error) {
      measurements.permissionResult = 'error';
      fail(describeMicError(error));
      return;
    }

    void readPermissionState().then((state) => {
      // Reads the state at about the time of the request. A 'prompt' value means the prompt was
      // shown, 'granted' means an earlier answer was reused, and 'denied' means a stored Block.
      measurements.permissionStateAtRequest = state;
    });

    permissionTimer = window.setTimeout(() => {
      measurements.permissionResult = 'no answer';
      fail(
        `No answer to the microphone prompt within ${PERMISSION_TIMEOUT_MS / 1000} s. The prompt may be hidden behind the AR view or never have appeared.`,
      );
    }, PERMISSION_TIMEOUT_MS);

    request.then(
      (granted) => {
        if (finished) {
          // The item ended while the prompt was open. Release the late stream at once.
          for (const track of granted.getTracks()) track.stop();
          return;
        }
        if (permissionTimer !== undefined) window.clearTimeout(permissionTimer);
        permissionTimer = undefined;
        stream = granted;
        measurements.permissionResult = 'granted';
        measurements.secondsToPermission = Number(((performance.now() - requestedAt) / 1000).toFixed(1));
        // From here, losing the AR session is a real failure of the item.
        ctx.setHoldOnSessionEnd(false);
        beginCapture(granted);
      },
      (error: unknown) => {
        if (finished) return;
        measurements.permissionResult =
          error instanceof Error && error.name === 'NotAllowedError' ? 'denied' : 'error';
        measurements.errorName = error instanceof Error ? error.name : 'unknown';
        fail(describeMicError(error));
      },
    );

    // ---- Steps 2 to 4: measure the stream and the level. ----
    const beginCapture = (granted: MediaStream): void => {
      const track = granted.getAudioTracks()[0];
      if (track === undefined) {
        fail('getUserMedia succeeded but returned a stream with no audio track.');
        return;
      }
      const settings = track.getSettings();
      measurements.trackLabel = track.label === '' ? 'none' : track.label;
      measurements.trackSampleRateHz = settings.sampleRate ?? 'not reported';
      measurements.trackChannelCount = settings.channelCount ?? 'not reported';
      measurements.echoCancellationApplied = String(settings.echoCancellation ?? 'not reported');
      measurements.noiseSuppressionApplied = String(settings.noiseSuppression ?? 'not reported');
      measurements.autoGainControlApplied = String(settings.autoGainControl ?? 'not reported');
      measurements.trackReadyState = track.readyState;
      track.addEventListener('ended', () => {
        trackEnded = true;
        if (!finished) fail('The microphone track ended while capturing (the system or browser took the microphone away).');
      });

      try {
        const AudioContextClass: typeof AudioContext | undefined =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass === undefined) {
          fail('The Web Audio API (AudioContext) is not available, so the level cannot be measured.');
          return;
        }
        audioContext = new AudioContextClass();
        measurements.audioContextSampleRateHz = audioContext.sampleRate;
        analyser = audioContext.createAnalyser();
        analyser.fftSize = ANALYSER_FFT_SIZE;
        analyser.smoothingTimeConstant = 0;
        source = audioContext.createMediaStreamSource(granted);
        // Deliberately not connected to `audioContext.destination`: no playback, no feedback.
        source.connect(analyser);
      } catch (error) {
        fail(`The audio graph could not be built: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }

      const context = audioContext;
      const finishOk = (): void => {
        finish({ item: 'c', verdict: 'works' });
      };
      const resumed = context.state === 'running' ? Promise.resolve() : context.resume();
      resumed.catch(() => undefined).finally(() => {
        measurements.audioContextState = context.state;
      });

      captureStarted = true;
      ctx.setDetail(`Microphone is on. Say: "${PROMPT_PHRASE}"`);

      stopFrames = ctx.onFrame((_frame, deltaSeconds) => {
        if (finished || analyser === undefined) return;
        const delta = Math.min(Math.max(deltaSeconds, 0), MAX_FRAME_DELTA_SECONDS);
        elapsed += delta;
        xrFrames += 1;
        const gapMs = deltaSeconds * 1000;
        if (xrFrames > 1 && gapMs > maxFrameGapMs) maxFrameGapMs = gapMs;

        analyser.getFloatTimeDomainData(samples);
        let sumSquares = 0;
        for (let index = 0; index < samples.length; index += 1) {
          sumSquares += samples[index] * samples[index];
        }
        const rms = Math.sqrt(sumSquares / samples.length);
        if (rms > peakRms) peakRms = rms;
        if (elapsed > WARMUP_SECONDS && rms < quietestRms) quietestRms = rms;
        if (rms >= SPEECH_RMS) {
          voicedSeconds += delta;
          if (secondsToFirstVoice < 0) secondsToFirstVoice = elapsed;
        }

        if (voicedSeconds >= VOICED_SECONDS_NEEDED) {
          finishOk();
          return;
        }
        if (elapsed >= LISTEN_TIMEOUT_SECONDS) {
          fail(
            `The microphone opened (track ${track.readyState}, audio context ${context.state}) but no speech-level sound was heard in ${LISTEN_TIMEOUT_SECONDS} s. Peak ${dbText(peakRms)}. Either nothing was said or the microphone gives silence.`,
          );
          return;
        }

        liveClock += delta;
        if (liveClock < LIVE_TEXT_INTERVAL_SECONDS) return;
        liveClock = 0;
        const left = Math.max(LISTEN_TIMEOUT_SECONDS - elapsed, 0).toFixed(0);
        ctx.setDetail(
          `SAY: "${PROMPT_PHRASE}"  ${levelBar(rms)} ${dbText(rms)}. Peak ${dbText(peakRms)}. Mic ${track.readyState}, ctx ${context.state}, rate ${context.sampleRate} Hz. ${left} s left.`,
        );
      });
    };
  });
}
