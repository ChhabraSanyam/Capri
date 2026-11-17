import { describe, expect, it } from 'vitest';
import { CORE_JOINT, JOINT_FLOATS, TRACKED_JOINT_COUNT, VOICE_UI } from '../../src/config/constants.js';
import type { Vec3 } from '../../src/domain/geometry.js';
import { keyboardLayout, quickActionsLayout } from '../../src/domain/panel-layout.js';
import {
  cellAt,
  PanelPressDetector,
  PressDebouncer,
  rayCell,
  toPanelLocal,
  type PanelFrame,
  type PressPanel,
} from '../../src/domain/panel-press.js';

interface FakeHand {
  tracked: boolean;
  joints: Float32Array;
}

/** A hand whose index tip is at `tip`, pointing along `dir`, with the thumb either on the tip or far away. */
function hand(tip: Vec3, dir: Vec3 = { x: 0, y: 0, z: -1 }, pinched = false): FakeHand {
  const joints = new Float32Array(TRACKED_JOINT_COUNT * JOINT_FLOATS);
  const set = (slot: number, x: number, y: number, z: number): void => {
    joints[slot * JOINT_FLOATS] = x;
    joints[slot * JOINT_FLOATS + 1] = y;
    joints[slot * JOINT_FLOATS + 2] = z;
  };
  set(CORE_JOINT.indexTip, tip.x, tip.y, tip.z);
  set(CORE_JOINT.indexProximal, tip.x - dir.x * 0.04, tip.y - dir.y * 0.04, tip.z - dir.z * 0.04);
  set(CORE_JOINT.thumbTip, tip.x + (pinched ? 0.008 : 0.08), tip.y, tip.z);
  return { tracked: true, joints };
}

const UNTRACKED: FakeHand = { tracked: false, joints: new Float32Array(TRACKED_JOINT_COUNT * JOINT_FLOATS) };

const FLAT: PanelFrame = { center: { x: 0, y: 1.2, z: -0.5 }, yawRad: 0, tiltRad: 0 };

function panel(id: string, frame: PanelFrame, layout = quickActionsLayout(true), shown = true): PressPanel {
  return { id, frame, layout, shown };
}

/** World position of a point `(x, y, depth)` in a panel's frame, written from the rotation matrix. */
function worldOf(frame: PanelFrame, x: number, y: number, depth: number): Vec3 {
  const sy = Math.sin(frame.yawRad);
  const cy = Math.cos(frame.yawRad);
  const st = Math.sin(frame.tiltRad);
  const ct = Math.cos(frame.tiltRad);
  const right = { x: cy, y: 0, z: -sy };
  const up = { x: st * sy, y: ct, z: st * cy };
  const normal = { x: ct * sy, y: -st, z: ct * cy };
  return {
    x: frame.center.x + right.x * x + up.x * y + normal.x * depth,
    y: frame.center.y + right.y * x + up.y * y + normal.y * depth,
    z: frame.center.z + right.z * x + up.z * y + normal.z * depth,
  };
}

function cellCenter(layout: ReturnType<typeof quickActionsLayout>, id: string) {
  const c = layout.cells.find((cell) => cell.id === id);
  if (c === undefined) throw new Error(id);
  return c;
}

describe('toPanelLocal', () => {
  it('inverts the panel frame for a yawed and tilted panel', () => {
    const frame: PanelFrame = { center: { x: 0.3, y: 0.9, z: -0.4 }, yawRad: 0.7, tiltRad: -0.43 };
    const world = worldOf(frame, 0.05, -0.08, 0.02);
    const local = toPanelLocal(frame, world.x, world.y, world.z);
    expect(local.x).toBeCloseTo(0.05, 9);
    expect(local.y).toBeCloseTo(-0.08, 9);
    expect(local.depth).toBeCloseTo(0.02, 9);
  });
});

describe('cellAt and rayCell', () => {
  const layout = quickActionsLayout(true);

  it('picks the nearest cell within the margin and none beyond it', () => {
    const c = cellCenter(layout, 'qa-dim');
    expect(cellAt(layout, c.x, c.y, 0)).toBe('qa-dim');
    expect(cellAt(layout, c.x + c.halfW + 0.003, c.y, VOICE_UI.cellMarginM)).toBeDefined();
    expect(cellAt(layout, 0, layout.halfH + 0.1, VOICE_UI.cellMarginM)).toBeUndefined();
  });

  it('hits the button a ray passes through, from a distance', () => {
    const c = cellCenter(layout, 'qa-brighten');
    const target = worldOf(FLAT, c.x, c.y, 0);
    const origin = { x: 0.1, y: 1.1, z: 0.3 };
    const d = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z };
    const len = Math.hypot(d.x, d.y, d.z);
    const ray = { origin, direction: { x: d.x / len, y: d.y / len, z: d.z / len } };
    expect(rayCell(ray, FLAT, layout, 0)).toBe('qa-brighten');
  });

  it('misses a ray that points away from the panel or runs parallel to it', () => {
    const away = { origin: { x: 0, y: 1.2, z: 0 }, direction: { x: 0, y: 0, z: 1 } };
    expect(rayCell(away, FLAT, layout, 0.01)).toBeUndefined();
    const parallel = { origin: { x: 0, y: 1.2, z: 0 }, direction: { x: 1, y: 0, z: 0 } };
    expect(rayCell(parallel, FLAT, layout, 0.01)).toBeUndefined();
  });
});

describe('PanelPressDetector', () => {
  const layout = quickActionsLayout(true);

  function setup() {
    const detector = new PanelPressDetector();
    const panels = [panel('quick-actions', FLAT, layout)];
    let time = 0;
    const step = (right: FakeHand, left: FakeHand = UNTRACKED, list: readonly PressPanel[] = panels) => {
      time += 1 / 60;
      const press = detector.update({ left, right }, list, time);
      return press === undefined ? undefined : { ...press };
    };
    return { detector, panels, step };
  }

  it('presses a button with a ray pinch aimed at it', () => {
    const { step } = setup();
    const c = cellCenter(layout, 'qa-turn_off');
    const target = worldOf(FLAT, c.x, c.y, 0);
    const tip = { x: target.x, y: target.y, z: target.z + 0.25 };
    expect(step(hand(tip))).toBeUndefined();
    expect(step(hand(tip, { x: 0, y: 0, z: -1 }, true))).toEqual({
      panelId: 'quick-actions',
      cellId: 'qa-turn_off',
      via: 'pinch',
    });
    // Holding the pinch does not press again.
    expect(step(hand(tip, { x: 0, y: 0, z: -1 }, true))).toBeUndefined();
  });

  it('aims a pinch with the ray from before the finger bent to close the pinch', () => {
    const { step } = setup();
    const c = cellCenter(layout, 'qa-brighten');
    const target = worldOf(FLAT, c.x, c.y, 0);
    const tip = { x: target.x, y: target.y, z: target.z + 0.25 };
    for (let i = 0; i < 30; i += 1) expect(step(hand(tip))).toBeUndefined();
    // On the pinch frame the index bends: the tip drops and the ray points at the floor.
    const bent = hand({ x: tip.x, y: tip.y - 0.03, z: tip.z }, { x: 0, y: -0.9, z: -0.4 }, true);
    expect(step(bent)?.cellId).toBe('qa-brighten');
  });

  it('presses a button with a fingertip poke, once, until the finger leaves', () => {
    const { step } = setup();
    const c = cellCenter(layout, 'qa-go_away');
    const at = (depth: number) => hand(worldOf(FLAT, c.x, c.y, depth));
    expect(step(at(0.1))).toBeUndefined();
    expect(step(at(0.01))).toEqual({ panelId: 'quick-actions', cellId: 'qa-go_away', via: 'poke' });
    expect(step(at(0.0))).toBeUndefined();
    expect(step(at(0.04))).toBeUndefined();
    expect(step(at(0.01))).toBeUndefined();
    expect(step(at(0.1))).toBeUndefined();
    expect(step(at(0.01))?.cellId).toBe('qa-go_away');
  });

  it('works with the left hand too', () => {
    const { step } = setup();
    const c = cellCenter(layout, 'qa-keyboard');
    const press = step(UNTRACKED, hand(worldOf(FLAT, c.x, c.y, 0.005)));
    expect(press?.cellId).toBe('qa-keyboard');
  });

  it('ignores a poke between buttons, a hidden panel, and a fingertip behind the panel', () => {
    const { step, panels } = setup();
    expect(step(hand(worldOf(FLAT, 0, layout.halfH + 0.05, 0.005)))).toBeUndefined();
    const c = cellCenter(layout, 'qa-dim');
    const hidden = [panel('quick-actions', FLAT, layout, false)];
    expect(step(UNTRACKED)).toBeUndefined();
    expect(step(hand(worldOf(FLAT, c.x, c.y, 0.005)), UNTRACKED, hidden)).toBeUndefined();
    expect(step(UNTRACKED, UNTRACKED, panels)).toBeUndefined();
    expect(step(hand(worldOf(FLAT, c.x, c.y, -0.2)))).toBeUndefined();
  });

  it('does not count a pinch that starts while the same hand is poking as a second press', () => {
    const { step } = setup();
    const c = cellCenter(layout, 'qa-dim');
    const p = worldOf(FLAT, c.x, c.y, 0.005);
    expect(step(hand(p))?.via).toBe('poke');
    expect(step(hand(p, { x: 0, y: 0, z: -1 }, true))).toBeUndefined();
  });

  it('presses a key on the tilted keyboard by poke and by ray pinch', () => {
    const kbFrame: PanelFrame = { center: { x: 0.1, y: 0.9, z: -0.4 }, yawRad: 0.2, tiltRad: -0.436 };
    const kb = keyboardLayout();
    const q = cellCenter(kb, 'key-q');
    const detector = new PanelPressDetector();
    const panels = [panel('hand-keyboard', kbFrame, kb)];
    expect(detector.update({ left: UNTRACKED, right: hand(worldOf(kbFrame, q.x, q.y, 0.1)) }, panels, 0)).toBeUndefined();
    const poke = detector.update({ left: UNTRACKED, right: hand(worldOf(kbFrame, q.x, q.y, 0.01)) }, panels, 0.02);
    expect(poke?.cellId).toBe('key-q');

    const s = cellCenter(kb, 'key-send');
    const from = worldOf(kbFrame, s.x, s.y, 0.3);
    const to = worldOf(kbFrame, s.x, s.y, 0);
    const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const len = Math.hypot(d.x, d.y, d.z);
    const dir = { x: d.x / len, y: d.y / len, z: d.z / len };
    const other = new PanelPressDetector();
    expect(other.update({ left: UNTRACKED, right: hand(from, dir) }, panels, 0)).toBeUndefined();
    expect(other.update({ left: UNTRACKED, right: hand(from, dir, true) }, panels, 0.02)?.cellId).toBe('key-send');
  });

  it('forgets state on reset', () => {
    const { detector, step } = setup();
    const c = cellCenter(layout, 'qa-dim');
    const p = worldOf(FLAT, c.x, c.y, 0.005);
    expect(step(hand(p))?.cellId).toBe('qa-dim');
    detector.reset();
    expect(step(hand(p))?.cellId).toBe('qa-dim');
  });
});

describe('PressDebouncer', () => {
  it('drops a repeat of the same key inside the window and lets other keys and later presses through', () => {
    const d = new PressDebouncer(0.15);
    expect(d.accept('qa:turn_on', 1)).toBe(true);
    expect(d.accept('qa:turn_on', 1.1)).toBe(false);
    expect(d.accept('qa:dim', 1.1)).toBe(true);
    expect(d.accept('qa:turn_on', 1.2)).toBe(true);
    d.reset();
    expect(d.accept('qa:dim', 1.21)).toBe(true);
  });
});
