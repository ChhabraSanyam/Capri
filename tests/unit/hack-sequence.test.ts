import { describe, expect, it } from 'vitest';
import { err, ok, type LightState, type Result } from '../../src/backends/types.js';
import { HACK_SEQUENCE } from '../../src/config/constants.js';
import {
  HackSequence,
  type HackEvent,
  type HackSequenceDeps,
  type LightAction,
} from '../../src/domain/actions/hack-sequence.js';
import type { PersonaRequest } from '../../src/domain/persona/persona.js';

const TARGET = { x: 1, y: 1, z: -2 };
const ACTION: LightAction = {
  device: { id: 'd1', entityId: 'light.desk', name: 'desk lamp' },
  command: { kind: 'off' },
};
const STATE: LightState = { entityId: 'light.desk', on: false, brightnessPct: 100, rgb: [255, 255, 255] };

interface Rig {
  readonly log: string[];
  readonly said: PersonaRequest[];
  readonly events: HackEvent[];
  readonly errors: unknown[];
  readonly calls: number[];
  settle(result: Result<LightState>): void;
  deps: HackSequenceDeps;
}

/** A rig whose backend answers when the test says so. `log` records every port call in order. */
function rig(options: { backend?: HackSequenceDeps['backend']; vfxThrows?: boolean } = {}): Rig {
  const log: string[] = [];
  const said: PersonaRequest[] = [];
  const events: HackEvent[] = [];
  const errors: unknown[] = [];
  const calls: number[] = [];
  let answer: (r: Result<LightState>) => void = () => undefined;
  const backend: HackSequenceDeps['backend'] = options.backend ?? {
    applyCommand: () => {
      log.push('backend');
      calls.push(log.length);
      return new Promise((resolve) => {
        answer = resolve;
      });
    },
  };
  const vfx = (name: string) => (): void => {
    log.push(`vfx.${name}`);
    if (options.vfxThrows) throw new Error('renderer broke');
  };
  const deps: HackSequenceDeps = {
    animator: {
      setLookTarget: (t) => log.push(t === 'user' ? 'look.user' : 'look.target'),
      play: (g) => log.push(`play.${g}`),
    },
    vfx: { flick: vfx('flick'), beam: vfx('beam'), pulse: vfx('pulse'), hold: vfx('hold'), end: vfx('end') },
    backend,
    persona: {
      say: (r) => {
        said.push(r);
        log.push(r.kind === 'call' ? `say.${r.state}` : `say.${r.kind}`);
      },
    },
    onEvent: (e) => {
      events.push(e);
      if (e.type === 'pulseEnded') log.push('pulseEnded');
    },
    onError: (e) => errors.push(e),
  };
  return { log, said, events, errors, calls, settle: (r) => answer(r), deps };
}

const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1];

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

function runTo(seq: HackSequence, seconds: number, step = 1 / 72): void {
  for (let t = 0; t < seconds; t += step) seq.update(step);
}

describe('HackSequence', () => {
  it('runs gaze, flick, beam, pulse, then the call, then the reaction, in that order', async () => {
    const r = rig();
    const seq = new HackSequence(r.deps, ACTION, TARGET);
    runTo(seq, 1.6);
    expect(seq.phase).toBe('LINK_HOLD');
    r.settle(ok(STATE));
    await flush();
    runTo(seq, 0.1);
    expect(r.log).toEqual([
      'look.target', 'say.pending',
      'play.flick', 'vfx.flick',
      'vfx.beam',
      'vfx.pulse',
      'pulseEnded', 'backend', 'vfx.hold',
      'vfx.end', 'look.user', 'play.celebrate', 'say.success',
    ]);
    expect(seq.result).toEqual(ok(STATE));
    await expect(seq.completion).resolves.toEqual(ok(STATE));
  });

  it('dispatches the backend call exactly once, only after the pulse has ended', () => {
    const r = rig();
    const seq = new HackSequence(r.deps, ACTION, TARGET);
    const { aimS, flickS, beamS, pulseS } = HACK_SEQUENCE;
    seq.update(aimS + flickS + beamS + pulseS - 0.05);
    expect(seq.phase).toBe('PULSE');
    expect(seq.callCount).toBe(0);
    seq.update(0.1);
    expect(seq.callCount).toBe(1);
    runTo(seq, 3);
    expect(seq.callCount).toBe(1);
    expect(r.calls).toHaveLength(1);
  });

  it('crosses every phase in order when one frame is longer than the whole run-up', () => {
    const r = rig();
    const seq = new HackSequence(r.deps, ACTION, TARGET);
    seq.update(5);
    const phases = r.events.flatMap((e) => (e.type === 'phase' ? [e.phase] : []));
    expect(phases).toEqual(['AIM', 'FLICK', 'BEAM', 'PULSE', 'CALL', 'LINK_HOLD']);
    expect(r.log.indexOf('pulseEnded')).toBeLessThan(r.log.indexOf('backend'));
  });

  it('only acknowledges while the call is pending, however long it takes', async () => {
    const r = rig();
    const seq = new HackSequence(r.deps, ACTION, TARGET);
    runTo(seq, 6);
    expect(seq.phase).toBe('LINK_HOLD');
    expect(r.said.map((s) => (s.kind === 'call' ? s.state : s.kind))).toEqual(['pending']);
    expect(r.log).not.toContain('play.celebrate');
    r.settle(ok(STATE));
    await flush();
    seq.update(1 / 72);
    expect(r.said.map((s) => (s.kind === 'call' ? s.state : s.kind))).toEqual(['pending', 'success']);
  });

  it('shrugs and says the backend message on failure, with no celebration', async () => {
    const r = rig();
    const seq = new HackSequence(r.deps, ACTION, TARGET);
    runTo(seq, 1.6);
    r.settle(err({ kind: 'auth', message: 'Home Assistant refused the token.' }));
    await flush();
    runTo(seq, 0.1);
    expect(r.log).toContain('play.shrug');
    expect(r.log).not.toContain('play.celebrate');
    expect(last(r.said)).toMatchObject({ kind: 'call', state: 'failure', error: 'Home Assistant refused the token.' });
    expect(r.events).toContainEqual({ type: 'result', ok: false });
    expect(seq.result).toMatchObject({ ok: false });
  });

  it('reports a thrown or rejected backend call as a failure, never a success', async () => {
    const thrown = rig({ backend: { applyCommand: () => { throw new Error('boom'); } } });
    const a = new HackSequence(thrown.deps, ACTION, TARGET);
    runTo(a, 2);
    expect(a.result).toMatchObject({ ok: false });
    const rejected = rig({ backend: { applyCommand: () => Promise.reject(new Error('boom')) } });
    const b = new HackSequence(rejected.deps, ACTION, TARGET);
    runTo(b, 1.6);
    await flush();
    runTo(b, 0.1);
    expect(b.result).toMatchObject({ ok: false });
    expect(last(rejected.said)).toMatchObject({ state: 'failure' });
  });

  it('fails a call that never answers after the timeout and ignores a late success', async () => {
    const r = rig();
    const seq = new HackSequence(r.deps, ACTION, TARGET);
    runTo(seq, 1.6);
    seq.update(HACK_SEQUENCE.callTimeoutS - 0.5);
    expect(seq.phase).toBe('LINK_HOLD');
    seq.update(0.6);
    expect(seq.phase).toBe('RESULT');
    expect(seq.result).toMatchObject({ ok: false, error: { kind: 'timeout' } });
    r.settle(ok(STATE));
    await flush();
    runTo(seq, 2);
    expect(seq.done).toBe(true);
    expect(seq.result).toMatchObject({ ok: false });
    expect(r.said.filter((s) => s.kind === 'call' && s.state === 'success')).toHaveLength(0);
  });

  it('keeps going when the renderer throws and reports the error', async () => {
    const r = rig({ vfxThrows: true });
    const seq = new HackSequence(r.deps, ACTION, TARGET);
    runTo(seq, 1.6);
    r.settle(ok(STATE));
    await flush();
    runTo(seq, 2);
    expect(seq.done).toBe(true);
    expect(seq.callCount).toBe(1);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('ignores non-finite and negative frame times', () => {
    const r = rig();
    const seq = new HackSequence(r.deps, ACTION, TARGET);
    seq.update(Number.NaN);
    seq.update(-5);
    seq.update(Number.POSITIVE_INFINITY * 0);
    expect(seq.phase).toBe('AIM');
  });
});
