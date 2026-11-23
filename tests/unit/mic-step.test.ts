import { describe, expect, it } from 'vitest';
import { MIC_STORAGE_KEY } from '../../src/config/constants.js';
import {
  createMicStep,
  describeMicFailure,
  getMicState,
  micHint,
  parseMicState,
  type MicMediaDevices,
  type MicStepElements,
} from '../../src/ui/setup-page/mic-step.js';

function fakeElements() {
  const listeners: (() => void)[] = [];
  const button = {
    disabled: false,
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
  };
  const status = { textContent: '' };
  const hint = { textContent: '', hidden: true };
  return {
    button,
    status,
    hint,
    click: () => listeners.forEach((fn) => fn()),
    elements: { button, status, hint } as unknown as MicStepElements,
  };
}

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

function fakeStream() {
  const stopped: boolean[] = [false, false];
  const stream = {
    getTracks: () => stopped.map((_, i) => ({ stop: () => void (stopped[i] = true) })),
  } as unknown as MediaStream;
  return { stream, stopped };
}

describe('Mic_Setup_Step', () => {
  it('requests audio once, stops every track at once, and records granted', async () => {
    const { stream, stopped } = fakeStream();
    const calls: MediaStreamConstraints[] = [];
    const mediaDevices: MicMediaDevices = {
      getUserMedia: (c) => {
        calls.push(c);
        return Promise.resolve(stream);
      },
    };
    const storage = fakeStorage();
    const page = fakeElements();
    const step = createMicStep({ elements: page.elements, mediaDevices, storage });
    expect(page.status.textContent).toContain('not requested');
    expect(page.hint.hidden).toBe(false);
    expect(page.hint.textContent).toContain('Commands list');

    expect(await step.request()).toBe('granted');
    expect(calls).toEqual([{ audio: true }]);
    expect(stopped).toEqual([true, true]);
    expect(storage.data.get(MIC_STORAGE_KEY)).toBe('granted');
    expect(getMicState()).toBe('granted');
    expect(page.status.textContent).toContain('allowed');
    expect(page.hint.hidden).toBe(true);
  });

  it('records denied, shows the reason and the fallback hint, and lets the user retry', async () => {
    const mediaDevices: MicMediaDevices = {
      getUserMedia: () => Promise.reject(new DOMException('no', 'NotAllowedError')),
    };
    const storage = fakeStorage();
    const page = fakeElements();
    const step = createMicStep({ elements: page.elements, mediaDevices, storage });
    expect(await step.request()).toBe('denied');
    expect(storage.data.get(MIC_STORAGE_KEY)).toBe('denied');
    expect(page.hint.textContent).toContain('blocked');
    expect(page.hint.textContent).toContain('Quest keyboard');
    expect(page.button.disabled).toBe(false);
  });

  it('never calls getUserMedia while an AR session is active', async () => {
    let called = false;
    const mediaDevices: MicMediaDevices = {
      getUserMedia: () => {
        called = true;
        return Promise.reject(new Error('should not run'));
      },
    };
    const page = fakeElements();
    const step = createMicStep({
      elements: page.elements,
      mediaDevices,
      storage: fakeStorage(),
      isSessionActive: () => true,
    });
    await step.request();
    expect(called).toBe(false);
  });

  it('click handler runs the request', async () => {
    const { stream } = fakeStream();
    let called = 0;
    const page = fakeElements();
    createMicStep({
      elements: page.elements,
      mediaDevices: {
        getUserMedia: () => {
          called += 1;
          return Promise.resolve(stream);
        },
      },
      storage: fakeStorage(),
    });
    page.click();
    expect(called).toBe(1);
  });

  it('parses stored values and maps failures to plain words', () => {
    expect(parseMicState('granted')).toBe('granted');
    expect(parseMicState('denied')).toBe('denied');
    expect(parseMicState('junk')).toBe('not-requested');
    expect(parseMicState(null)).toBe('not-requested');
    expect(micHint('granted')).toBe('');
    expect(describeMicFailure(new DOMException('x', 'NotFoundError'))).toContain('No microphone');
  });
});
