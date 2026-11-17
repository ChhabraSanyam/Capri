import { describe, expect, it } from 'vitest';
import { KeyboardModel } from '../../src/domain/keyboard-model.js';
import type { SpeechFailureReason } from '../../src/domain/speech-lang/speech-recognizer-port.js';
import {
  describeVoice,
  orbModeFor,
  speechStateOfModelStatus,
  TranscriptModel,
} from '../../src/domain/voice-ui-model.js';

describe('describeVoice', () => {
  it('shows no chip and no fallback when voice is ready', () => {
    const status = describeVoice('ready', undefined);
    expect(status).toMatchObject({ chip: undefined, fallback: false, orb: 'idle' });
  });

  it('shows the "Voice loading" chip and the fallback while the model loads (15.21)', () => {
    const status = describeVoice('loading', undefined);
    expect(status).toMatchObject({ chip: 'Voice loading', fallback: true, orb: 'loading' });
  });

  it('shows the fallback for every microphone failure (15.10, 15.18) except a deliberate stop', () => {
    const reasons: SpeechFailureReason[] = [
      'model-failed',
      'permission-not-granted',
      'permission-denied',
      'mic-unsupported',
      'mic-unavailable',
      'audio-blocked',
      'recognizer-failed',
    ];
    for (const reason of reasons) {
      const status = describeVoice('ready', reason);
      expect(status.fallback, reason).toBe(true);
      expect(status.chip, reason).toBeDefined();
      expect(status.orb, reason).toBe('unavailable');
    }
    expect(describeVoice('ready', 'stopped').fallback).toBe(false);
  });

  it('keeps chip and hint text plain ASCII', () => {
    for (const reason of ['model-loading', 'model-failed', 'permission-not-granted', 'permission-denied'] as const) {
      const status = describeVoice('ready', reason);
      expect(`${status.chip}${status.hint}`).toMatch(/^[\x20-\x7e]*$/u);
    }
  });

  it('draws the orb as listening only when voice works', () => {
    expect(orbModeFor(describeVoice('ready', undefined), true)).toBe('listening');
    expect(orbModeFor(describeVoice('ready', undefined), false)).toBe('idle');
    expect(orbModeFor(describeVoice('loading', undefined), true)).toBe('loading');
  });

  it('maps model statuses to recogniser states', () => {
    expect(speechStateOfModelStatus('ready')).toBe('ready');
    expect(speechStateOfModelStatus('failed')).toBe('failed');
    for (const s of ['idle', 'downloading', 'loading']) expect(speechStateOfModelStatus(s)).toBe('loading');
  });
});

describe('TranscriptModel', () => {
  it('is hidden until something happens', () => {
    expect(new TranscriptModel().view.visible).toBe(false);
  });

  it('shows the live words while listening, then the final words for the hold time (15.8, 15.9)', () => {
    const m = new TranscriptModel(6);
    m.setListening(true);
    expect(m.view).toMatchObject({ visible: true, heading: 'Listening', text: 'Say a command' });
    m.setPartial('turn off');
    expect(m.view.text).toBe('turn off');
    m.setFinal('turn off that');
    expect(m.view).toMatchObject({ visible: true, heading: 'I heard', text: 'turn off that' });
    m.tick(5.9);
    expect(m.view.visible).toBe(true);
    m.tick(0.2);
    expect(m.view.visible).toBe(false);
  });

  it('says so when nothing was heard', () => {
    const m = new TranscriptModel();
    m.setListening(true);
    m.setFinal('  ');
    expect(m.view.text).toBe('Nothing. Try again.');
  });

  it('shows the voice chip with its hint when voice is unavailable and nothing else is up', () => {
    const m = new TranscriptModel();
    m.setStatus(describeVoice('loading', undefined));
    expect(m.view).toMatchObject({ visible: true, chip: 'Voice loading' });
    m.setStatus(describeVoice('ready', undefined));
    expect(m.view.visible).toBe(false);
  });

  it('bumps the revision only when the view changes', () => {
    const m = new TranscriptModel();
    m.setListening(true);
    const rev = m.revision;
    m.setPartial('');
    m.tick(1);
    expect(m.revision).toBe(rev);
    m.setPartial('dim');
    expect(m.revision).toBe(rev + 1);
  });

  it('starting a new push-to-talk clears the previous result', () => {
    const m = new TranscriptModel();
    m.setFinal('come here');
    m.setListening(true);
    expect(m.view.heading).toBe('Listening');
    m.tick(100);
    expect(m.view.visible).toBe(true);
  });
});

describe('KeyboardModel', () => {
  const type = (m: KeyboardModel, text: string): void => {
    for (const c of text) m.press(c === ' ' ? 'key-space' : `key-${c}`);
  };

  it('types, deletes, and sends a line for the parser (15.12)', () => {
    const m = new KeyboardModel();
    type(m, 'turn on');
    expect(m.text).toBe('turn on');
    expect(m.display).toBe('turn on_');
    m.press('key-delete');
    expect(m.text).toBe('turn o');
    type(m, 'ff');
    expect(m.press('key-send')).toEqual({ type: 'submit', text: 'turn off' });
    expect(m.text).toBe('');
  });

  it('ignores a leading space, double spaces, an empty send, and unknown keys', () => {
    const m = new KeyboardModel();
    expect(m.press('key-space').type).toBe('none');
    expect(m.press('key-send').type).toBe('none');
    expect(m.press('key-delete').type).toBe('none');
    expect(m.press('key-unknown').type).toBe('none');
    type(m, 'a');
    m.press('key-space');
    expect(m.press('key-space').type).toBe('none');
    expect(m.press('key-send')).toEqual({ type: 'submit', text: 'a' });
  });

  it('caps the line and reports close', () => {
    const m = new KeyboardModel(3);
    type(m, 'abcd');
    expect(m.text).toBe('abc');
    expect(m.press('key-close').type).toBe('close');
  });
});
