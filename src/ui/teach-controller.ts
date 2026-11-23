/**
 * Hand input for the teach flow (task 9.7, Requirements 12.1, 12.2; task 33.3, Requirements 33.11
 * to 33.16). Reads the pinch of both hands from the frame's core joints and drives `TeachFlow`. It
 * imports no Three.js and no IWSDK, so the logic runs under Node with a fake frame. `HitCapture`
 * (`xr/hit-capture.ts`) is the `PointSource` in the app, a `TeachPointer` (`ui/teach-pointer.ts`)
 * is the pointer, and a `DeviceMarker` can be the preview marker.
 *
 * Teach pointer (task 33.3). While the flow is in `AwaitPoint` and the dominant hand has a ray,
 * every frame captures the pointed-at point into a reused result (`PointSource.captureInto`) and
 * shows a ray from the dominant index fingertip to the Teach_Reticle at that point. The reticle is
 * the capture: a dominant pinch stores the reticle position, never a point at the hand. Pinching
 * bends the index finger, so the pinch takes the reticle as it was `POINTING.confirmLookbackS`
 * (0.2 s) before the pinch onset (`CaptureHistory`), the same lookback the pointing confirm uses.
 * When nothing is hit the reticle sits at the fallback distance (2.0 m by default), and
 * `pointerFallbackM` tells the panel to offer Nearer and Farther.
 *
 * Why it reads joints itself: the IWER emulator did not deliver pokes or ray clicks to UIKit
 * buttons, so on-headset hand input on panels is unverified (A6). The flow therefore never needs a
 * button:
 *
 * | State          | Dominant-hand pinch                 | Other-hand pinch              |
 * | -------------- | ----------------------------------- | ----------------------------- |
 * | AwaitPoint     | capture the reticle point           | none                          |
 * | Captured       | confirm the point (2.0 m fallback)  | try again                     |
 * | PickEntity     | choose the highlighted row          | move the highlight to next row|
 * | PickNickname   | choose the highlighted row          | move the highlight to next row|
 * | Stored         | done                                | none                          |
 *
 * The other-hand pinch is push-to-talk in every row where the table says "none" (task 32.2,
 * Requirement 15.6). `ownsOtherPinch` tells the voice loop which rows those are. In the rows that
 * use it, the panel shows how to talk instead (`TeachView.talkHint`: talking waits for the step) and keeps
 * **Cancel** visible.
 *
 * The panel buttons (poke or ray pinch through UIKit) do the same transitions when they work.
 * A pinch aimed at the floating panel is left to its buttons: when the pinching hand's pointing ray
 * passes through the panel's rectangle (or the fingertip touches it), this controller ignores it, so a button press never
 * also captures a point or picks the highlighted row.
 *
 * `update` allocates nothing on a frame without a pinch, including the pointer frames. A pinch edge
 * copies one ray and one sample.
 */
import type { FrameContext } from '../app/frame-context.js';
import type { Logger } from '../app/logger.js';
import { POINTING, TEACH_FLOW } from '../config/constants.js';
import type { Ray, Vec3 } from '../domain/geometry.js';
import {
  copyCapture,
  createCaptureResult,
  type CaptureResult,
  type CaptureSource,
} from '../domain/pointing/capture.js';
import { CaptureHistory } from '../domain/pointing/capture-history.js';
import type { Surface } from '../domain/surfaces.js';
import type { TeachFlow, TeachState } from '../domain/devices/teach-flow.js';
import { rayHitsPanel, type PanelRect } from '../domain/devices/teach-input.js';
import { teachUsesOtherPinch } from '../domain/devices/teach-view.js';
import { PinchDetector } from '../domain/pointing/pinch.js';
import { PointingRay } from '../domain/pointing/ray.js';

export type TeachHand = 'left' | 'right';

/** What the controller needs from the environment raycast adapter (`HitCapture`). */
export interface PointSource {
  /** Run the environment raycast only while the flow waits for a point. */
  setActive(active: boolean): void;
  /** Capture the pointed-at point into `out` without allocating (`capturePointInto` rules). */
  captureInto(out: CaptureResult, ray: Ray, surfaces: readonly Surface[], head: Vec3): CaptureResult;
  /** Put the Nearer/Farther fallback distance back to the default. Called when a point is awaited. */
  resetFallback?(): void;
}

/** The teach pointer drawn while a point is awaited (`TeachPointer`). */
export interface PointerView {
  /** Show the ray from `tip` to the reticle at `point`. Called every frame; must not allocate. */
  show(tip: Vec3, point: Vec3, source: CaptureSource): void;
  hide(): void;
}

/** The slice of `DeviceMarker` used as the "this spot" preview. */
export interface PreviewMarker {
  setPosition(position: Vec3): void;
  setVisible(visible: boolean): void;
}

export interface TeachControllerDeps {
  readonly flow: TeachFlow;
  readonly points: PointSource;
  readonly getSurfaces: () => readonly Surface[];
  /** The floating panel's rectangle while it is shown, `undefined` while it is hidden. */
  readonly getPanelRect: () => PanelRect | undefined;
  readonly preview?: PreviewMarker;
  readonly pointer?: PointerView;
  /** The dominant hand. Defaults to the right hand. */
  readonly dominant?: TeachHand;
  readonly logger?: Logger;
}

export class TeachController {
  private readonly dominantSide: TeachHand;
  private readonly otherSide: TeachHand;
  private readonly dominantPinch = new PinchDetector();
  private readonly otherPinch = new PinchDetector();
  /** Smoothed aim rays. The point-pose gate is off: a pinch is not a pointing pose. */
  private readonly dominantRay = new PointingRay({ requirePointPose: false });
  private readonly otherRay = new PointingRay({ requirePointPose: false });
  private readonly unsubscribe: () => void;
  /** This frame's capture point, the Teach_Reticle. Valid while `reticleShown`. */
  private readonly reticlePoint = createCaptureResult();
  private readonly history = new CaptureHistory();
  private readonly head = { x: 0, y: 0, z: 0 };
  private reticleShown = false;

  constructor(private readonly deps: TeachControllerDeps) {
    this.dominantSide = deps.dominant ?? 'right';
    this.otherSide = this.dominantSide === 'right' ? 'left' : 'right';
    this.unsubscribe = deps.flow.subscribe((state) => this.onState(state));
    this.onState(deps.flow.state);
  }

  /** Call once per frame (the `pointing` stage). Allocation-free unless a pinch starts. */
  update(frame: FrameContext): void {
    const dominant = frame.hands[this.dominantSide];
    const other = frame.hands[this.otherSide];
    const dominantEdge = this.dominantPinch.update(dominant.tracked, dominant.joints);
    const otherEdge = this.otherPinch.update(other.tracked, other.joints);
    this.dominantRay.update(dominant.tracked, dominant.joints);
    this.otherRay.update(other.tracked, other.joints);
    this.updatePointer(frame);
    if (this.deps.flow.state.kind === 'idle') return;
    if (dominantEdge === 'start') this.onDominantPinch(frame.time);
    if (otherEdge === 'start') this.onOtherPinch();
  }

  /** True while the current step uses the other hand's pinch, so it must not also start talking. */
  get ownsOtherPinch(): boolean {
    return teachUsesOtherPinch(this.deps.flow.state.kind);
  }

  /** The Teach_Reticle point of this frame, or `undefined` while no pointer is shown. Reused object. */
  get reticle(): CaptureResult | undefined {
    return this.reticleShown ? this.reticlePoint : undefined;
  }

  /**
   * The fallback distance while the reticle sits at the fallback (nothing was hit), else
   * `undefined`. The panel shows Nearer and Farther while this is set (Requirement 33.16).
   */
  get pointerFallbackM(): number | undefined {
    return this.reticleShown && this.reticlePoint.source === 'fallback' ? this.reticlePoint.distanceM : undefined;
  }

  /** Forget pinch state, for example when the session ends. */
  reset(): void {
    this.dominantPinch.reset();
    this.otherPinch.reset();
    this.dominantRay.reset();
    this.otherRay.reset();
    this.history.clear();
    this.hidePointer();
  }

  dispose(): void {
    this.unsubscribe();
    this.deps.points.setActive(false);
    this.deps.preview?.setVisible(false);
    this.hidePointer();
  }

  private onState(state: TeachState): void {
    const awaiting = state.kind === 'awaitPoint';
    this.deps.points.setActive(awaiting);
    if (awaiting) {
      this.deps.points.resetFallback?.();
      this.history.clear();
    } else {
      this.hidePointer();
    }
    const preview = this.deps.preview;
    if (preview === undefined) return;
    if (state.kind === 'captured' || state.kind === 'pickEntity' || state.kind === 'pickNickname') {
      preview.setPosition(state.position);
      preview.setVisible(true);
    } else {
      preview.setVisible(false);
    }
  }

  /** Capture this frame's reticle point and draw the pointer, or hide it. Allocation-free. */
  private updatePointer(frame: FrameContext): void {
    const ray = this.dominantRay;
    if (this.deps.flow.state.kind !== 'awaitPoint' || !ray.active) {
      this.history.record(frame.time, undefined, undefined);
      this.hidePointer();
      return;
    }
    const head = frame.head.position;
    this.head.x = head[0]!;
    this.head.y = head[1]!;
    this.head.z = head[2]!;
    this.deps.points.captureInto(this.reticlePoint, ray, this.deps.getSurfaces(), this.head);
    this.history.record(frame.time, ray, this.reticlePoint);
    this.reticleShown = true;
    this.deps.pointer?.show(ray.origin, this.reticlePoint.position, this.reticlePoint.source);
  }

  /** `PointerView.hide` is cheap and idempotent, so it is called on every frame without a pointer. */
  private hidePointer(): void {
    this.reticleShown = false;
    this.deps.pointer?.hide();
  }

  /** Copy of the smoothed ray, or `undefined` when the pinch was aimed at the panel or has no ray. */
  private rayAwayFromPanel(aim: PointingRay): Ray | undefined {
    const ray = aim.snapshot();
    if (ray === undefined) return undefined;
    return this.awayFromPanel(ray) ? ray : undefined;
  }

  private awayFromPanel(ray: Ray): boolean {
    const panel = this.deps.getPanelRect();
    return panel === undefined || !rayHitsPanel(ray, panel, TEACH_FLOW.panelMarginM);
  }

  private onDominantPinch(timeS: number): void {
    const flow = this.deps.flow;
    if (flow.state.kind === 'awaitPoint') {
      this.captureReticle(timeS);
      return;
    }
    const ray = this.rayAwayFromPanel(this.dominantRay);
    if (ray === undefined) return;
    switch (flow.state.kind) {
      case 'captured':
        flow.confirm();
        break;
      case 'pickEntity':
      case 'pickNickname':
        flow.chooseHighlighted();
        break;
      case 'stored':
        flow.done();
        break;
      case 'idle':
        break;
    }
  }

  /**
   * Store the Teach_Reticle point as it was just before the pinch (Requirement 33.12). With no
   * reticle sample yet (the ray only just appeared), capture once along the current ray.
   */
  private captureReticle(timeS: number): void {
    const sample = this.history.at(timeS - POINTING.confirmLookbackS);
    if (sample !== undefined) {
      if (!this.awayFromPanel(sample.ray)) return;
      this.deps.flow.capture(sample.point, sample.ray);
      this.deps.logger?.info(`teach: captured the reticle point from ${sample.point.source}`);
      return;
    }
    const ray = this.rayAwayFromPanel(this.dominantRay);
    if (ray === undefined) return;
    const point = copyCapture(
      this.deps.points.captureInto(createCaptureResult(), ray, this.deps.getSurfaces(), this.head),
    );
    this.deps.flow.capture(point, ray);
    this.deps.logger?.info(`teach: captured a point from ${point.source}`);
  }

  private onOtherPinch(): void {
    const flow = this.deps.flow;
    if (this.rayAwayFromPanel(this.otherRay) === undefined) return;
    switch (flow.state.kind) {
      case 'captured':
        flow.retake();
        break;
      case 'pickEntity':
      case 'pickNickname':
        flow.moveHighlight(1);
        break;
      default:
        break;
    }
  }
}
