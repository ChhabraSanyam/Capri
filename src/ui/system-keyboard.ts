/**
 * System_Keyboard (task 33.9, Requirements 33.52 to 33.54, assumption A22): text entry with the Meta
 * Quest system keyboard during the immersive session. It replaces the custom Hand_Keyboard.
 *
 * How Quest Browser shows it (Meta, "System Keyboard in WebXR",
 * https://developers.meta.com/horizon/documentation/web/webxr-keyboard/, and the WebXR Device API
 * `XRSession.isSystemKeyboardSupported`):
 * - `session.isSystemKeyboardSupported` says whether the keyboard can show during the session.
 * - Calling `focus()` on a text `<input>` that is in the DOM shows it. The session turns
 *   `visible-blurred` while it shows (the app pauses, `ui/pause.ts`) and `visible` again after.
 * - Every showing is a new editing session, and the only input is the field's `value`: there are no
 *   key events to read. The Done key, the hide button, the Meta button, or a click outside dismiss
 *   it, and each one blurs the field.
 * - A field outside the viewport makes the page scroll to it, so the field sits fixed in the top-left
 *   corner of the viewport, 1 px and transparent. It is removed when the session ends.
 *
 * So the text is read on `blur` (and on Enter, for a hardware or desktop keyboard). Non-empty text is
 * submitted; an empty field is a cancel. Meta's sample shows the keyboard from the session `select`
 * event (a user activation). A press on the HUD_Menu comes from hand joints, not from a DOM event, so
 * if the first `focus()` does not show the keyboard, the next `select` (a pinch) focuses the field again.
 *
 * The typed text is never logged. Without a session the keyboard is unsupported, except through the
 * dev-only support override (`window.__capriKeyboard`, IWER cannot show the system keyboard).
 */
import type { Logger } from '../app/logger.js';
import { SYSTEM_KEYBOARD } from '../config/constants.js';

export type KeyboardCancelReason = 'empty' | 'replaced' | 'session-ended' | 'unsupported' | 'disposed';

export type KeyboardResult =
  | { readonly kind: 'submitted'; readonly text: string }
  | { readonly kind: 'cancelled'; readonly reason: KeyboardCancelReason };

/** The session fields the keyboard reads. `XRSession` satisfies it. */
export interface KeyboardSession {
  readonly isSystemKeyboardSupported?: boolean;
  readonly visibilityState: string;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** The part of the system keyboard the text-entry wiring uses. */
export interface SystemKeyboardPort {
  readonly supported: boolean;
  readonly isOpen: boolean;
  open(prompt: string): Promise<KeyboardResult>;
  cancel(): void;
}

export interface SystemKeyboardDeps {
  readonly document: Document;
  readonly getSession: () => KeyboardSession | undefined;
  readonly logger: Logger;
  /** Longest text kept. Defaults to `SYSTEM_KEYBOARD.maxChars`. */
  readonly maxChars?: number;
}

interface OpenPrompt {
  readonly resolve: (result: KeyboardResult) => void;
  readonly session: KeyboardSession | undefined;
  shown: boolean;
}

export class SystemKeyboard implements SystemKeyboardPort {
  private input: HTMLInputElement | undefined;
  private current: OpenPrompt | undefined;
  private override: boolean | undefined;
  private ignoreBlur = false;
  private disposed = false;
  private readonly maxChars: number;

  constructor(private readonly deps: SystemKeyboardDeps) {
    this.maxChars = deps.maxChars ?? SYSTEM_KEYBOARD.maxChars;
  }

  /** True when the system keyboard can show now (A22), or the dev override says so. */
  get supported(): boolean {
    if (this.override !== undefined) return this.override;
    return this.deps.getSession()?.isSystemKeyboardSupported === true;
  }

  get isOpen(): boolean {
    return this.current !== undefined;
  }

  /** True once the session turned `visible-blurred` for the open prompt (the keyboard showed). */
  get isShown(): boolean {
    return this.current?.shown ?? false;
  }

  /**
   * Show the keyboard with `prompt` as the field's placeholder and label. Resolves with the text when
   * the user submits it, or a cancel. A prompt that is still open is cancelled (`replaced`).
   */
  open(prompt: string): Promise<KeyboardResult> {
    if (this.disposed) return Promise.resolve({ kind: 'cancelled', reason: 'disposed' });
    this.finish({ kind: 'cancelled', reason: 'replaced' });
    if (!this.supported) return Promise.resolve({ kind: 'cancelled', reason: 'unsupported' });
    const input = this.ensureInput();
    const session = this.deps.getSession();
    return new Promise<KeyboardResult>((resolve) => {
      this.current = { resolve, session, shown: false };
      session?.addEventListener('select', this.onSelect);
      session?.addEventListener('visibilitychange', this.onVisibility);
      session?.addEventListener('end', this.onSessionEnd);
      input.value = '';
      input.placeholder = prompt;
      input.setAttribute('aria-label', prompt);
      this.focus(input);
      this.deps.logger.info('keyboard: opened');
    });
  }

  /** Close without text. */
  cancel(): void {
    this.finish({ kind: 'cancelled', reason: 'empty' });
  }

  /**
   * Dev and test seam: the user typed `text` and pressed Done. Returns false when no prompt is open.
   * The production bundle never calls it (the window seam is behind `import.meta.env.DEV`).
   */
  submit(text: string): boolean {
    const input = this.input;
    if (this.current === undefined || input === undefined) return false;
    input.value = text;
    this.read();
    return true;
  }

  /** Dev seam: force support on or off (IWER has no system keyboard), or `undefined` to read the session. */
  setSupportOverride(value: boolean | undefined): void {
    this.override = value;
  }

  /** The session ended: cancel an open prompt and take the field out of the DOM (Meta's clean-up step). */
  endSession(): void {
    this.onSessionEnd();
  }

  dispose(): void {
    this.finish({ kind: 'cancelled', reason: 'disposed' });
    this.disposed = true;
    this.removeInput();
  }

  // ---- Internals ---------------------------------------------------------------------------------

  private ensureInput(): HTMLInputElement {
    if (this.input !== undefined && this.input.isConnected) return this.input;
    const doc = this.deps.document;
    const input = doc.createElement('input');
    input.type = 'text';
    input.id = 'capri-system-keyboard';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = this.maxChars;
    input.setAttribute('enterkeyhint', 'send');
    input.setAttribute('autocapitalize', 'sentences');
    // Inside the viewport (an off-screen field scrolls the page), but invisible and not clickable.
    const s = input.style;
    s.position = 'fixed';
    s.left = '0';
    s.top = '0';
    s.width = '1px';
    s.height = '1px';
    s.padding = '0';
    s.border = '0';
    s.opacity = '0';
    s.pointerEvents = 'none';
    s.fontSize = '16px';
    input.addEventListener('blur', this.onBlur);
    input.addEventListener('keydown', this.onKeyDown);
    doc.body.appendChild(input);
    this.input = input;
    return input;
  }

  private removeInput(): void {
    const input = this.input;
    if (input === undefined) return;
    input.removeEventListener('blur', this.onBlur);
    input.removeEventListener('keydown', this.onKeyDown);
    input.remove();
    this.input = undefined;
  }

  private focus(input: HTMLInputElement): void {
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }
  }

  /** Read the field: non-empty text submits, empty cancels. The field is cleared either way. */
  private read(): void {
    const input = this.input;
    const text = (input?.value ?? '').trim().slice(0, this.maxChars);
    if (input !== undefined) input.value = '';
    this.finish(text.length > 0 ? { kind: 'submitted', text } : { kind: 'cancelled', reason: 'empty' });
  }

  private finish(result: KeyboardResult): void {
    const open = this.current;
    if (open === undefined) return;
    this.current = undefined;
    open.session?.removeEventListener('select', this.onSelect);
    open.session?.removeEventListener('visibilitychange', this.onVisibility);
    open.session?.removeEventListener('end', this.onSessionEnd);
    const input = this.input;
    if (input !== undefined) {
      input.value = '';
      if (this.deps.document.activeElement === input) {
        this.ignoreBlur = true;
        input.blur();
        this.ignoreBlur = false;
      }
    }
    this.deps.logger.info(
      result.kind === 'submitted' ? 'keyboard: text submitted' : `keyboard: closed without text (${result.reason})`,
    );
    open.resolve(result);
  }

  private readonly onBlur = (): void => {
    if (this.ignoreBlur || this.current === undefined) return;
    this.read();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.current === undefined) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.read();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
    }
  };

  /** A pinch while the keyboard is not showing: focus again, now with a user activation. */
  private readonly onSelect = (): void => {
    const open = this.current;
    const input = this.input;
    if (open === undefined || input === undefined || open.shown) return;
    if (open.session !== undefined && open.session.visibilityState !== 'visible') return;
    this.ignoreBlur = true;
    input.blur();
    this.ignoreBlur = false;
    this.focus(input);
  };

  private readonly onVisibility = (): void => {
    const open = this.current;
    if (open === undefined || open.session === undefined) return;
    if (open.session.visibilityState === 'visible-blurred' && !open.shown) {
      open.shown = true;
      this.deps.logger.info('keyboard: shown');
    }
  };

  private readonly onSessionEnd = (): void => {
    this.finish({ kind: 'cancelled', reason: 'session-ended' });
    this.removeInput();
  };
}
