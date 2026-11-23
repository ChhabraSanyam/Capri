import { buildSessionInit, type ReferenceSpaceSpec, type XRFeatureOptions } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import project from '../../iwsdk.config.json';
import { createEventBus, type AppEvents } from '../../src/app/events.js';
import { createLogger, type LogLevel } from '../../src/app/logger.js';
import { wireSpaceReset, type SpaceResetTargets } from '../../src/app/space-reset.js';
import { DeviceRegistry, type DeviceRecord } from '../../src/domain/devices/registry.js';
import { flagUnanchoredApproximate } from '../../src/domain/devices/restore.js';
import type { Vec3 } from '../../src/domain/geometry.js';
import { AnchorDeviceStore, type AnchorPort } from '../../src/persistence/anchor-store.js';
import type { DeviceStore } from '../../src/persistence/device-store.js';
import { positionInSpace } from '../../src/xr/anchors.js';
import { grantedReferenceSpaceType, watchReferenceSpace, type XrManagerPort } from '../../src/xr/session.js';

/** Task 33.1, Requirements 33.1 to 33.5. */

const spec = project.world.xr.referenceSpace as ReferenceSpaceSpec;

function capture(): { logger: ReturnType<typeof createLogger>; lines: { level: LogLevel; line: string }[] } {
  const lines: { level: LogLevel; line: string }[] = [];
  return { logger: createLogger('test', (level, line) => lines.push({ level, line })), lines };
}

/** A session that grants only the listed reference space types, like a runtime that refuses others. */
function fakeSession(granted: readonly string[]): XRSession {
  return {
    requestReferenceSpace: (type: string) =>
      granted.includes(type)
        ? Promise.resolve(new EventTarget() as unknown as XRReferenceSpace)
        : Promise.reject(new DOMException('The requested reference space type is not supported.', 'NotSupportedError')),
  } as unknown as XRSession;
}

function record(id: string, position: Vec3, extra: Partial<DeviceRecord> = {}): DeviceRecord {
  return { id, entityId: `light.${id}`, name: id, aliases: [], position, ...extra };
}

describe('the boundaryless session request (iwsdk.config.json)', () => {
  it('asks for unbounded with local-floor, local, viewer as the fallback order', () => {
    expect(spec).toEqual({ type: 'unbounded', fallbackOrder: ['local-floor', 'local', 'viewer'] });
  });

  it('requests the unbounded and local-floor features so the runtime may grant either space', () => {
    const init = buildSessionInit({ features: project.world.xr.features as XRFeatureOptions });
    expect(init.optionalFeatures).toEqual(expect.arrayContaining(['unbounded', 'local-floor']));
    expect(init.requiredFeatures).toEqual(['hand-tracking']);
  });
});

describe('grantedReferenceSpaceType (the IWSDK probe)', () => {
  it('grants unbounded when the runtime offers it', async () => {
    expect(await grantedReferenceSpaceType(fakeSession(['unbounded', 'local-floor', 'local', 'viewer']), spec)).toBe('unbounded');
  });

  it('falls back to local-floor when unbounded is refused', async () => {
    expect(await grantedReferenceSpaceType(fakeSession(['local-floor', 'local', 'viewer']), spec)).toBe('local-floor');
  });

  it('keeps going down the list, and reports none when nothing resolves', async () => {
    expect(await grantedReferenceSpaceType(fakeSession(['viewer']), spec)).toBe('viewer');
    expect(await grantedReferenceSpaceType(fakeSession([]), spec)).toBeUndefined();
  });
});

class FakeXrManager implements XrManagerPort {
  readonly target = new EventTarget();
  space: XRReferenceSpace | null = null;
  session: XRSession | null = null;
  private readonly wrapped = new Map<() => void, EventListener>();
  addEventListener(type: 'sessionstart' | 'sessionend', listener: () => void): void {
    const wrapped: EventListener = () => listener();
    this.wrapped.set(listener, wrapped);
    this.target.addEventListener(type, wrapped);
  }
  removeEventListener(type: 'sessionstart' | 'sessionend', listener: () => void): void {
    const wrapped = this.wrapped.get(listener);
    if (wrapped !== undefined) this.target.removeEventListener(type, wrapped);
  }
  getReferenceSpace(): XRReferenceSpace | null {
    return this.space;
  }
  getSession(): XRSession | null {
    return this.session;
  }
  start(granted: readonly string[]): EventTarget {
    const space = new EventTarget();
    this.space = space as unknown as XRReferenceSpace;
    this.session = fakeSession(granted);
    this.target.dispatchEvent(new Event('sessionstart'));
    return space;
  }
  end(): void {
    this.target.dispatchEvent(new Event('sessionend'));
    this.space = null;
    this.session = null;
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('watchReferenceSpace', () => {
  it('logs the granted type once and forwards reset as space:reset until the session ends', async () => {
    const xr = new FakeXrManager();
    const events = createEventBus<AppEvents>();
    const resets: (string | undefined)[] = [];
    events.on('space:reset', ({ type }) => resets.push(type));
    const { logger, lines } = capture();
    const stop = watchReferenceSpace({ xr, spec, events, logger });

    const space = xr.start(['local-floor', 'local', 'viewer']);
    await settle();
    expect(lines.filter((l) => l.line.includes('reference space:'))).toHaveLength(1);
    expect(lines.some((l) => l.level === 'warn' && l.line.includes('unbounded was refused, using local-floor'))).toBe(true);

    space.dispatchEvent(new Event('reset'));
    expect(resets).toEqual(['local-floor']);

    xr.end();
    space.dispatchEvent(new Event('reset'));
    expect(resets).toHaveLength(1);

    const next = xr.start(['unbounded', 'local-floor', 'local', 'viewer']);
    await settle();
    expect(lines.some((l) => l.level === 'info' && l.line.includes('unbounded granted'))).toBe(true);
    next.dispatchEvent(new Event('reset'));
    expect(resets).toEqual(['local-floor', 'unbounded']);

    stop();
    next.dispatchEvent(new Event('reset'));
    xr.start(['unbounded']).dispatchEvent(new Event('reset'));
    expect(resets).toHaveLength(2);
  });
});

describe('wireSpaceReset', () => {
  function targets() {
    const calls: string[] = [];
    let skipped: readonly string[] = [];
    const t: SpaceResetTargets = {
      rescans: [{ requestScan: () => calls.push('floor') }, { requestScan: () => calls.push('surfaces') }],
      devices: {
        onSpaceReset: (skip) => {
          skipped = skip;
          calls.push('devices');
          return ['desk lamp'];
        },
      },
      getMockBulbs: () => ({ entityIds: ['light.mock_a'], replaceFromHead: () => calls.push('bulbs') }),
      avatar: { recomputeHome: () => calls.push('avatar') },
    };
    return { t, calls, skipped: () => skipped };
  }

  it('rescans the floor, re-places bulbs, re-reads devices, and re-homes Capri on each reset', () => {
    const events = createEventBus<AppEvents>();
    const { t, calls, skipped } = targets();
    const { logger, lines } = capture();
    const off = wireSpaceReset(events, t, logger);
    events.emit('space:reset', { type: 'unbounded' });
    expect(calls).toEqual(['floor', 'surfaces', 'bulbs', 'devices', 'avatar']);
    expect(skipped()).toEqual(['light.mock_a']);
    expect(lines.some((l) => l.level === 'warn' && l.line.includes('desk lamp') && l.line.includes('Re-teach lights'))).toBe(true);
    off();
    events.emit('space:reset', { type: 'unbounded' });
    expect(calls).toHaveLength(5);
  });

  it('works without mock bulbs (Live Mode)', () => {
    const events = createEventBus<AppEvents>();
    const { t, calls, skipped } = targets();
    wireSpaceReset(events, { ...t, getMockBulbs: () => undefined }, capture().logger);
    events.emit('space:reset', { type: 'local-floor' });
    expect(calls).toEqual(['floor', 'surfaces', 'devices', 'avatar']);
    expect(skipped()).toEqual([]);
  });
});

describe('flagUnanchoredApproximate', () => {
  const at: Vec3 = { x: 1, y: 1, z: -1 };

  it('flags records without an anchor and leaves anchored and skipped ones alone', () => {
    const records = [
      record('lamp', at),
      record('ceiling', at, { anchorHandle: 'h1' }),
      { ...record('bulb', at), entityId: 'light.mock_a' },
    ];
    const result = flagUnanchoredApproximate(records, ['light.mock_a']);
    expect(result.changed).toBe(true);
    expect(result.names).toEqual(['lamp']);
    expect(result.records.map((r) => r.approximate === true)).toEqual([true, false, false]);
    expect(result.records[0]!.position).toEqual(at);
  });

  it('reports already flagged records without changing the list', () => {
    const records = [record('lamp', at, { approximate: true }), record('ceiling', at, { anchorHandle: 'h1' })];
    const result = flagUnanchoredApproximate(records);
    expect(result.changed).toBe(false);
    expect(result.records).toBe(records);
    expect(result.names).toEqual(['lamp']);
  });

  it('is cleared when the light is taught again', () => {
    const registry = new DeviceRegistry({ initial: [record('lamp', at, { approximate: true })] });
    const taught = registry.add({ entityId: 'light.lamp', name: 'lamp', position: { x: 2, y: 1, z: -1 } });
    expect(taught?.approximate).toBeUndefined();
    expect(registry.all()).toHaveLength(1);
  });
});

describe('re-reading anchors after a reset', () => {
  class MemoryStore implements DeviceStore {
    constructor(private records: readonly DeviceRecord[]) {}
    load(): Promise<DeviceRecord[]> {
      return Promise.resolve([...this.records]);
    }
    save(records: readonly DeviceRecord[]): Promise<void> {
      this.records = [...records];
      return Promise.resolve();
    }
  }

  it('moves anchored records to where their anchor is seen from the new origin', async () => {
    // The anchor stays put in the room. After the origin moved 0.5 m along +X, the same anchor reads
    // 0.5 m smaller in X.
    let shift = 0;
    const port: AnchorPort = {
      isReady: () => true,
      persist: () => Promise.resolve(undefined),
      restore: (handle) => Promise.resolve(handle === 'h1' ? { x: 1 - shift, y: 1, z: -2 } : undefined),
      release: () => Promise.resolve(),
    };
    const stored = [record('lamp', { x: 1, y: 1, z: -2 }, { anchorHandle: 'h1' }), record('fan', { x: 3, y: 1, z: 0 })];
    const store = new AnchorDeviceStore(new MemoryStore(stored), port);
    shift = 0.5;
    const restored = await store.restoreAnchors(stored);
    expect(restored[0]!.position).toEqual({ x: 0.5, y: 1, z: -2 });
    expect(restored[1]!.position).toEqual({ x: 3, y: 1, z: 0 });
  });
});

describe('positionInSpace (the anchor fallback to a local space)', () => {
  it('maps a point through the pose of one space in another', () => {
    // `from`'s origin sits at (1, 0, -2) in `to`, turned 90 degrees about +Y (x -> -z).
    const matrix = new Float32Array([0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, -2, 1]);
    const frame = { getPose: () => ({ transform: { matrix } }) } as unknown as XRFrame;
    const space = {} as XRSpace;
    const p = positionInSpace(frame, space, space, { x: 1, y: 1.5, z: 0 })!;
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(1.5);
    expect(p.z).toBeCloseTo(-3);
  });

  it('returns undefined when the frame cannot relate the spaces', () => {
    const frame = { getPose: () => undefined } as unknown as XRFrame;
    expect(positionInSpace(frame, {} as XRSpace, {} as XRSpace, { x: 0, y: 0, z: 0 })).toBeUndefined();
  });
});
