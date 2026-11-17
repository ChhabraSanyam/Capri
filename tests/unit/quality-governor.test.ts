import { describe, expect, it } from 'vitest';
import { QualityGovernor } from '../../src/vfx/quality-governor.js';

function feed(governor: QualityGovernor, ms: number, frames: number): void {
  for (let i = 0; i < frames; i += 1) governor.sample(ms);
}

describe('QualityGovernor', () => {
  it('starts at full emission', () => {
    const g = new QualityGovernor();
    expect(g.scale).toBe(1);
    expect(g.reduced).toBe(false);
  });

  it('does nothing until the 30-frame window is full', () => {
    const g = new QualityGovernor();
    feed(g, 20, 29);
    expect(g.reduced).toBe(false);
    g.sample(20);
    expect(g.reduced).toBe(true);
    expect(g.scale).toBe(0.5);
  });

  it('stays at full emission while the average is at or under 12.5 ms', () => {
    const g = new QualityGovernor();
    feed(g, 12.5, 90);
    expect(g.reduced).toBe(false);
  });

  it('halves once and never goes below the floor', () => {
    const g = new QualityGovernor();
    feed(g, 30, 300);
    expect(g.scale).toBe(0.5);
  });

  it('ignores hitches and bad samples', () => {
    const g = new QualityGovernor();
    feed(g, 500, 100);
    feed(g, Number.NaN, 100);
    feed(g, -4, 100);
    expect(g.reduced).toBe(false);
    expect(g.averageMs).toBe(0);
  });

  it('keeps the reduction for the rest of the sequence even when frames recover', () => {
    const g = new QualityGovernor();
    feed(g, 20, 30);
    feed(g, 8, 60);
    expect(g.reduced).toBe(true);
  });

  it('stays reduced into the next sequence while the average is between 11 and 12.5 ms', () => {
    const g = new QualityGovernor();
    feed(g, 20, 30);
    feed(g, 12, 30);
    g.beginSequence();
    expect(g.reduced).toBe(true);
  });

  it('returns to full emission on the next sequence once the average is at or under 11 ms', () => {
    const g = new QualityGovernor();
    feed(g, 20, 30);
    feed(g, 10, 30);
    g.beginSequence();
    expect(g.reduced).toBe(false);
    expect(g.scale).toBe(1);
  });

  it('starts every sequence with a fresh window', () => {
    const g = new QualityGovernor();
    feed(g, 20, 30);
    feed(g, 9, 30);
    g.beginSequence();
    feed(g, 20, 29);
    expect(g.reduced).toBe(false);
  });

  it('scales counts down but never to nothing', () => {
    const g = new QualityGovernor();
    expect(g.scaleCount(18)).toBe(18);
    feed(g, 20, 30);
    expect(g.scaleCount(18)).toBe(9);
    expect(g.scaleCount(1)).toBe(1);
    expect(g.scaleCount(3)).toBe(1);
    expect(g.scaleCount(0)).toBe(0);
  });
});
