/**
 * Wrist_Button poke (task 33.8, Requirements 33.38, 33.39). Pure and allocation-free.
 *
 * Only a fingertip poke presses the button: the dominant index tip comes within
 * `WRIST_BUTTON.pokeRadiusM` of the button centre while the button is shown. No pinch is read here,
 * because the Quest system reserves the palm-up pinch for its own menu. After a poke the tip must
 * leave `pokeReleaseM` before it can poke again, so a finger resting on the button toggles once.
 * A tip that is already inside the radius when the button appears must leave first, so the button
 * showing up under a finger never toggles the menu by itself.
 */
import { CORE_JOINT, JOINT_FLOATS, WRIST_BUTTON } from '../../config/constants.js';
import type { Vec3 } from '../geometry.js';

export interface PokeHand {
  readonly tracked: boolean;
  readonly joints: ArrayLike<number>;
}

export class WristPokeDetector {
  /** The tip is inside the release distance after a poke (or since the button appeared). */
  private latched = false;
  private wasArmed = false;

  /** True while the tip has not backed off since the last poke. */
  get isTouching(): boolean {
    return this.latched;
  }

  /**
   * One frame. `button` is the button centre while it is shown, else `undefined`. `hand` is the
   * dominant hand. Returns true on the frame of a poke.
   */
  update(hand: PokeHand, button: Vec3 | undefined): boolean {
    if (button === undefined || !hand.tracked) {
      this.latched = false;
      this.wasArmed = false;
      return false;
    }
    const base = CORE_JOINT.indexTip * JOINT_FLOATS;
    const d = Math.hypot(
      hand.joints[base]! - button.x,
      hand.joints[base + 1]! - button.y,
      hand.joints[base + 2]! - button.z,
    );
    if (!Number.isFinite(d)) return false;
    if (!this.wasArmed) {
      // The button just appeared (or the hand just came back): a tip already on it must leave first.
      this.wasArmed = true;
      this.latched = d < WRIST_BUTTON.pokeReleaseM;
      return false;
    }
    if (this.latched) {
      if (d > WRIST_BUTTON.pokeReleaseM) this.latched = false;
      return false;
    }
    if (d < WRIST_BUTTON.pokeRadiusM) {
      this.latched = true;
      return true;
    }
    return false;
  }

  reset(): void {
    this.latched = false;
    this.wasArmed = false;
  }
}
