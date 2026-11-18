/**
 * Resume hand guard (task 27.2, Requirement 28.2). Closing the Meta system menu is itself a pinch,
 * and when the session turns visible again the hand can still be closed. Every pinch reader in the
 * app (push-to-talk, the pointing confirm, the panel presses, the teach flow and orb) would see that
 * as a new pinch. So after a resume, a hand reads as untracked until it has been seen open (thumb and
 * index apart by more than `PINCH.offAboveM`), or until `PAUSE.handGuardMaxS` has passed.
 *
 * Untracked is a state every reader already handles (hand tracking can drop at any time), so this
 * needs no change in them. `apply` runs in the `readFrame` stage right after the hand source fills
 * the frame. It allocates nothing. No Three.js and no IWSDK.
 */
import { PAUSE, PINCH } from '../config/constants.js';
import { pinchDistance, type HandSide } from '../domain/pointing/pinch.js';
import type { FrameContext } from './frame-context.js';

export class ResumeHandGuard {
  private left = false;
  private right = false;
  private remainingS = 0;

  /** True while at least one hand is still held back. */
  get active(): boolean {
    return this.left || this.right;
  }

  /** Called on resume: hold both hands back until they open. */
  arm(): void {
    this.left = true;
    this.right = true;
    this.remainingS = PAUSE.handGuardMaxS;
  }

  reset(): void {
    this.left = false;
    this.right = false;
    this.remainingS = 0;
  }

  apply(frame: FrameContext): void {
    if (!this.left && !this.right) return;
    const dt = Number.isFinite(frame.dt) && frame.dt > 0 ? frame.dt : 0;
    this.remainingS -= dt;
    if (this.remainingS <= 0 || !frame.inSession) {
      this.reset();
      return;
    }
    if (this.left) this.left = this.hold(frame, 'left');
    if (this.right) this.right = this.hold(frame, 'right');
  }

  /** True while the hand stays held back. A held hand is masked as untracked for this frame. */
  private hold(frame: FrameContext, side: HandSide): boolean {
    const hand = frame.hands[side];
    if (hand.tracked && pinchDistance(hand.joints) > PINCH.offAboveM) return false;
    hand.tracked = false;
    hand.pinching = false;
    return true;
  }
}
