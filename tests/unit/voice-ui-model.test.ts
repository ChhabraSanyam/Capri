import { describe, expect, it } from 'vitest';
import type { SpeechFailureReason } from '../../src/domain/speech-lang/speech-recognizer-port.js';
import {
  describeVoice,
  micLevelFromRms,
  speechStateOfModelStatus,
  TranscriptBubbleModel,
} from '../../src/domain/voice-ui-model.js';
describe('describeVoice', () => {
  it('shows no chip and no fallback when voice is ready', () => {
    const status = describeVoice('ready', undefined);
    expect(status).toMatchObject({ chip: undefined, fallback: false, indicator: 'ready' });
  });
  it('shows the "Voice loading" chip and the fallback while the model loads (15.21)', () => {
    const status = describeVoice('loading', undefined);
    expect(status).toMatchObject({ chip: 'Voice loading', fallback: true, indicator: 'loading' });
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
      expect(status.indicator, reason).toBe('unavailable');
    }
    expect(describeVoice('ready', 'stopped').fallback).toBe(false);
  });
  it('keeps chip and hint text plain ASCII', () => {
    for (const reason of ['model-loading', 'model-failed', 'permission-not-granted', 'permission-denied'] as const) {
      const status = describeVoice('ready', reason);
      expect(`${status.chip}${status.hint}`).toMatch(/^[\x20-\x7e]*$/u);
    }
  });
  it('maps model statuses to recogniser states', () => {
    expect(speechStateOfModelStatus('ready')).toBe('ready');
    expect(speechStateOfModelStatus('failed')).toBe('failed');
    for (const s of ['idle', 'downloading', 'loading']) expect(speechStateOfModelStatus(s)).toBe('loading');
  });
});
describe('micLevelFromRms', () => {
  it('removes the noise floor, scales, and clamps to [0, 1]', () => {
    expect(micLevelFromRms(0, 0.01, 10)).toBe(0);
    expect(micLevelFromRms(0.005, 0.01, 10)).toBe(0);
    expect(micLevelFromRms(0.06, 0.01, 10)).toBeCloseTo(0.5, 9);
    expect(micLevelFromRms(0.5, 0.01, 10)).toBe(1);
    expect(micLevelFromRms(Number.NaN)).toBe(0);
  });
});
describe('TranscriptBubbleModel (33.24 to 33.28)', () => {
  const READY = describeVoice('ready', undefined);
  const model = (): TranscriptBubbleModel => {
    const m = new TranscriptBubbleModel({ finalHoldS: 2.5, noticeS: 2.5 });
    m.setStatus(READY);
    return m;
  };
  it('is hidden until push-to-talk starts, and shows nothing just because voice is unavailable', () => {
    const m = new TranscriptBubbleModel();
    expect(m.view.kind).toBe('hidden');
    m.setStatus(describeVoice('loading', undefined));
    expect(m.view.kind).toBe('hidden');
  });
  it('listens with the mic level, then shows the partial and final words, then hides', () => {
    const m = model();
    m.setListening(true);
    expect(m.view).toEqual({ kind: 'listening', text: '' });
    m.setLevel(0.6);
    expect(m.level).toBeCloseTo(0.6, 9);
    m.setPartial('turn off');
    expect(m.view).toEqual({ kind: 'partial', text: 'turn off' });
    expect(m.level).toBe(0);
    m.setFinal(' turn off that ');
    expect(m.view).toEqual({ kind: 'final', text: 'turn off that' });
    m.tick(2.4);
    expect(m.view.kind).toBe('final');
    m.tick(0.2);
    expect(m.view.kind).toBe('hidden');
  });
  it('hides at once on an empty final (Capri asks again in her own bubble)', () => {
    const m = model();
    m.setListening(true);
    m.setFinal('  ');
    expect(m.view.kind).toBe('hidden');
  });
  it('shows "Voice loading" or "Mic not allowed" for 2.5 s when push-to-talk starts, then hides', () => {
    for (const [status, text] of [
      [describeVoice('loading', undefined), 'Voice loading'],
      [describeVoice('ready', 'permission-not-granted'), 'Mic not allowed'],
    ] as const) {
      const m = model();
      m.setStatus(status);
      m.setListening(true);
      expect(m.view).toEqual({ kind: 'notice', text });
      m.setListening(false);
      m.tick(2.4);
      expect(m.view.kind).toBe('notice');
      m.tick(0.2);
      expect(m.view.kind).toBe('hidden');
    }
  });
  it('shows a failure that is reported while push-to-talk is on, and drops a stale one when the start works', () => {
    const failed = model();
    failed.setListening(true);
    failed.setStatus(describeVoice('ready', 'permission-denied'));
    failed.setListening(false);
    expect(failed.view).toEqual({ kind: 'notice', text: 'Mic blocked' });
    const recovered = model();
    recovered.setStatus(describeVoice('ready', 'mic-unavailable'));
    recovered.setListening(true);
    expect(recovered.view.kind).toBe('notice');
    recovered.setStatus(READY);
    expect(recovered.view.kind).toBe('listening');
  });
  it('bumps the revision only when the view changes, not for the level', () => {
    const m = model();
    m.setListening(true);
    const rev = m.revision;
    m.setPartial('');
    m.setLevel(0.9);
    m.tick(1);
    expect(m.revision).toBe(rev);
    m.setPartial('dim');
    expect(m.revision).toBe(rev + 1);
  });
  it('a new push-to-talk clears the previous result and stays up while held', () => {
    const m = model();
    m.setFinal('come here');
    m.setListening(true);
    expect(m.view.kind).toBe('listening');
    m.tick(100);
    expect(m.view.kind).toBe('listening');
  });
});
