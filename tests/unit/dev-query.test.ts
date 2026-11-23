import { describe, expect, it } from 'vitest';
import { parseDevQuery } from '../../src/domain/dev-query.js';
import { shouldShowDevPanel } from '../../src/ui/dev-panel.js';
import { shouldShowHandTestPanel } from '../../src/ui/hand-test-panel.js';

describe('parseDevQuery (task 33.2)', () => {
  it('turns everything off for the default URL, even in a dev build', () => {
    // Vitest runs with import.meta.env.DEV true, so this also proves the flags ignore the build mode.
    expect(import.meta.env.DEV).toBe(true);
    expect(parseDevQuery('')).toEqual({ hands: false, dev: false, handtest: false });
    expect(shouldShowDevPanel('')).toBe(false);
    expect(shouldShowHandTestPanel('')).toBe(false);
  });

  it('turns on only the flag whose parameter is 1', () => {
    expect(parseDevQuery('?hands=1')).toEqual({ hands: true, dev: false, handtest: false });
    expect(parseDevQuery('?dev=1')).toEqual({ hands: false, dev: true, handtest: false });
    expect(parseDevQuery('?handtest=1')).toEqual({ hands: false, dev: false, handtest: true });
    expect(parseDevQuery('?perf=1&fakehands&hands=1&dev=1&handtest=1')).toEqual({
      hands: true,
      dev: true,
      handtest: true,
    });
    expect(shouldShowDevPanel('?dev=1')).toBe(true);
    expect(shouldShowHandTestPanel('?handtest=1')).toBe(true);
  });

  it('ignores other values and a bare parameter', () => {
    expect(parseDevQuery('?hands&dev=true&handtest=0')).toEqual({ hands: false, dev: false, handtest: false });
    // `?dev=1` does not open the hand test panel, and `?fakehands` does not draw the skeleton.
    expect(shouldShowHandTestPanel('?dev=1')).toBe(false);
    expect(parseDevQuery('?fakehands=manual').hands).toBe(false);
  });
});
