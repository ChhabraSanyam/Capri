/**
 * Device registration wiring (task 9.8, Requirements 12.1 to 12.8, 12.10, 12.11, 12.12).
 *
 * Puts the pieces from tasks 9.2 to 9.7 together:
 *  - `DeviceRegistry` (events: `registry:changed` on the app bus) and `TeachFlow`;
 *  - persistence: `store.load()` once at start (before AR), a save after every registry change, and
 *    `store.restoreAnchors?.()` once each time an AR session starts. Restored positions are
 *    approximate (about 10 cm). They are applied without saving them back, so the error does not
 *    build up, and nothing labels them exact;
 *  - one `DeviceMarker` per registered device, reconciled on every registry change, plus a preview
 *    marker for a captured spot, all turned toward the head each frame;
 *  - `HitCapture` (environment raycast while the flow waits for a point), `TeachController` (own
 *    pinch input), and `DeviceListPanel` (floating list with "Teach me your lights" and "Re-teach
 *    lights");
 *  - the `TeachOrb`: an always-visible floating entry beside the Avatar. A pinch aimed at it, or a
 *    fingertip poke, starts the flow, so the flow is reachable by hand even if UIKit clicks are not.
 *
 * Pointing support (task 11.7): `pointTargets` is the marker list the selector uses (rebuilt only when
 * the registry changes), `setHighlight` shows the pointed marker with its ring and the selected one in
 * green, `isTeachIdle` tells the pointing wiring whether the dominant pinch is free, and `getUiAim`
 * gives the rectangles a pinch may be aimed at instead of a device (the list panel, any extra panel
 * added with `addUiRect`, and the orb).
 *
 * Stage use: `updatePointing` is for the `pointing` stage and `updateUi` for the `vfxUi` stage.
 * Neither allocates on a quiet frame. A pinch edge builds one ray, and a registry change rebuilds the
 * marker list. Teardown: `dispose()` removes every entity, subscription, and the raycast target.
 */
import type { World } from '@iwsdk/core';
import type { LightState, SmartHomeBackend } from '../backends/types.js';
import { featureFlags } from '../config/feature-flags.js';
import { TEACH_FLOW, TEACH_ORB } from '../config/constants.js';
import { OrbPressDetector } from '../domain/devices/teach-orb.js';
import { adoptStoredHandles, mergeRestoredPositions } from '../domain/devices/restore.js';
import { DeviceRegistry, type DeviceRecord, type NewDevice } from '../domain/devices/registry.js';
import { TeachFlow } from '../domain/devices/teach-flow.js';
import type { Vec3 } from '../domain/geometry.js';
import type { PanelRect } from '../domain/devices/teach-input.js';
import type { PointTarget } from '../domain/pointing/selector.js';
import type { UiAimTargets } from '../domain/pointing/ui-aim.js';
import type { Lexicon } from '../domain/speech-lang/lexicon.js';
import type { Surface } from '../domain/surfaces.js';
import type { DeviceStore } from '../persistence/device-store.js';
import { DeviceMarker } from '../ui/device-marker.js';
import { DeviceListPanel } from '../ui/panels/device-list.js';
import { TeachController } from '../ui/teach-controller.js';
import { TeachOrb } from '../ui/teach-orb.js';
import { HitCapture } from '../xr/hit-capture.js';
import type { AppEvents, EventBus } from './events.js';
import type { FrameContext } from './frame-context.js';
import type { Logger } from './logger.js';

export interface DeviceRegistrationDeps {
  readonly world: World;
  readonly events: EventBus<AppEvents>;
  readonly logger: Logger;
  /** The light backend (`MockHome` for now). Only `listLights` is used here. */
  readonly backend: Pick<SmartHomeBackend, 'listLights'>;
  /** Anchor or localStorage store, from `createDeviceStore`. */
  readonly store: DeviceStore;
  /**
   * Reads the records as they were written (handles included, positions unrestored). Used to adopt
   * anchor handles the store created while saving. Without it, handles are only known after a reload.
   */
  readonly handleSource?: DeviceStore;
  readonly lexicon: Lexicon;
  readonly getSurfaces: () => readonly Surface[];
  /** Feet position of the Avatar while she is in the room, else `undefined`. */
  readonly getAvatarPosition: () => Vec3 | undefined;
  /** The dominant hand. Defaults to the right hand. */
  readonly dominant?: 'left' | 'right';
}

export class DeviceRegistration {
  readonly registry: DeviceRegistry;
  readonly flow: TeachFlow;
  readonly panel: DeviceListPanel;
  readonly controller: TeachController;
  readonly orb: TeachOrb;
  readonly hitCapture: HitCapture;
  /** Resolves when the stored devices have been read (and applied, when the registry was still empty). */
  readonly loaded: Promise<void>;

  private readonly preview: DeviceMarker;
  private readonly orbDetector = new OrbPressDetector();
  private readonly unsubscribe: () => void;
  private markerById = new Map<string, DeviceMarker>();
  private markers: DeviceMarker[] = [];
  private targets: readonly PointTarget[] = [];
  private pointedId: string | undefined;
  private selectedId: string | undefined;
  private lightStates: ReadonlyMap<string, LightState> = new Map();
  private readonly extraRects: (() => PanelRect | undefined)[] = [];
  /** True while the registry is changed by a load or a restore, which must not be saved again. */
  private quiet = false;
  private wasInSession = false;
  private disposed = false;

  constructor(private readonly deps: DeviceRegistrationDeps) {
    const dominant = deps.dominant ?? 'right';
    this.registry = new DeviceRegistry({ events: deps.events });
    this.flow = new TeachFlow({
      registry: this.registry,
      listLights: () => deps.backend.listLights(),
      lexicon: deps.lexicon,
    });
    this.hitCapture = new HitCapture(deps.world, { hand: dominant, hitTestEnabled: featureFlags.hitTestWork });
    this.preview = new DeviceMarker(deps.world, { name: TEACH_FLOW.previewMarkerName });
    this.panel = new DeviceListPanel(deps.world, deps.logger, this.flow, this.registry, { dominant });
    this.controller = new TeachController({
      flow: this.flow,
      points: this.hitCapture,
      getSurfaces: deps.getSurfaces,
      getPanelRect: () => this.panel.getRect(),
      preview: this.preview,
      dominant,
      logger: deps.logger,
    });
    this.orb = new TeachOrb(deps.world);
    this.unsubscribe = this.registry.subscribe((records) => this.onRegistryChanged(records));
    this.loaded = this.loadStored();
  }

  /** Markers currently shown, for tests and dev inspection. */
  get markerCount(): number {
    return this.markers.length;
  }

  /** The markers the pointing selector tests against. The array changes only with the registry. */
  get pointTargets(): readonly PointTarget[] {
    return this.targets;
  }

  /** True while the teach flow is idle, so the dominant pinch is free to confirm a device. */
  get isTeachIdle(): boolean {
    return this.flow.state.kind === 'idle';
  }

  /**
   * Highlight the pointed device with its ring and name, and show the selected one in green. Either
   * can be `undefined`. A device that is only selected keeps its ring until the selection expires.
   */
  setHighlight(pointedId: string | undefined, selectedId: string | undefined): void {
    this.pointedId = pointedId;
    this.selectedId = selectedId;
    this.applyHighlight();
  }

  /**
   * Tint each marker from its light's state (task 13.25): dim when off, the light's colour when on.
   * Call it with the whole snapshot on every backend state change. A marker whose light is not in the
   * snapshot keeps the plain colour. The snapshot is kept, so a marker made later is tinted too.
   */
  applyLightStates(states: readonly LightState[]): void {
    this.lightStates = new Map(states.map((state) => [state.entityId, state]));
    this.applyTints();
  }

  /** Add a floating panel whose rectangle a pinch may be aimed at (it then never confirms a device). */
  addUiRect(getRect: () => PanelRect | undefined): () => void {
    this.extraRects.push(getRect);
    return () => {
      const i = this.extraRects.indexOf(getRect);
      if (i >= 0) this.extraRects.splice(i, 1);
    };
  }

  /** The panels that are shown and the orb, for `isAimedAtUi`. Allocates, so call it on a pinch. */
  getUiAim(): UiAimTargets {
    const panels: PanelRect[] = [];
    const list = this.panel.getRect();
    if (list !== undefined) panels.push(list);
    for (const getRect of this.extraRects) {
      const rect = getRect();
      if (rect !== undefined) panels.push(rect);
    }
    return { panels, orbCenter: this.orb.isVisible ? { ...this.orb.center } : undefined };
  }

  /** The marker of a registered device, for tests and dev inspection. */
  markerFor(deviceId: string): DeviceMarker | undefined {
    return this.markerById.get(deviceId);
  }

  /**
   * Register or move devices without saving them (task 17.4). The Mock Mode bulbs are placed again
   * from the head pose at every session start, so a stored position would only be stale. A light that
   * is already registered keeps its id and loses any anchor handle, so a restore cannot move it back.
   */
  registerWithoutSaving(devices: readonly NewDevice[]): void {
    const wasQuiet = this.quiet;
    this.quiet = true;
    try {
      for (const device of devices) this.registry.add(device);
    } finally {
      this.quiet = wasQuiet;
    }
  }

  /**
   * The `pointing` stage. The teach controller runs first, so a pinch that finishes or cancels the
   * flow cannot also press the orb. The orb only counts while the flow was idle at the start of the
   * frame, and the controller has already consumed this frame's pinch edge, so the pinch that opens
   * the flow never also captures a point.
   */
  updatePointing(frame: FrameContext): void {
    this.trackSession(frame.inSession);
    if (!frame.inSession) return;
    const wasIdle = this.flow.state.kind === 'idle';
    this.controller.update(frame);
    const center = this.orb.isVisible ? this.orb.center : undefined;
    if (this.orbDetector.update(frame.hands, center, wasIdle && this.flow.state.kind === 'idle')) {
      this.deps.logger.info('teach: orb pressed');
      this.flow.start('teach');
    }
  }

  /** The `vfxUi` stage: orb placement, marker pulse and facing. */
  updateUi(frame: FrameContext): void {
    const headX = frame.head.position[0]!;
    const headZ = frame.head.position[2]!;
    const avatar = this.deps.getAvatarPosition();
    const showOrb = frame.inSession && avatar !== undefined && this.flow.state.kind === 'idle';
    this.orb.setVisible(showOrb);
    if (showOrb) {
      // The user's right, seen looking from the head toward the Avatar, is (-uz, ux).
      let ux = avatar.x - headX;
      let uz = avatar.z - headZ;
      const len = Math.hypot(ux, uz);
      if (len > 1e-6) {
        ux /= len;
        uz /= len;
      } else {
        ux = 0;
        uz = -1;
      }
      this.orb.setPosition(avatar.x - uz * TEACH_ORB.sideM, avatar.y + TEACH_ORB.riseM, avatar.z + ux * TEACH_ORB.sideM);
      this.orb.update(frame.time, headX, headZ);
    }
    this.preview.update(frame.time, headX, headZ);
    for (let i = 0; i < this.markers.length; i += 1) this.markers[i]!.update(frame.time, headX, headZ);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.controller.dispose();
    this.panel.dispose();
    this.hitCapture.dispose();
    this.orb.dispose();
    this.preview.dispose();
    for (const marker of this.markers) marker.dispose();
    this.markers = [];
    this.targets = [];
    this.markerById.clear();
  }

  // ---- Persistence ---------------------------------------------------------------------------

  private async loadStored(): Promise<void> {
    try {
      const records = await this.deps.store.load();
      // A light taught before the read finished is newer than the stored list, so keep it.
      if (this.disposed || records.length === 0 || this.registry.all().length > 0) return;
      this.applyQuietly(records);
      this.deps.logger.info(`registry: loaded ${records.length} stored ${records.length === 1 ? 'device' : 'devices'}`);
    } catch (cause) {
      this.deps.logger.warn('registry: could not read the stored devices', cause);
    }
  }

  private onRegistryChanged(records: readonly DeviceRecord[]): void {
    this.syncMarkers(records);
    if (this.quiet) return;
    void this.save(records);
  }

  private async save(records: readonly DeviceRecord[]): Promise<void> {
    try {
      await this.deps.store.save(records);
      await this.adoptHandles();
    } catch (cause) {
      this.deps.logger.warn('registry: could not save the devices', cause);
    }
  }

  /** Pick up anchor handles the store created during a save, so re-entering AR can restore them. */
  private async adoptHandles(): Promise<void> {
    const source = this.deps.handleSource;
    if (source === undefined || this.disposed) return;
    const adopted = adoptStoredHandles(this.registry.all(), await source.load());
    if (adopted !== undefined && !this.disposed) this.applyQuietly(adopted);
  }

  /** Restore anchors for the records that have a handle, once per session start. */
  private restoreAnchors(): void {
    const restore = this.deps.store.restoreAnchors;
    if (restore === undefined) return;
    void this.loaded.then(async () => {
      const requested = this.registry.all();
      if (this.disposed || !requested.some((r) => r.anchorHandle !== undefined)) return;
      try {
        const restored = await restore.call(this.deps.store, requested);
        const merged = mergeRestoredPositions(this.registry.all(), requested, restored);
        if (merged === undefined || this.disposed) return;
        this.applyQuietly(merged);
        // Restored positions are approximate, so the log says so.
        this.deps.logger.info('registry: anchors restored, marker positions are approximate (about 10 cm)');
      } catch (cause) {
        this.deps.logger.warn('registry: could not restore anchors, keeping the stored positions', cause);
      }
    });
  }

  private applyQuietly(records: readonly DeviceRecord[]): void {
    this.quiet = true;
    try {
      this.registry.replaceAll(records);
    } finally {
      this.quiet = false;
    }
  }

  // ---- Markers and session -------------------------------------------------------------------

  private syncMarkers(records: readonly DeviceRecord[]): void {
    const next = new Map<string, DeviceMarker>();
    for (const record of records) {
      const marker =
        this.markerById.get(record.id) ?? new DeviceMarker(this.deps.world, { name: record.name, deviceId: record.id });
      marker.setName(record.name);
      marker.setPosition(record.position);
      marker.setVisible(true);
      next.set(record.id, marker);
    }
    for (const [id, marker] of this.markerById) {
      if (!next.has(id)) marker.dispose();
    }
    this.markerById = next;
    this.markers = [...next.values()];
    this.targets = records.map((record) => ({ id: record.id, position: record.position }));
    this.applyTints();
    this.applyHighlight();
  }

  private applyTints(): void {
    for (const record of this.registry.all()) {
      this.markerById.get(record.id)?.setLightState(this.lightStates.get(record.entityId));
    }
  }

  private applyHighlight(): void {
    for (let i = 0; i < this.markers.length; i += 1) {
      const marker = this.markers[i]!;
      const id = marker.deviceId;
      const selected = id !== undefined && id === this.selectedId;
      marker.setSelected(selected);
      marker.setHighlighted(selected || (id !== undefined && id === this.pointedId));
    }
  }

  private trackSession(inSession: boolean): void {
    if (inSession === this.wasInSession) return;
    this.wasInSession = inSession;
    if (inSession) {
      this.restoreAnchors();
      return;
    }
    this.flow.cancel();
    this.controller.reset();
    this.orbDetector.reset();
    this.orb.setVisible(false);
  }
}
