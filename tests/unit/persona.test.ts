import { describe, expect, it } from 'vitest';
import manifestText from '../../voice/voice-manifest.txt?raw';
import { createManualClock } from '../../src/app/clock.js';
import { createSeededRng } from '../../src/app/rng.js';
import { ActionMemory, toggleRepeat } from '../../src/domain/persona/action-memory.js';
import { claimAllowed, nextCallState } from '../../src/domain/persona/call-state.js';
import { Persona, personaRequestFor, type PersonaRequest } from '../../src/domain/persona/persona.js';
import {
  BANTER_CONTEXTS,
  renderTemplate,
  templateSlots,
  type BanterKind,
} from '../../src/domain/persona/templates.js';
import { limitSentences, sentenceCount } from '../../src/domain/persona/truncate.js';
import type { Utterance } from '../../src/domain/persona/utterance.js';
import { claimsCompletion } from '../../src/domain/persona/call-state.js';
import { parseVoiceManifest, type VoiceManifest } from '../../src/domain/speech/voice-manifest.js';

function manifest(): VoiceManifest {
  const parsed = parseVoiceManifest(manifestText);
  if (!parsed.ok) throw new Error('manifest');
  return parsed.manifest;
}

function persona(withManifest: boolean, seed = 1) {
  const clock = createManualClock(0);
  const said: Utterance[] = [];
  const p = new Persona({
    rng: createSeededRng(seed),
    clock,
    ...(withManifest ? { manifest: manifest() } : {}),
    deliver: (u) => void said.push(u),
  });
  return { p, clock, said };
}

const lamp = { kind: 'light', device: 'desk lamp', command: { kind: 'off' } } as const;

describe('limitSentences', () => {
  it('keeps the first two sentences as a prefix', () => {
    expect(limitSentences('One. Two! Three? Four.')).toBe('One. Two!');
    expect(limitSentences('One. Two.')).toBe('One. Two.');
    expect(limitSentences('  Just one  ')).toBe('  Just one  ');
  });
  it('ignores decimal points and abbreviations, and is idempotent', () => {
    const text = 'Set it to 3.5 now. Ask Dr. Who, e.g. later. Then stop.';
    const once = limitSentences(text);
    expect(once).toBe('Set it to 3.5 now. Ask Dr. Who, e.g. later.');
    expect(limitSentences(once)).toBe(once);
    expect(sentenceCount(once)).toBe(2);
  });
});

describe('call state', () => {
  it('allows each claim only in its own state', () => {
    expect(claimAllowed('pending', 'ack')).toBe(true);
    expect(claimAllowed('pending', 'done')).toBe(false);
    expect(claimAllowed('idle', 'done')).toBe(false);
    expect(claimAllowed('success', 'done')).toBe(true);
    expect(claimAllowed('success', 'ack')).toBe(false);
    expect(claimAllowed('failure', 'fail')).toBe(true);
    expect(claimAllowed('success', 'fail')).toBe(false);
  });
  it('only leaves pending through a result', () => {
    expect(nextCallState('idle', 'succeed')).toBe('idle');
    expect(nextCallState(nextCallState('idle', 'start'), 'succeed')).toBe('success');
    expect(nextCallState('pending', 'fail')).toBe('failure');
  });
});

describe('action memory', () => {
  it('keeps the last 20 actions in order', () => {
    const memory = new ActionMemory();
    for (let i = 0; i < 25; i++) memory.record({ kind: 'toggle', deviceId: 'a', t: i });
    expect(memory.size).toBe(20);
    expect(memory.entries().map((e) => e.t)).toEqual(Array.from({ length: 20 }, (_, i) => i + 5));
  });
  it('finds a device toggled three times within 60 s', () => {
    const memory = new ActionMemory();
    memory.record({ kind: 'toggle', deviceId: 'a', t: 0 });
    memory.record({ kind: 'toggle', deviceId: 'b', t: 1000 });
    memory.record({ kind: 'toggle', deviceId: 'a', t: 30_000 });
    expect(toggleRepeat(memory, 30_000)).toBeUndefined();
    memory.record({ kind: 'toggle', deviceId: 'a', t: 60_000 });
    expect(toggleRepeat(memory, 60_000)).toBe('a');
    expect(toggleRepeat(memory, 60_001)).toBeUndefined();
  });
});

describe('templates', () => {
  const kinds = Object.keys(BANTER_CONTEXTS) as BanterKind[];
  it('give 3 to 6 variants per dynamic context, each at most two sentences', () => {
    for (const kind of kinds) {
      const { templates } = BANTER_CONTEXTS[kind];
      if (templates.length === 0) continue;
      expect(templates.length, kind).toBeGreaterThanOrEqual(3);
      expect(templates.length, kind).toBeLessThanOrEqual(6);
      for (const t of templates) {
        expect(sentenceCount(renderTemplate(t.text, {})), t.id).toBeLessThanOrEqual(2);
        expect(renderTemplate(t.text, {}), t.id).not.toMatch(/[{}]/);
        if (t.claims !== 'done') expect(claimsCompletion(t.text), t.id).toBe(false);
      }
    }
  });
  it('use only known slots and fill a slot value once, without reading braces in it', () => {
    for (const kind of kinds) {
      for (const t of BANTER_CONTEXTS[kind].templates) {
        for (const slot of templateSlots(t.text)) {
          expect(['device', 'count', 'surface', 'minutes', 'list', 'label', 'pct', 'color', 'min', 'max']).toContain(slot);
        }
      }
    }
    expect(renderTemplate('{device} is on.', { device: '{label} lamp.' })).toBe('Label lamp is on.');
  });
  it('point at library lines that exist in the manifest', () => {
    const m = manifest();
    for (const kind of kinds) {
      for (const pool of BANTER_CONTEXTS[kind].library ?? []) {
        const lines = m.categories[pool.category].filter((l) => pool.ids === undefined || pool.ids.includes(l.id));
        expect(lines.length, kind).toBe(pool.ids?.length ?? m.categories[pool.category].length);
      }
    }
  });
});

describe('Persona truthfulness', () => {
  for (const withManifest of [true, false]) {
    describe(withManifest ? 'with the Voice_Library' : 'without it', () => {
      it('only acknowledges while pending', () => {
        for (let seed = 1; seed <= 20; seed++) {
          const { p } = persona(withManifest, seed);
          const lines = p.utter({ kind: 'call', state: 'pending', subject: lamp });
          expect(lines.length).toBeGreaterThan(0);
          for (const l of lines) {
            expect(l.claims).toBe('ack');
            expect(claimsCompletion(l.text)).toBe(false);
          }
        }
      });
      it('says done, with what was done, only after success', () => {
        const { p } = persona(withManifest);
        const lines = p.utter({ kind: 'call', state: 'success', subject: lamp });
        expect(lines.every((l) => l.claims === 'done')).toBe(true);
        expect(lines[lines.length - 1]!.text.toLowerCase()).toContain('desk lamp');
        expect(lines[0]!.gesture).toBe('celebrate');
      });
      it('reports a failure with the backend message and a shrug', () => {
        const { p } = persona(withManifest);
        const message = 'I cannot find that light.';
        const lines = p.utter({ kind: 'call', state: 'failure', subject: lamp, error: message });
        expect(lines.every((l) => l.claims === 'fail')).toBe(true);
        expect(lines.some((l) => l.text.includes(message))).toBe(true);
        expect(lines[0]!.gesture).toBe('shrug');
      });
      it('says nothing when idle, and rewrites a pending line that smuggles in completion wording', () => {
        const { p } = persona(withManifest);
        expect(p.utter({ kind: 'call', state: 'idle', subject: lamp })).toEqual([]);
        const sneaky = { kind: 'light', device: 'finished done lamp', command: { kind: 'on' } } as const;
        for (let i = 0; i < 12; i++) {
          for (const l of p.utter({ kind: 'call', state: 'pending', subject: sneaky })) {
            expect(claimsCompletion(l.text)).toBe(false);
          }
        }
      });
    });
  }
  it('plays library lines with their id and category, and keeps the text for the bubble', () => {
    const { p } = persona(true);
    const [ack] = p.utter({ kind: 'call', state: 'pending', subject: lamp });
    expect(ack!.libraryCategory === 'confirm' || ack!.libraryCategory === 'thinking').toBe(true);
    expect(ack!.libraryId).toMatch(/^(confirm|thinking)_/);
    expect(ack!.text.length).toBeGreaterThan(0);
    const [dyn] = persona(false).p.utter({ kind: 'call', state: 'pending', subject: lamp });
    expect(dyn!.libraryId).toBeUndefined();
  });
  it('limits a long backend message to two sentences', () => {
    const { p } = persona(true);
    const lines = p.utter({ kind: 'call', state: 'failure', subject: lamp, error: 'One. Two. Three.' });
    expect(lines.every((l) => sentenceCount(l.text) <= 2)).toBe(true);
  });
});

describe('Persona situations', () => {
  const requests: PersonaRequest[] = [
    { kind: 'greeting' },
    { kind: 'idle_ignored' },
    { kind: 'ask_pointed' },
    { kind: 'ask_repeat' },
    { kind: 'hermes_unavailable' },
    { kind: 'hermes_not_connected' },
    { kind: 'ask_which', candidates: ['desk lamp', 'floor lamp', 'a', 'b', 'c'] },
    { kind: 'surface_missing', surface: 'table', reason: 'not_found' },
    { kind: 'surface_missing', surface: '', reason: 'unsuitable' },
    { kind: 'timer_done', minutes: 5 },
    { kind: 'timer_done', minutes: 1, label: 'check the oven.' },
    { kind: 'unsupported', reason: 'unrecognised' },
    { kind: 'unsupported', reason: 'unknown_device', text: 'kitchen light' },
    { kind: 'unsupported', reason: 'bad_timer' },
    { kind: 'unsupported', reason: 'bad_color' },
  ];
  it('answers every request with short neutral lines and no open slots', () => {
    for (const withManifest of [true, false]) {
      for (const request of requests) {
        const { p } = persona(withManifest);
        const lines = p.utter(request);
        expect(lines.length, JSON.stringify(request)).toBeGreaterThan(0);
        for (const l of lines) {
          expect(l.claims).toBe('neutral');
          expect(sentenceCount(l.text)).toBeLessThanOrEqual(2);
          expect(l.text).not.toMatch(/[{}]/);
        }
      }
    }
  });
  it('names the candidates when asking which device', () => {
    const { p } = persona(false);
    const [line] = p.utter({ kind: 'ask_which', candidates: ['desk lamp', 'floor lamp'] });
    expect(line!.text).toContain('the desk lamp or the floor lamp');
  });
  it('names the surface and the timer, and delivers through PersonaPort', () => {
    const { p, said } = persona(false);
    p.situation({ kind: 'surface_missing', surface: 'couch', reason: 'not_found' });
    p.situation({ kind: 'timer_done', minutes: 5 });
    expect(said[0]!.text.toLowerCase()).toContain('couch');
    expect(said[1]!.text).toContain('5 minutes');
  });
  it('maps resolver outcomes to requests', () => {
    expect(personaRequestFor({ type: 'repeat' })).toEqual({ kind: 'ask_repeat' });
    expect(personaRequestFor({ type: 'clarify', reason: 'no_pointed', candidates: [], intent: { type: 'repeat' } })).toEqual({
      kind: 'ask_pointed',
    });
  });
  it('teases a light toggled three times within a minute, once', () => {
    const { p, clock, said } = persona(true);
    const nameOf = (id: string) => (id === 'lamp-1' ? 'desk lamp' : undefined);
    for (let i = 0; i < 2; i++) {
      expect(p.noteAction({ kind: 'toggle', deviceId: 'lamp-1' }, nameOf)).toEqual([]);
      clock.advance(5000);
    }
    const tease = p.noteAction({ kind: 'toggle', deviceId: 'lamp-1' }, nameOf);
    expect(tease).toHaveLength(1);
    expect(tease[0]!.text.toLowerCase()).toContain('desk lamp');
    expect(tease[0]!.gesture).toBe('tease');
    expect(said).toHaveLength(1);
    clock.advance(1000);
    expect(p.noteAction({ kind: 'toggle', deviceId: 'lamp-1' }, nameOf)).toEqual([]);
    expect(p.memory.size).toBe(4);
  });
});
