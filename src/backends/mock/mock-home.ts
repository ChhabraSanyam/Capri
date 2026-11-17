import { createStore } from '../observable.js';
import {
  err,
  ok,
  type ConnectionState,
  type DeviceCommand,
  type LightEntity,
  type LightState,
  type Observable,
  type Result,
  type Rgb,
  type SmartHomeBackend,
} from '../types.js';

/** Simulated round-trip time. Short enough to feel instant, long enough to be asynchronous. */
export const MOCK_LATENCY_MS = 120;

export const MOCK_BULB_IDS = ['mock.bulb_1', 'mock.bulb_2', 'mock.bulb_3'] as const;

const WARM_WHITE: Rgb = [255, 244, 229];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Round and clamp to 0..100. Non-finite input counts as 0. */
function normalizePct(pct: number): number {
  return Number.isFinite(pct) ? clamp(Math.round(pct), 0, 100) : 0;
}

function normalizeChannel(channel: number): number {
  return Number.isFinite(channel) ? clamp(Math.round(channel), 0, 255) : 0;
}

/**
 * Pure reducer for one bulb. Mirrors Home Assistant's `light.turn_on` / `light.turn_off`:
 * - `on` keeps the last brightness (never leaves a lit bulb at 0%).
 * - `brightness` 0 turns the bulb off and keeps the previous level, a positive value turns it on.
 * - `color` turns the bulb on.
 */
export function reduceLight(state: LightState, cmd: DeviceCommand): LightState {
  switch (cmd.kind) {
    case 'on':
      return { ...state, on: true, brightnessPct: state.brightnessPct > 0 ? state.brightnessPct : 100 };
    case 'off':
      return { ...state, on: false };
    case 'brightness': {
      const pct = normalizePct(cmd.pct);
      return pct === 0 ? { ...state, on: false } : { ...state, on: true, brightnessPct: pct };
    }
    case 'color': {
      const [r, g, b] = cmd.rgb;
      return {
        ...state,
        on: true,
        brightnessPct: state.brightnessPct > 0 ? state.brightnessPct : 100,
        rgb: [normalizeChannel(r), normalizeChannel(g), normalizeChannel(b)],
      };
    }
  }
}

export function createInitialMockLights(): LightEntity[] {
  return MOCK_BULB_IDS.map((entityId, index) => ({
    entityId,
    friendlyName: `Mock bulb ${index + 1}`,
    supportsColor: true,
    state: { entityId, on: false, brightnessPct: 100, rgb: WARM_WHITE },
  }));
}

export interface MockHomeOptions {
  /** Defaults to `MOCK_LATENCY_MS`. Pass 0 in tests. */
  latencyMs?: number;
  /** Starting lights. Defaults to three colour-capable bulbs, all off. */
  lights?: readonly LightEntity[];
}

export interface MockHome extends SmartHomeBackend {
  readonly kind: 'mock';
  /** Snapshot of every bulb state. A new array is published after each change. */
  readonly state$: Observable<readonly LightState[]>;
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * In-memory Home Assistant stand-in (Requirements 23.3, 23.4, 23.6). Makes no network call.
 * Entity ids outside `mock.*` get `not_a_light` and unknown ids get `not_found`, like the live client.
 */
export function createMockHome(options: MockHomeOptions = {}): MockHome {
  const latencyMs = options.latencyMs ?? MOCK_LATENCY_MS;
  const entities = new Map<string, LightEntity>();
  for (const light of options.lights ?? createInitialMockLights()) {
    entities.set(light.entityId, { ...light, state: { ...light.state } });
  }

  const states = createStore<readonly LightState[]>(
    [...entities.values()].map((entity) => entity.state),
  );
  const connection = createStore<ConnectionState>('connected');

  const publish = (): void => {
    states.set([...entities.values()].map((entity) => entity.state));
  };

  return {
    kind: 'mock',
    connection,
    state$: states,

    async testConnection() {
      return ok({ detail: 'Mock Mode: no network' });
    },

    async listLights() {
      return ok(
        [...entities.values()].map((entity) => ({ ...entity, state: { ...entity.state } })),
      );
    },

    async applyCommand(entityId, cmd, signal): Promise<Result<LightState>> {
      if (!entityId.startsWith('mock.')) {
        return err({ kind: 'not_a_light', message: 'That is not a light I can control.' });
      }
      if (!(await delay(latencyMs, signal))) {
        // BackendErrorKind has no "aborted"; a cancelled call is reported as a timeout.
        return err({ kind: 'timeout', message: 'The request was cancelled before it finished.' });
      }
      const entity = entities.get(entityId);
      if (entity === undefined) {
        return err({ kind: 'not_found', message: 'I cannot find that light.' });
      }
      if (cmd.kind === 'color' && !entity.supportsColor) {
        return err({ kind: 'unsupported_color', message: 'That light cannot do colours.' });
      }
      entity.state = reduceLight(entity.state, cmd);
      publish();
      return ok({ ...entity.state });
    },
  };
}
