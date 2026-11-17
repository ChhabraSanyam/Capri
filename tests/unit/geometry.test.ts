import { describe, expect, it } from 'vitest';
import { BlinkScheduler, nextBlinkIntervalS } from '../../src/domain/blink.js';
import {
  DEG_TO_RAD,
  clampLook,
  directionToYawPitch,
  length,
  raySphere,
  vec3,
} from '../../src/domain/geometry.js';
import { createSeededRng } from '../../src/app/rng.js';

describe('raySphere', () => {
  const center = vec3(0, 0, 5);

  it('returns the near hit distance for a ray aimed at the sphere', () => {
    const t = raySphere({ origin: vec3(0, 0, 0), direction: vec3(0, 0, 2) }, center, 1);
    expect(t).toBeCloseTo(4);
  });

  it('misses a sphere off to the side and one behind the origin', () => {
    expect(raySphere({ origin: vec3(0, 0, 0), direction: vec3(1, 0, 0) }, center, 1)).toBeUndefined();
    expect(raySphere({ origin: vec3(0, 0, 0), direction: vec3(0, 0, -1) }, center, 1)).toBeUndefined();
  });

  it('hits the far side from inside and ignores a zero direction', () => {
    expect(raySphere({ origin: center, direction: vec3(0, 0, 1) }, center, 1)).toBeCloseTo(1);
    expect(raySphere({ origin: vec3(0, 0, 0), direction: vec3(0, 0, 0) }, center, 1)).toBeUndefined();
  });
});

describe('clampLook', () => {
  it('returns a direction inside the limits unchanged', () => {
    const dir = vec3(0.3, 0.1, 1);
    expect(clampLook(dir)).toBe(dir);
  });

  it('clamps yaw to 70 degrees and keeps pitch', () => {
    const out = clampLook(vec3(1, 0, 0)); // 90 degrees left
    const { yaw, pitch } = directionToYawPitch(out);
    expect(yaw).toBeCloseTo(70 * DEG_TO_RAD);
    expect(pitch).toBeCloseTo(0);
  });

  it('clamps pitch to -40 degrees when looking straight down, and keeps length', () => {
    const out = clampLook(vec3(0, -3, 0));
    expect(directionToYawPitch(out).pitch).toBeCloseTo(-40 * DEG_TO_RAD);
    expect(length(out)).toBeCloseTo(3);
  });

  it('faces forward for a zero direction', () => {
    expect(clampLook(vec3(0, 0, 0))).toEqual(vec3(0, 0, 1));
  });
});

describe('BlinkScheduler', () => {
  it('draws every interval from [2 s, 6 s]', () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 500; i += 1) {
      const s = nextBlinkIntervalS(rng);
      expect(s).toBeGreaterThanOrEqual(2);
      expect(s).toBeLessThanOrEqual(6);
    }
  });

  it('blinks between 2 s and 6 s apart when stepped at 72 fps', () => {
    const scheduler = new BlinkScheduler(createSeededRng(42));
    const dt = 1 / 72;
    const times: number[] = [];
    for (let frame = 1; frame <= 72 * 120; frame += 1) {
      if (scheduler.update(dt)) times.push(frame * dt);
    }
    expect(times.length).toBeGreaterThan(20);
    for (let i = 1; i < times.length; i += 1) {
      const gap = times[i] - times[i - 1];
      expect(gap).toBeGreaterThanOrEqual(2 - dt);
      expect(gap).toBeLessThanOrEqual(6 + dt);
    }
  });

  it('produces one blink, not a burst, after a long frame hitch', () => {
    const scheduler = new BlinkScheduler(createSeededRng(1));
    expect(scheduler.update(30)).toBe(true);
    expect(scheduler.update(0.001)).toBe(false);
  });
});
