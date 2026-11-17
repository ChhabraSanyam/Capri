/**
 * Plain `PersonaPort` (task 7.8): shows the situation text in a speech bubble above the Avatar for a
 * few seconds. Step 6 replaces it with the real Persona. Call `update(dt)` once per frame from the
 * `vfxUi` stage so the bubble hides itself.
 */
import { PLAIN_PERSONA_BUBBLE } from '../config/constants.js';
import { plainSituationText, type PersonaPort, type PersonaSituation } from '../domain/actions/persona-port.js';
import type { Vec3 } from '../domain/geometry.js';
import type { SpeechBubble } from './speech-bubble.js';

export class PlainBubblePersona implements PersonaPort {
  private remainingS = 0;

  constructor(
    private readonly bubble: SpeechBubble,
    /** Where the Avatar's origin is now. */
    private readonly getAvatarPosition: () => Vec3,
    /** Where the user's head is now, so the bubble faces it. */
    private readonly getHeadPosition: () => Vec3,
  ) {}

  situation(situation: PersonaSituation): void {
    const feet = this.getAvatarPosition();
    const at: Vec3 = { x: feet.x, y: feet.y + PLAIN_PERSONA_BUBBLE.heightAboveFeetM, z: feet.z };
    this.bubble.show(plainSituationText(situation), at, this.getHeadPosition());
    this.remainingS = PLAIN_PERSONA_BUBBLE.holdS;
  }

  update(dtS: number): void {
    if (this.remainingS <= 0) return;
    this.remainingS -= Number.isFinite(dtS) && dtS > 0 ? dtS : 0;
    if (this.remainingS <= 0) this.bubble.hide();
  }
}
