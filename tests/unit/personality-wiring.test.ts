import { describe, expect, it } from 'vitest';
import { createManualClock } from '../../src/app/clock.js';
import { createEventBus, type AppEvents } from '../../src/app/events.js';
import { createFrameContext } from '../../src/app/frame-context.js';
import { createLogger } from '../../src/app/logger.js';
import { PersonalityWiring, type PersonalityAnimator } from '../../src/app/personality.js';
import { createSeededRng } from '../../src/app/rng.js';
import type { GestureId } from '../../src/domain/animation-types.js';
import type { AvatarMode } from '../../src/domain/avatar-state.js';
import type { Vec3 } from '../../src/domain/geometry.js';
import type { PersonaRequest } from '../../src/domain/persona/persona.js';
import type { Surface } from '../../src/domain/surfaces.js';

const FRAME_MS = 100;

function surface(id: string, label: Surface['label'], center: Vec3): Surface {
  return { id, label, rawLabel: label, center, normal: { x: 0, y: 1, z: 0 }, halfExtents: { x: 0.5, z: 0.5 } };
}

/** An animator that plays each gesture for `durationMs` of clock time, like the real one. */
class FakeAnimator implements PersonalityAnimator {
  readonly played: { gesture: GestureId; target: Vec3 | undefined; t: number }[] = [];
  private current: { gesture: GestureId; endsAt: number; resolve: () => void } | undefined;
  constructor(
    private readonly clock: { now(): number },
    private readonly durationMs = 2_000,
  ) {}
  get activeGesture(): GestureId {
    return this.current?.gesture ?? 'none';
  }
  play(g: GestureId, opts?: { target?: Vec3 }): Promise<void> {
    this.current?.resolve();
    this.played.push({ gesture: g, target: opts?.target, t: this.clock.now() });
    return new Promise((resolve) => {
      this.current = { gesture: g, endsAt: this.clock.now() + this.durationMs, resolve };
    });
  }
  tick(): void {
    if (this.current !== undefined && this.clock.now() >= this.current.endsAt) {
      this.current.resolve();
      this.current = undefined;
    }
  }
}

function rig(options: { surfaces?: readonly Surface[]; markers?: readonly { position: Vec3 }[] } = {}) {
  const clock = createManualClock(1_000);
  const events = createEventBus<AppEvents>(createLogger('test'));
  const animator = new FakeAnimator(clock);
  const said: PersonaRequest[] = [];
  const state = { speaking: false, hack: false, task: false, present: true, mode: 'idle' as AvatarMode };
  const surfaces = options.surfaces ?? [];
  const markers = options.markers ?? [];
  const wiring = new PersonalityWiring({
    clock,
    rng: createSeededRng(11),
    logger: createLogger('test'),
    events,
    persona: { say: (request) => (said.push(request), []) },
    getAnimator: () => animator,
    isPresent: () => state.present,
    getMode: () => state.mode,
    isSpeaking: () => state.speaking,
    isHackActive: () => state.hack,
    isTaskRunning: () => state.task,
    getSurfaces: () => surfaces,
    getMarkers: () => markers,
  });
  const frame = createFrameContext();
  frame.inSession = true;
  /** Step `ms` of clock time in 100 ms frames; promise callbacks run between frames. */
  async function run(ms: number, each?: (t: number) => void): Promise<void> {
    const end = clock.now() + ms;
    while (clock.now() < end) {
      clock.advance(FRAME_MS);
      animator.tick();
      await Promise.resolve();
      each?.(clock.now());
      wiring.update(frame);
    }
  }
  return { clock, events, animator, said, state, wiring, frame, run };
}

describe('PersonalityWiring', () => {
  it('plays an idle behaviour at least every 20 s while she is free, and never while she speaks', async () => {
    const r = rig({ markers: [{ position: { x: 1, y: 1, z: -1 } }] });
    await r.run(1);
    let lastInput = r.clock.now();
    // Keep the user active, so only behaviours (not the ignored reaction) are in play.
    await r.run(100_000, (t) => {
      if (t - lastInput >= 30_000) {
        r.wiring.noteInput();
        lastInput = t;
      }
    });
    const times = r.animator.played.map((p) => p.t);
    expect(times.length).toBeGreaterThanOrEqual(5);
    // A gap is drawn after the last input or behaviour, so behaviour-to-behaviour gaps stay below 20 s.
    for (let i = 1; i < times.length; i += 1) expect(times[i]! - times[i - 1]!).toBeLessThan(20_000);
    expect(new Set(r.animator.played.map((p) => p.gesture))).toEqual(new Set(['stretch', 'fidget', 'glance']));
    expect(r.said).toEqual([]);

    r.animator.played.length = 0;
    r.state.speaking = true;
    await r.run(40_000);
    expect(r.animator.played).toEqual([]);
  });

  it('glances at a real Surface or marker, never at the floor', async () => {
    const table = surface('t', 'table', { x: 0.5, y: 0.7, z: -1.2 });
    const floor = surface('f', 'floor', { x: 0, y: 0, z: 0 });
    const marker = { position: { x: -1, y: 1.4, z: -2 } };
    const r = rig({ surfaces: [floor, table], markers: [marker] });
    await r.run(200_000, (t) => {
      if (t % 30_000 < FRAME_MS) r.wiring.noteInput();
    });
    const glances = r.animator.played.filter((p) => p.gesture === 'glance');
    expect(glances.length).toBeGreaterThan(0);
    for (const g of glances) expect([table.center, marker.position]).toContain(g.target);
  });

  it('treats another gesture as busy, but not its own', async () => {
    const r = rig();
    await r.run(1);
    // A wave someone else started blocks the schedule for as long as it plays.
    void r.animator.play('wave');
    r.animator.played.length = 0;
    const due = r.wiring.scheduler.nextBehaviourAtMs;
    r.clock.set(due + 1);
    r.wiring.update(r.frame);
    expect(r.animator.played).toEqual([]);
  });

  it('fires the ignored reaction once after 60 s without input, through the Persona only', async () => {
    const r = rig();
    await r.run(59_000);
    expect(r.said).toEqual([]);
    await r.run(2_000);
    expect(r.said).toEqual([{ kind: 'idle_ignored' }]);
    expect(r.animator.played.some((p) => p.gesture === 'ignored')).toBe(false);
    await r.run(60_000);
    expect(r.said).toHaveLength(1);
  });

  it('restarts the silence on a pinch edge and on a resolved command', async () => {
    const r = rig();
    await r.run(50_000);
    r.frame.hands.right.pinching = true;
    await r.run(200);
    r.frame.hands.right.pinching = false;
    await r.run(50_000);
    expect(r.said).toEqual([]);
    r.events.emit('intent:resolved', { intent: 'light' });
    await r.run(50_000);
    expect(r.said).toEqual([]);
    await r.run(11_000);
    expect(r.said).toEqual([{ kind: 'idle_ignored' }]);
  });

  it('plays only playful idles while a task runs, and nothing during a hack or a move', async () => {
    const r = rig({ markers: [{ position: { x: 1, y: 1, z: -1 } }] });
    r.state.task = true;
    await r.run(120_000);
    expect(r.animator.played.length).toBeGreaterThan(0);
    expect(r.animator.played.every((p) => p.gesture === 'fidget' || p.gesture === 'glance')).toBe(true);
    expect(r.said).toEqual([]);

    r.state.task = false;
    r.animator.played.length = 0;
    r.state.hack = true;
    await r.run(30_000);
    r.state.hack = false;
    r.state.mode = 'moving';
    await r.run(30_000);
    expect(r.animator.played).toEqual([]);
  });
});
