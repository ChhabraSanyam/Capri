import { describe, expect, it } from 'vitest';
import { PointingWiring, type PointingView } from '../../src/app/pointing-wiring.js';
import { createFrameContext, type FrameContext } from '../../src/app/frame-context.js';
import { TEACH_ORB } from '../../src/config/constants.js';
import type { PanelRect } from '../../src/domain/devices/teach-input.js';
import type { Vec3 } from '../../src/domain/geometry.js';
import { RayHistory } from '../../src/domain/pointing/ray-history.js';
import { isAimedAtUi } from '../../src/domain/pointing/ui-aim.js';
import { FakeHandSource, type FakeHandCommand } from '../../src/xr/fake-hands.js';
import { createHeadGazeProvider } from '../../src/xr/head.js';

const DT = 1 / 60;
const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];
const A: Vec3 = { x: 0.2, y: 1.15, z: -2.5 };
const B: Vec3 = { x: 0.32, y: 1.15, z: -2.5 };

interface Rig {
  readonly frame: FrameContext;
  readonly hands: FakeHandSource;
  readonly wiring: PointingWiring;
  readonly events: string[];
  readonly looks: (Vec3 | 'user')[];
  readonly highlights: string[];
  ui: { panels: PanelRect[]; orbCenter: Vec3 | undefined };
  /** Advance `n` frames with the right hand at `command`, then return. */
  run(n: number, command: FakeHandCommand | null, confirmAllowed?: boolean): void;
}

function createRig(targets: { id: string; position: Vec3 }[], head: Vec3 = { x: 0.2, y: 1.15, z: 0 }): Rig {
  const frame = createFrameContext();
  frame.inSession = true;
  frame.dt = DT;
  frame.head.position.set([head.x, head.y, head.z]);
  const hands = new FakeHandSource();
  const events: string[] = [];
  const looks: (Vec3 | 'user')[] = [];
  const highlights: string[] = [];
  const view: PointingView = {
    setHighlight: (p, s) => highlights.push(`${p ?? '-'}|${s ?? '-'}`),
    lookAt: (t) => looks.push(t),
  };
  const ui = { panels: [] as PanelRect[], orbCenter: undefined as Vec3 | undefined };
  const wiring = new PointingWiring({
    events: { emit: (name, payload) => events.push(`${String(name)}:${JSON.stringify(payload)}`) },
    hands,
    gaze: createHeadGazeProvider(),
    getTargets: () => targets,
    getUiAim: () => ui,
    view,
    requirePointPose: true,
  });
  const rig: Rig = {
    frame,
    hands,
    wiring,
    events,
    looks,
    highlights,
    ui,
    run(n, command, confirmAllowed = true) {
      hands.setHand('right', command);
      for (let i = 0; i < n; i += 1) {
        frame.time += DT;
        hands.read(frame);
        wiring.update(frame, confirmAllowed);
      }
    },
  };
  return rig;
}

const pointAt = (target: Vec3): FakeHandCommand => ({ pose: 'point', target });
const pinchAt = (target: Vec3): FakeHandCommand => ({ pose: 'point-pinch', target });

describe('PointingWiring', () => {
  it('highlights the pointed device, looks at it, and emits pointed:changed', () => {
    const rig = createRig([{ id: 'a', position: A }]);
    rig.run(10, pointAt(A));
    expect(rig.wiring.pointed).toBe('a');
    expect(rig.events).toEqual(['pointed:changed:{"deviceId":"a"}']);
    expect(last(rig.highlights)).toBe('a|-');
    expect(rig.looks).toEqual([A]);
  });

  it('keeps the highlight for 1 s after pointing away, then clears it and looks back at the user', () => {
    const rig = createRig([{ id: 'a', position: A }]);
    rig.run(10, pointAt(A));
    rig.run(Math.round(0.9 / DT), { pose: 'fist' });
    expect(rig.wiring.pointed).toBe('a');
    rig.run(Math.round(0.3 / DT), { pose: 'fist' });
    expect(rig.wiring.pointed).toBeUndefined();
    expect(last(rig.events)).toBe('pointed:changed:{"deviceId":null}');
    expect(rig.looks).toEqual([A, 'user']);
  });

  it('confirms the pointed device on a dominant pinch and emits selected:changed', () => {
    const rig = createRig([{ id: 'a', position: A }]);
    rig.run(30, pointAt(A));
    rig.run(3, pinchAt(A));
    expect(rig.wiring.selected).toBe('a');
    expect(rig.events).toContain('selected:changed:{"deviceId":"a"}');
    expect(last(rig.highlights)).toBe('a|a');
  });

  it('breaks a tie between two hit volumes with the head gaze', () => {
    const targets = [
      { id: 'a', position: A },
      { id: 'b', position: B },
    ];
    // The ray runs through A, and B is 0.12 m beside it (inside the 0.15 m hit radius).
    const lookingAtB = createRig(targets, { x: B.x, y: 1.15, z: 0 });
    lookingAtB.run(10, pointAt(A));
    expect(lookingAtB.wiring.pointed).toBe('b');
    const lookingAtA = createRig(targets, { x: A.x, y: 1.15, z: 0 });
    lookingAtA.run(10, pointAt(A));
    expect(lookingAtA.wiring.pointed).toBe('a');
  });

  it('does not confirm when the pinch is aimed at a panel or the orb', () => {
    const rig = createRig([{ id: 'a', position: A }]);
    rig.run(30, pointAt(A));
    // A panel in front of the hand, between it and the marker, in the way of the aim ray.
    rig.ui.panels.push({ center: { x: 0.2, y: 1.15, z: -1.2 }, yawRad: 0, halfWidthM: 0.3, halfHeightM: 0.3 });
    rig.run(3, pinchAt(A));
    expect(rig.wiring.selected).toBeUndefined();
    rig.run(3, { pose: 'fist' });

    rig.ui.panels.length = 0;
    rig.ui.orbCenter = { x: 0.2, y: 1.15, z: -1.5 };
    rig.run(30, pointAt(A));
    rig.run(3, pinchAt(A));
    expect(rig.wiring.selected).toBeUndefined();
  });

  it('does not confirm while another flow owns the pinch, but confirms again afterwards', () => {
    const rig = createRig([{ id: 'a', position: A }]);
    rig.run(30, pointAt(A));
    rig.run(3, pinchAt(A), false);
    expect(rig.wiring.selected).toBeUndefined();
    rig.run(3, pointAt(A));
    rig.run(3, pinchAt(A), true);
    expect(rig.wiring.selected).toBe('a');
  });

  it('ignores a pinch from the other hand and a pinch with nothing pointed at', () => {
    const rig = createRig([{ id: 'a', position: A }]);
    rig.run(3, pinchAt(A));
    expect(rig.wiring.selected).toBeUndefined();
    rig.hands.setHand('left', pinchAt(A));
    rig.run(30, pointAt(A));
    expect(rig.wiring.selected).toBeUndefined();
  });

  it('confirms explicitly with confirmPointed', () => {
    const rig = createRig([{ id: 'a', position: A }]);
    expect(rig.wiring.confirmPointed()).toBeUndefined();
    rig.run(10, pointAt(A));
    expect(rig.wiring.confirmPointed()).toBe('a');
    expect(rig.wiring.deictic).toBe('a');
    expect(rig.events).toContain('selected:changed:{"deviceId":"a"}');
  });

  it('clears everything once when the session ends', () => {
    const rig = createRig([{ id: 'a', position: A }]);
    rig.run(10, pointAt(A));
    rig.wiring.confirmPointed();
    rig.frame.inSession = false;
    rig.run(2, pointAt(A));
    expect(rig.wiring.pointed).toBeUndefined();
    expect(rig.wiring.selected).toBeUndefined();
    expect(rig.events.filter((e) => e === 'pointed:changed:{"deviceId":null}')).toHaveLength(1);
    expect(last(rig.looks)).toBe('user');
  });

  it('stops reacting after dispose', () => {
    const rig = createRig([{ id: 'a', position: A }]);
    rig.wiring.dispose();
    rig.run(10, pointAt(A));
    rig.run(3, pinchAt(A));
    expect(rig.events).toEqual([]);
  });
});

describe('isAimedAtUi', () => {
  const ray = { origin: { x: 0, y: 1.2, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
  const panel: PanelRect = { center: { x: 0, y: 1.2, z: -0.8 }, yawRad: 0, halfWidthM: 0.2, halfHeightM: 0.2 };

  it('is true for a ray through a panel or the orb, false otherwise', () => {
    expect(isAimedAtUi(ray, { panels: [panel], orbCenter: undefined })).toBe(true);
    expect(isAimedAtUi(ray, { panels: [], orbCenter: { x: 0, y: 1.2, z: -1 } })).toBe(true);
    expect(isAimedAtUi(ray, { panels: [], orbCenter: undefined })).toBe(false);
    expect(
      isAimedAtUi(ray, { panels: [{ ...panel, center: { x: 1.5, y: 1.2, z: -0.8 } }], orbCenter: undefined }),
    ).toBe(false);
  });

  it('counts a fingertip poking the orb and ignores an orb behind the hand', () => {
    const orb = { x: 0.01, y: 1.2, z: 0.0 };
    expect(isAimedAtUi({ ...ray, direction: { x: 1, y: 0, z: 0 } }, { panels: [], orbCenter: orb })).toBe(true);
    const behind = { x: 0, y: 1.2, z: TEACH_ORB.hitRadiusM * 6 };
    expect(isAimedAtUi(ray, { panels: [], orbCenter: behind })).toBe(false);
  });
});

describe('RayHistory', () => {
  const at = (x: number) => ({ origin: { x, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } });

  it('returns the newest ray at or before the time, else the oldest, and nothing for a gap', () => {
    const h = new RayHistory();
    expect(h.at(1)).toBeUndefined();
    h.record(1, at(1));
    h.record(2, at(2));
    h.record(3, undefined);
    expect(h.at(2.5)?.origin.x).toBe(2);
    expect(h.at(0)?.origin.x).toBe(1);
    expect(h.at(3)).toBeUndefined();
    h.clear();
    expect(h.at(2)).toBeUndefined();
  });

  it('keeps working after the ring wraps', () => {
    const h = new RayHistory();
    for (let i = 0; i < 300; i += 1) h.record(i, at(i));
    expect(h.at(299)?.origin.x).toBe(299);
    expect(h.at(250)?.origin.x).toBe(250);
  });
});
