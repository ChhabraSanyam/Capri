import { describe, expect, it } from 'vitest';
import { createFrameContext, type FrameContext } from '../../src/app/frame-context.js';
import { ok, type LightEntity } from '../../src/backends/types.js';
import { CORE_JOINT, JOINT_FLOATS } from '../../src/config/constants.js';
import { DeviceRegistry } from '../../src/domain/devices/registry.js';
import { TeachFlow } from '../../src/domain/devices/teach-flow.js';
import { rayHitsPanel, type PanelRect } from '../../src/domain/devices/teach-input.js';
import { capturePointInto, type CaptureSource } from '../../src/domain/pointing/capture.js';
import { rawPointingRay as pointingRay } from '../../src/domain/pointing/ray.js';
import type { Ray, Vec3 } from '../../src/domain/geometry.js';
import type { Surface } from '../../src/domain/surfaces.js';
import { createLexicon } from '../../src/domain/speech-lang/lexicon.js';
import { TeachController, type PointerView, type PointSource, type PreviewMarker } from '../../src/ui/teach-controller.js';

type Side = 'left' | 'right';

function setJoint(joints: Float32Array, slot: number, p: Vec3): void {
  joints[slot * JOINT_FLOATS] = p.x;
  joints[slot * JOINT_FLOATS + 1] = p.y;
  joints[slot * JOINT_FLOATS + 2] = p.z;
}

/** A hand whose index finger points along -Z from `tip`, with the thumb pinched or open. */
function pose(frame: FrameContext, side: Side, tip: Vec3, pinched: boolean): void {
  const hand = frame.hands[side];
  hand.tracked = true;
  setJoint(hand.joints, CORE_JOINT.indexTip, tip);
  setJoint(hand.joints, CORE_JOINT.indexProximal, { x: tip.x, y: tip.y, z: tip.z + 0.05 });
  setJoint(hand.joints, CORE_JOINT.thumbTip, { x: tip.x, y: tip.y - (pinched ? 0.01 : 0.08), z: tip.z });
}

const TIP: Vec3 = { x: 0.2, y: 1.0, z: -0.3 };
const LEFT_TIP: Vec3 = { x: -0.2, y: 1.0, z: -0.3 };
const LAMP_WALL: Surface = {
  id: 'wall',
  label: 'wall',
  rawLabel: 'WALL_FACE',
  center: { x: 0.2, y: 1.0, z: -3 },
  normal: { x: 0, y: 0, z: 1 },
  halfExtents: { x: 2, z: 0.0 },
  topY: 3,
};
const LIGHTS: LightEntity[] = ['mock.bulb_1', 'mock.bulb_2'].map((entityId, i) => ({
  entityId,
  friendlyName: i === 0 ? 'Bulb one' : 'Bulb two',
  supportsColor: true,
  state: { entityId, on: false, brightnessPct: 100, rgb: [255, 255, 255] },
}));

function setup(panel?: PanelRect) {
  const registry = new DeviceRegistry();
  const flow = new TeachFlow({
    registry,
    lexicon: createLexicon('bulb one two'.split(' ')),
    listLights: () => Promise.resolve(ok(LIGHTS)),
  });
  const activeLog: boolean[] = [];
  const captures: Ray[] = [];
  const points: PointSource = {
    setActive: (a) => activeLog.push(a),
    captureInto: (out, ray, surfaces, head) => {
      captures.push({ origin: { ...ray.origin }, direction: { ...ray.direction } });
      return capturePointInto(out, ray, surfaces, head);
    },
  };
  const pointer = {
    visible: false,
    tip: undefined as Vec3 | undefined,
    point: undefined as Vec3 | undefined,
    source: undefined as CaptureSource | undefined,
  };
  const pointerView: PointerView = {
    show: (tip, point, source) => {
      pointer.visible = true;
      pointer.tip = { ...tip };
      pointer.point = { ...point };
      pointer.source = source;
    },
    hide: () => {
      pointer.visible = false;
    },
  };
  const preview = { visible: false, position: undefined as Vec3 | undefined };
  const marker: PreviewMarker = {
    setPosition: (p) => {
      preview.position = p;
    },
    setVisible: (v) => {
      preview.visible = v;
    },
  };
  const controller = new TeachController({
    flow,
    points,
    getSurfaces: () => [LAMP_WALL],
    getPanelRect: () => panel,
    preview: marker,
    pointer: pointerView,
  });
  const frame = createFrameContext();
  frame.head.position.set([0, 1.6, 0.3]);
  const tick = (right: boolean, left = false): void => {
    pose(frame, 'right', TIP, right);
    pose(frame, 'left', LEFT_TIP, left);
    controller.update(frame);
  };
  return { flow, registry, controller, frame, tick, activeLog, captures, preview, pointer };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('pointingRay and rayHitsPanel', () => {
  it('points from the proximal joint through the tip', () => {
    const frame = createFrameContext();
    pose(frame, 'right', TIP, false);
    const ray = pointingRay(frame.hands.right.joints)!;
    expect(ray.origin).toEqual(expect.objectContaining({ x: expect.closeTo(0.2), z: expect.closeTo(-0.3) }));
    expect(ray.direction.z).toBeCloseTo(-1);
  });

  it('returns undefined for a finger with no length', () => {
    const joints = new Float32Array(24);
    expect(pointingRay(joints)).toBeUndefined();
  });

  const panel: PanelRect = { center: { x: 0, y: 1, z: -1 }, yawRad: 0, halfWidthM: 0.25, halfHeightM: 0.3 };
  it('hits a ray through the rectangle and misses one beside, behind, or above it', () => {
    const forward = { x: 0, y: 0, z: -1 };
    expect(rayHitsPanel({ origin: { x: 0.1, y: 1, z: 0 }, direction: forward }, panel, 0.04)).toBe(true);
    expect(rayHitsPanel({ origin: { x: 0.6, y: 1, z: 0 }, direction: forward }, panel, 0.04)).toBe(false);
    expect(rayHitsPanel({ origin: { x: 0, y: 1.6, z: 0 }, direction: forward }, panel, 0.04)).toBe(false);
    expect(rayHitsPanel({ origin: { x: 0, y: 1, z: -2 }, direction: forward }, panel, 0.04)).toBe(false);
    expect(rayHitsPanel({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, panel, 0.04)).toBe(false);
  });

  it('treats a fingertip touching the panel as a hit even when it points along the panel', () => {
    expect(rayHitsPanel({ origin: { x: 0, y: 1, z: -0.97 }, direction: { x: 1, y: 0, z: 0 } }, panel, 0.04)).toBe(true);
  });

  it('follows the panel yaw', () => {
    const turned: PanelRect = { ...panel, yawRad: Math.PI / 2 }; // normal along +X
    expect(rayHitsPanel({ origin: { x: 1, y: 1, z: -1 }, direction: { x: -1, y: 0, z: 0 } }, turned, 0.04)).toBe(true);
    expect(rayHitsPanel({ origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } }, turned, 0.04)).toBe(false);
  });
});

describe('TeachController', () => {
  it('captures on the pinch start only, runs the point source only while awaiting a point', async () => {
    const t = setup();
    t.tick(true); // pinch with the flow idle: nothing happens
    t.tick(false);
    expect(t.flow.state.kind).toBe('idle');
    expect(t.captures).toHaveLength(0);
    expect(t.pointer.visible).toBe(false);

    t.flow.start();
    expect(t.activeLog[t.activeLog.length - 1]).toBe(true);
    t.tick(false);
    // The pointer shows a ray from the fingertip to the reticle on the wall.
    expect(t.pointer).toMatchObject({ visible: true, source: 'surface' });
    expect(t.pointer.tip!.z).toBeCloseTo(TIP.z, 5);
    expect(t.pointer.point!.z).toBeCloseTo(-2.98, 5);
    expect(t.controller.pointerFallbackM).toBeUndefined();
    t.tick(true); // pinch start stores the reticle point
    expect(t.flow.state).toMatchObject({ kind: 'pickEntity', source: 'surface' });
    expect(t.activeLog[t.activeLog.length - 1]).toBe(false);
    expect(t.preview.visible).toBe(true);
    expect(t.pointer.visible).toBe(false);
    expect((t.flow.state as { position: Vec3 }).position.z).toBeCloseTo(-2.98, 5);
    const calls = t.captures.length;
    t.tick(true); // still held: no more captures
    expect(t.captures).toHaveLength(calls);
    await settle();
  });

  it('stores the reticle point from before the pinch, not where the bent finger points', async () => {
    const t = setup();
    t.flow.start();
    for (let i = 0; i < 30; i += 1) {
      t.frame.time += 1 / 72;
      t.tick(false); // aimed at the wall
    }
    const aimed = { ...t.pointer.point! };
    // Pinching bends the finger: the ray now points straight down, at nothing.
    t.frame.time += 1 / 72;
    pose(t.frame, 'right', TIP, true);
    setJoint(t.frame.hands.right.joints, CORE_JOINT.indexProximal, { x: TIP.x, y: TIP.y + 0.05, z: TIP.z });
    t.controller.update(t.frame);
    expect(t.flow.state).toMatchObject({ kind: 'pickEntity', source: 'surface' });
    const stored = (t.flow.state as { position: Vec3 }).position;
    expect(stored).toEqual(aimed);
    expect(Math.hypot(stored.x - TIP.x, stored.y - TIP.y, stored.z - TIP.z)).toBeGreaterThan(0.05);
    await settle();
  });

  it('reports the fallback distance while nothing is hit, so the panel can offer Nearer and Farther', () => {
    const t = setup();
    t.flow.start();
    pose(t.frame, 'right', TIP, false);
    setJoint(t.frame.hands.right.joints, CORE_JOINT.indexProximal, { x: TIP.x, y: TIP.y - 0.05, z: TIP.z });
    t.controller.update(t.frame);
    expect(t.pointer).toMatchObject({ visible: true, source: 'fallback' });
    expect(t.pointer.point!.y).toBeCloseTo(TIP.y + 2, 5);
    expect(t.controller.pointerFallbackM).toBe(2);
    t.flow.cancel();
    expect(t.pointer.visible).toBe(false);
    expect(t.controller.pointerFallbackM).toBeUndefined();
  });

  it('confirms a fallback point with a second dominant pinch and retakes with the other hand', async () => {
    const t = setup();
    t.flow.start();
    // Aim at the sky so no surface is hit. Use a ray that points up and away.
    t.frame.hands.right.tracked = true;
    pose(t.frame, 'right', { x: 0.2, y: 1, z: -0.3 }, false);
    setJoint(t.frame.hands.right.joints, CORE_JOINT.indexProximal, { x: 0.2, y: 0.95, z: -0.3 });
    t.controller.update(t.frame);
    pose(t.frame, 'right', { x: 0.2, y: 1, z: -0.3 }, true);
    setJoint(t.frame.hands.right.joints, CORE_JOINT.indexProximal, { x: 0.2, y: 0.95, z: -0.3 });
    t.controller.update(t.frame);
    expect(t.flow.state.kind).toBe('captured');
    expect(t.preview.visible).toBe(true);

    t.tick(false);
    t.tick(true);
    expect(t.flow.state.kind).toBe('pickEntity'); // confirmed by pinching again

    t.flow.retake();
    t.flow.capture({ position: { x: 0, y: 1, z: -2 }, source: 'fallback', distanceM: 2 }, { origin: TIP, direction: { x: 0, y: 0, z: -1 } });
    expect(t.flow.state.kind).toBe('captured');
    t.tick(false, false);
    t.tick(false, true); // other hand pinch
    expect(t.flow.state.kind).toBe('awaitPoint');
    await settle();
  });

  it('picks a light with own-pinch only: other hand moves the highlight, dominant hand chooses', async () => {
    const t = setup();
    t.flow.start();
    t.tick(false);
    t.tick(true); // capture the wall
    await settle();
    expect(t.flow.choiceCount()).toBe(2);
    t.tick(false);
    t.tick(false, true); // other hand: highlight row 1
    expect((t.flow.state as { highlight: number }).highlight).toBe(1);
    t.tick(false, false);
    t.tick(true, false); // dominant hand: choose it
    expect(t.flow.state.kind).toBe('stored');
    expect(t.registry.all()[0]).toMatchObject({ entityId: 'mock.bulb_2', name: 'bulb two' });
    expect(t.preview.visible).toBe(false);
    t.tick(false);
    t.tick(true); // pinch again dismisses the stored message
    expect(t.flow.state.kind).toBe('idle');
  });

  it('leaves a pinch aimed at the panel to its buttons', () => {
    // The panel sits straight in front of the dominant fingertip.
    const panel: PanelRect = { center: { x: 0.2, y: 1, z: -0.6 }, yawRad: 0, halfWidthM: 0.26, halfHeightM: 0.34 };
    const t = setup(panel);
    t.flow.start();
    t.tick(false);
    t.tick(true);
    expect(t.flow.state.kind).toBe('awaitPoint');
  });

  it('stops the point source and hides the preview on dispose', () => {
    const t = setup();
    t.flow.start();
    t.controller.dispose();
    expect(t.activeLog[t.activeLog.length - 1]).toBe(false);
    expect(t.preview.visible).toBe(false);
    t.flow.cancel();
    t.flow.start();
    expect(t.activeLog.filter((a) => a).length).toBe(1); // no longer subscribed
  });
});
