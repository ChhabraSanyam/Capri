import { describe, expect, it } from 'vitest';
import { createMockHome } from '../../src/backends/mock/mock-home.js';
import { err, ok, type LightEntity, type Result } from '../../src/backends/types.js';
import { TEACH_FLOW } from '../../src/config/constants.js';
import { DeviceRegistry } from '../../src/domain/devices/registry.js';
import { TeachFlow, type TeachState } from '../../src/domain/devices/teach-flow.js';
import { buildTeachView } from '../../src/domain/devices/teach-view.js';
import type { CapturedPoint } from '../../src/domain/pointing/capture.js';
import { createLexicon } from '../../src/domain/speech-lang/lexicon.js';

const FALLBACK_LEXICON = createLexicon(
  'mock bulb lamp light desk floor ceiling bedside corner one two three'.split(' '),
);

const RAY = { origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
const SURFACE_POINT: CapturedPoint = {
  position: { x: 0, y: 1, z: -1.5 },
  source: 'surface',
  distanceM: 1.5,
  surfaceId: 's1',
};
const FALLBACK_POINT: CapturedPoint = { position: { x: 0, y: 1, z: -2 }, source: 'fallback', distanceM: 2 };

function light(entityId: string, friendlyName: string): LightEntity {
  return {
    entityId,
    friendlyName,
    supportsColor: true,
    state: { entityId, on: false, brightnessPct: 100, rgb: [255, 255, 255] },
  };
}

function setup(lights: LightEntity[] | Result<LightEntity[]> = [light('mock.bulb_1', 'Mock bulb 1'), light('mock.bulb_2', 'Mock bulb 2')]) {
  let counter = 0;
  const changes: string[] = [];
  const registry = new DeviceRegistry({
    idFactory: () => `id-${++counter}`,
    events: { emit: (name) => changes.push(name) },
  });
  const result: Result<LightEntity[]> = Array.isArray(lights) ? ok(lights) : lights;
  let calls = 0;
  const flow = new TeachFlow({
    registry,
    lexicon: FALLBACK_LEXICON,
    listLights: () => {
      calls += 1;
      return Promise.resolve(result);
    },
  });
  return { flow, registry, changes, calls: () => calls };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
function kinds(flow: TeachFlow): string {
  return flow.state.kind;
}

describe('TeachFlow', () => {
  it('runs Idle -> AwaitPoint -> PickEntity -> Stored on a surface point and stores the position', async () => {
    const { flow, registry, changes } = setup();
    const seen: string[] = [];
    flow.subscribe((s) => seen.push(s.kind));
    flow.start();
    expect(flow.awaitingPoint).toBe(true);
    expect(flow.capture(SURFACE_POINT, RAY)).toBe(true);
    expect(kinds(flow)).toBe('pickEntity');
    await tick();
    expect(flow.choiceCount()).toBe(2);
    expect(flow.choose(1)).toBe(true);
    expect(flow.state.kind).toBe('stored');
    expect(registry.all()).toHaveLength(1);
    expect(registry.all()[0]).toMatchObject({ entityId: 'mock.bulb_2', name: 'mock bulb two', position: SURFACE_POINT.position });
    expect(changes).toEqual(['registry:changed']);
    expect(seen).toEqual(['awaitPoint', 'pickEntity', 'pickEntity', 'stored']);
    expect(flow.done()).toBe(true);
    expect(kinds(flow)).toBe('idle');
  });

  it('works with the mock backend lights', async () => {
    const home = createMockHome({ latencyMs: 0 });
    const registry = new DeviceRegistry();
    const flow = new TeachFlow({ registry, lexicon: FALLBACK_LEXICON, listLights: () => home.listLights() });
    flow.start();
    flow.capture(SURFACE_POINT, RAY);
    await tick();
    expect(flow.choiceCount()).toBe(3);
  });

  it('ignores capture, confirm, and choose in the wrong state', () => {
    const { flow } = setup();
    expect(flow.capture(SURFACE_POINT, RAY)).toBe(false);
    expect(flow.confirm()).toBe(false);
    expect(flow.nearer()).toBe(false);
    expect(flow.choose(0)).toBe(false);
    expect(flow.perform('cancel')).toBe(false);
    flow.start();
    expect(flow.confirm()).toBe(false);
    expect(flow.retake()).toBe(false);
  });

  it('holds a fallback point in Captured, adjusts it along the ray, and keeps it in range', () => {
    const { flow } = setup();
    flow.start();
    flow.capture(FALLBACK_POINT, RAY);
    expect(kinds(flow)).toBe('captured');
    flow.farther();
    let state = flow.state as Extract<TeachState, { kind: 'captured' }>;
    expect(state.distanceM).toBeCloseTo(2.25);
    expect(state.position).toEqual({ x: 0, y: 1, z: -2.25 });
    flow.nearer();
    flow.nearer();
    state = flow.state as Extract<TeachState, { kind: 'captured' }>;
    expect(state.position.z).toBeCloseTo(-1.75);
    for (let i = 0; i < 40; i += 1) flow.nearer();
    expect((flow.state as Extract<TeachState, { kind: 'captured' }>).distanceM).toBeCloseTo(0.5);
    for (let i = 0; i < 40; i += 1) flow.farther();
    expect((flow.state as Extract<TeachState, { kind: 'captured' }>).distanceM).toBeCloseTo(5);
    expect(flow.confirm()).toBe(true);
    expect(kinds(flow)).toBe('pickEntity');
  });

  it('retake returns to AwaitPoint and drops the captured point', async () => {
    const { flow } = setup();
    flow.start();
    flow.capture(SURFACE_POINT, RAY);
    await tick();
    expect(flow.retake()).toBe(true);
    expect(flow.state).toEqual({ kind: 'awaitPoint', mode: 'teach' });
  });

  it('offers nickname choices for a name the recogniser cannot hear, then stores the nickname', async () => {
    const { flow, registry } = setup([light('light.x', 'Zxqvk Lamp')]);
    flow.start();
    flow.capture(SURFACE_POINT, RAY);
    await tick();
    flow.choose(0);
    expect(kinds(flow)).toBe('pickNickname');
    expect(flow.choiceCount()).toBeGreaterThan(0);
    expect(registry.all()).toHaveLength(0);
    flow.choose(0);
    expect(kinds(flow)).toBe('stored');
    expect(registry.all()[0]).toMatchObject({ entityId: 'light.x', name: 'desk lamp' });
  });

  it('re-teach lists only taught lights and moves a marker without adding a second one', async () => {
    const { flow, registry } = setup();
    registry.add({ entityId: 'mock.bulb_2', name: 'mock bulb 2', position: { x: 1, y: 1, z: 1 }, anchorHandle: 'old' });
    const firstId = registry.all()[0]!.id;
    flow.start('reteach');
    flow.capture(SURFACE_POINT, RAY);
    await tick();
    expect(flow.choiceCount()).toBe(1);
    flow.choose(0);
    expect(registry.all()).toHaveLength(1);
    const record = registry.all()[0]!;
    expect(record.id).toBe(firstId);
    expect(record.position).toEqual(SURFACE_POINT.position);
    // The old anchor handle is dropped so the store anchors the new position.
    expect(record.anchorHandle).toBeUndefined();
  });

  it('re-teach lists every light when none is taught yet', async () => {
    const { flow } = setup();
    flow.start('reteach');
    flow.capture(SURFACE_POINT, RAY);
    await tick();
    expect(flow.choiceCount()).toBe(2);
  });

  it('shows a list error and recovers on reload', async () => {
    let fail = true;
    const registry = new DeviceRegistry();
    const flow = new TeachFlow({
      registry,
      lexicon: FALLBACK_LEXICON,
      listLights: () =>
        Promise.resolve(fail ? err({ kind: 'timeout', message: 'Home Assistant is not answering.' }) : ok([light('mock.bulb_1', 'Bulb')])),
    });
    flow.start();
    flow.capture(SURFACE_POINT, RAY);
    await tick();
    expect(flow.state).toMatchObject({ kind: 'pickEntity', list: { status: 'error', message: 'Home Assistant is not answering.' } });
    expect(flow.choose(0)).toBe(false);
    fail = false;
    expect(flow.perform('reload')).toBe(true);
    await tick();
    expect(flow.choiceCount()).toBe(1);
  });

  it('ignores a light list that arrives after the flow was cancelled', async () => {
    const { flow } = setup();
    flow.start();
    flow.capture(SURFACE_POINT, RAY);
    flow.cancel();
    await tick();
    expect(kinds(flow)).toBe('idle');
  });

  it('moves the highlight (own-pinch path), wraps, pages, and chooses the highlighted row', async () => {
    const many = Array.from({ length: 7 }, (_, i) => light(`light.l${i}`, `Lamp ${i}`));
    const { flow, registry } = setup(many);
    flow.start();
    flow.capture(SURFACE_POINT, RAY);
    await tick();
    expect(flow.pageStep(-1)).toBe(false);
    expect(flow.pageStep(1)).toBe(true);
    expect((flow.state as Extract<TeachState, { kind: 'pickEntity' }>).highlight).toBe(TEACH_FLOW.choicesPerPage);
    expect(flow.pageStep(1)).toBe(false);
    for (let i = 0; i < 2; i += 1) flow.moveHighlight(1);
    expect((flow.state as Extract<TeachState, { kind: 'pickEntity' }>).highlight).toBe(0); // 5 -> 6 -> wraps to 0
    flow.moveHighlight(2);
    expect(flow.chooseHighlighted()).toBe(true);
    expect(registry.all()[0]!.entityId).toBe('light.l2');
  });
});

describe('buildTeachView', () => {
  const devices = [
    {
      id: 'd1',
      entityId: 'mock.bulb_1',
      name: 'lamp',
      aliases: [],
      position: { x: 0, y: 0, z: 0 },
    },
  ];
  const lights = [light('mock.bulb_1', 'Mock bulb 1'), light('mock.bulb_2', 'Mock bulb 2')];
  const states: TeachState[] = [
    { kind: 'idle' },
    { kind: 'awaitPoint', mode: 'teach' },
    { kind: 'captured', mode: 'teach', ray: RAY, distanceM: 2, position: FALLBACK_POINT.position },
    { kind: 'pickEntity', mode: 'teach', position: SURFACE_POINT.position, source: 'surface', list: { status: 'loading' }, highlight: 0 },
    { kind: 'pickEntity', mode: 'teach', position: SURFACE_POINT.position, source: 'surface', list: { status: 'error', message: 'Nope.' }, highlight: 0 },
    { kind: 'pickEntity', mode: 'teach', position: SURFACE_POINT.position, source: 'surface', list: { status: 'ready', lights }, highlight: 0 },
    { kind: 'pickNickname', mode: 'teach', position: SURFACE_POINT.position, entity: lights[0]!, choices: ['desk lamp'], highlight: 0 },
    { kind: 'stored', record: devices[0]! },
  ];

  it('keeps Teach visible always and Re-teach visible in every state while a device exists', () => {
    for (const state of states) {
      expect(buildTeachView(state, devices).teach.visible).toBe(true);
      expect(buildTeachView(state, devices).reteach.visible).toBe(true);
      expect(buildTeachView(state, []).reteach.visible).toBe(false);
    }
  });

  it('never claims a position is exact', () => {
    for (const state of states) {
      const view = buildTeachView(state, devices);
      const text = [view.heading, view.instruction, ...view.rows.map((r) => r.label)].join(' ').toLowerCase();
      expect(text).not.toMatch(/exact|precise|perfect/);
    }
  });

  it('lists the lights, tags taught ones, and marks the highlighted row', () => {
    const view = buildTeachView(states[5]!, devices);
    expect(view.rows.map((r) => r.label)).toEqual(['Mock bulb 1 (taught)', 'Mock bulb 2']);
    expect(view.rows.map((r) => r.highlighted)).toEqual([true, false]);
    expect(view.retake.visible && view.cancel.visible).toBe(true);
    expect(view.next.visible).toBe(false);
  });

  it('shows Nearer and Farther only for a fallback point', () => {
    expect(buildTeachView(states[2]!, []).nearer.visible).toBe(true);
    expect(buildTeachView(states[2]!, []).primaryAction).toBe('confirm');
    expect(buildTeachView(states[5]!, []).nearer.visible).toBe(false);
  });

  it('offers a reload button when the list failed', () => {
    const view = buildTeachView(states[4]!, []);
    expect(view.primaryAction).toBe('reload');
    expect(view.instruction).toBe('Nope.');
  });

  it('pages a long list', () => {
    const many = Array.from({ length: 7 }, (_, i) => light(`light.l${i}`, `Lamp ${i}`));
    const state: TeachState = {
      kind: 'pickEntity',
      mode: 'teach',
      position: SURFACE_POINT.position,
      source: 'surface',
      list: { status: 'ready', lights: many },
      highlight: 5,
    };
    const view = buildTeachView(state, []);
    expect(view.rows.map((r) => r.index)).toEqual([5, 6]);
    expect(view.prev.visible).toBe(true);
    expect(view.next.visible).toBe(false);
    expect(view.pageCount).toBe(2);
  });
});
