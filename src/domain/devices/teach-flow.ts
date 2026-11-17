/**
 * "Teach me your lights" state machine (task 9.7, Requirements 12.1 to 12.4, 12.10 to 12.12).
 * Pure: plain data, no Three.js and no IWSDK, so the whole flow runs under Node.
 *
 *   Idle -> AwaitPoint -> Captured -> PickEntity -> (PickNickname) -> Stored -> Idle
 *
 * - `AwaitPoint`: waiting for the dominant-hand pinch. The adapter calls `capture` with the pointed
 *   point (`capturePoint`: Surface hit, else environment raycast, else 2.0 m along the ray).
 * - `Captured`: only reached when the point came from the 2.0 m fallback, because that is the one
 *   case where the user has to adjust it. `nearer` and `farther` move it along the same ray, and
 *   `confirm` accepts it. A point that sits on a real Surface or a hit-test result goes straight to
 *   `PickEntity`, so the list shows right after the capture (Requirement 12.3).
 * - `PickEntity`: the floating list built from `SmartHomeBackend.listLights()`. A choice stores the
 *   light with the captured position (Requirement 12.4). In re-teach mode only lights that are
 *   already taught are listed (unless none are, then all are), so a marker is moved, not duplicated.
 * - `PickNickname`: only when the friendly name has words the recogniser cannot hear. Offers short
 *   nickname choices so the flow stays hands-only (design: DeviceNaming).
 * - `Stored`: the record was added to the registry (which emits `registry:changed`). `done` returns
 *   to `Idle`.
 *
 * Every transition is available through `perform(action)`, which is what panel buttons call, and
 * also through `moveHighlight`/`chooseHighlighted`, the own-pinch path that needs no button.
 *
 * Re-teaching a light that is already registered updates its record in place (the registry keys on
 * the entity id), drops the old anchor handle so the store anchors the new position, and keeps one
 * marker per light. Nothing here describes a stored position as exact (Requirement 12.12).
 */
import type { LightEntity, Result } from '../../backends/types.js';
import { TEACH_FLOW } from '../../config/constants.js';
import { add, normalize, scale, type Ray, type Vec3 } from '../geometry.js';
import { adjustFallbackDistance, type CaptureSource, type CapturedPoint } from '../pointing/capture.js';
import type { Lexicon } from '../speech-lang/lexicon.js';
import { checkDeviceName, NICKNAME_CHOICES } from './naming.js';
import type { DeviceRecord, DeviceRegistry } from './registry.js';

export type TeachMode = 'teach' | 'reteach';

/** What a panel button asks the flow to do. */
export type TeachAction =
  | 'start'
  | 'restart'
  | 'nearer'
  | 'farther'
  | 'confirm'
  | 'retake'
  | 'cancel'
  | 'reload'
  | 'done'
  | 'prev'
  | 'next';

export type LightList =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly lights: readonly LightEntity[] }
  | { readonly status: 'error'; readonly message: string };

export type TeachState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'awaitPoint'; readonly mode: TeachMode }
  | {
      readonly kind: 'captured';
      readonly mode: TeachMode;
      readonly ray: Ray;
      readonly distanceM: number;
      readonly position: Vec3;
    }
  | {
      readonly kind: 'pickEntity';
      readonly mode: TeachMode;
      readonly position: Vec3;
      readonly source: CaptureSource;
      readonly list: LightList;
      /** Absolute index of the highlighted row, for the own-pinch path. */
      readonly highlight: number;
    }
  | {
      readonly kind: 'pickNickname';
      readonly mode: TeachMode;
      readonly position: Vec3;
      readonly entity: LightEntity;
      readonly choices: readonly string[];
      readonly highlight: number;
    }
  | { readonly kind: 'stored'; readonly record: DeviceRecord };

export type TeachStateKind = TeachState['kind'];

export interface TeachFlowDeps {
  readonly registry: DeviceRegistry;
  readonly listLights: () => Promise<Result<LightEntity[]>>;
  readonly lexicon: Lexicon;
}

export type TeachListener = (state: TeachState) => void;

const LIST_ERROR_FALLBACK = 'I could not load your lights.';

function copyVec(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export class TeachFlow {
  private current: TeachState = { kind: 'idle' };
  private readonly listeners = new Set<TeachListener>();
  /** Bumped whenever a light list request starts or becomes irrelevant, so stale answers are ignored. */
  private listToken = 0;

  constructor(private readonly deps: TeachFlowDeps) {}

  get state(): TeachState {
    return this.current;
  }

  /** True while the flow wants a pointing capture (the adapter runs the environment raycast then). */
  get awaitingPoint(): boolean {
    return this.current.kind === 'awaitPoint';
  }

  subscribe(listener: TeachListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Begin the flow from any state. `reteach` moves markers of lights that are already taught. */
  start(mode: TeachMode = 'teach'): void {
    this.listToken += 1;
    this.set({ kind: 'awaitPoint', mode });
  }

  /** Leave the flow and discard the captured point. */
  cancel(): void {
    this.listToken += 1;
    if (this.current.kind !== 'idle') this.set({ kind: 'idle' });
  }

  /** `Stored` back to `Idle`. Ignored in other states. */
  done(): boolean {
    if (this.current.kind !== 'stored') return false;
    this.set({ kind: 'idle' });
    return true;
  }

  /**
   * Accept a pointed point. `ray` is the pointing ray it came from, kept so Nearer and Farther can
   * slide the fallback point along it. Ignored unless the flow is in `AwaitPoint`.
   */
  capture(point: CapturedPoint, ray: Ray): boolean {
    const state = this.current;
    if (state.kind !== 'awaitPoint') return false;
    if (point.source === 'fallback') {
      this.set({
        kind: 'captured',
        mode: state.mode,
        ray: { origin: copyVec(ray.origin), direction: normalize(ray.direction) },
        distanceM: point.distanceM,
        position: copyVec(point.position),
      });
    } else {
      this.enterPick(state.mode, copyVec(point.position), point.source);
    }
    return true;
  }

  /** Move the fallback point closer along its ray. Only in `Captured`. */
  nearer(): boolean {
    return this.adjust('nearer');
  }

  /** Move the fallback point farther along its ray. Only in `Captured`. */
  farther(): boolean {
    return this.adjust('farther');
  }

  /** Accept the fallback point and show the list. Only in `Captured`. */
  confirm(): boolean {
    const state = this.current;
    if (state.kind !== 'captured') return false;
    this.enterPick(state.mode, state.position, 'fallback');
    return true;
  }

  /** Throw the captured point away and wait for a new pinch. Not available before a capture. */
  retake(): boolean {
    const state = this.current;
    if (state.kind !== 'captured' && state.kind !== 'pickEntity' && state.kind !== 'pickNickname') return false;
    this.start(state.mode);
    return true;
  }

  /** Ask for the light list again after an error. Only in `PickEntity`. */
  reload(): boolean {
    const state = this.current;
    if (state.kind !== 'pickEntity') return false;
    this.enterPick(state.mode, state.position, state.source);
    return true;
  }

  /** Number of rows in the current list or nickname choices, 0 when there is nothing to choose. */
  choiceCount(): number {
    const state = this.current;
    if (state.kind === 'pickEntity') return state.list.status === 'ready' ? state.list.lights.length : 0;
    if (state.kind === 'pickNickname') return state.choices.length;
    return 0;
  }

  /** Move the highlight by `step` rows, wrapping around. The own-pinch path for the non-dominant hand. */
  moveHighlight(step = 1): boolean {
    const state = this.current;
    const count = this.choiceCount();
    if (count === 0 || (state.kind !== 'pickEntity' && state.kind !== 'pickNickname')) return false;
    const highlight = (((state.highlight + step) % count) + count) % count;
    this.set({ ...state, highlight });
    return true;
  }

  /** Move the highlight to the first row of the previous (-1) or next (+1) page. */
  pageStep(direction: -1 | 1): boolean {
    const state = this.current;
    const count = this.choiceCount();
    if (count === 0 || (state.kind !== 'pickEntity' && state.kind !== 'pickNickname')) return false;
    const pageSize = TEACH_FLOW.choicesPerPage;
    const pages = Math.ceil(count / pageSize);
    const page = Math.floor(state.highlight / pageSize) + direction;
    if (page < 0 || page >= pages) return false;
    this.set({ ...state, highlight: page * pageSize });
    return true;
  }

  /** Choose the highlighted row. The own-pinch path for the dominant hand. */
  chooseHighlighted(): boolean {
    const state = this.current;
    if (state.kind !== 'pickEntity' && state.kind !== 'pickNickname') return false;
    return this.choose(state.highlight);
  }

  /** Choose a row by absolute index. Stores the light, or moves on to the nickname choices. */
  choose(index: number): boolean {
    const state = this.current;
    if (!Number.isInteger(index) || index < 0) return false;
    if (state.kind === 'pickEntity') {
      if (state.list.status !== 'ready') return false;
      const entity = state.list.lights[index];
      if (entity === undefined) return false;
      return this.pickEntity(state.mode, state.position, entity);
    }
    if (state.kind === 'pickNickname') {
      const nickname = state.choices[index];
      if (nickname === undefined) return false;
      return this.store(state.entity, nickname, state.position);
    }
    return false;
  }

  /** Run a panel button's action. Returns false when the action does not apply in this state. */
  perform(action: TeachAction): boolean {
    switch (action) {
      case 'start':
        this.start('teach');
        return true;
      case 'restart':
        this.start('reteach');
        return true;
      case 'nearer':
        return this.nearer();
      case 'farther':
        return this.farther();
      case 'confirm':
        return this.confirm();
      case 'retake':
        return this.retake();
      case 'cancel':
        if (this.current.kind === 'idle') return false;
        this.cancel();
        return true;
      case 'reload':
        return this.reload();
      case 'done':
        return this.done();
      case 'prev':
        return this.pageStep(-1);
      case 'next':
        return this.pageStep(1);
    }
  }

  private adjust(direction: 'nearer' | 'farther'): boolean {
    const state = this.current;
    if (state.kind !== 'captured') return false;
    const distanceM = adjustFallbackDistance(state.distanceM, direction);
    const position = add(state.ray.origin, scale(normalize(state.ray.direction), distanceM));
    this.set({ ...state, distanceM, position });
    return true;
  }

  private enterPick(mode: TeachMode, position: Vec3, source: CaptureSource): void {
    this.listToken += 1;
    const token = this.listToken;
    this.set({ kind: 'pickEntity', mode, position, source, list: { status: 'loading' }, highlight: 0 });
    let request: Promise<Result<LightEntity[]>>;
    try {
      request = this.deps.listLights();
    } catch {
      this.applyList(token, { status: 'error', message: LIST_ERROR_FALLBACK });
      return;
    }
    request.then(
      (result) => {
        if (!result.ok) {
          this.applyList(token, { status: 'error', message: result.error.message || LIST_ERROR_FALLBACK });
          return;
        }
        this.applyList(token, { status: 'ready', lights: this.listFor(mode, result.value) });
      },
      () => this.applyList(token, { status: 'error', message: LIST_ERROR_FALLBACK }),
    );
  }

  private applyList(token: number, list: LightList): void {
    const state = this.current;
    if (token !== this.listToken || state.kind !== 'pickEntity') return;
    this.set({ ...state, list, highlight: 0 });
  }

  /** Re-teach lists only lights that are already taught, unless none are. */
  private listFor(mode: TeachMode, lights: readonly LightEntity[]): readonly LightEntity[] {
    if (mode !== 'reteach') return [...lights];
    const taught = new Set(this.deps.registry.all().map((r) => r.entityId));
    const known = lights.filter((l) => taught.has(l.entityId));
    return known.length > 0 ? known : [...lights];
  }

  private pickEntity(mode: TeachMode, position: Vec3, entity: LightEntity): boolean {
    const own = this.deps.registry.all().find((r) => r.entityId === entity.entityId);
    const taken = this.deps.registry
      .all()
      .filter((r) => r !== own)
      .map((r) => r.name);
    const check = checkDeviceName(entity.friendlyName, this.deps.lexicon, taken);
    if (!check.needsNickname) return this.store(entity, entity.friendlyName, position);
    const choices = check.nicknameChoices.length > 0 ? check.nicknameChoices : NICKNAME_CHOICES;
    this.set({ kind: 'pickNickname', mode, position, entity, choices, highlight: 0 });
    return true;
  }

  private store(entity: LightEntity, name: string, position: Vec3): boolean {
    // Registering a light that is already taught replaces its record. The old anchor handle is not
    // passed on, so the store anchors the new position and releases the old anchor.
    const record = this.deps.registry.add({ entityId: entity.entityId, name, position: copyVec(position) });
    if (record === undefined) {
      const state = this.current;
      if (state.kind === 'pickEntity' || state.kind === 'pickNickname') {
        this.set({
          kind: 'pickNickname',
          mode: state.mode,
          position: state.position,
          entity,
          choices: NICKNAME_CHOICES,
          highlight: 0,
        });
      }
      return false;
    }
    this.listToken += 1;
    this.set({ kind: 'stored', record });
    return true;
  }

  private set(next: TeachState): void {
    this.current = next;
    for (const listener of [...this.listeners]) listener(next);
  }
}
