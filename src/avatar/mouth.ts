/**
 * Mouth driver (task 13.20, Requirements 16.11, 16.13, 16.14). Each frame it reads the amplitude of
 * the playing tier 1 library audio, runs it through `mouthFrom` (about 40 ms attack, 90 ms release),
 * and hands the result to the animator's `setMouth`, which drives the `aa` expression.
 *
 * Only library audio moves the mouth. When nothing from the library is playing the amplitude is 0, so
 * the mouth closes within the release time and stays shut for tier 2 speech and tier 3 text. There is
 * no synthetic flap. Allocation free.
 */
import { mouthFrom } from '../domain/speech/lip-flap.js';
import type { LipFlapTuning } from '../domain/speech/lip-flap.js';

export interface MouthSource {
  /** RMS of the playing library audio, 0 when none is playing. */
  readonly amplitude: number;
}

export interface MouthTarget {
  setMouth(open01: number): void;
}

export class MouthDriver {
  private open = 0;

  constructor(
    private readonly source: MouthSource,
    /** The animator may not exist yet while the Avatar is loading. */
    private readonly getTarget: () => MouthTarget | undefined,
    private readonly tuning?: LipFlapTuning,
  ) {}

  get value(): number {
    return this.open;
  }

  /** Call once per frame, after the engine's `update`. */
  update(dtS: number): void {
    this.open = this.tuning === undefined
      ? mouthFrom(this.source.amplitude, this.open, dtS)
      : mouthFrom(this.source.amplitude, this.open, dtS, this.tuning);
    this.getTarget()?.setMouth(this.open);
  }

  /** Close the mouth now. */
  reset(): void {
    this.open = 0;
    this.getTarget()?.setMouth(0);
  }
}
