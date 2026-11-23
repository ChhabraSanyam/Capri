/**
 * Ability dispatcher (task 7.10). The one place that turns an ability request into calls on the
 * `AvatarController`: the `?dev=1` panel uses it now, and the intent resolver and the Hermes
 * contract use the same entry later. It reads the room through the `SurfaceSource` (the
 * `SurfaceStore`) and the head through `getHead`.
 *
 * No Three.js, so it runs in Node tests. Requests allocate (a plan, a result); nothing here runs per
 * frame.
 */
import type { SurfaceSource } from '../domain/actions/surface-source.js';
import type { NavigationRequest } from '../domain/actions/abilities.js';
import { planDevAction, type DevActionId } from '../domain/actions/dev-actions.js';
import type { Vec3 } from '../domain/geometry.js';
import type { HeadPose } from '../domain/placement.js';
import type { AbilityResult, AvatarController } from './avatar-controller.js';

/** What a dispatch did. `done` covers the instant abilities (look, point). */
export type DispatchResult = AbilityResult | { readonly status: 'done' };

/** The controller calls the dispatcher needs. `AvatarController` satisfies it. */
export type AbilityTarget = Pick<AvatarController, 'execute' | 'lookAt' | 'pointAt'>;

/** The calls the voice loop makes (task 13.25). `AbilityDispatcher` satisfies it. */
export interface VoiceAbilities {
  navigate(request: NavigationRequest): DispatchResult;
  lookAt(target: Vec3): DispatchResult;
  pointAt(target: Vec3): DispatchResult;
  /** "look at me" (task 33.9): head and eyes back to the user. */
  lookAtUser(): DispatchResult;
}

export interface AbilityDispatcherDeps {
  readonly controller: AbilityTarget;
  readonly surfaces: SurfaceSource;
  /** Head pose, or undefined until the headset has reported one. */
  readonly getHead: () => HeadPose | undefined;
}

export class AbilityDispatcher implements VoiceAbilities {
  constructor(private readonly deps: AbilityDispatcherDeps) {}

  /** Run a navigation ability from the voice loop: `come_here`, `go_away`, `sit_on`, and so on. */
  navigate(request: NavigationRequest): DispatchResult {
    return this.deps.controller.execute(request);
  }

  /** Turn her head and eyes to a world position. */
  lookAt(target: Vec3): DispatchResult {
    this.deps.controller.lookAt(target);
    return { status: 'done' };
  }

  /** Extend her arm and index finger at a world position. */
  pointAt(target: Vec3): DispatchResult {
    this.deps.controller.pointAt(target);
    return { status: 'done' };
  }

  /** Turn her head and eyes back to the user ("look at me"). */
  lookAtUser(): DispatchResult {
    this.deps.controller.lookAt('user');
    return { status: 'done' };
  }

  /** Run one developer test action. `unavailable` means there is no head pose yet. */
  runDevAction(id: DevActionId): DispatchResult {
    const head = this.deps.getHead();
    if (head === undefined) return { status: 'unavailable' };
    const plan = planDevAction(id, head, this.deps.surfaces.all());
    switch (plan.kind) {
      case 'navigate':
        return this.deps.controller.execute(plan.request);
      case 'look_user':
        this.deps.controller.lookAt('user');
        return { status: 'done' };
      case 'point':
        this.deps.controller.pointAt(plan.target);
        return { status: 'done' };
    }
  }
}

/** One short line for the panel's status row. */
export function describeDispatch(label: string, result: DispatchResult): string {
  switch (result.status) {
    case 'started':
      return `${label}: on her way.`;
    case 'done':
      return `${label}: done.`;
    case 'surface_missing':
      return `${label}: surface missing, she stays put.`;
    case 'busy':
      return `${label}: she is busy, try again.`;
    case 'unavailable':
      return `${label}: not ready yet (no head pose).`;
  }
}
