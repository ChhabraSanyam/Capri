import { describe, expect, it } from 'vitest';

/**
 * Requirements 8.2, 8.3, 9.11: no controller-only code path, and nothing reads `gamepad`.
 * The Milestone 0 spike (`src/spike/`) is exempt because it measures the gamepad on purpose.
 */
/** Raw text of every TypeScript file under src/, keyed by path (resolved by Vite at transform time). */
const FILES = import.meta.glob<string>(['/src/**/*.ts', '!/src/spike/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const FORBIDDEN = /\.gamepad\b|\bgamepads?\b|\bgetButton(Down|Up)?\b|\bgetAxes(Values)?\b|\bInputComponent\b|\bXRControllerVisualAdapter\b/u;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

describe('no controller-only input', () => {
  it('scans the source tree', () => {
    expect(Object.keys(FILES).length).toBeGreaterThan(10);
    expect(Object.keys(FILES).some((path) => path.includes('/spike/'))).toBe(false);
  });

  it('no file outside the spike reads a gamepad or controller button', () => {
    const offenders = Object.entries(FILES)
      .filter(([, text]) => FORBIDDEN.test(stripComments(text)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
