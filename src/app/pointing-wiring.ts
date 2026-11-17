/**
 * Pointing wiring (task 11.7, Requirements 13.4, 13.5, 13.7, 13.9). Connects the pure pointing code
 * to the app. It imports no Three.js and no IWSDK, so the stage logic runs under Node with a fake
 * frame. The markers and the Avatar are reached through the `PointingView` port.
 *
 * Each frame (`update`, called from the `pointing` stage):
 * 1. the dominant hand's two rays are updated: the pointing ray (smoothed, point-pose gate from
 *    `resolvePointPoseGate`) that selects markers, and an ungated aim ray that only answers "was this
 *    pinch aimed at a panel or the orb?". Pinching bends the index finger and drops the ray, so the
 *    aim ray is read from 200 ms before the pinch onset (`RayHistory`), as the selector does;
 * 2. the head gaze ray is read (`GazeProvider`, head forward on Quest). It breaks ties when the
 *    pointing ray passes through more than one hit volume (Requirement 13.6);
 * 3. the `PinchTracker` runs. The dominant hand's `pinchStart` confirms the device that was pointed
 *    at 200 ms earlier (`PointingSelector.confirmFromPinch`), unless the caller says confirming is not
 *    allowed this frame (the teach flow is active) or the pinch was aimed at UI;
 * 4. the `PointingSelector` runs. Its changes go out as `pointed:changed` and `selected:changed` on
 *    the app event bus, set the marker highlight, and turn the Avatar's gaze to the pointed marker
 *    (back to the user when the pointed device clears).
 *
 * `confirmPointed` is the explicit confirm (voice "that one", Requirement 13.8, wired in Step 6).
 *
 * The non-dominant hand's pinch is left alone: it is push-to-talk (Step 6) and teach-flow input.
 * Nothing allocates on a frame without an edge. A pinch edge builds one aim ray snapshot and the UI
 * rectangles. When the session ends the selector, pinch state, and rays are reset once.
 */
import { POINTING } from '../config/constants.js';
import { createGazeRay, type GazeProvider } from '../xr/head.js';
import type { HandSource } from '../xr/hands.js';
import { PinchTracker } from '../domain/pointing/pinch.js';
import { PointingRay } from '../domain/pointing/ray.js';
import { RayHistory } from '../domain/pointing/ray-history.js';
import {
  PointingSelector,
  type PointTarget,
  type PointingEvent,
  type PointingFrame,
} from '../domain/pointing/selector.js';
import { isAimedAtUi, type UiAimTargets } from '../domain/pointing/ui-aim.js';
import type { Vec3 } from '../domain/geometry.js';
import type { AppEvents, EventBus } from './events.js';
import type { FrameContext } from './frame-context.js';
import type { Logger } from './logger.js';

/** What the wiring drives: marker highlight and the Avatar's gaze. */
export interface PointingView {
  /** Show the pointed marker as highlighted, and the selected one as confirmed. `undefined` clears. */
  setHighlight(pointedId: string | undefined, selectedId: string | undefined): void;
  /** Turn the Avatar's head and eyes to a world position, or back to the user. */
  lookAt(target: Vec3 | 'user'): void;
}

export interface PointingWiringDeps {
  readonly events: Pick<EventBus<AppEvents>, 'emit'>;
  /** Supplies `dominantHand`. Read every frame, so the setting can change at run time. */
  readonly hands: Pick<HandSource, 'dominantHand'>;
  readonly gaze: GazeProvider;
  /** The markers that can be pointed at. Must return the same array until the markers change. */
  readonly getTargets: () => readonly PointTarget[];
  /** Panels and the orb a pinch may be aimed at. Called on a pinch edge only. */
  readonly getUiAim: () => UiAimTargets;
  readonly view: PointingView;
  /** Point-pose gate for the pointing ray. Defaults to `featureFlags.pointPoseGate`. */
  readonly requirePointPose?: boolean;
  readonly logger?: Logger;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export class PointingWiring {
  readonly selector = new PointingSelector();

  private side: 'left' | 'right';
  private readonly pointRay: PointingRay;
  /** Ungated aim ray, for the "aimed at UI" test. */
  private readonly aimRay = new PointingRay({ requirePointPose: false });
  private readonly aimHistory = new RayHistory();
  private readonly tracker = new PinchTracker();
  private readonly gazeRay = createGazeRay();
  private readonly pointingFrame: Mutable<PointingFrame> = {
    nowS: 0,
    ray: undefined,
    targets: [],
    gaze: undefined,
  };
  private targets: readonly PointTarget[] = [];
  private nowS = 0;
  private confirmAllowed = false;
  private wasInSession = false;
  private lookRedirected = false;
  private readonly unsubscribers: (() => void)[] = [];

  constructor(private readonly deps: PointingWiringDeps) {
    this.side = deps.hands.dominantHand;
    this.pointRay = new PointingRay(
      deps.requirePointPose === undefined ? {} : { requirePointPose: deps.requirePointPose },
    );
    this.unsubscribers.push(this.selector.subscribe((event) => this.onSelectorEvent(event)));
    this.unsubscribers.push(this.tracker.subscribe((type, hand) => this.onPinch(type, hand)));
  }

  /** Device the dominant index finger points at, or `undefined`. */
  get pointed(): string | undefined {
    return this.selector.pointed;
  }

  /** Device confirmed by a pinch or `confirmPointed`, or `undefined`. */
  get selected(): string | undefined {
    return this.selector.selected;
  }

  /** What "that one" refers to: the selected device, else the pointed one. */
  get deictic(): string | undefined {
    return this.selector.deictic;
  }

  /**
   * Explicit confirm (voice "that one", a dev control): selects the pointed device. Returns its id,
   * or `undefined` when nothing is pointed at.
   */
  confirmPointed(): string | undefined {
    return this.selector.confirmPointed(this.nowS);
  }

  /**
   * The `pointing` stage. `confirmAllowed` is false while another flow owns the dominant pinch (the
   * teach flow). Pass the value from before that flow ran this frame, so the pinch that ends it
   * does not also confirm a device.
   */
  update(frame: FrameContext, confirmAllowed: boolean): void {
    if (!frame.inSession) {
      if (this.wasInSession) this.reset();
      this.wasInSession = false;
      return;
    }
    this.wasInSession = true;

    const dominant = this.deps.hands.dominantHand;
    if (dominant !== this.side) {
      this.side = dominant;
      this.pointRay.reset();
      this.aimRay.reset();
      this.aimHistory.clear();
      this.selector.reset();
    }
    const hand = frame.hands[dominant];
    this.pointRay.update(hand.tracked, hand.joints);
    this.aimRay.update(hand.tracked, hand.joints);
    const gazeValid = this.deps.gaze.read(frame, this.gazeRay);

    this.targets = this.deps.getTargets();
    this.nowS = frame.time;
    this.confirmAllowed = confirmAllowed;
    // Pinch first: it confirms the value recorded up to the previous frame.
    this.tracker.update(frame.hands);
    this.aimHistory.record(frame.time, this.aimRay.ray);

    const pf = this.pointingFrame;
    pf.nowS = frame.time;
    pf.ray = this.pointRay.ray;
    pf.targets = this.targets;
    pf.gaze = gazeValid ? this.gazeRay : undefined;
    this.selector.update(pf);
  }

  /** Forget pointing and pinch state, for example when the session ends. Emits the clears. */
  reset(): void {
    this.tracker.reset();
    this.pointRay.reset();
    this.aimRay.reset();
    this.aimHistory.clear();
    this.selector.reset();
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.reset();
  }

  private onPinch(type: 'pinchStart' | 'pinchEnd', hand: 'left' | 'right'): void {
    if (type !== 'pinchStart' || hand !== this.side || !this.confirmAllowed) return;
    const aim = this.aimHistory.at(this.nowS - POINTING.confirmLookbackS);
    if (aim !== undefined && isAimedAtUi(aim, this.deps.getUiAim())) {
      this.deps.logger?.info('pointing: pinch aimed at UI, not confirming a device');
      return;
    }
    const id = this.selector.confirmFromPinch(this.nowS, this.targets);
    if (id !== undefined) this.deps.logger?.info(`pointing: pinch confirmed ${id}`);
  }

  private onSelectorEvent(event: PointingEvent): void {
    if (event.kind === 'pointed') {
      this.deps.events.emit('pointed:changed', { deviceId: event.id ?? null });
      this.updateGaze(event.id);
    } else {
      this.deps.events.emit('selected:changed', { deviceId: event.id ?? null });
    }
    this.deps.view.setHighlight(this.selector.pointed, this.selector.selected);
  }

  /** The Avatar looks at the pointed marker, and back at the user once it clears (Requirement 13.5). */
  private updateGaze(pointedId: string | undefined): void {
    if (pointedId !== undefined) {
      for (let i = 0; i < this.targets.length; i += 1) {
        const target = this.targets[i]!;
        if (target.id !== pointedId) continue;
        this.deps.view.lookAt(target.position);
        this.lookRedirected = true;
        return;
      }
      return;
    }
    if (this.lookRedirected) {
      this.lookRedirected = false;
      this.deps.view.lookAt('user');
    }
  }
}
