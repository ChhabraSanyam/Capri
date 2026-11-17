/**
 * Avatar controller (task 7.8, Requirements 11.1 to 11.5, 11.7, 11.8, 17.4). It runs the navigation
 * abilities (`come_here`, `go_away`, `move_to`, `sit_on`, `perch`) and `look_at` / `point_at`
 * through three collaborators: the surface source (what the room has), the `Locomotion` glide (how
 * she gets there), and the avatar state machine (what she is doing).
 *
 * No Three.js here, so it runs in Node tests. It never allocates per frame: a request allocates
 * (a plan and a promise at most), `update` does not.
 *
 * Hand-off with the idle placement: while `driving` is true, `AvatarPresence` applies `pose` and
 * skips its own follow and idle-ring rules. While it is false, presence places her and reports the
 * result with `syncIdle` so the next trip starts from where she really is.
 *
 * Missing Surface (Requirement 11.7): she stays where she is and the Persona hears a
 * `surface_missing` situation.
 */
import type { Animator } from '../domain/animation-types.js';
import { AvatarStateMachine, type AvatarMode } from '../domain/avatar-state.js';
import { planNavigation, type NavigationRequest } from '../domain/actions/abilities.js';
import type { PersonaPort, SurfaceMissingReason } from '../domain/actions/persona-port.js';
import type { SurfaceSource } from '../domain/actions/surface-source.js';
import type { Vec3 } from '../domain/geometry.js';
import type { HeadPose } from '../domain/placement.js';
import { Locomotion, type BodyPose } from './locomotion.js';

/** The part of the animator the abilities use. `ProceduralAnimator` satisfies it. */
export type AbilityAnimator = Pick<Animator, 'play' | 'setLookTarget' | 'setPointTarget' | 'releasePosture'>;

/** What `AvatarPresence` needs from the controller to hand placement over and back. */
export interface BodyPoseSource {
  /** True while the controller owns her position. */
  readonly driving: boolean;
  readonly pose: BodyPose;
  /** Report where the idle placement put her this frame. */
  syncIdle(x: number, y: number, z: number, yawRad: number): void;
  /** Back to the unanchored idle. Call when a session ends or starts. */
  reset(): void;
}

export type AbilityResult =
  | { readonly status: 'started' }
  | { readonly status: 'surface_missing'; readonly reason: SurfaceMissingReason }
  | { readonly status: 'busy' }
  | { readonly status: 'unavailable' };

export interface AvatarControllerDeps {
  readonly surfaces: SurfaceSource;
  readonly persona: PersonaPort;
  /** The animator, once the VRM has loaded. */
  readonly getAnimator: () => AbilityAnimator | undefined;
  /** Head pose, or undefined until the headset has reported one. */
  readonly getHead: () => HeadPose | undefined;
  /**
   * Called after every mode change. The controller itself holds and releases the sit and perch
   * poses (on arrival and on leaving), so this is for the app's own bookkeeping.
   */
  readonly onModeChange?: (mode: AvatarMode, previous: AvatarMode) => void;
}

function isSeated(mode: AvatarMode): boolean {
  return mode === 'sitting' || mode === 'perched';
}

export class AvatarController implements BodyPoseSource {
  private readonly state = new AvatarStateMachine();
  private readonly locomotion = new Locomotion();
  private pendingPointAt: Vec3 | undefined;
  private modeReported: AvatarMode = 'idle';
  /** True while a sit or perch pose is held on the animator. */
  private postureHeld = false;

  constructor(private readonly deps: AvatarControllerDeps) {}

  get mode(): AvatarMode {
    return this.state.mode;
  }

  get driving(): boolean {
    return this.state.driving;
  }

  get pose(): BodyPose {
    return this.locomotion.pose;
  }

  /** Current glide speed in metres per second (0 when not gliding). */
  get speedMps(): number {
    return this.locomotion.speedMps;
  }

  syncIdle(x: number, y: number, z: number, yawRad: number): void {
    // While driving, the locomotion owns the position. Only an idle placement reports in.
    if (!this.state.driving) this.locomotion.syncIdle(x, y, z, yawRad);
  }

  reset(): void {
    this.state.reset();
    this.locomotion.stop();
    this.pendingPointAt = undefined;
    this.reportMode();
  }

  /**
   * Run a navigation ability. `started` means she is gliding. `surface_missing` means she kept her
   * position and the Persona was told (Requirement 11.7).
   */
  execute(request: NavigationRequest): AbilityResult {
    const head = this.deps.getHead();
    if (head === undefined) return { status: 'unavailable' };
    if (this.state.mode === 'acting') return { status: 'busy' };

    const plan = planNavigation(request, { head, surfaces: this.deps.surfaces.all() });
    if (plan.kind === 'missing') {
      this.deps.persona.situation({ kind: 'surface_missing', surface: plan.surface, reason: plan.reason });
      return { status: 'surface_missing', reason: plan.reason };
    }
    if (!this.locomotion.goTo(plan.destination, plan.facing)) return { status: 'unavailable' };
    this.state.requestMove(plan.purpose);
    this.pendingPointAt = plan.pointAt;
    this.reportMode();
    return { status: 'started' };
  }

  /** `look_at`: turn head and eyes toward a world position, or back to the user (`'user'`) or nowhere (null). */
  lookAt(target: Vec3 | 'user' | null): void {
    this.deps.getAnimator()?.setLookTarget(target);
  }

  /**
   * `point_at`: extend the arm and index finger at the target. The animator turns her head and eyes
   * to the target while she points and gives the look back afterwards.
   */
  pointAt(target: Vec3): void {
    const animator = this.deps.getAnimator();
    if (animator === undefined) return;
    animator.setPointTarget(target);
    void animator.play('point', { target });
  }

  /** Enter `acting` (device action or gesture). False while moving or already acting. */
  beginAction(): boolean {
    const ok = this.state.beginAction();
    if (ok) this.reportMode();
    return ok;
  }

  /** Leave `acting` for the mode she was in. */
  endAction(): void {
    this.state.endAction();
    this.reportMode();
  }

  /** Advance one frame. Run it before the idle stage, so presence reads this frame's pose. */
  update(dtS: number): void {
    if (!this.state.driving) return;
    const head = this.deps.getHead();
    if (head === undefined) return;
    if (!this.locomotion.update(dtS, head)) return;
    if (this.state.mode !== 'moving') return;
    this.state.arrive();
    this.onArrived();
    this.reportMode();
  }

  private onArrived(): void {
    const animator = this.deps.getAnimator();
    const point = this.pendingPointAt;
    this.pendingPointAt = undefined;
    if (animator === undefined) return;
    if (this.state.mode === 'sitting' || this.state.mode === 'perched') {
      this.postureHeld = true;
      void animator.play(this.state.mode === 'sitting' ? 'sit' : 'perch');
    }
    if (point !== undefined) this.pointAt(point);
  }

  private reportMode(): void {
    const now = this.state.mode;
    if (now === this.modeReported) return;
    const previous = this.modeReported;
    this.modeReported = now;
    // Sit and perch hold until she leaves them. `acting` keeps the pose (she resumes it afterwards).
    if (this.postureHeld && !isSeated(now) && now !== 'acting') {
      this.postureHeld = false;
      this.deps.getAnimator()?.releasePosture();
    }
    this.deps.onModeChange?.(now, previous);
  }
}
