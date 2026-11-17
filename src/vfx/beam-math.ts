/**
 * Ribbon geometry for the two hacking beams (task 15.5, Requirements 18.3, 18.10). Pure maths over
 * typed arrays, with no Three.js import, so it runs under Node tests. `BeamRenderer` (`beam.ts`) wraps
 * the arrays in a `BufferGeometry`.
 *
 * Each beam is a camera-facing strip of `VFX_RENDER.beam.segments` quads: `segments + 1` cross
 * sections, two vertices each. The strip runs from `tail` to `head` along the path from the fingertip
 * to the marker (fractions in [0, 1]). It wobbles sideways and takes sparse random lateral jumps (the
 * glitch), tapers to a thin dim tail, and fades with `intensity`. Beam 0 is cyan and beam 1 is
 * magenta, and they wobble in opposite directions so they weave around each other.
 */
import { VFX_RENDER } from '../config/constants.js';
import { VFX_PALETTE_LINEAR } from './particle-pool.js';

export const BEAM_COUNT = 2;
export const BEAM_SEGMENTS = VFX_RENDER.beam.segments;
export const BEAM_SECTIONS = BEAM_SEGMENTS + 1;
/** Vertices of both ribbons: two per cross section. */
export const BEAM_VERTEX_COUNT = BEAM_COUNT * BEAM_SECTIONS * 2;
/** Indices of both ribbons: two triangles per quad. */
export const BEAM_INDEX_COUNT = BEAM_COUNT * BEAM_SEGMENTS * 6;
/** One glitch value per cross section per beam, each in [-1, 1]. */
export const BEAM_GLITCH_COUNT = BEAM_COUNT * BEAM_SECTIONS;

/** Triangle indices for both ribbons. Built once. */
export function buildBeamIndices(): Uint16Array {
  const indices = new Uint16Array(BEAM_INDEX_COUNT);
  let n = 0;
  for (let beam = 0; beam < BEAM_COUNT; beam += 1) {
    for (let k = 0; k < BEAM_SEGMENTS; k += 1) {
      const a = (beam * BEAM_SECTIONS + k) * 2;
      indices[n++] = a;
      indices[n++] = a + 1;
      indices[n++] = a + 2;
      indices[n++] = a + 1;
      indices[n++] = a + 3;
      indices[n++] = a + 2;
    }
  }
  return indices;
}

/** Inputs for one frame of ribbon geometry. Reused every frame, so writing it allocates nothing. */
export class BeamShape {
  ox = 0;
  oy = 0;
  oz = 0;
  tx = 0;
  ty = 0;
  tz = 1;
  camX = 0;
  camY = 0;
  camZ = 0;
  /** Path fractions of the leading and trailing end, 0 at the fingertip and 1 at the marker. */
  head = 1;
  tail = 0;
  /** Brightness multiplier in [0, 1]. */
  intensity = 1;
  /** Scales the ribbon width and the wobble, 1 for the full beam. */
  widthScale = 1;
  /** Seconds, drives the wobble phase. */
  timeS = 0;
}

/**
 * Fill `positions` and `colors` (both `BEAM_VERTEX_COUNT * 3` floats) for the current frame.
 * `glitch` holds `BEAM_GLITCH_COUNT` lateral jumps in [-1, 1], re-rolled by the caller at 15 Hz.
 */
export function writeBeams(
  shape: BeamShape,
  glitch: ArrayLike<number>,
  positions: Float32Array,
  colors: Float32Array,
): void {
  const { halfWidthM, wobbleM, wobbleCycles, glitchM } = VFX_RENDER.beam;
  let dx = shape.tx - shape.ox;
  let dy = shape.ty - shape.oy;
  let dz = shape.tz - shape.oz;
  const length = Math.hypot(dx, dy, dz);
  if (length > 1e-6) {
    dx /= length;
    dy /= length;
    dz /= length;
  } else {
    dx = 0;
    dy = 0;
    dz = 1;
  }
  const pathX = shape.tx - shape.ox;
  const pathY = shape.ty - shape.oy;
  const pathZ = shape.tz - shape.oz;
  const span = shape.head - shape.tail;
  let v = 0;
  for (let beam = 0; beam < BEAM_COUNT; beam += 1) {
    const sign = beam === 0 ? 1 : -1;
    const palette = beam * 3;
    const baseR = VFX_PALETTE_LINEAR[palette]!;
    const baseG = VFX_PALETTE_LINEAR[palette + 1]!;
    const baseB = VFX_PALETTE_LINEAR[palette + 2]!;
    for (let i = 0; i < BEAM_SECTIONS; i += 1) {
      const s = i / BEAM_SEGMENTS;
      const u = shape.tail + span * s;
      const cx = shape.ox + pathX * u;
      const cy = shape.oy + pathY * u;
      const cz = shape.oz + pathZ * u;
      // Side vector in the view plane: perpendicular to the path and to the line toward the camera.
      let wx = dy * (shape.camZ - cz) - dz * (shape.camY - cy);
      let wy = dz * (shape.camX - cx) - dx * (shape.camZ - cz);
      let wz = dx * (shape.camY - cy) - dy * (shape.camX - cx);
      let wl = Math.hypot(wx, wy, wz);
      if (wl < 1e-6) {
        // The camera is on the path. Any perpendicular will do.
        wx = dy;
        wy = -dx;
        wz = 0;
        wl = Math.hypot(wx, wy, wz);
        if (wl < 1e-6) {
          wx = 0;
          wy = dz;
          wz = -dy;
          wl = Math.hypot(wx, wy, wz) || 1;
        }
      }
      wx /= wl;
      wy /= wl;
      wz /= wl;
      // The wobble and the jumps vanish at both ends, so the beam stays pinned to the finger and the marker.
      const pin = Math.sin(Math.PI * Math.min(Math.max(u, 0), 1));
      const wobble = Math.sin(u * wobbleCycles * Math.PI * 2 + shape.timeS * 18 + beam * Math.PI) * wobbleM;
      const jump = (glitch[beam * BEAM_SECTIONS + i] ?? 0) * glitchM;
      const offset = sign * (wobble + jump) * pin * shape.widthScale;
      const half = halfWidthM * (0.15 + 0.85 * s ** 0.7) * shape.widthScale;
      const left = offset + half;
      const right = offset - half;
      positions[v] = cx + wx * left;
      positions[v + 1] = cy + wy * left;
      positions[v + 2] = cz + wz * left;
      positions[v + 3] = cx + wx * right;
      positions[v + 4] = cy + wy * right;
      positions[v + 5] = cz + wz * right;
      // Dim tail, bright head, with a white-hot tip. Additive blending, so dark is transparent.
      const bright = shape.intensity * s ** 1.2;
      const hot = 0.35 * s ** 6 * shape.intensity;
      const r = baseR * bright + hot;
      const g = baseG * bright + hot;
      const b = baseB * bright + hot;
      colors[v] = r;
      colors[v + 1] = g;
      colors[v + 2] = b;
      colors[v + 3] = r;
      colors[v + 4] = g;
      colors[v + 5] = b;
      v += 6;
    }
  }
}
