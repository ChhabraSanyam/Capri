/**
 * What happens on a reference space reset (task 33.1, Requirements 33.3, 33.4, 33.5).
 *
 * `xr/session.ts` forwards the space's `reset` event as `space:reset`. The origin has moved, so
 * every stored position may now point somewhere else in the room. Within 0.5 s:
 *  - the floor and Surface scans run again on the next frame, so the standing height still comes
 *    from the floor-labelled plane (Requirement 11.11);
 *  - the Mock Mode bulbs are laid out again from the next head pose;
 *  - anchored lights are re-read from their anchors (the next XR frame), and lights without an
 *    anchor are flagged approximate and logged for "Re-teach lights" (the HUD Lights tile lists them
 *    from task 33.8 on);
 *  - Capri's idle home is recomputed from the next head pose.
 *
 * Everything runs on the next frame or the next XR frame, about 11 to 14 ms after the event.
 */
import type { AppEvents, EventBus } from './events.js';
import type { Logger } from './logger.js';

export interface SpaceResetTargets {
  /** Scans to run again on the next frame (floor tracker, Surface store). */
  readonly rescans: readonly { requestScan(): void }[];
  /**
   * The lights: re-read anchored records from their anchors and flag the others approximate,
   * except `skipEntityIds`. Returns the spoken names of the flagged lights.
   */
  readonly devices: { onSpaceReset(skipEntityIds: readonly string[]): readonly string[] };
  /** The Mock Mode bulbs when they exist (Mock Mode only). */
  readonly getMockBulbs: () => { readonly entityIds: readonly string[]; replaceFromHead(): void } | undefined;
  /** Capri's presence: recompute the idle home from the next head pose. */
  readonly avatar: { recomputeHome(): void };
}

/** Subscribe the reset handling. Returns the unsubscribe function. */
export function wireSpaceReset(events: EventBus<AppEvents>, targets: SpaceResetTargets, logger: Logger): () => void {
  return events.on('space:reset', () => {
    for (const scan of targets.rescans) scan.requestScan();
    const bulbs = targets.getMockBulbs();
    bulbs?.replaceFromHead();
    const flagged = targets.devices.onSpaceReset(bulbs?.entityIds ?? []);
    targets.avatar.recomputeHome();
    if (flagged.length > 0) {
      logger.warn(
        `space reset: ${flagged.join(', ')} ${flagged.length === 1 ? 'has' : 'have'} no anchor, so the position is approximate now. Use "Re-teach lights".`,
      );
    }
  });
}
