import { describe, expect, it } from 'vitest';
import { createManualClock } from '../../src/app/clock.js';
import { createSeededRng } from '../../src/app/rng.js';
import { createMockHome } from '../../src/backends/mock/mock-home.js';
import { err, ok, type LightState, type Result } from '../../src/backends/types.js';
import { HackRunner, type ActingBody, type HackRunnerDeps } from '../../src/domain/actions/hack-runner.js';
import type { LightAction } from '../../src/domain/actions/device-runner.js';
import { Persona, type PersonaRequest } from '../../src/domain/persona/persona.js';
import type { Utterance } from '../../src/domain/persona/utterance.js';

const TARGET = { x: 1, y: 1, z: -2 };
const lamp = { id: 'd1', entityId: 'mock.bulb_1', name: 'desk lamp' };
const other = { id: 'd2', entityId: 'mock.bulb_2', name: 'floor lamp' };
const off = (device = lamp): LightAction => ({ device, command: { kind: 'off' } });
const on = (device = lamp): LightAction => ({ device, command: { kind: 'on' } });
const STATE: LightState = { entityId: 'mock.bulb_1', on: false, brightnessPct: 100, rgb: [255, 255, 255] };

/** Everything the ports do, in order, so a test can check the sequence of events. */
function rig(options: { backend?: HackRunnerDeps['backend']; body?: ActingBody; maxQueued?: number } = {}) {
  const log: string[] = [];
  const said: PersonaRequest[] = [];
  const home = createMockHome({ latencyMs: 0 });
  const backend: HackRunnerDeps['backend'] = options.backend ?? {
    applyCommand: (entityId, command, signal) => {
      log.push(`call:${entityId}:${command.kind}`);
      return home.applyCommand(entityId, command, signal);
    },
  };
  const vfx = (name: string) => (): void => void log.push(`vfx.${name}`);
  const runner = new HackRunner({
    getAnimator: () => ({
      setLookTarget: (t) => void log.push(t === 'user' ? 'look.user' : 'look.marker'),
      play: (g) => void log.push(`play.${g}`),
      setPointTarget: (t) => void log.push(t === null ? 'point.release' : 'point.set'),
    }),
    vfx: { flick: vfx('flick'), beam: vfx('beam'), pulse: vfx('pulse'), hold: vfx('hold'), end: vfx('end') },
    backend,
    persona: {
      say: (r) => {
        said.push(r);
        log.push(r.kind === 'call' ? `say.${r.state}` : `say.${r.kind}`);
      },
    },
    ...(options.body === undefined ? {} : { body: options.body }),
    resolveTarget: () => TARGET,
    ...(options.maxQueued === undefined ? {} : { maxQueued: options.maxQueued }),
  });
  /** Frames until the promise settles, with a real tick between frames so the mock backend can answer. */
  async function drive<T>(promise: Promise<T>, maxFrames = 600): Promise<T> {
    let settled = false;
    void promise.then(() => (settled = true));
    for (let i = 0; i < maxFrames && !settled; i += 1) {
      runner.update(1 / 30);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return promise;
  }
  /** Frames until the runner is idle again. */
  async function idle(maxFrames = 600): Promise<void> {
    for (let i = 0; i < maxFrames && (runner.busy || runner.queued > 0); i += 1) {
      runner.update(1 / 30);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return { runner, log, said, home, drive, idle };
}

const index = (log: readonly string[], entry: string, from = 0): number => log.indexOf(entry, from);

describe('HackRunner', () => {
  it('plays gaze, flick, beam and pulse, then calls the backend, then reacts to the real result', async () => {
    const r = rig();
    await r.home.applyCommand('mock.bulb_1', { kind: 'on' });
    const result = await r.drive(r.runner.run(off()));
    expect(result.ok).toBe(true);
    await r.idle();

    const order = ['look.marker', 'say.pending', 'play.flick', 'vfx.flick', 'vfx.beam', 'vfx.pulse', 'call:mock.bulb_1:off', 'vfx.hold', 'vfx.end', 'play.celebrate', 'say.success'];
    let at = -1;
    for (const entry of order) {
      const found = index(r.log, entry, at + 1);
      expect(found, `${entry} after position ${at} in ${r.log.join(' > ')}`).toBeGreaterThan(at);
      at = found;
    }
    expect(r.log.filter((e) => e.startsWith('call:'))).toHaveLength(1);
    expect(r.log).not.toContain('play.shrug');
    expect(r.log[r.log.length - 1]).toBe('point.release');
  });

  it('leaves the bulb alone until after the pulse, then changes it', async () => {
    const r = rig();
    await r.home.applyCommand('mock.bulb_1', { kind: 'on' });
    const before = (): boolean | undefined => r.home.state$.value.find((s) => s.entityId === 'mock.bulb_1')?.on;
    const seen: (boolean | undefined)[] = [];
    // Step by hand and note the bulb after each phase of the visible effect.
    void r.runner.run(off());
    while (!r.log.includes('vfx.pulse')) {
      r.runner.update(1 / 60);
      seen.push(before());
    }
    expect(seen.every((on) => on === true)).toBe(true);
    expect(r.log.some((e) => e.startsWith('call:'))).toBe(false);
    await r.idle();
    expect(before()).toBe(false);
  });

  it('shrugs and reports the real failure for an unknown light, and never says success', async () => {
    const r = rig();
    const result = await r.drive(r.runner.run(off({ id: 'x', entityId: 'mock.nope', name: 'ghost lamp' })));
    expect(result.ok).toBe(false);
    await r.idle();
    expect(r.log).toContain('play.shrug');
    expect(r.log).not.toContain('play.celebrate');
    const failure = r.said.find((s) => s.kind === 'call' && s.state === 'failure');
    expect(failure).toMatchObject({ error: 'I cannot find that light.' });
    expect(r.said.some((s) => s.kind === 'call' && s.state === 'success')).toBe(false);
  });

  it('treats a throwing backend as a failure', async () => {
    const r = rig({ backend: { applyCommand: () => Promise.reject(new Error('secret-token')) } });
    const result = await r.drive(r.runner.run(off()));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(r.said)).not.toContain('secret-token');
    expect(r.log).toContain('play.shrug');
  });

  it('queues a second command in order and gives it its own full sequence', async () => {
    const r = rig();
    const first = r.runner.run(off());
    const second = r.runner.run(on(other));
    expect(r.runner.queued).toBe(2);
    const results = await r.drive(Promise.all([first, second]));
    expect(results.map((x) => x.ok)).toEqual([true, true]);
    await r.idle();

    const calls = r.log.filter((e) => e.startsWith('call:'));
    expect(calls).toEqual(['call:mock.bulb_1:off', 'call:mock.bulb_2:on']);
    const firstCall = index(r.log, calls[0]!);
    const secondCall = index(r.log, calls[1]!);
    const flicks = r.log.map((e, i) => (e === 'play.flick' ? i : -1)).filter((i) => i >= 0);
    expect(flicks).toHaveLength(2);
    // The second flick starts only after the first sequence has called the backend and reacted.
    expect(flicks[1]).toBeGreaterThan(firstCall);
    expect(flicks[1]).toBeGreaterThan(index(r.log, 'play.celebrate'));
    expect(secondCall).toBeGreaterThan(flicks[1]!);
  });

  it('refuses a command beyond the queue limit with an honest failure and no backend call', async () => {
    const r = rig({ maxQueued: 2 });
    const a = r.runner.run(off());
    const b = r.runner.run(off());
    const refused = await r.runner.run(on(other));
    expect(refused.ok).toBe(false);
    expect(r.said.some((s) => s.kind === 'call' && s.state === 'failure')).toBe(true);
    await r.drive(Promise.all([a, b]));
    await r.idle();
    expect(r.log.filter((e) => e.startsWith('call:'))).toEqual(['call:mock.bulb_1:off', 'call:mock.bulb_1:off']);
  });

  it('wraps each sequence in beginAction and endAction, and waits while she is moving', async () => {
    const events: string[] = [];
    let moving = true;
    const body: ActingBody = {
      beginAction: () => {
        if (moving) return false;
        events.push('begin');
        return true;
      },
      endAction: () => void events.push('end'),
    };
    const r = rig({ body });
    const done = r.runner.run(off());
    for (let i = 0; i < 30; i += 1) r.runner.update(1 / 30);
    expect(r.log).toEqual([]);
    expect(r.runner.busy).toBe(false);
    moving = false;
    await r.drive(done);
    expect(events).toEqual(['begin']);
    await r.idle();
    expect(events).toEqual(['begin', 'end']);
  });

  it('resolves everything unanswered with a failure on dispose', async () => {
    const r = rig({ backend: { applyCommand: () => new Promise<Result<LightState>>(() => undefined) } });
    const a = r.runner.run(off());
    const b = r.runner.run(on(other));
    r.runner.update(1 / 30);
    r.runner.dispose();
    expect((await a).ok).toBe(false);
    expect((await b).ok).toBe(false);
    expect((await r.runner.run(off())).ok).toBe(false);
  });

  it('passes the backend result through untouched', async () => {
    const r = rig({ backend: { applyCommand: () => Promise.resolve(ok(STATE)) } });
    const result = await r.drive(r.runner.run(off()));
    expect(result).toEqual(ok(STATE));
    const failing = rig({ backend: { applyCommand: () => Promise.resolve(err({ kind: 'auth', message: 'Check the token.' })) } });
    const failed = await failing.drive(failing.runner.run(off()));
    expect(failed).toEqual(err({ kind: 'auth', message: 'Check the token.' }));
  });
});

describe('Persona.say without gestures', () => {
  it('drops the gesture and keeps the emotion, so the hack sequence is the only one that plays celebrate', () => {
    const delivered: Utterance[] = [];
    const persona = new Persona({
      rng: createSeededRng(1),
      clock: createManualClock(0),
      deliver: (line) => void delivered.push(line),
    });
    const subject = { kind: 'light' as const, device: 'desk lamp', command: { kind: 'off' as const } };

    persona.say({ kind: 'call', state: 'success', subject });
    expect(delivered.some((l) => l.gesture === 'celebrate')).toBe(true);

    delivered.length = 0;
    persona.say({ kind: 'call', state: 'success', subject }, { gestures: false });
    expect(delivered.length).toBeGreaterThan(0);
    expect(delivered.every((l) => l.gesture === undefined)).toBe(true);
    expect(delivered.some((l) => l.emotion === 'happy')).toBe(true);

    delivered.length = 0;
    persona.say({ kind: 'call', state: 'failure', subject, error: 'Nope.' }, { gestures: false });
    expect(delivered.some((l) => l.claims === 'fail' && l.text.includes('Nope.'))).toBe(true);
    expect(delivered.every((l) => l.gesture === undefined)).toBe(true);
  });
});
