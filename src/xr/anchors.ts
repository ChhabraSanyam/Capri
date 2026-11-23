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
 * `createAnchor` and `getPose` only work on an active frame, so every call runs inside a
 * `session.requestAnimationFrame` callback (`inNextFrame`). In an `unbounded` session a refused
 * `createAnchor` is retried once against a `local` space (task 33.1). Anchor objects stay alive for the session so their handles stay
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

/**
 * Run `use` inside the next XR frame callback, while the frame is still active, and resolve with its
 * result. `undefined` when the session ends, the wait times out, or `use` throws. Frame calls such as
 * `createAnchor` and `getPose` must happen inside the callback: after an `await` the frame may be
 * inactive already (IWER, the emulator, runs every frame callback before any continuation; task 33.1).
 */
function inNextFrame<T>(session: XRSession, timeoutMs: number, use: (frame: XRFrame) => T): Promise<T | undefined> {
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
        try {
          resolve(use(frame));
        } catch {
          resolve(undefined);
        }
      });
    } catch {
      done = true;
      clearTimeout(timer);
      resolve(undefined);
    }
  });
}

/**
 * `position`, given in `from`, expressed in `to`, or `undefined` when the frame cannot relate the
 * two spaces. `frame.getPose(from, to)` is the pose of `from`'s origin in `to`, and its column-major
 * matrix maps `from` coordinates to `to` coordinates.
 */
export function positionInSpace(frame: XRFrame, from: XRSpace, to: XRSpace, position: Vec3): Vec3 | undefined {
  const pose = frame.getPose(from, to);
  if (pose === undefined || pose === null) return undefined;
  const m = pose.transform.matrix;
  const { x, y, z } = position;
  return {
    x: m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    y: m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    z: m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  };
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
  let localSpace: { session: XRSession; space: XRReferenceSpace | undefined } | undefined;

  // A `local` space for the anchor fallback, requested once per session.
  const localSpaceFor = async (session: XRSession): Promise<XRReferenceSpace | undefined> => {
    if (localSpace?.session === session) return localSpace.space;
    let space: XRReferenceSpace | undefined;
    try {
      space = await session.requestReferenceSpace('local');
    } catch {
      space = undefined;
    }
    localSpace = { session, space };
    return space;
  };

  /**
   * Create an anchor at `position` (in the session space). Quest Browser has been reported to refuse
   * `XRFrame.createAnchor` against an `unbounded` space while accepting it in `local-floor` (Babylon.js
   * forum, Quest 3, April 2025; task 33.1). If the first call fails, the same point is anchored once
   * more against a `local` space on the next frame. The anchor is fixed in the room either way, and
   * `restore` reads it back against the session space.
   */
  const createAnchorAt = async (session: XRSession, space: XRReferenceSpace, position: Vec3): Promise<XRAnchor | undefined> => {
    const at = (p: Vec3): XRRigidTransform => new XRRigidTransform({ x: p.x, y: p.y, z: p.z, w: 1 });
    try {
      return await inNextFrame(session, frameTimeoutMs, (frame) => frame.createAnchor?.(at(position), space));
    } catch (first) {
      const local = await localSpaceFor(session);
      if (local === undefined || local === space) throw first;
      const retried = await inNextFrame(session, frameTimeoutMs, (frame) => {
        const p = positionInSpace(frame, space, local, position);
        return p === undefined ? undefined : frame.createAnchor?.(at(p), local);
      });
      if (retried === undefined) throw first;
      return retried;
    }
  };

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
        anchor = await createAnchorAt(session, space, position);
        if (anchor === undefined) return undefined;
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
        const target = anchor;
        const deadline = Date.now() + restoreTimeoutMs;
        while (Date.now() < deadline) {
          const found = await inNextFrame(session, frameTimeoutMs, (frame): Vec3 | undefined => {
            const space = source.getReferenceSpace();
            if (space === null) return undefined;
            const tracked = frame.trackedAnchors === undefined || frame.trackedAnchors.has(target);
            const pose = tracked ? frame.getPose(target.anchorSpace, space) : undefined;
            if (pose === undefined || pose === null) return undefined;
            const p = pose.transform.position;
            return { x: p.x, y: p.y, z: p.z };
          });
          if (found !== undefined) {
            live.set(handle, target);
            return found;
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
