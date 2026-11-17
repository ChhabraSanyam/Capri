/**
 * Starting the AR session from the entry page, with a readable failure reason.
 *
 * `world.launchXR()` returns nothing and reports a rejected `requestSession` only through
 * `console.error('[XR] Failed to start XR session:', error)`. To show the reason on the page, this
 * module watches `world.sessionRequestPending` and captures that one console message while the
 * request is pending. It never calls `getUserMedia` (Requirement 15.17).
 */
import type { World, XROptions } from '@iwsdk/core';
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
