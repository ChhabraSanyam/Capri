/**
 * MicCapture (task 13.21, Requirements 15.1, 15.15 to 15.19). Opens the microphone for one
 * push-to-talk and hands the audio to a sink as `Float32Array` blocks.
 *
 * Rules, all from the Milestone 0 spike (`docs/spike-report.md`, items (c) and (d)):
 * - The first microphone permission prompt inside an AR session ended the session. So this class
 *   calls `getUserMedia` only when permission is already granted: the Permissions API says
 *   `granted`, or, where that API cannot answer, the value the 2D page recorded in `capri.v1.mic`.
 *   In every other state it does not call `getUserMedia` and reports why. Nothing here can show a
 *   prompt, except if the browser forgets a permission between the check and the call.
 * - The microphone is open only while the user talks: `start` acquires the stream, `stop` releases
 *   every track. The `AudioContext` and the worklet stay loaded between talks (suspended while
 *   idle), so the next start does not pay for them again.
 * - Capture uses an `AudioWorklet` (`public/audio/pcm-capture-worklet.js`) that copies blocks on the
 *   audio thread. A `ScriptProcessorNode` on the page thread dropped audio while the page was busy
 *   rendering, so it is only the fallback when the worklet cannot load.
 * - The context runs at its own rate (48 kHz on the Quest), which is what the spike proved. A fixed
 *   rate can be requested with `sampleRate` (the design names 16000), but that was not tried on the
 *   headset.
 * - This `AudioContext` is separate from the playback context owned by the audio engine. Its output
 *   goes through a zero gain, so nothing is played.
 *
 * `start` and `stop` never throw. `start` resolves with a typed result that names the failure.
 */
import { assetUrl } from '../config/asset-url.js';
import { MIC_STORAGE_KEY } from '../config/constants.js';
import { parseMicState } from '../ui/setup-page/mic-step.js';

export type MicFailureReason =
  | 'permission-not-granted'
  | 'permission-denied'
  | 'mic-unsupported'
  | 'mic-unavailable'
  | 'audio-blocked'
  | 'stopped';

export type CaptureMethod = 'audio-worklet' | 'script-processor';

export type MicStartResult =
  | { readonly ok: true; readonly sampleRate: number; readonly method: CaptureMethod }
  | { readonly ok: false; readonly reason: MicFailureReason; readonly message: string };

/** Receives each block. The array is only valid during the call on the fallback path. */
export type PcmSink = (samples: Float32Array, sampleRate: number) => void;

/** Outcome of the permission check. `source` says which signal decided. */
export interface MicPermissionCheck {
  readonly permission: 'granted' | 'denied' | 'not-granted';
  readonly source: 'permissions-api' | 'recorded';
}

/** Constraints that match the spike (echo cancellation limits Capri's own voice being heard). */
export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
};

/** Samples per block posted by the worklet (about 85 ms at 48 kHz). */
export const CAPTURE_BLOCK_SAMPLES = 4096;
export const CAPTURE_WORKLET_NAME = 'capri-pcm-capture';
export const CAPTURE_WORKLET_PATH = 'audio/pcm-capture-worklet.js';

/** Longest wait for a suspended capture context to start running. */
const RESUME_TIMEOUT_MS = 2000;

export interface PermissionsLike {
  query(descriptor: { name: string }): Promise<{ readonly state: string }>;
}

export interface MicCaptureDeps {
  readonly mediaDevices?: Pick<MediaDevices, 'getUserMedia'> | undefined;
  readonly permissions?: PermissionsLike | undefined;
  readonly storage?: Pick<Storage, 'getItem'> | undefined;
  readonly createAudioContext?: (sampleRate: number | undefined) => AudioContext;
  readonly workletUrl?: string;
  /** Fixed capture rate. Leave unset to use the context's own rate (the proven path). */
  readonly sampleRate?: number;
  /** Called at the start of every `start`, before the microphone opens: stops Capri's speech. */
  readonly bargeIn?: () => void;
}

function defaultPermissions(): PermissionsLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return navigator.permissions as unknown as PermissionsLike | undefined;
}

function defaultStorage(): Pick<Storage, 'getItem'> | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * Decide whether the microphone may be opened without a prompt. The Permissions API answers when it
 * can. `prompt` means opening it would show a prompt, so it counts as not granted. When the API is
 * missing, or rejects the `microphone` name, the value recorded on the 2D page decides.
 */
export async function checkMicPermission(
  sources: { readonly permissions?: PermissionsLike | undefined; readonly storage?: Pick<Storage, 'getItem'> | undefined } = {},
): Promise<MicPermissionCheck> {
  // An explicit `undefined` means "this source is missing" (tests); an absent key means "use the browser's".
  const permissions = 'permissions' in sources ? sources.permissions : defaultPermissions();
  const storage = 'storage' in sources ? sources.storage : defaultStorage();
  if (permissions !== undefined && typeof permissions.query === 'function') {
    try {
      const status = await permissions.query({ name: 'microphone' });
      if (status.state === 'granted') return { permission: 'granted', source: 'permissions-api' };
      if (status.state === 'denied') return { permission: 'denied', source: 'permissions-api' };
      return { permission: 'not-granted', source: 'permissions-api' };
    } catch {
      // Not every browser knows the "microphone" permission name. Use the recorded value.
    }
  }
  let recorded: string | null | undefined;
  try {
    recorded = storage?.getItem(MIC_STORAGE_KEY);
  } catch {
    recorded = undefined;
  }
  const state = parseMicState(recorded);
  return {
    permission: state === 'granted' ? 'granted' : state === 'denied' ? 'denied' : 'not-granted',
    source: 'recorded',
  };
}

/** Map a `getUserMedia` rejection to a failure reason. */
export function micFailureFromError(error: unknown): { reason: MicFailureReason; message: string } {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { reason: 'permission-denied', message: 'The browser blocked the microphone.' };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { reason: 'mic-unsupported', message: 'No microphone was found on this device.' };
    default:
      return { reason: 'mic-unavailable', message: 'The microphone is busy or could not start.' };
  }
}

type Phase = 'idle' | 'starting' | 'capturing';

export class MicCapture {
  private readonly deps: MicCaptureDeps;
  private phase: Phase = 'idle';
  /** Bumped by every `stop`, so a `start` that is still waiting can tell it was cancelled. */
  private generation = 0;
  private context: AudioContext | undefined;
  private preparing: Promise<number | undefined> | undefined;
  private workletNode: AudioWorkletNode | undefined;
  private scriptNode: ScriptProcessorNode | undefined;
  private silencer: GainNode | undefined;
  private source: MediaStreamAudioSourceNode | undefined;
  private stream: MediaStream | undefined;
  private sink: PcmSink | undefined;
  private method: CaptureMethod | undefined;
  private readonly endedListeners = new Set<() => void>();

  constructor(deps: MicCaptureDeps = {}) {
    this.deps = deps;
  }

  /** True between a successful `start` and the next `stop`. */
  get isCapturing(): boolean {
    return this.phase === 'capturing';
  }

  /** Rate of the capture context, once `prepare` has created it. */
  get sampleRate(): number | undefined {
    return this.context?.sampleRate;
  }

  /** Called when the microphone track ends while capturing (the system took the microphone away). */
  onEnded(listener: () => void): () => void {
    this.endedListeners.add(listener);
    return () => {
      this.endedListeners.delete(listener);
    };
  }

  /** Same check `start` makes. Exposed so the app can pick the fallback UI without starting. */
  checkPermission(): Promise<MicPermissionCheck> {
    return checkMicPermission(this.deps);
  }

  /**
   * Create the capture context and load the worklet. Needs no permission and does not open the
   * microphone, so it is safe on the 2D page. Resolves with the sample rate, or `undefined` when
   * the Web Audio API is missing. Idempotent.
   */
  prepare(): Promise<number | undefined> {
    if (this.preparing === undefined) {
      this.preparing = this.createGraph().catch(() => undefined);
    }
    return this.preparing;
  }

  /**
   * Open the microphone and send audio blocks to `sink`. Only runs when permission was already
   * granted. Never throws.
   */
  async start(sink: PcmSink): Promise<MicStartResult> {
    this.deps.bargeIn?.();
    if (this.phase === 'capturing') {
      this.sink = sink;
      return this.currentResult();
    }
    if (this.phase === 'starting') return failure('mic-unavailable', 'The microphone is already starting.');
    this.phase = 'starting';
    const generation = ++this.generation;
    const cancelled = (): boolean => generation !== this.generation;
    const abandon = (): MicStartResult => failure('stopped', 'Listening was stopped before the microphone opened.');

    try {
      const check = await this.checkPermission();
      if (cancelled()) return abandon();
      if (check.permission !== 'granted') {
        this.phase = 'idle';
        return failure(
          check.permission === 'denied' ? 'permission-denied' : 'permission-not-granted',
          check.permission === 'denied'
            ? 'The microphone is blocked. Allow it in the browser site settings on the entry page.'
            : 'The microphone was not allowed on the entry page, so it is not opened inside AR.',
        );
      }

      const mediaDevices =
        'mediaDevices' in this.deps
          ? this.deps.mediaDevices
          : typeof navigator === 'undefined'
            ? undefined
            : navigator.mediaDevices;
      if (mediaDevices === undefined || typeof mediaDevices.getUserMedia !== 'function') {
        this.phase = 'idle';
        return failure('mic-unsupported', 'This browser has no microphone access.');
      }

      const rate = await this.prepare();
      if (cancelled()) return abandon();
      if (rate === undefined || this.context === undefined) {
        this.phase = 'idle';
        return failure('mic-unsupported', 'The Web Audio API is not available.');
      }

      let stream: MediaStream;
      try {
        stream = await mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      } catch (error) {
        this.phase = 'idle';
        const mapped = micFailureFromError(error);
        return failure(mapped.reason, mapped.message);
      }
      if (cancelled()) {
        stopTracks(stream);
        return abandon();
      }

      const context = this.context;
      if (!(await resumeContext(context))) {
        stopTracks(stream);
        this.phase = 'idle';
        return failure('audio-blocked', 'The browser did not start the audio capture context.');
      }
      if (cancelled()) {
        stopTracks(stream);
        return abandon();
      }

      this.stream = stream;
      this.sink = sink;
      const track = stream.getAudioTracks()[0];
      track?.addEventListener('ended', () => {
        if (this.stream !== stream) return;
        this.release();
        for (const listener of [...this.endedListeners]) listener();
      });
      this.source = context.createMediaStreamSource(stream);
      const entry: AudioNode | undefined = this.workletNode ?? this.scriptNode;
      if (entry === undefined) {
        this.release();
        return failure('mic-unsupported', 'No audio capture node could be created.');
      }
      this.source.connect(entry);
      this.phase = 'capturing';
      return this.currentResult();
    } catch (error) {
      this.release();
      return failure('mic-unavailable', error instanceof Error ? error.message : String(error));
    }
  }

  /** Release the microphone. Safe to call at any time, including while a start is waiting. */
  stop(): void {
    this.generation += 1;
    this.release();
  }

  /** Release everything, including the capture context. The object is unusable afterwards. */
  dispose(): void {
    this.stop();
    this.endedListeners.clear();
    try {
      this.workletNode?.disconnect();
      this.scriptNode?.disconnect();
      this.silencer?.disconnect();
    } catch {
      // Already disconnected.
    }
    if (this.workletNode !== undefined) this.workletNode.port.onmessage = null;
    if (this.scriptNode !== undefined) this.scriptNode.onaudioprocess = null;
    this.workletNode = undefined;
    this.scriptNode = undefined;
    this.silencer = undefined;
    const closing = this.context;
    this.context = undefined;
    this.preparing = undefined;
    closing?.close().catch(() => undefined);
  }

  private currentResult(): MicStartResult {
    const sampleRate = this.context?.sampleRate;
    if (sampleRate === undefined || this.method === undefined) {
      return failure('mic-unavailable', 'The capture context is gone.');
    }
    return { ok: true, sampleRate, method: this.method };
  }

  private release(): void {
    this.phase = 'idle';
    this.sink = undefined;
    try {
      this.source?.disconnect();
    } catch {
      // Already disconnected.
    }
    this.source = undefined;
    if (this.stream !== undefined) {
      stopTracks(this.stream);
      this.stream = undefined;
    }
    // Idle context: the audio thread stops calling the worklet.
    this.context?.suspend().catch(() => undefined);
  }

  private async createGraph(): Promise<number | undefined> {
    const create =
      this.deps.createAudioContext ??
      ((rate: number | undefined): AudioContext | undefined => {
        const Ctor: typeof AudioContext | undefined =
          typeof window === 'undefined'
            ? undefined
            : (window.AudioContext ??
              (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
        if (Ctor === undefined) return undefined;
        return rate === undefined ? new Ctor() : new Ctor({ sampleRate: rate });
      });
    const context = create(this.deps.sampleRate);
    if (context === undefined) return undefined;
    this.context = context;
    const rate = context.sampleRate;
    const deliver = (samples: Float32Array): void => this.sink?.(samples, rate);

    // The output is silent (zero gain), so nothing is played and there is no feedback.
    const silencer = context.createGain();
    silencer.gain.value = 0;
    silencer.connect(context.destination);
    this.silencer = silencer;

    try {
      const url = this.deps.workletUrl ?? new URL(assetUrl(CAPTURE_WORKLET_PATH), window.location.href).href;
      await context.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(context, CAPTURE_WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: { blockSize: CAPTURE_BLOCK_SAMPLES },
      });
      node.port.onmessage = (event: MessageEvent<{ samples: Float32Array }>): void => deliver(event.data.samples);
      node.connect(silencer);
      this.workletNode = node;
      this.method = 'audio-worklet';
    } catch {
      // The page-thread node can drop audio when a frame runs long, so it is only the fallback.
      const node = context.createScriptProcessor(CAPTURE_BLOCK_SAMPLES, 1, 1);
      node.onaudioprocess = (event: AudioProcessingEvent): void => deliver(event.inputBuffer.getChannelData(0));
      node.connect(silencer);
      this.scriptNode = node;
      this.method = 'script-processor';
    }
    // Idle until the first push-to-talk.
    await context.suspend().catch(() => undefined);
    return rate;
  }
}

function failure(reason: MicFailureReason, message: string): MicStartResult {
  return { ok: false, reason, message };
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** Resume a suspended context. True when it is running within the timeout. */
async function resumeContext(context: AudioContext): Promise<boolean> {
  if (context.state === 'running') return true;
  await Promise.race([
    context.resume().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS)),
  ]);
  // The state changes while awaiting, so widen it again after the early return above.
  return (context.state as AudioContextState) === 'running';
}
