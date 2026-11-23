/**
 * Starting the AR session from the entry page, with a readable failure reason.
 *
 * `world.launchXR()` returns nothing and reports a rejected `requestSession` only through
 * `console.error('[XR] Failed to start XR session:', error)`. To show the reason on the page, this
 * module watches `world.sessionRequestPending` and captures that one console message while the
 * request is pending. It never calls `getUserMedia` (Requirement 15.17).
 */
import {
  normalizeReferenceSpec,
  resolveReferenceSpaceType,
  type ReferenceSpaceSpec,
  type World,
  type XROptions,
} from '@iwsdk/core';
import type { Logger } from '../app/logger.js';
import type { FeatureFlags } from '../config/feature-flags.js';

/**
 * Session options that depend on capability flags. With `depthOcclusion` on, depth sensing is
 * requested as an optional feature, so the session still starts where depth is unavailable and the
 * Avatar then renders without occlusion (Requirement 29.11). They merge over the options from
 * `iwsdk.config.json`.
 */
export function sessionOverridesFor(flags: Pick<FeatureFlags, 'depthOcclusion'>): Partial<XROptions> | undefined {
  if (!flags.depthOcclusion) return undefined;
  return { features: { depthSensing: { usage: 'gpu-optimized', format: 'float32' } } };
}

/** Plain-words reason for a failed session request. */
export function describeSessionFailure(error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotSupportedError':
      return 'This browser or headset does not support an AR session with hand tracking. Turn hand tracking on in the headset settings and try again.';
    case 'NotAllowedError':
    case 'SecurityError':
      return 'The browser did not allow the AR session. Accept the prompt in the headset, and open the page over https.';
    case 'InvalidStateError':
      return 'Another immersive session is already running. Close it and try again.';
    default: {
      const detail = error instanceof Error && error.message !== '' ? ` (${error.message})` : '';
      return `The AR session could not start${detail}.`;
    }
  }
}

export interface SessionLaunchOptions {
  /** Called once with the reason when the request ends without a session. */
  readonly onFailure: (reason: string) => void;
  /** Extra XR options merged over the project defaults (see `sessionOverridesFor`). */
  readonly xrOptions?: Partial<XROptions>;
  /** How often to check whether the request has finished. */
  readonly pollMs?: number;
}

/**
 * Request the AR session. Resolves when the request has finished, either with a session or with a
 * failure (reported through `onFailure`).
 */
export function launchSession(world: World, options: SessionLaunchOptions): Promise<void> {
  const pollMs = options.pollMs ?? 100;
  let captured: unknown;
  let sawFailure = false;
  const originalError = console.error;
  console.error = (...args: unknown[]): void => {
    const first = args[0];
    if (typeof first === 'string' && first.startsWith('[XR] Failed to start XR session')) {
      sawFailure = true;
      captured = args[1];
    }
    originalError.apply(console, args);
  };
  const restore = (): void => {
    console.error = originalError;
  };

  try {
    world.launchXR(options.xrOptions);
  } catch (error) {
    restore();
    options.onFailure(describeSessionFailure(error));
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const timer = window.setInterval(() => {
      if (world.sessionRequestPending) return;
      window.clearInterval(timer);
      restore();
      if (world.session === undefined) {
        options.onFailure(
          sawFailure
            ? describeSessionFailure(captured)
            : 'The AR session did not start. Check the headset for a prompt and tap Enter AR again.',
        );
      }
      resolve();
    }, pollMs);
  });
}

// ---- Reference space (task 33.1, Requirements 33.1 to 33.3) -------------------------------------

/**
 * The reference space type IWSDK picks for `spec` on `session`. `iwsdk.config.json` asks for
 * `unbounded` (no room-scale boundary in passthrough) with `local-floor`, `local`, `viewer` as
 * fallbacks. IWSDK 1.1.0 probes them in that order with `session.requestReferenceSpace` and hands the
 * first one that resolves to three.js (`adoptXRSession` in `@iwsdk/core/dist/init/xr.js`). three.js
 * keeps that type private, so this runs the same IWSDK probe again to learn it. `undefined` when
 * none resolves (IWSDK then ends the session).
 */
export async function grantedReferenceSpaceType(
  session: XRSession,
  spec: ReferenceSpaceSpec | undefined,
): Promise<string | undefined> {
  const normalized = normalizeReferenceSpec(spec);
  try {
    return await resolveReferenceSpaceType(session, normalized.type, normalized.required ? [] : normalized.fallbackOrder);
  } catch {
    return undefined;
  }
}

/** The part of three.js's `WebXRManager` (`world.renderer.xr`) the watcher uses. */
export interface XrManagerPort {
  addEventListener(type: 'sessionstart' | 'sessionend', listener: () => void): void;
  removeEventListener(type: 'sessionstart' | 'sessionend', listener: () => void): void;
  getReferenceSpace(): XRReferenceSpace | null;
  getSession(): XRSession | null;
}

export interface ReferenceSpaceWatchDeps {
  readonly xr: XrManagerPort;
  /** The project's reference space policy, `world.xrDefaults?.referenceSpace`. */
  readonly spec: ReferenceSpaceSpec | undefined;
  readonly events: { emit(name: 'space:reset', payload: { type: string | undefined }): void };
  readonly logger: Logger;
}

/**
 * At every session start: log the granted reference space type once, and forward the space's
 * `reset` event (the user recentred, or tracking moved the origin) as `space:reset`. Mirrors how
 * IWSDK's own environment system attaches its reset listener. Returns the teardown.
 */
export function watchReferenceSpace(deps: ReferenceSpaceWatchDeps): () => void {
  const preferred = normalizeReferenceSpec(deps.spec).type;
  let space: XRReferenceSpace | null = null;
  let granted: string | undefined;
  let generation = 0;

  const onReset = (): void => {
    deps.logger.info(`reference space reset (${granted ?? 'unknown type'}): re-placing devices, bulbs, and Capri`);
    deps.events.emit('space:reset', { type: granted });
  };
  const detach = (): void => {
    space?.removeEventListener('reset', onReset);
    space = null;
  };
  const onStart = (): void => {
    detach();
    generation += 1;
    const mine = generation;
    granted = undefined;
    space = deps.xr.getReferenceSpace();
    space?.addEventListener('reset', onReset);
    const session = deps.xr.getSession();
    if (space === null || session === null) {
      deps.logger.warn('reference space: the session started without one');
      return;
    }
    void grantedReferenceSpaceType(session, deps.spec).then((type) => {
      if (mine !== generation) return;
      granted = type;
      if (type === preferred) deps.logger.info(`reference space: ${type} granted`);
      else deps.logger.warn(`reference space: ${preferred} was refused, using ${type ?? 'none'}`);
    });
  };
  const onEnd = (): void => {
    generation += 1;
    granted = undefined;
    detach();
  };

  deps.xr.addEventListener('sessionstart', onStart);
  deps.xr.addEventListener('sessionend', onEnd);
  return () => {
    deps.xr.removeEventListener('sessionstart', onStart);
    deps.xr.removeEventListener('sessionend', onEnd);
    onEnd();
  };
}
