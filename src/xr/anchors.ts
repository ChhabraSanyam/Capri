/**
 * WebXR adapter for persistent device anchors (task 9.3, Requirements 12.5, 12.10).
 *
 * Implements the `AnchorPort` that `AnchorDeviceStore` uses. It follows the calls the Milestone 0
 * spike proved on Quest (`src/spike/items/b.ts`, A5): `anchor.requestPersistentHandle()` to save a
 * handle, `session.restorePersistentAnchor(handle)` after a reload, `frame.getPose(anchor.anchorSpace)`
 * once the anchor is tracked, and `session.deletePersistentAnchor(handle)` to forget one.
 *
 * Anchors are created with `XRFrame.createAnchor(pose, space)` at a known position. The spike
 * created its anchors from an `XRHitTestResult` (`result.createAnchor()`), and the frame based path
 * was only a fallback that was not measured. If a runtime refuses it, `persist` returns `undefined`
 * and the store keeps the position in localStorage.
 *
 * A restored anchor can be about 10 cm from where it was saved. The position returned by `restore`
 * is approximate and callers must not present it as exact (Requirement 12.12).
 *
 * `createAnchor` and `getPose` only work on an active frame, so every call waits for one through
 * `session.requestAnimationFrame`. Anchor objects stay alive for the session so their handles stay
 * valid, and are deleted on `release`. Positions are in the session reference space. This adapter
 * never calls `getUserMedia` or reads a gamepad.
 */
import type { Vec3 } from '../domain/geometry.js';
import type { AnchorPort } from '../persistence/anchor-store.js';

export interface XrAnchorSource {
  getSession(): XRSession | undefined;
  getReferenceSpace(): XRReferenceSpace | null;
}

export interface WebXrAnchorOptions {
  /** How long to wait for one frame, in ms. */
  readonly frameTimeoutMs?: number;
  /** How long to wait for a restored anchor to be tracked, in ms. */
  readonly restoreTimeoutMs?: number;
}

const DEFAULT_FRAME_TIMEOUT_MS = 2000;
const DEFAULT_RESTORE_TIMEOUT_MS = 6000;

/** Resolve with the next XR frame, or `undefined` when the session ends or the wait times out. */
function nextFrame(session: XRSession, timeoutMs: number): Promise<XRFrame | undefined> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(undefined);
      }
    }, timeoutMs);
    try {
      session.requestAnimationFrame((_time, frame) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(frame);
      });
    } catch {
      done = true;
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}

function deleteQuietly(anchor: XRAnchor): void {
  try {
    anchor.delete();
  } catch {
    // The session may already be gone.
  }
}

export function createWebXrAnchorPort(source: XrAnchorSource, options: WebXrAnchorOptions = {}): AnchorPort {
  const frameTimeoutMs = options.frameTimeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS;
  const restoreTimeoutMs = options.restoreTimeoutMs ?? DEFAULT_RESTORE_TIMEOUT_MS;
  const live = new Map<string, XRAnchor>();
  let liveSession: XRSession | undefined;

  // Anchor objects belong to the session that made them. After a new session starts, a handle has to
  // be restored again, so the cache from the old session is dropped.
  const supported = (session: XRSession | undefined): session is XRSession => {
    if (session !== liveSession) {
      live.clear();
      liveSession = session;
    }
    return (
      session !== undefined &&
      typeof session.restorePersistentAnchor === 'function' &&
      typeof session.requestAnimationFrame === 'function'
    );
  };

  return {
    isReady(): boolean {
      return supported(source.getSession()) && source.getReferenceSpace() !== null;
    },

    async persist(position: Vec3): Promise<string | undefined> {
      const session = source.getSession();
      const space = source.getReferenceSpace();
      if (!supported(session) || space === null) return undefined;
      let anchor: XRAnchor | undefined;
      try {
        const frame = await nextFrame(session, frameTimeoutMs);
        if (frame === undefined || typeof frame.createAnchor !== 'function') return undefined;
        const transform = new XRRigidTransform({ x: position.x, y: position.y, z: position.z, w: 1 });
        anchor = await frame.createAnchor(transform, space);
        if (typeof anchor.requestPersistentHandle !== 'function') {
          deleteQuietly(anchor);
          return undefined;
        }
        const handle = await anchor.requestPersistentHandle();
        if (handle.length === 0) {
          deleteQuietly(anchor);
          return undefined;
        }
        live.set(handle, anchor);
        return handle;
      } catch {
        if (anchor !== undefined) deleteQuietly(anchor);
        return undefined;
      }
    },

    async restore(handle: string): Promise<Vec3 | undefined> {
      const session = source.getSession();
      if (!supported(session)) return undefined;
      let anchor = live.get(handle);
      try {
        anchor ??= await session.restorePersistentAnchor!(handle);
        const deadline = Date.now() + restoreTimeoutMs;
        while (Date.now() < deadline) {
          const frame = await nextFrame(session, frameTimeoutMs);
          const space = source.getReferenceSpace();
          if (frame === undefined || space === null) continue;
          const tracked = frame.trackedAnchors === undefined || frame.trackedAnchors.has(anchor);
          const pose = tracked ? frame.getPose(anchor.anchorSpace, space) : undefined;
          if (pose !== undefined) {
            live.set(handle, anchor);
            const p = pose.transform.position;
            return { x: p.x, y: p.y, z: p.z };
          }
        }
      } catch {
        // Fall through: the caller keeps the stored position.
      }
      if (anchor !== undefined && !live.has(handle)) deleteQuietly(anchor);
      return undefined;
    },

    async release(handle: string): Promise<void> {
      const anchor = live.get(handle);
      if (anchor !== undefined) {
        deleteQuietly(anchor);
        live.delete(handle);
      }
      const session = source.getSession();
      if (session !== undefined && typeof session.deletePersistentAnchor === 'function') {
        try {
          await session.deletePersistentAnchor(handle);
        } catch {
          // Already gone, or the runtime refused. Nothing else to do.
        }
      }
    },
  };
}
