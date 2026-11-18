import { describe, expect, it } from 'vitest';
import { createManualClock, type ManualClock } from '../../src/app/clock.js';
import { createSeededRng, type Rng } from '../../src/app/rng.js';
import { IDLE_SCHEDULE } from '../../src/config/constants.js';
import {
  createIdleInputs,
  IdleScheduler,
  nextIdleGapS,
  type IdleInputs,
} from '../../src/domain/idle-scheduler.js';

const FRAME_MS = 100;

interface Event {
  readonly t: number;
  readonly kind: 'behaviour' | 'ignored';
  readonly gesture: string;
  readonly glanceSource: 'surface' | 'marker' | null;
  readonly glanceIndex: number;
}

function setup(seed = 7): { clock: ManualClock; scheduler: IdleScheduler; inputs: IdleInputs } {
  const clock = createManualClock(1_000);
  const scheduler = new IdleScheduler(createSeededRng(seed), clock);
  const inputs = createIdleInputs();
  inputs.surfaceCount = 2;
  inputs.markerCount = 3;
  return { clock, scheduler, inputs };
}

/** Step the clock in fixed frames for `durationMs`, collecting every non-`none` decision. */
function run(
  clock: ManualClock,
  scheduler: IdleScheduler,
  inputs: IdleInputs,
  durationMs: number,
  onFrame?: (t: number) => void,
): Event[] {
  const events: Event[] = [];
  const end = clock.now() + durationMs;
  while (clock.now() < end) {
    clock.advance(FRAME_MS);
    onFrame?.(clock.now());
    const d = scheduler.update(inputs);
    if (d.kind !== 'none') {
      events.push({
        t: clock.now(),
        kind: d.kind,
        gesture: d.gesture,
        glanceSource: d.glanceSource,
        glanceIndex: d.glanceIndex,
      });
    }
  }
  return events;
}

describe('nextIdleGapS', () => {
  it('stays inside [8 s, 18 s], including for an Rng that returns 0 or 1', () => {
    const rng = createSeededRng(3);
    for (let i = 0; i < 500; i++) {
      const g = nextIdleGapS(rng);
      expect(g).toBeGreaterThanOrEqual(IDLE_SCHEDULE.gapMinS);
      expect(g).toBeLessThanOrEqual(IDLE_SCHEDULE.gapMaxS);
    }
    const zero: Rng = { next: () => 0 };
    const one: Rng = { next: () => 1 };
    expect(nextIdleGapS(zero)).toBe(8);
    expect(nextIdleGapS(one)).toBe(18);
  });
});

describe('IdleScheduler', () => {
  it('plays an idle behaviour at least every 20 s and not sooner than 8 s while free', () => {
    const { clock, scheduler, inputs } = setup();
    const start = clock.now();
    const behaviours = run(clock, scheduler, inputs, 59_000).filter((e) => e.kind === 'behaviour');
    expect(behaviours.length).toBeGreaterThanOrEqual(3);
    let prev = start;
    for (const e of behaviours) {
      expect(e.t - prev).toBeLessThan(20_000);
      expect(e.t - prev).toBeGreaterThanOrEqual(8_000);
      prev = e.t;
    }
  });

  it('chooses stretch, fidget, and glance, never the same one twice in a row', () => {
    const { clock, scheduler, inputs } = setup(11);
    const events: Event[] = [];
    // Keep the user "present" so the ignored reaction does not interleave.
    for (let i = 0; i < 40; i++) {
      events.push(...run(clock, scheduler, inputs, 50_000));
      scheduler.noteInput();
    }
    const gestures = events.filter((e) => e.kind === 'behaviour').map((e) => e.gesture);
    expect(new Set(gestures)).toEqual(new Set(['stretch', 'fidget', 'glance']));
    for (let i = 1; i < gestures.length; i++) expect(gestures[i]).not.toBe(gestures[i - 1]);
  });

  it('aims a glance at a real Surface or marker index', () => {
    const { clock, scheduler, inputs } = setup(5);
    const glances: Event[] = [];
    for (let i = 0; i < 40; i++) {
      glances.push(...run(clock, scheduler, inputs, 50_000).filter((e) => e.gesture === 'glance'));
      scheduler.noteInput();
    }
    expect(glances.length).toBeGreaterThan(0);
    for (const g of glances) {
      if (g.glanceSource === 'surface') expect(g.glanceIndex).toBeLessThan(inputs.surfaceCount);
      else expect(g.glanceSource).toBe('marker');
      if (g.glanceSource === 'marker') expect(g.glanceIndex).toBeLessThan(inputs.markerCount);
      expect(g.glanceIndex).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(glances.map((g) => g.glanceSource))).toEqual(new Set(['surface', 'marker']));
  });

  it('never glances with nothing to look at', () => {
    const { clock, scheduler, inputs } = setup(9);
    inputs.surfaceCount = 0;
    inputs.markerCount = 0;
    const events: Event[] = [];
    for (let i = 0; i < 20; i++) {
      events.push(...run(clock, scheduler, inputs, 50_000));
      scheduler.noteInput();
    }
    expect(events.some((e) => e.gesture === 'glance')).toBe(false);
    expect(events.some((e) => e.kind === 'behaviour')).toBe(true);
  });

  it('plays the ignored reaction once at 60 s without input, not before, and re-arms on input', () => {
    const { clock, scheduler, inputs } = setup();
    const start = clock.now();
    const events = run(clock, scheduler, inputs, 200_000);
    const ignored = events.filter((e) => e.kind === 'ignored');
    expect(ignored).toHaveLength(1);
    expect(ignored[0]!.gesture).toBe('ignored');
    expect(ignored[0]!.t - start).toBeGreaterThanOrEqual(60_000);
    expect(ignored[0]!.t - start).toBeLessThan(60_000 + FRAME_MS + 1);

    scheduler.noteInput();
    const inputAt = clock.now();
    const again = run(clock, scheduler, inputs, 70_000).filter((e) => e.kind === 'ignored');
    expect(again).toHaveLength(1);
    expect(again[0]!.t - inputAt).toBeGreaterThanOrEqual(60_000);
  });

  it('input restarts the gap', () => {
    const { clock, scheduler, inputs } = setup();
    clock.advance(7_000);
    scheduler.noteInput();
    expect(scheduler.nextBehaviourAtMs - clock.now()).toBeGreaterThanOrEqual(8_000);
    const events = run(clock, scheduler, inputs, 7_900);
    expect(events).toHaveLength(0);
  });

  it('never starts anything while she speaks, moves, acts, hacks, or plays another gesture', () => {
    const blockers: Array<(i: IdleInputs) => void> = [
      (i) => (i.speaking = true),
      (i) => (i.hackActive = true),
      (i) => (i.gestureBusy = true),
      (i) => (i.mode = 'moving'),
      (i) => (i.mode = 'acting'),
    ];
    for (const block of blockers) {
      const { clock, scheduler, inputs } = setup();
      block(inputs);
      expect(run(clock, scheduler, inputs, 120_000)).toHaveLength(0);
    }
  });

  it('plays while perched, sitting, or away', () => {
    for (const mode of ['perched', 'sitting', 'away'] as const) {
      const { clock, scheduler, inputs } = setup();
      inputs.mode = mode;
      expect(run(clock, scheduler, inputs, 20_000).some((e) => e.kind === 'behaviour')).toBe(true);
    }
  });

  it('restarts the gap when she becomes free, and an overdue ignored waits for the first free frame', () => {
    const { clock, scheduler, inputs } = setup();
    const start = clock.now();
    inputs.speaking = true;
    run(clock, scheduler, inputs, 65_000);
    inputs.speaking = false;
    const freeAt = clock.now() + FRAME_MS;
    const events = run(clock, scheduler, inputs, 30_000);
    expect(events[0]!.kind).toBe('ignored');
    expect(events[0]!.t).toBe(freeAt);
    expect(events[0]!.t - start).toBeGreaterThanOrEqual(60_000);
    const firstBehaviour = events.find((e) => e.kind === 'behaviour')!;
    expect(firstBehaviour.t - freeAt).toBeGreaterThanOrEqual(8_000);
  });

  it('limits itself to fidget and glance while a Hermes task runs, with no ignored reaction', () => {
    const { clock, scheduler, inputs } = setup(13);
    inputs.taskRunning = true;
    const events = run(clock, scheduler, inputs, 300_000);
    expect(events.length).toBeGreaterThan(10);
    for (const e of events) {
      expect(e.kind).toBe('behaviour');
      expect(['fidget', 'glance']).toContain(e.gesture);
    }
    // When the task ends after a long silence, the ignored reaction follows on the next free frame.
    inputs.taskRunning = false;
    const after = run(clock, scheduler, inputs, FRAME_MS);
    expect(after.map((e) => e.kind)).toEqual(['ignored']);
  });

  it('repeats fidget during a task when there is nothing to glance at', () => {
    const { clock, scheduler, inputs } = setup();
    inputs.taskRunning = true;
    inputs.surfaceCount = 0;
    inputs.markerCount = 0;
    const events = run(clock, scheduler, inputs, 60_000);
    expect(events.length).toBeGreaterThan(2);
    expect(events.every((e) => e.gesture === 'fidget')).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const a = setup(42);
    const b = setup(42);
    expect(run(a.clock, a.scheduler, a.inputs, 180_000)).toEqual(run(b.clock, b.scheduler, b.inputs, 180_000));
  });

  it('returns the same decision object every frame', () => {
    const { clock, scheduler, inputs } = setup();
    const first = scheduler.update(inputs);
    clock.advance(30_000);
    expect(scheduler.update(inputs)).toBe(first);
  });

  it('restarts the schedule when time moves backwards, and reset() starts fresh', () => {
    const { clock, scheduler, inputs } = setup();
    clock.advance(50_000);
    scheduler.update(inputs);
    clock.set(0);
    expect(scheduler.update(inputs).kind).toBe('none');
    expect(scheduler.lastInputAtMs).toBe(0);
    expect(scheduler.nextBehaviourAtMs).toBeGreaterThanOrEqual(8_000);

    clock.set(100_000);
    scheduler.update(inputs);
    expect(scheduler.ignoredReacted).toBe(true);
    scheduler.reset();
    expect(scheduler.ignoredReacted).toBe(false);
    expect(scheduler.lastInputAtMs).toBe(100_000);
  });
});
