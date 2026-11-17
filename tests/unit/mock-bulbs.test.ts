import { describe, expect, it } from 'vitest';
import { MOCK_BULB_IDS } from '../../src/backends/mock/mock-home.js';
import { MOCK_BULB_LAYOUT } from '../../src/config/constants.js';
import { bulbLook, BULB_LOOK_OFF } from '../../src/domain/devices/bulb-look.js';
import { layoutMockBulbs } from '../../src/domain/devices/mock-bulb-layout.js';
import { idleHome, type HeadPose } from '../../src/domain/placement.js';

const head: HeadPose = { position: { x: 1, y: 1.2, z: -2 }, forward: { x: 0, y: 0, z: -1 } };

describe('layoutMockBulbs', () => {
  it('lays out the three mock lights in order', () => {
    expect(layoutMockBulbs(head).map((b) => b.entityId)).toEqual([...MOCK_BULB_IDS]);
  });

  it('places bulbs 1.8 to 2.2 m away at different heights, in front of the user', () => {
    const placed = layoutMockBulbs(head);
    for (const bulb of placed) {
      const dist = Math.hypot(bulb.position.x - head.position.x, bulb.position.z - head.position.z);
      expect(dist).toBeGreaterThanOrEqual(1.79);
      expect(dist).toBeLessThanOrEqual(2.21);
      expect(bulb.position.z).toBeLessThan(head.position.z); // forward is -Z
    }
    expect(new Set(placed.map((b) => b.position.y)).size).toBe(3);
  });

  it('puts positive yaw on the user right (+X when facing -Z)', () => {
    const [left, , right] = layoutMockBulbs(head);
    expect(left!.position.x).toBeLessThan(head.position.x);
    expect(right!.position.x).toBeGreaterThan(head.position.x);
  });

  it('keeps every bulb away from the Avatar idle spot', () => {
    const home = idleHome(head);
    for (const bulb of layoutMockBulbs(head)) {
      expect(Math.hypot(bulb.position.x - home.x, bulb.position.z - home.z)).toBeGreaterThan(0.6);
    }
  });

  it('never hangs below the minimum height above a known floor', () => {
    for (const bulb of layoutMockBulbs(head, 1.0)) {
      expect(bulb.position.y).toBeGreaterThanOrEqual(1.0 + MOCK_BULB_LAYOUT.minAboveFloorM);
    }
  });
});

describe('bulbLook', () => {
  it('is dark with no glow when off or unknown', () => {
    expect(bulbLook(undefined)).toBe(BULB_LOOK_OFF);
    expect(bulbLook({ on: false, brightnessPct: 80, rgb: [255, 0, 0] })).toBe(BULB_LOOK_OFF);
  });

  it('takes the light colour when on', () => {
    const look = bulbLook({ on: true, brightnessPct: 100, rgb: [255, 0, 0] });
    expect(look.lit).toBe(true);
    expect(look.haloHex).toBe(0xff0000);
    expect(look.coreHex).toBe(0xff0000);
  });

  it('is dimmer and has a fainter glow at a lower brightness', () => {
    const full = bulbLook({ on: true, brightnessPct: 100, rgb: [255, 244, 229] });
    const dim = bulbLook({ on: true, brightnessPct: 20, rgb: [255, 244, 229] });
    expect(dim.haloOpacity).toBeLessThan(full.haloOpacity);
    expect(dim.haloScale).toBeLessThan(full.haloScale);
    expect(dim.coreHex).toBeLessThan(full.coreHex);
    expect(dim.lit).toBe(true);
  });
});
