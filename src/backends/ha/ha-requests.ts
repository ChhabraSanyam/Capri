/**
 * Home Assistant request building and response reading (task 25.5, Requirements 25.2 to 25.7).
 * Pure: no I/O, no globals, no clock. It builds a request or refuses before any I/O happens.
 *
 * Only the documented REST API is used (https://developers.home-assistant.io/docs/api/rest/, now
 * served at https://contributors.home-assistant.io/core/internals/rest-api/):
 *
 * | Use              | Request                                                                  |
 * |------------------|--------------------------------------------------------------------------|
 * | connection check | `GET /api/` (trailing slash), answers `{"message": "API running."}`       |
 * | list lights      | `GET /api/states`, filtered to `entity_id` starting with `light.`         |
 * | one light        | `GET /api/states/<entity_id>`, or 404                                     |
 * | on               | `POST /api/services/light/turn_on`  `{ "entity_id": id }`                 |
 * | off              | `POST /api/services/light/turn_off` `{ "entity_id": id }`                 |
 * | brightness       | `POST /api/services/light/turn_on`  `{ "entity_id": id, "brightness_pct": 0..100 }` |
 * | colour           | `POST /api/services/light/turn_on`  `{ "entity_id": id, "rgb_color": [r, g, b] }`   |
 *
 * Every request carries `Authorization: Bearer <token>` and `Content-Type: application/json`.
 * Field meanings come from the `light.turn_on` action docs
 * (https://www.home-assistant.io/actions/light.turn_on/): `brightness_pct` 0 turns the light off and
 * 100 is full; `rgb_color` is three integers 0 to 255. Light state attributes (`brightness` 0 to
 * 255, `rgb_color`, `supported_color_modes`) come from the light entity docs
 * (https://contributors.home-assistant.io/core/entities/light/).
 *
 * No URL, token, or entity id is hard-coded here (Requirement 25.10): the base URL comes from the
 * URL guard, the token from the caller, and entity ids from Home Assistant itself.
 */
import { err, ok, type DeviceCommand, type LightEntity, type LightState, type Result, type Rgb } from '../types.js';
import { HA_NOT_A_LIGHT } from './ha-errors.js';

/** The only entity domain the client controls (Requirement 25.7). */
export const HA_LIGHT_PREFIX = 'light.';

export const HA_PATHS = {
  /** Connection check. The trailing slash matters: the path is `/api/`, not `/api`. */
  apiRoot: '/api/',
  states: '/api/states',
  turnOn: '/api/services/light/turn_on',
  turnOff: '/api/services/light/turn_off',
} as const;

/**
 * Colour modes that accept `rgb_color` (directly or converted by Home Assistant). `onoff`,
 * `brightness`, `color_temp`, and `white` alone cannot show a colour (assumption A17).
 */
export const HA_COLOR_MODES: readonly string[] = ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'];

/** Used for `rgb` when Home Assistant reports no colour. The same warm white as `MockHome`. */
export const HA_DEFAULT_RGB: Rgb = [255, 244, 229];

export type HaMethod = 'GET' | 'POST';

/** One request, relative to the guarded base URL. The client adds the base and the headers. */
export interface HaRequest {
  readonly method: HaMethod;
  /** Starts with `/api/`. Joined to the base with `endpointPath`, so it never leaves the origin. */
  readonly path: string;
  readonly body?: Readonly<Record<string, unknown>>;
}

/** The fields of a Home Assistant state object that Capri reads. */
export interface HaStateObject {
  readonly entity_id: string;
  readonly state: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

export function isLightEntityId(entityId: unknown): entityId is string {
  return typeof entityId === 'string' && entityId.startsWith(HA_LIGHT_PREFIX);
}

/** Round and clamp to an integer 0..100. Non-finite input counts as 0 (the same as `MockHome`). */
export function clampBrightnessPct(pct: number): number {
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : 0;
}

/** Round and clamp to an integer 0..255. Non-finite input counts as 0 (the same as `MockHome`). */
export function clampRgbChannel(channel: number): number {
  return Number.isFinite(channel) ? Math.min(255, Math.max(0, Math.round(channel))) : 0;
}

export function buildPingRequest(): HaRequest {
  return { method: 'GET', path: HA_PATHS.apiRoot };
}

export function buildListStatesRequest(): HaRequest {
  return { method: 'GET', path: HA_PATHS.states };
}

/** `GET /api/states/<entity_id>` for one light. `not_a_light` without a request otherwise. */
export function buildLightStateRequest(entityId: string): Result<HaRequest> {
  if (!isLightEntityId(entityId)) return err(notALight());
  return ok({ method: 'GET', path: `${HA_PATHS.states}/${encodeURIComponent(entityId)}` });
}

/** The service call for a command on one light. `not_a_light` without a request otherwise. */
export function buildCommandRequest(entityId: string, cmd: DeviceCommand): Result<HaRequest> {
  if (!isLightEntityId(entityId)) return err(notALight());
  switch (cmd.kind) {
    case 'on':
      return ok({ method: 'POST', path: HA_PATHS.turnOn, body: { entity_id: entityId } });
    case 'off':
      return ok({ method: 'POST', path: HA_PATHS.turnOff, body: { entity_id: entityId } });
    case 'brightness':
      return ok({
        method: 'POST',
        path: HA_PATHS.turnOn,
        body: { entity_id: entityId, brightness_pct: clampBrightnessPct(cmd.pct) },
      });
    case 'color': {
      const [r, g, b] = cmd.rgb;
      return ok({
        method: 'POST',
        path: HA_PATHS.turnOn,
        body: { entity_id: entityId, rgb_color: [clampRgbChannel(r), clampRgbChannel(g), clampRgbChannel(b)] },
      });
    }
  }
}

/** Header values must be visible ASCII. A token with anything else cannot be sent. */
const HEADER_SAFE = /^[\u0021-\u007e]+$/;

export function isSendableToken(token: string): boolean {
  return HEADER_SAFE.test(token);
}

/** The headers of every request. The token appears here and nowhere else. */
export function buildHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** A request body as sent on the wire, or `undefined` for a GET. */
export function serializeBody(req: HaRequest): string | undefined {
  return req.body === undefined ? undefined : JSON.stringify(req.body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A Home Assistant state object, or `undefined` when `raw` is not one. */
export function readStateObject(raw: unknown): HaStateObject | undefined {
  if (!isRecord(raw)) return undefined;
  const { entity_id: entityId, state, attributes } = raw;
  if (typeof entityId !== 'string' || typeof state !== 'string') return undefined;
  return { entity_id: entityId, state, attributes: isRecord(attributes) ? attributes : {} };
}

/** The state objects of the light entities in a `GET /api/states` reply, in reply order. */
export function filterLightStates(raw: unknown): HaStateObject[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const lights: HaStateObject[] = [];
  for (const item of raw) {
    const state = readStateObject(item);
    if (state !== undefined && isLightEntityId(state.entity_id)) lights.push(state);
  }
  return lights;
}

/**
 * The state of `entityId` in a service call reply. The reply is the list of states that changed;
 * a reply in the `{ changed_states }` shape (only sent for `?return_response`, which Capri never
 * adds) is read too. `undefined` when the target is not in the list.
 */
export function findChangedState(raw: unknown, entityId: string): HaStateObject | undefined {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw['changed_states']) ? raw['changed_states'] : [];
  for (const item of list) {
    const state = readStateObject(item);
    if (state?.entity_id === entityId) return state;
  }
  return undefined;
}

/** True when `supported_color_modes` lists a mode that can show a colour (assumption A17). */
export function supportsColor(attributes: Readonly<Record<string, unknown>>): boolean {
  const modes = attributes['supported_color_modes'];
  return Array.isArray(modes) && modes.some((mode) => typeof mode === 'string' && HA_COLOR_MODES.includes(mode));
}

/** What the client remembers between readings, so a light that is off keeps its last level. */
export interface LastSeen {
  readonly brightnessPct: number;
  readonly rgb: Rgb;
}

/** Home Assistant `brightness` 1..255 as a percentage. A lit light never rounds down to 0%. */
export function brightnessToPct(brightness: number): number {
  return Math.max(1, clampBrightnessPct((brightness * 100) / 255));
}

function readBrightnessPct(attributes: Readonly<Record<string, unknown>>): number | undefined {
  const value = attributes['brightness'];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? brightnessToPct(value) : undefined;
}

function readRgb(attributes: Readonly<Record<string, unknown>>): Rgb | undefined {
  const value = attributes['rgb_color'];
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  if (!value.every((c) => typeof c === 'number' && Number.isFinite(c))) return undefined;
  const [r, g, b] = value as [number, number, number];
  return [clampRgbChannel(r), clampRgbChannel(g), clampRgbChannel(b)];
}

/**
 * The `LightState` Home Assistant reports. Home Assistant drops `brightness` and `rgb_color` while a
 * light is off, so those fall back to the last reading (`previous`). A light that is on with no
 * `brightness` (an on/off-only light) is at 100%.
 */
export function toLightState(state: HaStateObject, previous?: LastSeen): LightState {
  const on = state.state === 'on';
  const reportedPct = readBrightnessPct(state.attributes);
  const brightnessPct = reportedPct ?? (on ? 100 : (previous?.brightnessPct ?? 100));
  const rgb = readRgb(state.attributes) ?? previous?.rgb ?? HA_DEFAULT_RGB;
  return { entityId: state.entity_id, on, brightnessPct, rgb };
}

/** The `LightEntity` for a light state object. `friendly_name` falls back to the entity id. */
export function toLightEntity(state: HaStateObject, previous?: LastSeen): LightEntity {
  const name = state.attributes['friendly_name'];
  return {
    entityId: state.entity_id,
    friendlyName: typeof name === 'string' && name.trim() !== '' ? name : state.entity_id,
    supportsColor: supportsColor(state.attributes),
    state: toLightState(state, previous),
  };
}

/** True when the reply to `GET /api/` is the documented `{ "message": ... }` object. */
export function isApiRunningReply(raw: unknown): boolean {
  return isRecord(raw) && typeof raw['message'] === 'string';
}

function notALight() {
  return { ...HA_NOT_A_LIGHT };
}
