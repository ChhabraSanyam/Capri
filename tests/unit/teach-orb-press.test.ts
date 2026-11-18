/**
 * Task 32.2: the teach orb no longer catches stray pinches (Requirements 12.13, 23.12) and
 * push-to-talk keeps working while the teach flow is open (Requirements 15.6, 15.7).
 */
import { describe, expect, it } from 'vitest';
import { createFrameContext } from '../../src/app/frame-context.js';
import { TalkGesture } from '../../src/app/talk-gesture.js';
import { ok, type LightEntity } from '../../src/backends/types.js';
import { CORE_JOINT, JOINT_FLOATS, TEACH_ORB } from '../../src/config/constants.js';
import { DeviceRegistry } from '../../src/domain/devices/registry.js';
import { TeachFlow } from '../../src/domain/devices/teach-flow.js';
import {
  isTeachOrbVisible,
  OrbPressDetector,
  TEACH_ORB_PRESS,
  type OrbHands,
} from '../../src/domain/devices/teach-orb.js';
import { buildTeachView, TEACH_TALK_HINT, teachUsesOtherPinch } from '../../src/domain/devices/teach-view.js';
import type { Vec3 } from '../../src/domain/geometry.js';
import { PinchTracker } from '../../src/domain/pointing/pinch.js';
import { createLexicon } from '../../src/domain/speech-lang/lexicon.js';
import { TeachController } from '../../src/ui/teach-controller.js';
import { FakeHandSource } from '../../src/xr/fake-hands.js';

const DT = 1 / 60;

describe('teach orb visibility per mode', () => {
  const shown = { inSession: true, avatarPresent: true, teachIdle: true };
  it('is hidden in Mock Mode and shown in Live Mode', () => {
    expect(isTeachOrbVisible({ ...shown, home: 'mock' })).toBe(false);
    expect(isTeachOrbVisible({ ...shown, home: 'live' })).toBe(true);
  });
  it('is hidden in Live Mode outside a session, without the Avatar, or while teach runs', () => {
    expect(isTeachOrbVisible({ ...shown, home: 'live', inSession: false })).toBe(false);
    expect(isTeachOrbVisible({ ...shown, home: 'live', avatarPresent: false })).toBe(false);
    expect(isTeachOrbVisible({ ...shown, home: 'live', teachIdle: false })).toBe(false);
  });
});

/** A hand whose index finger points along `along` from `tip`, pinched or open. */
function hand(tip: Vec3, pinched: boolean, along: Vec3 = { x: 0, y: 0, z: -1 }) {
  const joints = new Float32Array(30 * JOINT_FLOATS);
  const set = (slot: number, p: Vec3): void => {
    joints[slot * JOINT_FLOATS] = p.x;
    joints[slot * JOINT_FLOATS + 1] = p.y;
    joints[slot * JOINT_FLOATS + 2] = p.z;
  };
  set(CORE_JOINT.indexTip, tip);
  set(CORE_JOINT.indexProximal, { x: tip.x - along.x * 0.05, y: tip.y - along.y * 0.05, z: tip.z - along.z * 0.05 });
  set(CORE_JOINT.thumbTip, { x: tip.x, y: tip.y - (pinched ? 0.01 : 0.08), z: tip.z });
  return { tracked: true, joints };
}

const OFF = { tracked: false, joints: new Float32Array(30 * JOINT_FLOATS) };
const right = (h: ReturnType<typeof hand>): OrbHands => ({ left: OFF, right: h });

describe('teach orb press: poke or dwell ray-pinch only', () => {
  const orb: Vec3 = { x: 0, y: 1.2, z: -1.5 };
  /** The ray from here goes straight through the orb centre. */
  const onTip: Vec3 = { x: 0, y: 1.2, z: -0.2 };
  /** 10 cm to the side: inside the old 0.12 m aim sphere, outside the orb's own 0.08 m volume. */
  const nearTip: Vec3 = { x: 0.1, y: 1.2, z: -0.2 };
  /** Aimed at a bulb well away from the orb. */
  const bulbDir: Vec3 = { x: 0.6, y: 0, z: -0.8 };

  function rig() {
    const d = new OrbPressDetector(TEACH_ORB_PRESS);
    let t = 0;
    let presses = 0;
    let firstPressAt: number | undefined;
    const run = (seconds: number, h: ReturnType<typeof hand>): void => {
      const frames = Math.round(seconds / DT);
      for (let i = 0; i < frames; i += 1) {
        t += DT;
        if (d.update(right(h), orb, true, t)) {
          presses += 1;
          firstPressAt ??= t;
        }
      }
    };
    return {
      run,
      get presses() {
        return presses;
      },
      get firstPressAt() {
        return firstPressAt;
      },
      get t() {
        return t;
      },
    };
  }

  it('opens on a pinch after the ray has stayed on the orb for the dwell', () => {
    const r = rig();
    r.run(TEACH_ORB.rayDwellS + 0.1, hand(onTip, false));
    expect(r.presses).toBe(0);
    r.run(0.1, hand(onTip, true));
    expect(r.presses).toBe(1);
  });

  it('opens when the pinch starts on the orb and is held there until the dwell is over, not before', () => {
    const r = rig();
    r.run(0.05, hand(onTip, false));
    const pinchAt = r.t;
    r.run(TEACH_ORB.rayDwellS + 0.2, hand(onTip, true));
    expect(r.presses).toBe(1);
    expect(r.firstPressAt! - pinchAt).toBeGreaterThan(TEACH_ORB.rayDwellS - 0.1);
  });

  it('keeps the dwell across slow frames longer than the grace', () => {
    const d = new OrbPressDetector(TEACH_ORB_PRESS);
    const slow = TEACH_ORB.rayGraceS + 0.05;
    let t = 0;
    for (let i = 0; i < 4; i += 1) expect(d.update(right(hand(onTip, false)), orb, true, (t += slow))).toBe(false);
    expect(d.update(right(hand(onTip, true)), orb, true, (t += slow))).toBe(true);
  });

  it('ignores a pinch released before the dwell is over', () => {
    const r = rig();
    r.run(0.05, hand(onTip, false));
    r.run(0.1, hand(onTip, true));
    r.run(0.5, hand(onTip, false));
    expect(r.presses).toBe(0);
  });

  it('ignores a pinch whose ray only passes near the orb, however long it dwells', () => {
    const r = rig();
    r.run(1, hand(nearTip, false));
    r.run(1, hand(nearTip, true));
    expect(r.presses).toBe(0);
  });

  it('ignores a pinch aimed at a bulb, and a ray that sweeps across the orb while pinched', () => {
    const r = rig();
    r.run(0.5, hand(onTip, false, bulbDir));
    r.run(0.3, hand(onTip, true, bulbDir));
    // Still pinched, the ray crosses the orb for a moment and leaves.
    r.run(0.1, hand(onTip, true));
    r.run(0.5, hand(onTip, true, bulbDir));
    r.run(0.1, hand(onTip, false, bulbDir));
    // A new pinch that starts while sweeping across: too short on the orb.
    r.run(0.05, hand(onTip, true));
    r.run(0.5, hand(onTip, true, bulbDir));
    expect(r.presses).toBe(0);
  });

  it('opens on a fingertip poke, once per touch', () => {
    const r = rig();
    const touching = { x: orb.x, y: orb.y, z: orb.z + TEACH_ORB.pokeRadiusM / 2 };
    r.run(0.1, hand(touching, false, bulbDir));
    expect(r.presses).toBe(1);
  });

  it('keeps the mic orb behaviour by default: a pinch on the aim sphere presses at once', () => {
    const d = new OrbPressDetector();
    d.update(right(hand(nearTip, false)), orb, true);
    expect(d.update(right(hand(nearTip, true)), orb, true)).toBe(true);
  });
});

describe('push-to-talk while the teach flow is open', () => {
  const LIGHTS: LightEntity[] = [
    {
      entityId: 'mock.bulb_1',
      friendlyName: 'Bulb one',
      supportsColor: true,
      state: { entityId: 'mock.bulb_1', on: false, brightnessPct: 100, rgb: [255, 255, 255] },
    },
  ];

  function rig() {
    const flow = new TeachFlow({
      registry: new DeviceRegistry(),
      lexicon: createLexicon(['bulb', 'one']),
      listLights: () => Promise.resolve(ok(LIGHTS)),
    });
    const controller = new TeachController({
      flow,
      points: { setActive: () => undefined, capture: () => ({ position: { x: 0, y: 1, z: -2 }, source: 'fallback', distanceM: 2 }) },
      getSurfaces: () => [],
      getPanelRect: () => undefined,
    });
    const frame = createFrameContext();
    frame.inSession = true;
    frame.dt = DT;
    const hands = new FakeHandSource();
    const tracker = new PinchTracker();
    const gesture = new TalkGesture();
    const edges: string[] = [];
    const run = (n: number, pose: 'point' | 'point-pinch'): void => {
      hands.setHand('left', { pose, target: { x: -0.2, y: 1.15, z: -2 } });
      for (let i = 0; i < n; i += 1) {
        frame.time += DT;
        hands.read(frame);
        tracker.update(frame.hands);
        const edge = gesture.update(frame, 'left', !controller.ownsOtherPinch, () => ({ panels: [], orbCenter: undefined }));
        if (edge !== undefined) edges.push(edge);
      }
    };
    return { flow, controller, edges, run };
  }

  it('starts on the non-dominant pinch while teach waits for a point', () => {
    const r = rig();
    r.flow.start('teach');
    expect(r.flow.state.kind).toBe('awaitPoint');
    expect(r.controller.ownsOtherPinch).toBe(false);
    r.run(20, 'point');
    r.run(10, 'point-pinch');
    r.run(10, 'point');
    expect(r.edges).toEqual(['start', 'end']);
  });

  it('shows how to talk, with Cancel visible, in the steps that use the non-dominant pinch', () => {
    const r = rig();
    r.flow.start('teach');
    const ray = { origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
    r.flow.capture({ position: { x: 0, y: 1, z: -2 }, source: 'fallback', distanceM: 2 }, ray);
    expect(r.flow.state.kind).toBe('captured');
    expect(r.controller.ownsOtherPinch).toBe(true);
    const view = buildTeachView(r.flow.state, []);
    expect(view.talkHint).toBe(TEACH_TALK_HINT);
    expect(view.talkHint).toMatch(/mic orb/);
    expect(view.cancel.visible).toBe(true);
    for (const kind of ['idle', 'awaitPoint', 'stored'] as const) expect(teachUsesOtherPinch(kind)).toBe(false);
    for (const kind of ['captured', 'pickEntity', 'pickNickname'] as const) expect(teachUsesOtherPinch(kind)).toBe(true);
  });
});
