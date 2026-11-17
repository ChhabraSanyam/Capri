import { describe, expect, it } from 'vitest';
import { createManualClock } from '../../src/app/clock.js';
import { plainSituationText, type PersonaSituation } from '../../src/domain/actions/persona-port.js';
import { announceExpired, TimerService } from '../../src/domain/actions/timers.js';
import type { GestureId } from '../../src/domain/animation-types.js';

describe('TimerService', () => {
  it('sets dueAt from the clock and fires once, never early', () => {
    const clock = createManualClock(1000);
    const timers = new TimerService(clock);
    const t = timers.start(2)!;
    expect(t.dueAt).toBe(1000 + 120_000);
    expect(timers.tick(1000 + 119_999)).toEqual([]);
    expect(timers.tick(1000 + 120_000)).toEqual([t]);
    expect(timers.tick(1000 + 500_000)).toEqual([]);
    expect(timers.pending()).toEqual([]);
  });

  it('uses the clock when tick has no argument', () => {
    const clock = createManualClock(0);
    const timers = new TimerService(clock);
    timers.start(1);
    clock.advance(59_999);
    expect(timers.tick()).toHaveLength(0);
    clock.advance(1);
    expect(timers.tick()).toHaveLength(1);
  });

  it('returns several expired timers soonest first and keeps the rest', () => {
    const timers = new TimerService(createManualClock(0));
    const long = timers.start(10)!;
    const b = timers.start(2)!;
    const a = timers.start(1)!;
    expect(timers.tick(180_000)).toEqual([a, b]);
    expect(timers.pending()).toEqual([long]);
  });

  it('carries a trimmed, bounded label and drops an empty one', () => {
    const timers = new TimerService(createManualClock());
    expect(timers.start(1, '  check the oven ')!.label).toBe('check the oven');
    expect(timers.start(1, '   ')!.label).toBeUndefined();
    expect(timers.start(1, 'x'.repeat(200))!.label).toHaveLength(60);
  });

  it('rejects durations that are not positive and finite', () => {
    const timers = new TimerService(createManualClock());
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e308]) expect(timers.start(bad)).toBeUndefined();
    expect(timers.pending()).toEqual([]);
  });

  it('does not allocate when nothing is due', () => {
    const timers = new TimerService(createManualClock());
    timers.start(5);
    expect(timers.tick(1)).toBe(timers.tick(2));
  });

  it('cancels a pending timer', () => {
    const timers = new TimerService(createManualClock());
    const t = timers.start(1)!;
    expect(timers.cancel(t.id)).toBe(true);
    expect(timers.cancel(t.id)).toBe(false);
    expect(timers.tick(1e9)).toEqual([]);
  });
});

describe('announceExpired', () => {
  function setup() {
    const played: GestureId[] = [];
    const said: PersonaSituation[] = [];
    const deps = {
      animator: { play: (g: GestureId) => (played.push(g), Promise.resolve()) },
      persona: { situation: (s: PersonaSituation) => void said.push(s) },
    };
    return { played, said, deps };
  }

  it('plays notify once and says one line per timer', () => {
    const { played, said, deps } = setup();
    const timers = new TimerService(createManualClock());
    timers.start(1);
    timers.start(2, 'tea');
    announceExpired(timers.tick(1e9), deps);
    expect(played).toEqual(['notify']);
    expect(said).toEqual([
      { kind: 'timer_done', minutes: 1 },
      { kind: 'timer_done', minutes: 2, label: 'tea' },
    ]);
  });

  it('does nothing for an empty list', () => {
    const { played, said, deps } = setup();
    announceExpired([], deps);
    expect(played).toEqual([]);
    expect(said).toEqual([]);
  });

  it('writes a short bubble line for plain and labelled timers', () => {
    expect(plainSituationText({ kind: 'timer_done', minutes: 5 })).toBe("Time's up! Your timer for 5 minutes just ran out.");
    expect(plainSituationText({ kind: 'timer_done', minutes: 1 })).toContain('timer for 1 minute just');
    expect(plainSituationText({ kind: 'timer_done', minutes: 5, label: 'check the oven.' })).toBe(
      "Time's up! Reminder: check the oven.",
    );
  });
});
