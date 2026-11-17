import { describe, expect, it } from 'vitest';
import {
  ParticleBank,
  ParticlePool,
  VFX_COLOR_CYAN,
  VFX_COLOR_MAGENTA,
  VFX_PARTICLE_CAP,
} from '../../src/vfx/particle-pool.js';

describe('ParticlePool', () => {
  it('has a hard cap of 192 with banks of 128, 24, and 32', () => {
    const pool = new ParticlePool();
    expect(VFX_PARTICLE_CAP).toBe(192);
    expect(pool.capacity).toBe(184);
    expect(pool.capacity).toBeLessThanOrEqual(VFX_PARTICLE_CAP);
    expect(pool.sparks.capacity).toBe(128);
    expect(pool.glyphs.capacity).toBe(24);
    expect(pool.lines.capacity).toBe(32);
  });

  it('never exceeds the cap when spawning far past it', () => {
    const pool = new ParticlePool();
    for (let i = 0; i < 1000; i += 1) {
      pool.spawn('spark', i, 0, 0, 0, 0, 0, 10, 1, VFX_COLOR_CYAN);
      pool.spawn('glyph', i, 0, 0, 0, 0, 0, 10, 1, VFX_COLOR_MAGENTA);
      pool.spawn('line', i, 0, 0, 0, 0, 0, 10, 1, VFX_COLOR_CYAN);
    }
    expect(pool.sparks.count).toBe(128);
    expect(pool.glyphs.count).toBe(24);
    expect(pool.lines.count).toBe(32);
    expect(pool.activeCount).toBe(pool.capacity);
    expect(pool.activeCount).toBeLessThanOrEqual(VFX_PARTICLE_CAP);
  });

  it('recycles the oldest element when full', () => {
    const bank = new ParticleBank('glyph', 3);
    bank.spawn(1, 0, 0, 0, 0, 0, 10, 1, VFX_COLOR_CYAN);
    bank.spawn(2, 0, 0, 0, 0, 0, 10, 1, VFX_COLOR_CYAN);
    bank.spawn(3, 0, 0, 0, 0, 0, 10, 1, VFX_COLOR_CYAN);
    const slot = bank.spawn(4, 0, 0, 0, 0, 0, 10, 1, VFX_COLOR_CYAN);
    expect(slot).toBe(0);
    expect(bank.count).toBe(3);
    expect([...bank.positions].filter((_, i) => i % 3 === 0).sort()).toEqual([2, 3, 4]);
    bank.spawn(5, 0, 0, 0, 0, 0, 10, 1, VFX_COLOR_CYAN);
    expect([...bank.positions].filter((_, i) => i % 3 === 0).sort()).toEqual([3, 4, 5]);
  });

  it('keeps recycling in spawn order after swap-removals reorder the slots', () => {
    const bank = new ParticleBank('spark', 3);
    bank.spawn(1, 0, 0, 0, 0, 0, 0.5, 1, VFX_COLOR_CYAN); // short-lived
    bank.spawn(2, 0, 0, 0, 0, 0, 10, 1, VFX_COLOR_CYAN);
    bank.spawn(3, 0, 0, 0, 0, 0, 10, 1, VFX_COLOR_CYAN);
    bank.update(1); // the first element dies, the last one moves into slot 0
    expect(bank.count).toBe(2);
    bank.spawn(4, 0, 0, 0, 0, 0, 10, 1, VFX_COLOR_CYAN);
    bank.spawn(5, 0, 0, 0, 0, 0, 10, 1, VFX_COLOR_CYAN); // full: x=2 is the oldest
    const xs = Array.from({ length: bank.count }, (_, i) => bank.positions[i * 3]).sort();
    expect(xs).toEqual([3, 4, 5]);
  });

  it('integrates position and spin, and removes elements at the end of their lifetime', () => {
    const pool = new ParticlePool();
    pool.spawn('spark', 0, 1, 0, 2, 0, -1, 1, 0.01, VFX_COLOR_CYAN, 0.5, 4);
    pool.update(0.25);
    const { sparks } = pool;
    expect(sparks.count).toBe(1);
    expect(sparks.positions[0]).toBeCloseTo(0.5);
    expect(sparks.positions[1]).toBeCloseTo(1);
    expect(sparks.positions[2]).toBeCloseTo(-0.25);
    expect(sparks.rotations[0]).toBeCloseTo(1.5);
    expect(sparks.ages[0]).toBeCloseTo(0.25);
    pool.update(0.75);
    expect(sparks.count).toBe(0);
    expect(pool.activeCount).toBe(0);
  });

  it('writes the cyan and magenta palette as linear RGB', () => {
    const bank = new ParticleBank('spark', 2);
    bank.spawn(0, 0, 0, 0, 0, 0, 1, 1, VFX_COLOR_CYAN);
    bank.spawn(0, 0, 0, 0, 0, 0, 1, 1, VFX_COLOR_MAGENTA);
    // #00f0ff: red 0, blue 1. #ff2bd6: red 1, green about 0.024.
    expect(bank.colors[0]).toBe(0);
    expect(bank.colors[2]).toBeCloseTo(1);
    expect(bank.colors[1]).toBeGreaterThan(0.85);
    expect(bank.colors[3]).toBeCloseTo(1);
    expect(bank.colors[4]).toBeCloseTo(0.0242, 3);
  });

  it('ignores non-finite spawns and steps, and clamps a zero lifetime', () => {
    const pool = new ParticlePool();
    expect(pool.spawn('spark', Number.NaN, 0, 0, 0, 0, 0, 1, 1, VFX_COLOR_CYAN)).toBe(-1);
    expect(pool.spawn('spark', 0, 0, 0, 0, 0, 0, Number.POSITIVE_INFINITY, 1, VFX_COLOR_CYAN)).toBe(-1);
    expect(pool.activeCount).toBe(0);
    pool.spawn('spark', 0, 0, 0, 1, 0, 0, 0, 1, VFX_COLOR_CYAN);
    expect(pool.sparks.lifetimes[0]).toBeGreaterThan(0);
    pool.update(Number.NaN);
    pool.update(-1);
    expect(pool.sparks.count).toBe(1);
    expect(pool.sparks.positions[0]).toBe(0);
  });

  it('clear empties every bank', () => {
    const pool = new ParticlePool();
    pool.spawn('line', 0, 0, 0, 0, 0, 0, 1, 1, VFX_COLOR_CYAN);
    pool.spawn('glyph', 0, 0, 0, 0, 0, 0, 1, 1, VFX_COLOR_CYAN);
    pool.clear();
    expect(pool.activeCount).toBe(0);
  });
});
