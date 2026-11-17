import { describe, expect, it } from 'vitest';
import { GRAMMAR_DEBOUNCE_MS, GrammarScheduler, type SchedulerTimer } from '../../src/domain/speech-lang/grammar-scheduler.js';

async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

/** A manual clock: `advance` runs every timer that falls due, in order. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const timer: SchedulerTimer = {
    setTimeout(run, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };
  return {
    timer,
    now: () => now,
    async advance(ms: number): Promise<void> {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

function setup(applyMs = 0) {
  const clock = fakeClock();
  const applied: { phrases: readonly string[]; startedAt: number; finishedAt: number }[] = [];
  const scheduler = new GrammarScheduler({
    timer: clock.timer,
    apply: async (phrases) => {
      const startedAt = clock.now();
      if (applyMs > 0) await new Promise<void>((resolve) => clock.timer.setTimeout(resolve, applyMs));
      applied.push({ phrases, startedAt, finishedAt: clock.now() });
    },
  });
  return { clock, scheduler, applied };
}

describe('GrammarScheduler', () => {
  it('applies a request after the 150 ms debounce, not before', async () => {
    const { clock, scheduler, applied } = setup();
    scheduler.request(['a', '[unk]']);
    await clock.advance(GRAMMAR_DEBOUNCE_MS - 1);
    expect(applied).toHaveLength(0);
    await clock.advance(1);
    expect(applied.map((a) => a.phrases)).toEqual([['a', '[unk]']]);
    expect(applied[0].startedAt).toBe(GRAMMAR_DEBOUNCE_MS);
  });

  it('turns a burst of requests into one rebuild with the newest grammar', async () => {
    const { clock, scheduler, applied } = setup();
    scheduler.request(['one']);
    await clock.advance(100);
    scheduler.request(['two']);
    await clock.advance(100);
    scheduler.request(['three']);
    await clock.advance(GRAMMAR_DEBOUNCE_MS);
    expect(applied.map((a) => a.phrases)).toEqual([['three']]);
  });

  it('holds the rebuild while push-to-talk is active and applies it when the hold ends', async () => {
    const { clock, scheduler, applied } = setup();
    scheduler.setHold(true);
    scheduler.request(['held']);
    await clock.advance(1000);
    expect(applied).toHaveLength(0);
    expect(scheduler.isPending).toBe(true);
    scheduler.setHold(false);
    await clock.advance(0);
    expect(applied.map((a) => a.phrases)).toEqual([['held']]);
    expect(applied[0].startedAt).toBe(1000);
  });

  it('waits out the debounce when the hold ends before it runs out', async () => {
    const { clock, scheduler, applied } = setup();
    scheduler.setHold(true);
    scheduler.request(['x']);
    await clock.advance(50);
    scheduler.setHold(false);
    await clock.advance(50);
    expect(applied).toHaveLength(0);
    await clock.advance(50);
    expect(applied).toHaveLength(1);
  });

  it('never runs two applies at once and applies only the newest request after a running one', async () => {
    const { clock, scheduler, applied } = setup(400);
    scheduler.request(['first']);
    await clock.advance(GRAMMAR_DEBOUNCE_MS);
    scheduler.request(['second']);
    scheduler.request(['third']);
    await clock.advance(GRAMMAR_DEBOUNCE_MS);
    expect(applied).toHaveLength(0); // 'first' is still running
    await clock.advance(1000);
    expect(applied.map((a) => a.phrases)).toEqual([['first'], ['third']]);
    expect(applied[1].startedAt).toBeGreaterThanOrEqual(applied[0].finishedAt);
  });

  it('drops a request equal to the grammar that is already live', async () => {
    const { clock, scheduler, applied } = setup();
    scheduler.request(['same']);
    await clock.advance(GRAMMAR_DEBOUNCE_MS);
    scheduler.request(['same']);
    await clock.advance(1000);
    expect(applied).toHaveLength(1);
    expect(scheduler.isPending).toBe(false);
  });

  it('starts the rebuild within 150 ms and a 157 ms rebuild finishes inside the 1 s budget', async () => {
    const { clock, scheduler, applied } = setup(157);
    scheduler.request(['devices changed']);
    await clock.advance(1000);
    expect(applied).toHaveLength(1);
    expect(applied[0].finishedAt).toBeLessThanOrEqual(1000);
  });

  it('reports a failed apply and lets the same grammar be requested again', async () => {
    const clock = fakeClock();
    const errors: unknown[] = [];
    let calls = 0;
    const scheduler = new GrammarScheduler({
      timer: clock.timer,
      apply: async () => {
        calls += 1;
        if (calls === 1) throw new Error('worker gone');
      },
      onError: (error) => errors.push(error),
    });
    scheduler.request(['g']);
    await clock.advance(GRAMMAR_DEBOUNCE_MS);
    expect(errors).toHaveLength(1);
    scheduler.request(['g']);
    await clock.advance(GRAMMAR_DEBOUNCE_MS);
    expect(calls).toBe(2);
  });

  it('applies nothing after dispose', async () => {
    const { clock, scheduler, applied } = setup();
    scheduler.request(['x']);
    scheduler.dispose();
    await clock.advance(1000);
    expect(applied).toHaveLength(0);
  });
});
