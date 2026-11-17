import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BEAM_GLITCH_COUNT,
  BEAM_INDEX_COUNT,
  BEAM_SECTIONS,
  BEAM_SEGMENTS,
  BEAM_VERTEX_COUNT,
  BeamShape,
  buildBeamIndices,
  writeBeams,
} from '../../src/vfx/beam-math.js';

function render(shape: BeamShape, glitchValue = 0): { positions: Float32Array; colors: Float32Array } {
  const positions = new Float32Array(BEAM_VERTEX_COUNT * 3);
  const colors = new Float32Array(BEAM_VERTEX_COUNT * 3);
  writeBeams(shape, new Float32Array(BEAM_GLITCH_COUNT).fill(glitchValue), positions, colors);
  return { positions, colors };
}

function shapeFor(ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): BeamShape {
  const s = new BeamShape();
  s.ox = ox;
  s.oy = oy;
  s.oz = oz;
  s.tx = tx;
  s.ty = ty;
  s.tz = tz;
  s.camX = 0;
  s.camY = 1.6;
  s.camZ = 2;
  return s;
}

describe('beam ribbons', () => {
  it('has two ribbons of 24 quads and indexes only existing vertices', () => {
    expect(BEAM_SEGMENTS).toBe(24);
    expect(BEAM_SECTIONS).toBe(25);
    const indices = buildBeamIndices();
    expect(indices.length).toBe(BEAM_INDEX_COUNT);
    expect(BEAM_INDEX_COUNT).toBe(2 * 24 * 6);
    expect(Math.max(...indices)).toBe(BEAM_VERTEX_COUNT - 1);
  });

  it('keeps both ends pinned: the head reaches the target and the full beam starts at the fingertip', () => {
    const s = shapeFor(0, 1, 0, 1, 1.2, -2);
    s.head = 1;
    s.tail = 0;
    const { positions } = render(s, 1);
    // First cross section of beam 0 is centred on the fingertip, the last on the target.
    const mid = (section: number): [number, number, number] => {
      const v = section * 6;
      return [
        (positions[v]! + positions[v + 3]!) / 2,
        (positions[v + 1]! + positions[v + 4]!) / 2,
        (positions[v + 2]! + positions[v + 5]!) / 2,
      ];
    };
    const start = mid(0);
    const end = mid(BEAM_SEGMENTS);
    expect(start[0]).toBeCloseTo(0, 4);
    expect(start[1]).toBeCloseTo(1, 4);
    expect(start[2]).toBeCloseTo(0, 4);
    expect(end[0]).toBeCloseTo(1, 4);
    expect(end[1]).toBeCloseTo(1.2, 4);
    expect(end[2]).toBeCloseTo(-2, 4);
  });

  it('colours beam 0 cyan and beam 1 magenta', () => {
    const s = shapeFor(0, 1, 0, 0, 1, -2);
    const { colors } = render(s);
    const last = (beam: number): number => (beam * BEAM_SECTIONS + BEAM_SEGMENTS) * 6;
    const cyan = last(0);
    const magenta = last(1);
    expect(colors[cyan + 2]).toBeGreaterThan(colors[cyan]!);
    expect(colors[cyan + 1]).toBeGreaterThan(colors[cyan]!);
    expect(colors[magenta]).toBeGreaterThan(colors[magenta + 1]!);
    expect(colors[magenta + 2]).toBeGreaterThan(colors[magenta + 1]!);
  });

  it('is dark at zero intensity', () => {
    const s = shapeFor(0, 1, 0, 0, 1, -2);
    s.intensity = 0;
    const { colors } = render(s);
    expect(Math.max(...colors)).toBe(0);
  });

  it('writes finite numbers for any geometry, including a camera on the path and a zero-length path', () => {
    fc.assert(
      fc.property(
        fc.tuple(...Array.from({ length: 9 }, () => fc.double({ min: -5, max: 5, noNaN: true }))),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        ([ox, oy, oz, tx, ty, tz, cx, cy, cz], a, b) => {
          const s = shapeFor(ox!, oy!, oz!, tx!, ty!, tz!);
          s.camX = cx!;
          s.camY = cy!;
          s.camZ = cz!;
          s.head = Math.max(a, b);
          s.tail = Math.min(a, b);
          const { positions, colors } = render(s, 0.5);
          return positions.every(Number.isFinite) && colors.every(Number.isFinite);
        },
      ),
    );
    const degenerate = shapeFor(1, 1, 1, 1, 1, 1);
    degenerate.camX = 1;
    degenerate.camY = 1;
    degenerate.camZ = 1;
    const { positions } = render(degenerate);
    expect(positions.every(Number.isFinite)).toBe(true);
  });
});
