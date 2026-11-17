/**
 * Speech presenter (task 13.20): puts the engine's bubble above the Avatar, turned to the user's
 * head, and plays the speaking gesture on the Avatar's animator. The full Speech_Bubble panel is
 * task 13.23. This uses the existing world-space `SpeechBubble`.
 */
import type { SpeechPresenter } from '../audio/audio-engine.js';
import { PLAIN_PERSONA_BUBBLE } from '../config/constants.js';
import type { Animator } from '../domain/animation-types.js';
import type { Vec3 } from '../domain/geometry.js';
import type { SpeechBubble } from './speech-bubble.js';

export interface SpeechPresenterDeps {
  readonly bubble: SpeechBubble;
  readonly getAvatarPosition: () => Vec3;
  readonly getHeadPosition: () => Vec3;
  readonly getAnimator: () => Pick<Animator, 'play'> | undefined;
}

export function createSpeechPresenter(deps: SpeechPresenterDeps): SpeechPresenter {
  return {
    showBubble(text) {
      const feet = deps.getAvatarPosition();
      deps.bubble.show(
        text,
        { x: feet.x, y: feet.y + PLAIN_PERSONA_BUBBLE.heightAboveFeetM, z: feet.z },
        deps.getHeadPosition(),
      );
    },
    hideBubble() {
      deps.bubble.hide();
    },
    playGesture(gesture) {
      void deps.getAnimator()?.play(gesture).catch(() => undefined);
    },
  };
}
