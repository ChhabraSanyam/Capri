/**
 * Bubble stacking (task 33.6, Requirement 33.27). Pure: where the Transcript_Bubble goes so that it
 * never overlaps Capri's Speech_Bubble.
 *
 * Both bubbles are upright quads that turn about +Y toward the head, so a bubble is described by its
 * centre and its half width and half height. Two bubbles overlap when their centres are closer
 * horizontally than the sum of their half widths and closer vertically than the sum of their half
 * heights (`bubblesOverlap`). The horizontal test uses the distance in the floor plane, which holds
 * whichever way each bubble is turned.
 *
 * `stackTranscriptBubble` places the transcript at its own anchor above Capri when that is clear of
 * the speech bubble by `gapM`. Otherwise it stacks it directly above the speech bubble, `gapM`
 * higher, in the same column. If the stacked centre would be higher than `maxCenterY`, the speech
 * bubble replaces the transcript (`replaced`: hide the transcript while she speaks).
 */
import type { Vec3 } from './geometry.js';

export interface BubbleSize {
  readonly halfWidthM: number;
  readonly halfHeightM: number;
}

export interface BubbleRect extends BubbleSize {
  readonly center: Vec3;
}

export type StackKind = 'alone' | 'stacked' | 'replaced';

export interface StackPlacement {
  readonly kind: StackKind;
  /** The transcript centre. Meaningless when `kind` is `replaced`. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MutableStackPlacement {
  kind: StackKind;
  x: number;
  y: number;
  z: number;
}

export interface StackOptions {
  /** Clear space kept between the two bubbles, in metres. */
  readonly gapM: number;
  /** The highest the transcript centre may go when stacked. */
  readonly maxCenterY: number;
}

/** True when the two upright bubbles overlap, with `marginM` of extra clearance required. */
export function bubblesOverlap(a: BubbleRect, b: BubbleRect, marginM = 0): boolean {
  const dy = Math.abs(a.center.y - b.center.y);
  if (dy >= a.halfHeightM + b.halfHeightM + marginM) return false;
  const horizontal = Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z);
  return horizontal < a.halfWidthM + b.halfWidthM + marginM;
}

/**
 * Place the Transcript_Bubble of `size` whose own spot is `anchor`, given the Speech_Bubble (or
 * `undefined` when none is shown). Writes into `out` when given, so a per-frame caller allocates nothing.
 */
export function stackTranscriptBubble(
  anchor: Vec3,
  size: BubbleSize,
  speech: BubbleRect | undefined,
  options: StackOptions,
  out: MutableStackPlacement = { kind: 'alone', x: 0, y: 0, z: 0 },
): StackPlacement {
  if (speech === undefined || !overlapsAt(anchor, size, speech, options.gapM)) {
    out.kind = 'alone';
    out.x = anchor.x;
    out.y = anchor.y;
    out.z = anchor.z;
    return out;
  }
  const y = speech.center.y + speech.halfHeightM + options.gapM + size.halfHeightM;
  out.x = speech.center.x;
  out.y = y;
  out.z = speech.center.z;
  out.kind = y > options.maxCenterY ? 'replaced' : 'stacked';
  return out;
}

/** `bubblesOverlap` for the transcript at `center`, without building a rectangle. */
function overlapsAt(center: Vec3, size: BubbleSize, speech: BubbleRect, marginM: number): boolean {
  const dy = Math.abs(center.y - speech.center.y);
  if (dy >= size.halfHeightM + speech.halfHeightM + marginM) return false;
  const horizontal = Math.hypot(center.x - speech.center.x, center.z - speech.center.z);
  return horizontal < size.halfWidthM + speech.halfWidthM + marginM;
}
