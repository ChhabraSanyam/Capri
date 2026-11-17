import { describe, expect, it } from 'vitest';
import { HandLostMonitor } from '../../src/domain/hand-lost.js';
import { StatusChips } from '../../src/ui/status-chips.js';
import { createEventBus, type AppEvents } from '../../src/app/events.js';

/** Feed (time, tracked) frames and return the visible flag after each one. */
function run(frames: ReadonlyArray<readonly [number, boolean]>): boolean[] {
  const monitor = new HandLostMonitor();
  return frames.map(([time, tracked]) => monitor.update(time, tracked));
}

describe('HandLostMonitor', () => {
  it('stays hidden while a hand is tracked', () => {
    expect(run([[0, true], [1, true], [5, true]])).toEqual([false, false, false]);
  });

  it('shows after 1.0 s without tracking, not before', () => {
    const out = run([[10, false], [10.5, false], [10.99, false], [11, false], [12, false]]);
    expect(out).toEqual([false, false, false, true, true]);
  });

  it('hides on the first frame where a hand is tracked again', () => {
    const out = run([[0, false], [1.2, false], [1.25, true], [1.3, true]]);
    expect(out).toEqual([false, true, false, false]);
  });

  it('restarts the 1.0 s count after a short tracking return', () => {
    const out = run([[0, false], [0.8, false], [0.9, true], [1.0, false], [1.9, false], [2.0, false]]);
    expect(out).toEqual([false, false, false, false, false, true]);
  });

  it('reset() clears a visible message and the count', () => {
    const monitor = new HandLostMonitor();
    monitor.update(0, false);
    expect(monitor.update(2, false)).toBe(true);
    monitor.reset();
    expect(monitor.visible).toBe(false);
    expect(monitor.update(3, false)).toBe(false);
    expect(monitor.update(4, false)).toBe(true);
  });

  it('restarts the count when time moves backwards', () => {
    const monitor = new HandLostMonitor();
    monitor.update(100, false);
    expect(monitor.update(50, false)).toBe(false);
    expect(monitor.update(51, false)).toBe(true);
  });
});

describe('StatusChips stub', () => {
  it('remembers the last connection state per integration', () => {
    const events = createEventBus<AppEvents>();
    const chips = new StatusChips(events);
    expect(chips.stateOf('hermes')).toBe('not_configured');
    events.emit('connection:changed', { integration: 'hermes', state: 'connecting' });
    expect(chips.stateOf('hermes')).toBe('connecting');
    chips.dispose();
    expect(events.listenerCount('connection:changed')).toBe(0);
  });
});
