import { describe, expect, it } from 'vitest';
import { CapriApp, STAGE_ORDER, type StageName } from '../../src/app/app.js';
import { createManualClock } from '../../src/app/clock.js';
import { createEventBus } from '../../src/app/events.js';
import { createLogger, type LogLevel } from '../../src/app/logger.js';
import { StageGuard } from '../../src/app/safe-run.js';

type Line = { level: LogLevel; line: string };

function testLogger(lines: Line[] = []) {
  return createLogger('test', (level, line) => lines.push({ level, line }));
}

const throwing = (): void => {
  throw new Error('x');
};

describe('CapriApp.tick', () => {
  it('runs registered stages in the fixed design order and fills the frame context', () => {
    const app = new CapriApp({ logger: testLogger(), isInSession: () => true });
    const seen: string[] = [];
    // Register in reverse so the order cannot come from registration order.
    for (const name of [...STAGE_ORDER].reverse() as StageName[]) {
      app.setStage(name, (frame) => {
        seen.push(name);
        expect(frame.dt).toBe(0.011);
        expect(frame.time).toBe(5);
        expect(frame.inSession).toBe(true);
      });
    }
    app.tick(0.011, 5);
    expect(seen).toEqual([...STAGE_ORDER]);
    expect([...STAGE_ORDER]).toEqual([
      'readFrame',
      'pointing',
      'voice',
      'orchestrator',
      'idle',
      'animator',
      'vfxUi',
      'perf',
    ]);
  });

  it('keeps later stages running when one stage throws', () => {
    const lines: Line[] = [];
    const app = new CapriApp({ logger: testLogger(lines) });
    let animatorRuns = 0;
    app.setStage('pointing', throwing);
    app.setStage('animator', () => {
      animatorRuns += 1;
    });
    app.tick(0.01, 0);
    expect(animatorRuns).toBe(1);
    expect(lines.some((l) => l.level === 'error' && l.line.includes('pointing'))).toBe(true);
  });

  it('reuses one frame context object across ticks', () => {
    const app = new CapriApp({ logger: testLogger() });
    const frames = new Set<object>();
    app.setStage('readFrame', (f) => frames.add(f));
    app.tick(0.01, 0);
    app.tick(0.01, 1);
    expect(frames.size).toBe(1);
  });
});

describe('StageGuard', () => {
  it('disables a stage after 5 errors in 2 s and re-enables it after 10 s', () => {
    const clock = createManualClock(0);
    const guard = new StageGuard('s', clock, testLogger());
    let calls = 0;
    const bad = (): void => {
      calls += 1;
      throw new Error('x');
    };
    for (let i = 0; i < 5; i += 1) {
      guard.run(bad, undefined);
      clock.advance(100);
    }
    expect(guard.disabled).toBe(true);
    const before = calls;
    guard.run(bad, undefined);
    expect(calls).toBe(before);
    clock.advance(10000);
    expect(guard.disabled).toBe(false);
    guard.run(bad, undefined);
    expect(calls).toBe(before + 1);
  });

  it('does not disable when errors are spread beyond the 2 s window', () => {
    const clock = createManualClock(0);
    const guard = new StageGuard('s', clock, testLogger());
    for (let i = 0; i < 8; i += 1) {
      guard.run(throwing, undefined);
      clock.advance(1000);
    }
    expect(guard.disabled).toBe(false);
  });

  it('logs at most one error per second per stage', () => {
    const clock = createManualClock(0);
    const lines: Line[] = [];
    const guard = new StageGuard('s', clock, testLogger(lines));
    for (let i = 0; i < 4; i += 1) {
      guard.run(throwing, undefined);
      clock.advance(100);
    }
    expect(lines.filter((l) => l.line.includes('threw')).length).toBe(1);
  });
});

describe('event bus', () => {
  it('delivers in order, supports unsubscribe, and isolates a throwing handler', () => {
    const bus = createEventBus<{ ping: number }>(testLogger());
    const got: string[] = [];
    bus.on('ping', throwing);
    const off = bus.on('ping', (n) => got.push(`a${n}`));
    bus.on('ping', (n) => got.push(`b${n}`));
    bus.emit('ping', 1);
    off();
    bus.emit('ping', 2);
    expect(got).toEqual(['a1', 'b1', 'b2']);
    expect(bus.listenerCount('ping')).toBe(2);
  });
});
