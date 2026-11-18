/**
 * Loading screen copy (task 27.1, Requirement 28.1). Pure: no DOM, no three.
 *
 * `describeLoading` turns the load state of the Avatar (the VRM), the Voice_Library index, and the
 * Vosk voice model into the title, detail, and status lines shown by the 2D entry page and by the
 * in-scene loading panel (`ui/loading.ts`). Only the Avatar decides the title: the voice lines and
 * the voice model are reported, never waited on (Requirement 15.21).
 *
 * `isLoadingPanelVisible` says when the in-scene panel is up: in a session, once the head has a pose,
 * until the Avatar has appeared. So the user never looks at an empty room without feedback, and a
 * VRM that failed keeps its message on screen.
 *
 * Tone follows the Persona (playful hacker who "jacks into" the house), kept short and plain.
 */

export type AvatarLoadPhase = 'loading' | 'ready' | 'failed';

export interface AvatarLoadSnapshot {
  readonly phase: AvatarLoadPhase;
  /** Bytes of the VRM received so far. */
  readonly loadedBytes: number;
  /** Size of the VRM, or undefined when the server sent no length. */
  readonly totalBytes: number | undefined;
  /** The Avatar's own words for the failure (`AvatarLoadError.message`), set when `phase` is `failed`. */
  readonly message: string | undefined;
}

/** `missing`: the index loaded empty or not at all, so every line is a text bubble and a chirp. */
export type VoiceLinesPhase = 'loading' | 'ready' | 'missing';

/** Same shape as `audio/voice-model.ts` `VoiceModelState`, restated here so domain stays pure. */
export type VoiceModelSnapshot =
  | { readonly status: 'idle' }
  | { readonly status: 'downloading'; readonly loadedBytes: number; readonly totalBytes: number | undefined }
  | { readonly status: 'loading'; readonly fromCache: boolean }
  | { readonly status: 'ready' }
  | { readonly status: 'failed'; readonly message: string };

export interface LoadingInput {
  readonly avatar: AvatarLoadSnapshot;
  readonly voiceLines: VoiceLinesPhase;
  /** Omit on the entry page, which has its own voice model progress bar. */
  readonly voiceModel?: VoiceModelSnapshot;
  /** `page`: the 2D entry page before AR. `scene`: the in-scene panel. */
  readonly where: 'page' | 'scene';
}

export type LoadingLineState = 'pending' | 'done' | 'failed';

export interface LoadingLine {
  readonly text: string;
  readonly state: LoadingLineState;
}

export interface LoadingView {
  readonly title: string;
  readonly detail: string;
  readonly lines: readonly LoadingLine[];
  /** True when the Avatar failed to load. */
  readonly failed: boolean;
  /** 0 to 1 while the VRM size is known and it is downloading, else undefined. */
  readonly avatarFraction: number | undefined;
  /** A short note under the lines, or undefined. */
  readonly hint: string | undefined;
}

const MEGABYTE = 1024 * 1024;

function megabytes(bytes: number): string {
  return (Math.max(0, bytes) / MEGABYTE).toFixed(1);
}

/** Received fraction, or undefined when the size is unknown or not positive. */
function fractionOf(loaded: number, total: number | undefined): number | undefined {
  if (total === undefined || !(total > 0) || !Number.isFinite(total)) return undefined;
  const f = loaded / total;
  if (!Number.isFinite(f)) return undefined;
  return Math.min(Math.max(f, 0), 1);
}

function avatarLine(avatar: AvatarLoadSnapshot): LoadingLine {
  switch (avatar.phase) {
    case 'ready':
      return { text: 'Avatar: ready', state: 'done' };
    case 'failed':
      return { text: 'Avatar: could not load', state: 'failed' };
    case 'loading': {
      const fraction = fractionOf(avatar.loadedBytes, avatar.totalBytes);
      if (fraction !== undefined && avatar.totalBytes !== undefined) {
        return {
          text: `Avatar: ${megabytes(avatar.loadedBytes)} of ${megabytes(avatar.totalBytes)} MB (${Math.round(fraction * 100)}%)`,
          state: 'pending',
        };
      }
      if (avatar.loadedBytes > 0) return { text: `Avatar: ${megabytes(avatar.loadedBytes)} MB`, state: 'pending' };
      return { text: 'Avatar: starting the download', state: 'pending' };
    }
  }
}

function voiceLinesLine(phase: VoiceLinesPhase): LoadingLine {
  switch (phase) {
    case 'loading':
      return { text: 'Voice lines: loading', state: 'pending' };
    case 'ready':
      return { text: 'Voice lines: ready', state: 'done' };
    case 'missing':
      return { text: 'Voice lines: none, she talks in text bubbles', state: 'failed' };
  }
}

function voiceModelLine(model: VoiceModelSnapshot): LoadingLine {
  switch (model.status) {
    case 'idle':
      return { text: 'Voice commands: waiting to start', state: 'pending' };
    case 'downloading': {
      const known = fractionOf(model.loadedBytes, model.totalBytes) !== undefined && model.totalBytes !== undefined;
      return {
        text: known
          ? `Voice commands: ${megabytes(model.loadedBytes)} of ${megabytes(model.totalBytes ?? 0)} MB`
          : `Voice commands: ${megabytes(model.loadedBytes)} MB`,
        state: 'pending',
      };
    }
    case 'loading':
      return {
        text: model.fromCache ? 'Voice commands: loading' : 'Voice commands: unpacking (first time only)',
        state: 'pending',
      };
    case 'ready':
      return { text: 'Voice commands: ready', state: 'done' };
    case 'failed':
      return { text: 'Voice commands: off, use the quick buttons', state: 'failed' };
  }
}

/** While the voice model is still on its way, the quick buttons are the way to talk to her. */
function voiceHint(model: VoiceModelSnapshot | undefined): string | undefined {
  if (model === undefined || model.status === 'ready' || model.status === 'failed') return undefined;
  return 'The quick buttons work while voice loads.';
}

/** The title, detail, and status lines for the current load state. */
export function describeLoading(input: LoadingInput): LoadingView {
  const { avatar, where } = input;
  const lines: LoadingLine[] = [avatarLine(avatar), voiceLinesLine(input.voiceLines)];
  if (input.voiceModel !== undefined) lines.push(voiceModelLine(input.voiceModel));
  const avatarFraction = avatar.phase === 'loading' ? fractionOf(avatar.loadedBytes, avatar.totalBytes) : undefined;
  const hint = voiceHint(input.voiceModel);
  if (avatar.phase === 'failed') {
    const said = (avatar.message ?? "Something broke while I was loading").replace(/[.\s]+$/u, '');
    return {
      title: 'Capri glitched on the way in',
      detail: `"${said}." Reload the page to try again.`,
      lines,
      failed: true,
      avatarFraction,
      hint,
    };
  }
  if (avatar.phase === 'ready') {
    return {
      title: 'Capri is ready',
      detail: where === 'page' ? 'She will be waiting in your room when you enter AR.' : 'Here she comes.',
      lines,
      failed: false,
      avatarFraction,
      hint,
    };
  }
  return {
    title: 'Capri is jacking in...',
    detail:
      where === 'page'
        ? 'You can enter AR now. She appears as soon as her avatar has loaded.'
        : 'Hang tight. She appears here as soon as her avatar has loaded.',
    lines,
    failed: false,
    avatarFraction,
    hint,
  };
}

export interface LoadingPanelInput {
  readonly inSession: boolean;
  /** True once the headset has reported a head pose, so the panel can be placed in view. */
  readonly headKnown: boolean;
  /** True once the Avatar has been placed in the room. */
  readonly avatarSpawned: boolean;
}

/** In a session with a known head, the panel stays up until the Avatar has appeared. */
export function isLoadingPanelVisible(input: LoadingPanelInput): boolean {
  return input.inSession && input.headKnown && !input.avatarSpawned;
}
