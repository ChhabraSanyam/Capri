// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Logger } from '../../src/app/logger.js';
import { TextEntry, TEXT_ENTRY_PROMPTS } from '../../src/app/text-entry.js';
import { TEXT_ENTRY_UNAVAILABLE } from '../../src/domain/hud/hud-view.js';
import { SystemKeyboard, type KeyboardSession } from '../../src/ui/system-keyboard.js';

/** A session with listeners, a visibility state, and the keyboard support flag. */
class FakeSession implements KeyboardSession {
  visibilityState = 'visible';
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(readonly isSystemKeyboardSupported: boolean) {}

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function recordingLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const log = (...args: unknown[]): void => void lines.push(args.map(String).join(' '));
  return { lines, debug: log, info: log, warn: log, error: log } as unknown as Logger & { lines: string[] };
}

function setup(supported = true) {
  document.body.innerHTML = '';
  const session = new FakeSession(supported);
  const logger = recordingLogger();
  let current: FakeSession | undefined = session;
  const keyboard = new SystemKeyboard({ document, getSession: () => current, logger });
  const field = (): HTMLInputElement | null => document.querySelector('#capri-system-keyboard');
  return { session, logger, keyboard, field, endSession: () => (current = undefined) };
}

describe('SystemKeyboard (task 33.9, A22)', () => {
  it('reads support from the session and is unsupported without one', () => {
    expect(setup(true).keyboard.supported).toBe(true);
    expect(setup(false).keyboard.supported).toBe(false);
    const { keyboard, endSession } = setup(true);
    endSession();
    expect(keyboard.supported).toBe(false);
    keyboard.setSupportOverride(true);
    expect(keyboard.supported).toBe(true);
  });

  it('focuses an in-viewport field with the prompt, and submits the text when the field blurs', async () => {
    const { keyboard, field, session, logger } = setup();
    const result = keyboard.open('Ask Hermes anything');
    const input = field();
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input!.placeholder).toBe('Ask Hermes anything');
    expect(input!.style.position).toBe('fixed');
    session.visibilityState = 'visible-blurred';
    session.fire('visibilitychange');
    expect(keyboard.isShown).toBe(true);
    // The user types on the system keyboard, then presses Done: the field blurs.
    input!.value = '  what is on my calendar  ';
    input!.blur();
    await expect(result).resolves.toEqual({ kind: 'submitted', text: 'what is on my calendar' });
    expect(keyboard.isOpen).toBe(false);
    expect(input!.value).toBe('');
    expect(session.count('select') + session.count('visibilitychange') + session.count('end')).toBe(0);
    // The typed text never reaches the log.
    expect(logger.lines.join('\n')).not.toMatch(/calendar/);
  });

  it('submits on Enter, cancels on Escape or an empty field', async () => {
    const { keyboard, field } = setup();
    const enter = keyboard.open('Type a command for Capri');
    field()!.value = 'turn that off';
    field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await expect(enter).resolves.toEqual({ kind: 'submitted', text: 'turn that off' });

    const escape = keyboard.open('Type a command for Capri');
    field()!.value = 'half typed';
    field()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(escape).resolves.toEqual({ kind: 'cancelled', reason: 'empty' });

    const empty = keyboard.open('Type a command for Capri');
    field()!.blur();
    await expect(empty).resolves.toEqual({ kind: 'cancelled', reason: 'empty' });
  });

  it('starts every prompt empty, replaces an open prompt, and refocuses on a pinch while hidden', async () => {
    const { keyboard, field, session } = setup();
    const first = keyboard.open('one');
    field()!.value = 'old';
    const second = keyboard.open('two');
    await expect(first).resolves.toEqual({ kind: 'cancelled', reason: 'replaced' });
    expect(field()!.value).toBe('');
    // A pinch (session select) while the keyboard is not showing focuses the field again, keeping the prompt.
    field()!.blur();
    await expect(second).resolves.toEqual({ kind: 'cancelled', reason: 'empty' });
    const third = keyboard.open('three');
    session.fire('select');
    expect(document.activeElement).toBe(field());
    expect(keyboard.isOpen).toBe(true);
    expect(keyboard.submit('hello')).toBe(true);
    await expect(third).resolves.toEqual({ kind: 'submitted', text: 'hello' });
    expect(keyboard.submit('late')).toBe(false);
  });

  it('cancels on session end and removes the field; refuses when unsupported', async () => {
    const { keyboard, field, session } = setup();
    const open = keyboard.open('one');
    session.fire('end');
    await expect(open).resolves.toEqual({ kind: 'cancelled', reason: 'session-ended' });
    expect(field()).toBeNull();
    const unsupported = setup(false);
    await expect(unsupported.keyboard.open('x')).resolves.toEqual({ kind: 'cancelled', reason: 'unsupported' });
    expect(unsupported.field()).toBeNull();
  });

  it('cuts text to the limit', async () => {
    document.body.innerHTML = '';
    const keyboard = new SystemKeyboard({ document, getSession: () => new FakeSession(true), logger: recordingLogger(), maxChars: 5 });
    const open = keyboard.open('x');
    keyboard.submit('abcdefgh');
    await expect(open).resolves.toEqual({ kind: 'submitted', text: 'abcde' });
  });
});

describe('TextEntry routing (task 33.9, Requirements 33.53 to 33.58)', () => {
  function rig(opts: { supported?: boolean; connected?: boolean } = {}) {
    const { keyboard, field } = setup(opts.supported ?? true);
    const sent: string[] = [];
    const lines: string[] = [];
    let notConnected = 0;
    const entry = new TextEntry({
      keyboard,
      targets: {
        command: async (t) => void sent.push(`command:${t}`),
        ask: async (t) => void sent.push(`ask:${t}`),
        task: async (t) => void sent.push(`task:${t}`),
      },
      isHermesConnected: () => opts.connected ?? true,
      sayNotConnected: () => void (notConnected += 1),
      showLine: (t) => void lines.push(t),
      logger: recordingLogger(),
    });
    return { entry, keyboard, field, sent, lines, notConnected: () => notConnected };
  }

  it('sends the text to the target of the purpose and shows it as the transcript', async () => {
    for (const purpose of ['command', 'ask', 'task'] as const) {
      const r = rig();
      const done = r.entry.open(purpose);
      expect(r.field()!.placeholder).toBe(TEXT_ENTRY_PROMPTS[purpose]);
      r.keyboard.submit('water the plants');
      await expect(done).resolves.toBe('submitted');
      expect(r.sent).toEqual([`${purpose}:water the plants`]);
      expect(r.lines[r.lines.length - 1]).toBe('water the plants');
    }
  });

  it('says the not-connected line instead of opening the keyboard for Hermes without Hermes', async () => {
    for (const purpose of ['ask', 'task'] as const) {
      const r = rig({ connected: false });
      await expect(r.entry.open(purpose)).resolves.toBe('not_connected');
      expect(r.notConnected()).toBe(1);
      expect(r.keyboard.isOpen).toBe(false);
    }
    // Typed commands do not need Hermes.
    const r = rig({ connected: false });
    const done = r.entry.open('command');
    expect(r.keyboard.isOpen).toBe(true);
    r.keyboard.submit('come here');
    await expect(done).resolves.toBe('submitted');
    expect(r.sent).toEqual(['command:come here']);
  });

  it('says text entry is unavailable without the system keyboard, and sends nothing on a cancel', async () => {
    const r = rig({ supported: false });
    expect(r.entry.available).toBe(false);
    await expect(r.entry.open('command')).resolves.toBe('unsupported');
    expect(r.lines).toEqual([TEXT_ENTRY_UNAVAILABLE]);
    const c = rig();
    const done = c.entry.open('ask');
    c.keyboard.cancel();
    await expect(done).resolves.toBe('cancelled');
    expect(c.sent).toEqual([]);
  });
});
