import { describe, expect, it } from 'vitest';
import { UI_LIMITS, UI_ZONES } from '../../src/config/constants.js';
import { DEG_TO_RAD } from '../../src/domain/geometry.js';
import type { HeadPose } from '../../src/domain/placement.js';
import {
  angleDelta,
  billboardYaw,
  interactionOf,
  isInSeatedZone,
  PANEL_KINDS,
  place,
} from '../../src/domain/ui-placement.js';

const HEAD: HeadPose = { position: { x: 0, y: 1.2, z: 0 }, forward: { x: 0, y: 0, z: -1 } };

describe('place', () => {
  it('puts the device list on the non-dominant side, 1.0 m out at eye height', () => {
    const right = place('device-list', HEAD, 'right').position;
    // Forward is -Z, so the user's right is +X. A right-handed user has the list on the left.
    expect(right.x).toBeLessThan(0);
    expect(Math.hypot(right.x, right.z)).toBeCloseTo(1.0, 6);
    expect(right.y).toBeCloseTo(1.2, 6);
    expect(Math.atan2(-right.x, -right.z) / DEG_TO_RAD).toBeCloseTo(20, 5);
  });
  it('has no mic orb or transcript zone (task 33.6), and no always-visible chips or Quick_Actions (task 33.8)', () => {
    expect(PANEL_KINDS).not.toContain('mic-orb');
    expect(PANEL_KINDS).not.toContain('transcript');
    expect(PANEL_KINDS).not.toContain('status-chips');
    expect(PANEL_KINDS).not.toContain('quick-actions');
  });
  it('puts the HUD_Menu straight ahead in the poke zone, below the eyes and leaning up (task 33.8)', () => {
    const pose = place('hud', HEAD, 'right');
    expect(interactionOf('hud')).toBe('poke');
    expect(pose.position.x).toBeCloseTo(0, 9);
    expect(pose.position.z).toBeCloseTo(-UI_ZONES.hud.distanceM, 9);
    expect(pose.position.y).toBeLessThan(HEAD.position.y);
    expect(pose.tiltRad).toBeLessThan(0);
    expect(isInSeatedZone('hud', HEAD, pose)).toBe(true);
  });

  it('mirrors every zone for a left-handed user', () => {
    for (const kind of PANEL_KINDS) {
      const a = place(kind, HEAD, 'right');
      const b = place(kind, HEAD, 'left');
      expect(b.position.x).toBeCloseTo(-a.position.x, 9);
      expect(b.position.z).toBeCloseTo(a.position.z, 9);
      expect(b.position.y).toBeCloseTo(a.position.y, 9);
    }
  });

  it('turns every panel face toward the head and leans only the HUD', () => {
    for (const kind of PANEL_KINDS) {
      const pose = place(kind, HEAD);
      const normalX = Math.sin(pose.yawRad);
      const normalZ = Math.cos(pose.yawRad);
      const toHeadX = HEAD.position.x - pose.position.x;
      const toHeadZ = HEAD.position.z - pose.position.z;
      expect(normalX * toHeadX + normalZ * toHeadZ).toBeGreaterThan(0);
      expect(pose.tiltRad).toBeCloseTo(-UI_ZONES[kind].tiltDeg * DEG_TO_RAD, 9);
    }
    expect(place('hud', HEAD).tiltRad).toBeLessThan(0);
  });

  it('follows the head position and horizontal forward, ignoring pitch', () => {
    const head: HeadPose = { position: { x: 2, y: 1.5, z: -3 }, forward: { x: 1, y: -0.8, z: 0 } };
    const pose = place('task-panel', head);
    // 1.2 m along the yaw of +X, turned 30 degrees toward the right (+Z for a +X forward).
    expect(pose.position.x).toBeCloseTo(2 + 1.2 * Math.cos(30 * DEG_TO_RAD), 6);
    expect(pose.position.z).toBeCloseTo(-3 + 1.2 * Math.sin(30 * DEG_TO_RAD), 6);
    expect(pose.position.y).toBeCloseTo(1.5, 6);
  });

  it('keeps poke panels 0.35 to 0.8 m away, ray panels under 1.6 m, all inside the view cone', () => {
    for (const kind of PANEL_KINDS) {
      const pose = place(kind, HEAD);
      const d = Math.hypot(pose.position.x, pose.position.y - HEAD.position.y, pose.position.z);
      if (interactionOf(kind) === 'poke') {
        expect(d).toBeGreaterThanOrEqual(UI_LIMITS.pokeMinM);
        expect(d).toBeLessThanOrEqual(UI_LIMITS.pokeMaxM);
      }
      expect(d).toBeLessThanOrEqual(UI_LIMITS.rayMaxM);
      expect(isInSeatedZone(kind, HEAD, pose)).toBe(true);
    }
  });

  it('uses the horizontal fallback forward when the head looks straight down', () => {
    const head: HeadPose = { position: { x: 0, y: 1.2, z: 0 }, forward: { x: 0, y: -1, z: 0 } };
    expect(place('hud', head).position.z).toBeLessThan(0);
  });

  it('flags a panel outside its zone', () => {
    expect(isInSeatedZone('hud', HEAD, { position: { x: 0, y: 1, z: -1.5 }, yawRad: 0, tiltRad: 0 })).toBe(false);
    expect(isInSeatedZone('task-panel', HEAD, { position: { x: 0, y: 1.2, z: 0.9 }, yawRad: 0, tiltRad: 0 })).toBe(false);
  });
});

describe('billboardYaw', () => {
  it('measures the shortest turn across the wrap', () => {
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6, 9);
  });

  it('stays still inside the dead zone and turns at the capped rate outside it', () => {
    expect(billboardYaw(0, 5 * DEG_TO_RAD, 1)).toBe(0);
    expect(billboardYaw(0, 1, 0.2, 0.5, 12)).toBeCloseTo(0.1, 9);
    expect(billboardYaw(0, -1, 0.2, 0.5, 12)).toBeCloseTo(-0.1, 9);
  });

  it('never overshoots the target', () => {
    expect(billboardYaw(0, 0.5, 10, 0.5, 12)).toBeCloseTo(0.5, 9);
  });
});
