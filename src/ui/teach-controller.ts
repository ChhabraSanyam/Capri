/**
 * Hand input for the teach flow (task 9.7, Requirements 12.1, 12.2). Reads the pinch of both hands
 * from the frame's core joints and drives `TeachFlow`. It imports no Three.js and no IWSDK, so the
 * logic runs under Node with a fake frame. `HitCapture` (`xr/hit-capture.ts`) is the `PointSource`
 * in the app, and a `DeviceMarker` can be the preview marker.
 *
 * Why it reads joints itself: the IWER emulator did not deliver pokes or ray clicks to UIKit
 * buttons, so on-headset hand input on panels is unverified (A6). The flow therefore never needs a
 * button:
 *
 * | State          | Dominant-hand pinch                 | Other-hand pinch              |
 * | -------------- | ----------------------------------- | ----------------------------- |
 * | AwaitPoint     | capture the pointed-at point        | none                          |
 * | Captured       | confirm the point (2.0 m fallback)  | try again                     |
 * | PickEntity     | choose the highlighted row          | move the highlight to next row|
 * | PickNickname   | choose the highlighted row          | move the highlight to next row|
 * | Stored         | done                                | none                          |
 *
 * The other-hand pinch is push-to-talk in every row where the table says "none" (task 32.2,
 * Requirement 15.6). `ownsOtherPinch` tells the voice loop which rows those are. In the rows that
 * use it, the panel shows how to talk instead (`TeachView.talkHint`: poke the mic orb) and keeps
 * **Cancel** visible.
 *
 * The panel buttons (poke or ray pinch through UIKit) do the same transitions when they work.
 * A pinch aimed at the floating panel is left to its buttons: when the pinching hand's pointing ray
 * passes through the panel's rectangle (or the fingertip touches it), this controller ignores it, so a button press never
 * also captures a point or picks the highlighted row.
 *
 * `update` allocates nothing on a frame without a pinch. A pinch edge copies one ray.
 */
import type { FrameContext } from '../app/frame-context.js';
import type { Logger } from '../app/logger.js';
import { TEACH_FLOW } from '../config/constants.js';
import type { Ray, Vec3 } from '../domain/geometry.js';
import type { CapturedPoint } from '../domain/pointing/capture.js';
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
  capture(ray: Ray, surfaces: readonly Surface[]): CapturedPoint;
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
    if (this.deps.flow.state.kind === 'idle') return;
    if (dominantEdge === 'start') this.onDominantPinch();
    if (otherEdge === 'start') this.onOtherPinch();
  }

  /** True while the current step uses the other hand's pinch, so it must not also start talking. */
  get ownsOtherPinch(): boolean {
    return teachUsesOtherPinch(this.deps.flow.state.kind);
  }

  /** Forget pinch state, for example when the session ends. */
  reset(): void {
    this.dominantPinch.reset();
    this.otherPinch.reset();
    this.dominantRay.reset();
    this.otherRay.reset();
  }

  dispose(): void {
    this.unsubscribe();
    this.deps.points.setActive(false);
    this.deps.preview?.setVisible(false);
  }

  private onState(state: TeachState): void {
    this.deps.points.setActive(state.kind === 'awaitPoint');
    const preview = this.deps.preview;
    if (preview === undefined) return;
    if (state.kind === 'captured' || state.kind === 'pickEntity' || state.kind === 'pickNickname') {
      preview.setPosition(state.position);
      preview.setVisible(true);
    } else {
      preview.setVisible(false);
    }
  }

  /** Copy of the smoothed ray, or `undefined` when the pinch was aimed at the panel or has no ray. */
  private rayAwayFromPanel(aim: PointingRay): Ray | undefined {
    const ray = aim.snapshot();
    if (ray === undefined) return undefined;
    const panel = this.deps.getPanelRect();
    if (panel !== undefined && rayHitsPanel(ray, panel, TEACH_FLOW.panelMarginM)) return undefined;
    return ray;
  }

  private onDominantPinch(): void {
    const flow = this.deps.flow;
    const ray = this.rayAwayFromPanel(this.dominantRay);
    if (ray === undefined) return;
    switch (flow.state.kind) {
      case 'awaitPoint': {
        const point = this.deps.points.capture(ray, this.deps.getSurfaces());
        flow.capture(point, ray);
        this.deps.logger?.info(`teach: captured a point from ${point.source}`);
        break;
      }
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
