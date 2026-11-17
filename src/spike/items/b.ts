/**
 * Spike item (b): planes, semantic labels, mesh, anchors, hit-test, and depth
 * (Requirements 3.1 to 3.8). Six capability rows are reported separately.
 *
 * IWSDK background, from the typings and compiled sources of @iwsdk/core 1.1.0:
 * - `SceneUnderstandingSystem` makes one entity per detected plane (`XRPlane`) and mesh (`XRMesh`).
 *   The `XRPlane` component has no label field, so the label is read from the raw plane in `_plane`.
 *   `XRMesh` carries `semanticLabel` itself.
 * - `EnvironmentRaycastTarget` runs a hit-test along a hand's target ray and keeps the latest
 *   `XRHitTestResult` on the component. Systems update before `world.onXRFrame` callbacks, so the
 *   result read inside the callback belongs to the current, active frame. That matters because
 *   `createAnchor()` and `getPose()` only work on an active frame.
 * - IWSDK keeps one global anchor. Per-object anchors need the raw WebXR anchor calls used here.
 * - `DepthSensingSystem` is not auto-registered. It only learns whether depth sensing was granted
 *   when a session starts, so `spike-main.ts` registers it before the session.
 *
 * Flow of one run, stage by stage (the user uses the RIGHT hand for placing):
 *   floor    right pinch on the floor      -> hit-test result, anchor, floor stand-in
 *   table    right pinch on a table top    -> hit-test result, anchor, table stand-in
 *   anchors  hold every anchor for 300 good frames
 *   depth    only if depth data arrives: hold a hand in front of the table stand-in.
 *            Right pinch = it hid behind the hand. Left pinch = it did not.
 *   reload   only if a persistent handle was saved: the user leaves AR, reloads the page, enters
 *            AR, and presses Start again. Left pinch skips this check.
 * The second run (`restore`) restores the saved handle and asks for a right pinch on the same
 * table spot. The distance between the restored anchor and that pinch is measured.
 *
 * Allocation: every object used per frame is created before the first frame. Strings are built a
 * few times per second for the live text only. `getPose` returns a browser object per call, which
 * the API cannot avoid. Hit handling runs on a pinch, not every frame.
 */
import {
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DepthOccludable,
  DepthSensingSystem,
  DoubleSide,
  EnvironmentRaycastTarget,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  RaycastSpace,
  RingGeometry,
  SphereGeometry,
  Vector3,
  XRMesh as XRMeshComponent,
  XRPlane as XRPlaneComponent,
  type Entity,
} from '@iwsdk/core';
import {
  CAPABILITY_KEYS,
  type AbortReason,
  type CapabilityKey,
  type SpikeContext,
  type SpikeResult,
  type Verdict,
} from '../types.js';
import { idleHomeDraft, type Point3 } from './b-placement.js';

// ---------------------------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------------------------

const REQUIRED_ANCHOR_FRAMES = 300;
/** More lost frames than this out of the first 300+ means the anchor did not hold. */
const MAX_LOST_ANCHOR_FRAMES = 30;
const FLOOR_STAGE_TIMEOUT_S = 120;
const TABLE_STAGE_TIMEOUT_S = 120;
/** 300 frames take about 4 s on the headset. The long limit covers slow emulator frame rates. */
const ANCHOR_STAGE_TIMEOUT_S = 90;
const DEPTH_STAGE_TIMEOUT_S = 30;
const RELOAD_WAIT_TIMEOUT_S = 900;
const RESTORE_STAGE_TIMEOUT_S = 120;
const RESTORE_NO_POSE_TIMEOUT_S = 10;
/** A table top must be at least this far above the floor. */
const MIN_TABLE_HEIGHT_M = 0.3;
/** The restored anchor counts as "in place" when a new pinch lands this close to it. */
const RESTORE_MATCH_RADIUS_M = 0.15;
const MIN_DEPTH_FRAMES = 30;
/** Ignore pinches right after Start, so the pinch that pressed the button does not count. */
const PINCH_GUARD_S = 0.7;
const SCAN_INTERVAL_S = 0.5;
const LIVE_TEXT_INTERVAL_S = 0.25;
const MAX_FRAME_DELTA_S = 0.1;
const PLANE_HIT_TOLERANCE_M = 0.15;
const MESH_HIT_MARGIN_M = 0.15;
const FALLBACK_ANCHOR_AHEAD_M = 1.0;
const FALLBACK_ANCHOR_BELOW_HEAD_M = 0.5;

const STAND_IN_BODY_RADIUS_M = 0.09;
const STAND_IN_BODY_LENGTH_M = 0.28;
const STAND_IN_HEAD_RADIUS_M = 0.07;

const COLOR_FLOOR = 0x35d0ff;
const COLOR_TABLE = 0xffa23a;
const COLOR_FALLBACK = 0xffffff;
const COLOR_RESTORED = 0xff4fd8;

const INTERIM_KEY = 'capri.spike.b.interim.v1';
/** An interim record older than this is ignored (the user did not come back). */
const INTERIM_MAX_AGE_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------------------------
// Interim storage (survives the page reload of the restart check)
// ---------------------------------------------------------------------------------------------

interface Phase1Summary {
  /** Verdict of the whole item, decided from the first run. */
  verdict: Verdict;
  capabilities: Partial<Record<CapabilityKey, Verdict>>;
  /** One plain-words reason per failed capability. */
  reasons: Partial<Record<CapabilityKey, string>>;
  measurements: Record<string, number | string>;
}

interface Interim {
  savedAt: number;
  handle: string;
  summary: Phase1Summary;
}

function isVerdict(value: unknown): value is Verdict {
  return value === 'works' || value === 'does_not_work';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseInterim(text: string | null, now: number): Interim | undefined {
  if (text === null) return undefined;
  try {
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw) || typeof raw.savedAt !== 'number' || typeof raw.handle !== 'string') {
      return undefined;
    }
    if (raw.handle.length === 0 || now - raw.savedAt > INTERIM_MAX_AGE_MS) return undefined;
    const summary = raw.summary;
    if (!isRecord(summary) || !isVerdict(summary.verdict)) return undefined;

    const capabilities: Partial<Record<CapabilityKey, Verdict>> = {};
    const reasons: Partial<Record<CapabilityKey, string>> = {};
    const savedCapabilities = isRecord(summary.capabilities) ? summary.capabilities : {};
    const savedReasons = isRecord(summary.reasons) ? summary.reasons : {};
    for (const key of CAPABILITY_KEYS) {
      const verdict = savedCapabilities[key];
      if (isVerdict(verdict)) capabilities[key] = verdict;
      const reason = savedReasons[key];
      if (typeof reason === 'string') reasons[key] = reason;
    }
    const measurements: Record<string, number | string> = {};
    if (isRecord(summary.measurements)) {
      for (const [key, value] of Object.entries(summary.measurements)) {
        if (typeof value === 'number' || typeof value === 'string') measurements[key] = value;
      }
    }
    return {
      savedAt: raw.savedAt,
      handle: raw.handle,
      summary: { verdict: summary.verdict, capabilities, reasons, measurements },
    };
  } catch {
    return undefined;
  }
}

function readInterim(): Interim | undefined {
  try {
    return parseInterim(window.localStorage.getItem(INTERIM_KEY), Date.now());
  } catch {
    return undefined;
  }
}

function writeInterim(interim: Interim): void {
  try {
    window.localStorage.setItem(INTERIM_KEY, JSON.stringify(interim));
  } catch {
    // Storage blocked or full: the reload check cannot continue, and the probe reports that.
  }
}

/** Forget the saved reload-check state. Also called by the page's Clear results button. */
export function clearItemBState(storage: Storage): void {
  try {
    storage.removeItem(INTERIM_KEY);
  } catch {
    // Nothing to clear.
  }
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

type Stage = 'floor' | 'table' | 'anchors' | 'depth' | 'reload-wait' | 'restore' | 'done';
type Hand = 'left' | 'right';
type HandleState = 'none' | 'unsupported' | 'requested' | 'saved' | 'failed';

interface AnchorTrack {
  name: 'floor' | 'table' | 'fallback' | 'restored';
  marker: Group;
  ringMaterial: MeshBasicMaterial;
  anchor: XRAnchor | undefined;
  creating: boolean;
  error: string | undefined;
  goodFrames: number;
  lostFrames: number;
  hasStart: boolean;
  startX: number;
  startY: number;
  startZ: number;
  lastX: number;
  lastY: number;
  lastZ: number;
  hasPose: boolean;
  maxDriftM: number;
  wantsHandle: boolean;
  handleState: HandleState;
  handle: string | undefined;
  handleError: string | undefined;
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.replace(/\s+/gu, ' ').trim();
    return message.length > 0 ? `${error.name}: ${message}` : error.name;
  }
  return String(error);
}

function mm(metres: number): number {
  return Math.round(metres * 1000);
}

function metres(value: number): string {
  return value.toFixed(2);
}

function featureGranted(session: XRSession, name: string): boolean | undefined {
  const features = (session as XRSession & { enabledFeatures?: readonly string[] }).enabledFeatures;
  return features === undefined ? undefined : features.includes(name);
}

function grantedText(value: boolean | undefined): string {
  return value === undefined ? 'unknown' : value ? 'yes' : 'no';
}

function labelsText(labels: ReadonlyMap<string, number>): string {
  if (labels.size === 0) return 'none';
  const parts: string[] = [];
  labels.forEach((count, label) => parts.push(`${label}:${count}`));
  return parts.sort().join(',');
}

function failedSummary(reasons: Partial<Record<CapabilityKey, string>>): string {
  const parts: string[] = [];
  for (const key of CAPABILITY_KEYS) {
    const reason = reasons[key];
    if (reason !== undefined) parts.push(`${key}: ${reason}`);
  }
  return parts.join(' | ');
}

function buildResult(
  summary: Phase1Summary,
  extra: Record<string, number | string>,
): SpikeResult {
  const failed = failedSummary(summary.reasons);
  const result: SpikeResult = {
    item: 'b',
    verdict: summary.verdict,
    capabilities: { ...summary.capabilities },
    measurements: { ...summary.measurements, ...extra },
  };
  if (failed.length > 0) result.failureReason = failed;
  return result;
}

// ---------------------------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------------------------

export function runItemB(ctx: SpikeContext): Promise<SpikeResult> {
  const world = ctx.world;
  const session = world.xrSession;
  if (session === undefined) {
    const reason = 'No WebXR session is active. Press Enter AR on the page first.';
    const capabilities: Partial<Record<CapabilityKey, Verdict>> = {};
    for (const key of CAPABILITY_KEYS) capabilities[key] = 'does_not_work';
    return Promise.resolve({ item: 'b', verdict: 'does_not_work', capabilities, failureReason: reason });
  }

  const planeFeature = featureGranted(session, 'plane-detection');
  const meshFeature = featureGranted(session, 'mesh-detection');
  const anchorFeature = featureGranted(session, 'anchors');
  const hitTestFeature = featureGranted(session, 'hit-test');
  const depthFeature = featureGranted(session, 'depth-sensing');

  const interim = readInterim();
  const secondRun = interim !== undefined && typeof session.restorePersistentAnchor === 'function';
  if (interim !== undefined && !secondRun) {
    // A handle was saved but this session cannot restore it. Report that and finish.
    clearItemBState(window.localStorage);
    return Promise.resolve(
      buildResult(interim.summary, {
        persistentRestore: 'not supported: session.restorePersistentAnchor is missing',
      }),
    );
  }

  // ---- Everything below is allocated once, before the first frame. ----
  const spawned: Entity[] = [];
  const spawn = (object: Object3D): Entity => {
    const entity = world.createTransformEntity(object);
    spawned.push(entity);
    return entity;
  };

  const ringGeometry = new RingGeometry(0.05, 0.075, 28);
  ringGeometry.rotateX(-Math.PI / 2);
  const poleGeometry = new CylinderGeometry(0.004, 0.004, 0.18, 6);
  poleGeometry.translate(0, 0.09, 0);
  const reticleGeometry = new RingGeometry(0.02, 0.03, 20);
  reticleGeometry.rotateX(-Math.PI / 2);
  const bodyGeometry = new CapsuleGeometry(STAND_IN_BODY_RADIUS_M, STAND_IN_BODY_LENGTH_M, 4, 12);
  const headGeometry = new SphereGeometry(STAND_IN_HEAD_RADIUS_M, 16, 12);
  const noseGeometry = new ConeGeometry(0.02, 0.05, 8);
  noseGeometry.rotateX(Math.PI / 2);
  const reticleMaterial = new MeshBasicMaterial({ color: 0xffffff });
  const poleMaterial = new MeshBasicMaterial({ color: 0xffffff });
  const noseMaterial = new MeshBasicMaterial({ color: 0xffffff });
  const bodyMaterials = {
    floor: new MeshBasicMaterial({ color: COLOR_FLOOR }),
    table: new MeshBasicMaterial({ color: COLOR_TABLE }),
  };
  const ringColors: Record<AnchorTrack['name'], number> = {
    floor: COLOR_FLOOR,
    table: COLOR_TABLE,
    fallback: COLOR_FALLBACK,
    restored: COLOR_RESTORED,
  };
  const tracks: AnchorTrack[] = [];

  const makeStandIn = (material: MeshBasicMaterial): Group => {
    const group = new Group();
    const body = new Mesh(bodyGeometry, material);
    body.position.y = STAND_IN_BODY_RADIUS_M + STAND_IN_BODY_LENGTH_M / 2;
    const head = new Mesh(headGeometry, material);
    head.position.y = STAND_IN_BODY_RADIUS_M * 2 + STAND_IN_BODY_LENGTH_M + STAND_IN_HEAD_RADIUS_M * 0.6;
    const nose = new Mesh(noseGeometry, noseMaterial);
    nose.position.set(0, head.position.y, STAND_IN_HEAD_RADIUS_M + 0.02);
    group.add(body, head, nose);
    group.visible = false;
    return group;
  };

  const floorStandIn = makeStandIn(bodyMaterials.floor);
  const tableStandIn = makeStandIn(bodyMaterials.table);
  const floorStandInEntity = spawn(floorStandIn);
  const tableStandInEntity = spawn(tableStandIn);

  const reticle = new Group();
  reticle.add(new Mesh(reticleGeometry, reticleMaterial));
  reticle.visible = false;
  const reticleEntity = spawn(reticle);
  reticleEntity.addComponent(EnvironmentRaycastTarget, { space: RaycastSpace.Right });

  const query = {
    planes: world.queryManager.registerQuery({ required: [XRPlaneComponent] }),
    meshes: world.queryManager.registerQuery({ required: [XRMeshComponent] }),
  };
  const depthSystem = world.getSystem(DepthSensingSystem);

  const headPosition = new Vector3();
  const headDirection = new Vector3();
  const hitPoint = new Vector3();
  const localPoint = new Vector3();
  const poseMatrix = new Matrix4();
  const standInPoint: Point3 = { x: 0, y: 0, z: 0 };

  // Scan state
  const scanLabels = new Map<string, number>();
  const peakLabels = new Map<string, number>();
  let scanPlaneEntities = 0;
  let scanMeshEntities = 0;
  let scanBoundedMeshes = 0;
  let scanFloorY = Number.NaN;
  let maxPlanes = 0;
  let maxMeshes = 0;
  let maxBoundedMeshes = 0;
  let rawPlaneCount = 0;
  let rawMeshCount = 0;
  let maxRawPlanes = 0;
  let maxRawMeshes = 0;
  let labelsOnPlanes = false;
  let labelsOnMeshes = false;
  let floorLabelY = Number.NaN;
  let planesQualified = 0;
  let meshesQualified = 0;

  // Hit-label lookup state (used by the visitors below)
  let bestScore = Number.POSITIVE_INFINITY;
  let bestLabel = '';

  // Run state
  let stage: Stage = secondRun ? 'restore' : 'floor';
  let stageTime = 0;
  let elapsed = 0;
  let frames = 0;
  let scanClock = SCAN_INTERVAL_S;
  let liveClock = LIVE_TEXT_INTERVAL_S;
  let pendingPinch: Hand | null = null;
  let pinchCount = 0;
  let emptyHits = 0;
  let hitCount = 0;
  let wrongHeightHits = 0;
  let anchorMethod = 'none';
  let floorY = Number.NaN;
  let floorSource = 'none';
  let floorHitY = Number.NaN;
  let floorHitLabel = '';
  let tableHitLabel = '';
  let tableHeightM = Number.NaN;
  let tableStandInPlaced = false;
  let floorStandInPlaced = false;
  let hitTestFailedReason: string | undefined;
  let depthFrames = 0;
  let depthAnswer: 'none' | 'hidden' | 'not-hidden' = 'none';
  let restoreOutcome = '';
  let restoreDistanceM = Number.NaN;
  let needsUserNow = false;
  let finished = false;
  let stopFrames: () => void = () => undefined;
  let forgetHandle: string | undefined;
  let planesUnsubscribe: () => void = () => undefined;
  let meshesUnsubscribe: () => void = () => undefined;

  const setNeedsUser = (needsUser: boolean): void => {
    if (needsUser === needsUserNow) return;
    needsUserNow = needsUser;
    ctx.setNeedsUser(needsUser);
  };

  const setStage = (next: Stage): void => {
    stage = next;
    stageTime = 0;
  };

  // ---- Scene scan (planes, meshes, labels) ----

  const addLabel = (label: string): void => {
    scanLabels.set(label, (scanLabels.get(label) ?? 0) + 1);
  };

  const visitPlane = (entity: Entity): void => {
    scanPlaneEntities += 1;
    const raw = entity.getValue(XRPlaneComponent, '_plane') as unknown as XRPlane | null;
    const label = raw?.semanticLabel ?? '';
    if (label.length > 0) {
      addLabel(label);
      labelsOnPlanes = true;
      if (label === 'floor') {
        const y = entity.object3D?.position.y;
        if (y !== undefined && (Number.isNaN(scanFloorY) || y < scanFloorY)) scanFloorY = y;
      }
    }
  };

  const visitMesh = (entity: Entity): void => {
    scanMeshEntities += 1;
    if (entity.getValue(XRMeshComponent, 'isBounded3D') === true) scanBoundedMeshes += 1;
    const label = entity.getValue(XRMeshComponent, 'semanticLabel');
    if (typeof label === 'string' && label.length > 0) {
      addLabel(label);
      labelsOnMeshes = true;
    }
  };

  const mergePeak = (count: number, label: string): void => {
    if (count > (peakLabels.get(label) ?? 0)) peakLabels.set(label, count);
  };

  const scanScene = (frame: XRFrame): void => {
    try {
      rawPlaneCount = frame.detectedPlanes?.size ?? 0;
      rawMeshCount = frame.detectedMeshes?.size ?? 0;
    } catch {
      rawPlaneCount = 0;
      rawMeshCount = 0;
    }
    scanLabels.clear();
    scanPlaneEntities = 0;
    scanMeshEntities = 0;
    scanBoundedMeshes = 0;
    scanFloorY = Number.NaN;
    query.planes.entities.forEach(visitPlane);
    query.meshes.entities.forEach(visitMesh);
    if (scanPlaneEntities > maxPlanes) maxPlanes = scanPlaneEntities;
    if (scanMeshEntities > maxMeshes) maxMeshes = scanMeshEntities;
    if (scanBoundedMeshes > maxBoundedMeshes) maxBoundedMeshes = scanBoundedMeshes;
    if (rawPlaneCount > maxRawPlanes) maxRawPlanes = rawPlaneCount;
    if (rawMeshCount > maxRawMeshes) maxRawMeshes = rawMeshCount;
    scanLabels.forEach(mergePeak);
    if (!Number.isNaN(scanFloorY)) floorLabelY = scanFloorY;
  };

  // ---- Label of the surface under a hit point ----

  const nearPlane = (entity: Entity): void => {
    const object = entity.object3D;
    const raw = entity.getValue(XRPlaneComponent, '_plane') as unknown as XRPlane | null;
    if (object === undefined || object === null || raw === null) return;
    object.updateWorldMatrix(true, false);
    localPoint.copy(hitPoint);
    object.worldToLocal(localPoint);
    const offPlane = Math.abs(localPoint.y);
    if (offPlane > PLANE_HIT_TOLERANCE_M || offPlane >= bestScore) return;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    const polygon = raw.polygon;
    for (let index = 0; index < polygon.length; index += 1) {
      const point = polygon[index];
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.z < minZ) minZ = point.z;
      if (point.z > maxZ) maxZ = point.z;
    }
    if (
      localPoint.x < minX - PLANE_HIT_TOLERANCE_M ||
      localPoint.x > maxX + PLANE_HIT_TOLERANCE_M ||
      localPoint.z < minZ - PLANE_HIT_TOLERANCE_M ||
      localPoint.z > maxZ + PLANE_HIT_TOLERANCE_M
    ) {
      return;
    }
    bestScore = offPlane;
    bestLabel = raw.semanticLabel ?? '';
  };

  const nearMesh = (entity: Entity): void => {
    const object = entity.object3D;
    const label = entity.getValue(XRMeshComponent, 'semanticLabel');
    if (object === undefined || object === null || typeof label !== 'string' || label.length === 0) return;
    const min = entity.getVectorView(XRMeshComponent, 'min');
    const max = entity.getVectorView(XRMeshComponent, 'max');
    object.updateWorldMatrix(true, false);
    localPoint.copy(hitPoint);
    object.worldToLocal(localPoint);
    const outX = Math.max(min[0] - localPoint.x, 0, localPoint.x - max[0]);
    const outY = Math.max(min[1] - localPoint.y, 0, localPoint.y - max[1]);
    const outZ = Math.max(min[2] - localPoint.z, 0, localPoint.z - max[2]);
    const outside = Math.hypot(outX, outY, outZ);
    // A tiny bias keeps a plane label ahead of a mesh label when both fit equally well.
    const score = outside + 0.001;
    if (outside > MESH_HIT_MARGIN_M || score >= bestScore) return;
    bestScore = score;
    bestLabel = label;
  };

  const labelAtHit = (): string => {
    bestScore = Number.POSITIVE_INFINITY;
    bestLabel = '';
    query.planes.entities.forEach(nearPlane);
    query.meshes.entities.forEach(nearMesh);
    return bestLabel.length > 0 ? bestLabel : 'none';
  };

  // ---- Stand-ins and markers ----

  const readHead = (): void => {
    world.player.head.getWorldPosition(headPosition);
    world.player.head.getWorldDirection(headDirection);
  };

  const faceHead = (group: Group): void => {
    group.rotation.y = Math.atan2(headPosition.x - group.position.x, headPosition.z - group.position.z);
  };

  const placeFloorStandIn = (): void => {
    readHead();
    // Object3D.getWorldDirection returns the local +Z axis, and the head looks down -Z.
    idleHomeDraft(
      headPosition,
      -headDirection.x,
      -headDirection.z,
      Number.isNaN(floorY) ? undefined : floorY,
      standInPoint,
    );
    floorStandIn.position.set(standInPoint.x, standInPoint.y, standInPoint.z);
    faceHead(floorStandIn);
    floorStandIn.visible = true;
    floorStandInPlaced = true;
  };

  const placeTableStandIn = (x: number, y: number, z: number): void => {
    readHead();
    tableStandIn.position.set(x, y, z);
    faceHead(tableStandIn);
    tableStandIn.visible = true;
    tableStandInPlaced = true;
    if (depthFeature === true && depthSystem !== undefined) {
      tableStandInEntity.addComponent(DepthOccludable);
    }
  };

  const createTrack = (name: AnchorTrack['name']): AnchorTrack => {
    const marker = new Group();
    const ringMaterial = new MeshBasicMaterial({ color: ringColors[name], side: DoubleSide });
    marker.add(new Mesh(ringGeometry, ringMaterial), new Mesh(poleGeometry, poleMaterial));
    marker.visible = false;
    spawn(marker);
    const track: AnchorTrack = {
      name,
      marker,
      ringMaterial,
      anchor: undefined,
      creating: false,
      error: undefined,
      goodFrames: 0,
      lostFrames: 0,
      hasStart: false,
      startX: 0,
      startY: 0,
      startZ: 0,
      lastX: 0,
      lastY: 0,
      lastZ: 0,
      hasPose: false,
      maxDriftM: 0,
      wantsHandle: name === 'table' || name === 'fallback',
      handleState: 'none',
      handle: undefined,
      handleError: undefined,
    };
    tracks.push(track);
    return track;
  };

  const requestHandle = (track: AnchorTrack, anchor: XRAnchor): void => {
    if (typeof anchor.requestPersistentHandle !== 'function') {
      track.handleState = 'unsupported';
      return;
    }
    track.handleState = 'requested';
    anchor.requestPersistentHandle().then(
      (handle) => {
        track.handle = handle;
        track.handleState = handle.length > 0 ? 'saved' : 'failed';
        if (handle.length === 0) track.handleError = 'empty handle';
      },
      (error: unknown) => {
        track.handleState = 'failed';
        track.handleError = errorText(error);
      },
    );
  };

  const adoptAnchor = (track: AnchorTrack, promise: Promise<XRAnchor>): void => {
    track.creating = true;
    promise.then(
      (anchor) => {
        track.creating = false;
        if (finished) {
          try {
            anchor.delete();
          } catch {
            // Session already gone.
          }
          return;
        }
        track.anchor = anchor;
        if (track.wantsHandle) requestHandle(track, anchor);
      },
      (error: unknown) => {
        track.creating = false;
        track.error = errorText(error);
      },
    );
  };

  /** Must run inside the frame callback: createAnchor needs an active frame. */
  const createAnchorAtHit = (
    track: AnchorTrack,
    frame: XRFrame,
    referenceSpace: XRReferenceSpace,
    result: XRHitTestResult,
    pose: XRPose,
  ): void => {
    try {
      if (typeof result.createAnchor === 'function') {
        anchorMethod = 'XRHitTestResult.createAnchor';
        adoptAnchor(track, result.createAnchor());
        return;
      }
      if (typeof frame.createAnchor === 'function') {
        anchorMethod = 'XRFrame.createAnchor';
        adoptAnchor(track, frame.createAnchor(pose.transform, referenceSpace));
        return;
      }
      track.error = 'Neither XRHitTestResult.createAnchor nor XRFrame.createAnchor exists.';
    } catch (error) {
      track.error = errorText(error);
    }
  };

  const createFallbackAnchor = (frame: XRFrame, referenceSpace: XRReferenceSpace): void => {
    const track = createTrack('fallback');
    readHead();
    try {
      if (typeof frame.createAnchor !== 'function') {
        track.error = 'XRFrame.createAnchor does not exist.';
        return;
      }
      anchorMethod = 'XRFrame.createAnchor (fallback, no hit-test)';
      const x = headPosition.x - headDirection.x * FALLBACK_ANCHOR_AHEAD_M;
      const z = headPosition.z - headDirection.z * FALLBACK_ANCHOR_AHEAD_M;
      const y = headPosition.y - FALLBACK_ANCHOR_BELOW_HEAD_M;
      const transform = new XRRigidTransform({ x, y, z }, { x: 0, y: 0, z: 0, w: 1 });
      adoptAnchor(track, frame.createAnchor(transform, referenceSpace));
    } catch (error) {
      track.error = errorText(error);
    }
  };

  const updateTrack = (track: AnchorTrack, frame: XRFrame, referenceSpace: XRReferenceSpace): void => {
    const anchor = track.anchor;
    if (anchor === undefined) return;
    let pose: XRPose | undefined;
    try {
      const tracked = frame.trackedAnchors === undefined || frame.trackedAnchors.has(anchor);
      pose = tracked ? frame.getPose(anchor.anchorSpace, referenceSpace) : undefined;
    } catch {
      pose = undefined;
    }
    if (pose === undefined) {
      track.lostFrames += 1;
      return;
    }
    track.goodFrames += 1;
    const position = pose.transform.position;
    track.lastX = position.x;
    track.lastY = position.y;
    track.lastZ = position.z;
    track.hasPose = true;
    if (!track.hasStart) {
      track.hasStart = true;
      track.startX = position.x;
      track.startY = position.y;
      track.startZ = position.z;
    } else {
      const drift = Math.hypot(position.x - track.startX, position.y - track.startY, position.z - track.startZ);
      if (drift > track.maxDriftM) track.maxDriftM = drift;
    }
    poseMatrix.fromArray(pose.transform.matrix);
    poseMatrix.decompose(track.marker.position, track.marker.quaternion, track.marker.scale);
    track.marker.visible = true;
  };

  const trackSettled = (track: AnchorTrack): boolean => {
    if (track.error !== undefined) return true;
    if (track.anchor === undefined) return false;
    if (track.goodFrames < REQUIRED_ANCHOR_FRAMES) return false;
    return track.handleState !== 'requested';
  };

  // ---- Verdicts ----

  const evaluate = (): Phase1Summary => {
    const capabilities: Partial<Record<CapabilityKey, Verdict>> = {};
    const reasons: Partial<Record<CapabilityKey, string>> = {};
    const fail = (key: CapabilityKey, reason: string): void => {
      capabilities[key] = 'does_not_work';
      reasons[key] = reason;
    };
    const pass = (key: CapabilityKey): void => {
      capabilities[key] = 'works';
    };

    // planes
    if (maxPlanes > 0) pass('planes');
    else if (planeFeature === false) fail('planes', 'plane-detection was not granted for this session.');
    else fail('planes', `No plane appeared. Raw frame.detectedPlanes max ${maxRawPlanes}. Scan the room and check the Quest room setup.`);

    // semantic labels
    if (peakLabels.size > 0) pass('semanticLabels');
    else if (maxPlanes + maxMeshes === 0) fail('semanticLabels', 'No plane or mesh appeared, so no label could be read.');
    else fail('semanticLabels', 'Planes or meshes appeared but none carried a semanticLabel.');

    // mesh
    if (maxMeshes > 0) pass('mesh');
    else if (meshFeature === false) fail('mesh', 'mesh-detection was not granted for this session.');
    else fail('mesh', `No mesh appeared. Raw frame.detectedMeshes max ${maxRawMeshes}. The room scan may be missing.`);

    // anchors
    const phase1Tracks = tracks.filter((track) => track.name !== 'restored');
    const problems: string[] = [];
    for (const track of phase1Tracks) {
      if (track.error !== undefined) problems.push(`${track.name} anchor: ${track.error}`);
      else if (track.anchor === undefined) problems.push(`${track.name} anchor was never created`);
      else if (track.goodFrames < REQUIRED_ANCHOR_FRAMES) {
        problems.push(`${track.name} anchor tracked only ${track.goodFrames} of ${REQUIRED_ANCHOR_FRAMES} frames`);
      } else if (track.lostFrames > MAX_LOST_ANCHOR_FRAMES) {
        problems.push(`${track.name} anchor lost tracking on ${track.lostFrames} frames`);
      }
    }
    if (phase1Tracks.length === 0) {
      fail('anchors', anchorFeature === false ? 'The anchors feature was not granted.' : 'No anchor was created.');
    } else if (problems.length > 0) {
      fail('anchors', problems.join('; ') + '.');
    } else {
      pass('anchors');
    }

    // hit-test
    if (hitCount > 0) pass('hitTest');
    else if (hitTestFeature === false) fail('hitTest', 'The hit-test feature was not granted for this session.');
    else if (hitTestFailedReason !== undefined) fail('hitTest', hitTestFailedReason);
    else fail('hitTest', 'No hit-test result was seen.');

    // depth (bonus)
    if (depthFeature !== true) {
      fail('depthOcclusion', `depth-sensing was not granted (${grantedText(depthFeature)}).`);
    } else if (depthSystem === undefined) {
      fail('depthOcclusion', 'DepthSensingSystem was not registered before the session.');
    } else if (depthFrames < MIN_DEPTH_FRAMES) {
      fail('depthOcclusion', `Depth was granted but only ${depthFrames} frames carried depth data.`);
    } else if (depthAnswer === 'hidden') {
      pass('depthOcclusion');
    } else if (depthAnswer === 'not-hidden') {
      fail('depthOcclusion', 'Depth data arrived, but the stand-in did not hide behind the hand.');
    } else {
      fail('depthOcclusion', 'Depth data arrived, but occlusion was not confirmed by the user in time.');
    }

    const must: CapabilityKey[] = ['planes', 'hitTest', 'anchors'];
    const verdict: Verdict = must.every((key) => capabilities[key] === 'works') ? 'works' : 'does_not_work';
    return { verdict, capabilities, reasons, measurements: buildMeasurements() };
  };

  const buildMeasurements = (): Record<string, number | string> => {
    const measurements: Record<string, number | string> = {
      featuresGranted: `planes=${grantedText(planeFeature)} meshes=${grantedText(meshFeature)} anchors=${grantedText(anchorFeature)} hitTest=${grantedText(hitTestFeature)} depth=${grantedText(depthFeature)}`,
      planesMaxEntities: maxPlanes,
      planesMaxRawFrame: maxRawPlanes,
      planesQualifyEvents: planesQualified,
      meshesMaxEntities: maxMeshes,
      meshesMaxBounded3D: maxBoundedMeshes,
      meshesMaxRawFrame: maxRawMeshes,
      meshesQualifyEvents: meshesQualified,
      semanticLabelsPeak: labelsText(peakLabels),
      semanticLabelsOn: `${labelsOnPlanes ? 'planes' : ''}${labelsOnPlanes && labelsOnMeshes ? '+' : ''}${labelsOnMeshes ? 'meshes' : ''}` || 'none',
      pinchesSeen: pinchCount,
      hitTestHits: hitCount,
      hitTestEmptyResults: emptyHits,
      anchorCreateMethod: anchorMethod,
      persistentHandleApi: tracks.some((track) => track.handleState === 'unsupported') ? 'no' : tracks.some((track) => track.handleState !== 'none') ? 'yes' : 'not tried',
      depthFramesWithData: depthFrames,
      framesObserved: frames,
    };
    if (!Number.isNaN(floorLabelY)) measurements.floorLabelY_m = Number(floorLabelY.toFixed(3));
    if (!Number.isNaN(floorHitY)) measurements.floorHitY_m = Number(floorHitY.toFixed(3));
    if (!Number.isNaN(floorLabelY) && !Number.isNaN(floorHitY)) {
      measurements.floorHitVsLabelMm = mm(floorHitY - floorLabelY);
    }
    measurements.floorStandInSource = floorSource;
    if (floorHitLabel.length > 0) measurements.labelUnderFloorPinch = floorHitLabel;
    if (tableHitLabel.length > 0) measurements.labelUnderTablePinch = tableHitLabel;
    if (!Number.isNaN(tableHeightM)) measurements.tableTopAboveFloor_m = Number(tableHeightM.toFixed(2));
    measurements.floorStandIn = floorStandInPlaced ? (Number.isNaN(floorY) ? 'floating (no floor known)' : 'on floor') : 'not placed';
    measurements.tableStandIn = tableStandInPlaced ? 'at table hit' : 'not placed (no table pinch)';
    if (wrongHeightHits > 0) measurements.pinchesRejectedAsFloorLevel = wrongHeightHits;
    for (const track of tracks) {
      if (track.name === 'restored') continue;
      measurements[`anchor_${track.name}`] =
        `good ${track.goodFrames}, lost ${track.lostFrames}, drift ${mm(track.maxDriftM)} mm` +
        (track.error !== undefined ? `, error ${track.error}` : '') +
        (track.wantsHandle ? `, persistent handle ${track.handleState}${track.handleError !== undefined ? ` (${track.handleError})` : ''}` : '');
    }
    if (depthAnswer !== 'none') measurements.depthUserAnswer = depthAnswer === 'hidden' ? 'hid behind hand' : 'did not hide';
    return measurements;
  };

  // ---- Stage logic ----

  const tableTrack = (): AnchorTrack | undefined => tracks.find((track) => track.name === 'table' || track.name === 'fallback');

  const finish = (result: SpikeResult): void => {
    if (finished) return;
    finished = true;
    setStage('done');
    stopFrames();
    session.removeEventListener('selectstart', onSelectStart);
    for (const track of tracks) {
      if (track.anchor === undefined) continue;
      try {
        track.anchor.delete();
      } catch {
        // The session may be gone already.
      }
    }
    if (forgetHandle !== undefined && typeof session.deletePersistentAnchor === 'function') {
      session.deletePersistentAnchor(forgetHandle).catch(() => undefined);
    }
    for (const entity of spawned) {
      try {
        if (entity.active) entity.dispose();
      } catch {
        // Already disposed.
      }
    }
    for (const geometry of [ringGeometry, poleGeometry, reticleGeometry, bodyGeometry, headGeometry, noseGeometry]) {
      geometry.dispose();
    }
    for (const material of [reticleMaterial, poleMaterial, noseMaterial, bodyMaterials.floor, bodyMaterials.table]) {
      material.dispose();
    }
    for (const track of tracks) track.ringMaterial.dispose();
    setNeedsUser(false);
    ctx.setHoldOnSessionEnd(false);
    resolveRun(result);
  };

  let resolveRun: (result: SpikeResult) => void = () => undefined;

  /** The first run is over and no reload check is wanted or possible. */
  const finishFirstRun = (note: string): void => {
    const summary = evaluate();
    const handle = tableTrack()?.handle;
    if (handle !== undefined) forgetHandle = handle;
    clearItemBState(window.localStorage);
    finish(buildResult(summary, { persistentRestore: note }));
  };

  const enterReloadWait = (): void => {
    const track = tableTrack();
    if (track === undefined || track.handleState !== 'saved' || track.handle === undefined) {
      const why =
        track === undefined
          ? 'not run: no table anchor'
          : track.handleState === 'unsupported'
            ? 'not supported: anchor.requestPersistentHandle is missing'
            : track.handleState === 'failed'
              ? `failed to save a handle: ${track.handleError ?? 'unknown'}`
              : 'not run: no handle was saved';
      finishFirstRun(why);
      return;
    }
    const summary = evaluate();
    writeInterim({ savedAt: Date.now(), handle: track.handle, summary });
    ctx.setHoldOnSessionEnd(true);
    setStage('reload-wait');
    setNeedsUser(true);
  };

  const afterAnchors = (): void => {
    if (depthFeature === true && depthSystem !== undefined && depthFrames >= MIN_DEPTH_FRAMES && tableStandInPlaced) {
      setStage('depth');
      setNeedsUser(true);
      return;
    }
    enterReloadWait();
  };

  const currentResult = (): XRHitTestResult | undefined => {
    const result = reticleEntity.getValue(EnvironmentRaycastTarget, 'xrHitTestResult') as unknown as
      | XRHitTestResult
      | null
      | undefined;
    return result ?? undefined;
  };

  const handlePinch = (hand: Hand, frame: XRFrame, referenceSpace: XRReferenceSpace): void => {
    pinchCount += 1;

    if (stage === 'depth') {
      depthAnswer = hand === 'right' ? 'hidden' : 'not-hidden';
      setNeedsUser(false);
      enterReloadWait();
      return;
    }
    if (stage === 'reload-wait') {
      if (hand === 'left') {
        const handle = tableTrack()?.handle;
        if (handle !== undefined) forgetHandle = handle;
        clearItemBState(window.localStorage);
        finish(buildResult(evaluate(), { persistentRestore: 'skipped by the user' }));
      }
      return;
    }
    if (hand !== 'right') return;
    if (stage !== 'floor' && stage !== 'table' && stage !== 'restore') return;

    const result = currentResult();
    let pose: XRPose | undefined;
    try {
      pose = result?.getPose(referenceSpace);
    } catch {
      pose = undefined;
    }
    if (result === undefined || pose === undefined) {
      emptyHits += 1;
      return;
    }
    const position = pose.transform.position;
    hitPoint.set(position.x, position.y, position.z);

    if (stage === 'restore') {
      const restored = tracks.find((track) => track.name === 'restored');
      if (restored === undefined || !restored.hasPose) {
        emptyHits += 1;
        return;
      }
      hitCount += 1;
      restoreDistanceM = Math.hypot(position.x - restored.lastX, position.y - restored.lastY, position.z - restored.lastZ);
      restoreOutcome =
        restoreDistanceM <= RESTORE_MATCH_RADIUS_M
          ? 'restored in place'
          : `restored but ${mm(restoreDistanceM)} mm from the new pinch`;
      finishSecondRun();
      return;
    }

    hitCount += 1;

    if (stage === 'floor') {
      floorHitY = position.y;
      floorHitLabel = labelAtHit();
      if (!Number.isNaN(floorLabelY)) {
        floorY = floorLabelY;
        floorSource = 'label floor plane';
      } else {
        floorY = position.y;
        floorSource = 'first pinch';
      }
      createAnchorAtHit(createTrack('floor'), frame, referenceSpace, result, pose);
      placeFloorStandIn();
      setStage('table');
      return;
    }

    // table stage
    if (position.y < floorY + MIN_TABLE_HEIGHT_M) {
      wrongHeightHits += 1;
      return;
    }
    tableHitLabel = labelAtHit();
    tableHeightM = position.y - floorY;
    createAnchorAtHit(createTrack('table'), frame, referenceSpace, result, pose);
    placeTableStandIn(position.x, position.y, position.z);
    setStage('anchors');
    setNeedsUser(false);
  };

  const finishSecondRun = (): void => {
    if (interim === undefined) return;
    clearItemBState(window.localStorage);
    forgetHandle = interim.handle;
    const extra: Record<string, number | string> = {
      persistentRestore: restoreOutcome,
      persistentRestoreRun: 'after page reload',
    };
    if (!Number.isNaN(restoreDistanceM)) extra.restoreDistance_mm = mm(restoreDistanceM);
    const merged: Phase1Summary = {
      ...interim.summary,
      measurements: { ...interim.summary.measurements },
    };
    finish(buildResult(merged, extra));
  };

  // ---- Second run: restore the saved anchor ----

  const startRestore = (): void => {
    if (interim === undefined) return;
    const track = createTrack('restored');
    try {
      const promise = session.restorePersistentAnchor?.(interim.handle);
      if (promise === undefined) {
        restoreOutcome = 'not supported: session.restorePersistentAnchor is missing';
        finishSecondRun();
        return;
      }
      track.creating = true;
      promise.then(
        (anchor) => {
          track.creating = false;
          if (finished) {
            try {
              anchor.delete();
            } catch {
              // Session gone.
            }
            return;
          }
          track.anchor = anchor;
        },
        (error: unknown) => {
          track.creating = false;
          track.error = errorText(error);
        },
      );
    } catch (error) {
      track.error = errorText(error);
    }
  };

  // ---- Pinch input ----

  const onSelectStart = (event: XRInputSourceEvent): void => {
    const handedness = event.inputSource.handedness;
    if (handedness === 'left' || handedness === 'right') pendingPinch = handedness;
  };

  // ---- Live text ----

  const liveText = (): string => {
    const scene = `Planes ${scanPlaneEntities}, meshes ${scanMeshEntities}, labels ${labelsText(peakLabels)}.`;
    switch (stage) {
      case 'floor':
        return `${scene} Step 1: pinch the FLOOR with your right hand. Pinches ${pinchCount}, hits ${hitCount}, empty ${emptyHits}. ${Math.max(0, Math.ceil(FLOOR_STAGE_TIMEOUT_S - stageTime))} s left.`;
      case 'table':
        return `${scene} Step 2: pinch a TABLE TOP with your right hand.${wrongHeightHits > 0 ? ' That pinch was at floor level.' : ''} ${Math.max(0, Math.ceil(TABLE_STAGE_TIMEOUT_S - stageTime))} s left.`;
      case 'anchors': {
        const parts = tracks.map((track) => `${track.name} ${track.error !== undefined ? 'ERR' : `${track.goodFrames}/${REQUIRED_ANCHOR_FRAMES}`}`);
        return `Holding anchors: ${parts.join(', ')}. Look at the cyan and orange rings. Keep looking around.`;
      }
      case 'depth':
        return `Depth check (${depthFrames} frames of depth). Hold a hand between you and the orange figure. RIGHT pinch if it hid behind the hand, LEFT pinch if it did not. ${Math.max(0, Math.ceil(DEPTH_STAGE_TIMEOUT_S - stageTime))} s left.`;
      case 'reload-wait':
        return 'Anchor saved. Now exit AR, reload this page, enter AR, press Start on item (b) again. Or pinch with your LEFT hand to skip this check.';
      case 'restore': {
        const track = tracks.find((candidate) => candidate.name === 'restored');
        if (track === undefined || track.error !== undefined) return 'Restoring the saved anchor.';
        if (!track.hasPose) return 'Restoring the saved anchor. Look around the table where you pinched before.';
        return `Restored. The magenta ring is the saved anchor. Pinch the table right under it with your right hand. ${Math.max(0, Math.ceil(RESTORE_STAGE_TIMEOUT_S - stageTime))} s left.`;
      }
      default:
        return '';
    }
  };

  // ---- Frame loop ----

  const onFrame = (frame: XRFrame, deltaSeconds: number): void => {
    if (finished) return;
    const referenceSpace = world.xrReferenceSpace;
    if (referenceSpace === null) return;

    const delta = Math.min(Math.max(deltaSeconds, 0), MAX_FRAME_DELTA_S);
    elapsed += delta;
    stageTime += delta;
    frames += 1;

    scanClock += delta;
    if (scanClock >= SCAN_INTERVAL_S) {
      scanClock = 0;
      scanScene(frame);
    }

    if (!floorStandInPlaced && frames > 5 && stage !== 'restore') placeFloorStandIn();
    if (!Number.isNaN(floorLabelY) && Number.isNaN(floorY) && stage !== 'restore') {
      floorY = floorLabelY;
      floorSource = 'label floor plane';
      placeFloorStandIn();
    }

    if (pendingPinch !== null) {
      const hand = pendingPinch;
      pendingPinch = null;
      if (elapsed > PINCH_GUARD_S) handlePinch(hand, frame, referenceSpace);
      if (finished) return;
    }

    for (let index = 0; index < tracks.length; index += 1) updateTrack(tracks[index], frame, referenceSpace);

    if (depthSystem !== undefined && depthSystem.gpuDepthData.length + depthSystem.cpuDepthData.length > 0) {
      depthFrames += 1;
    }

    switch (stage) {
      case 'floor':
        if (stageTime > FLOOR_STAGE_TIMEOUT_S) {
          hitTestFailedReason = `No pinch produced a hit-test result in ${FLOOR_STAGE_TIMEOUT_S} s (pinches ${pinchCount}, empty results ${emptyHits}).`;
          createFallbackAnchor(frame, referenceSpace);
          setStage('anchors');
          setNeedsUser(false);
        }
        break;
      case 'table':
        if (stageTime > TABLE_STAGE_TIMEOUT_S) {
          setStage('anchors');
          setNeedsUser(false);
        }
        break;
      case 'anchors':
        if (tracks.every(trackSettled) || stageTime > ANCHOR_STAGE_TIMEOUT_S) afterAnchors();
        break;
      case 'depth':
        if (stageTime > DEPTH_STAGE_TIMEOUT_S) {
          setNeedsUser(false);
          enterReloadWait();
        }
        break;
      case 'reload-wait':
        if (stageTime > RELOAD_WAIT_TIMEOUT_S) {
          const handle = tableTrack()?.handle;
          if (handle !== undefined) forgetHandle = handle;
          clearItemBState(window.localStorage);
          finish(buildResult(evaluate(), { persistentRestore: 'not run: no reload within the time limit' }));
        }
        break;
      case 'restore': {
        const track = tracks.find((candidate) => candidate.name === 'restored');
        if (track !== undefined && track.error !== undefined) {
          restoreOutcome = `failed: ${track.error}`;
          finishSecondRun();
        } else if (track !== undefined && !track.hasPose && stageTime > RESTORE_NO_POSE_TIMEOUT_S && track.anchor !== undefined) {
          restoreOutcome = 'restored a handle but the anchor never reported a pose';
          finishSecondRun();
        } else if (stageTime > RESTORE_STAGE_TIMEOUT_S) {
          restoreOutcome = track !== undefined && track.hasPose ? 'restored with a pose, position not checked (no pinch in time)' : 'restore did not complete in time';
          finishSecondRun();
        }
        break;
      }
      default:
        break;
    }
    if (finished) return;

    liveClock += delta;
    if (liveClock < LIVE_TEXT_INTERVAL_S) return;
    liveClock = 0;
    ctx.setDetail(liveText());
  };

  return new Promise<SpikeResult>((resolve) => {
    resolveRun = resolve;

    ctx.signal.addEventListener(
      'abort',
      () => {
        if (finished) return;
        const reason = ctx.signal.reason as AbortReason | undefined;
        if (reason !== 'session-ended') {
          // Stopped by the user: drop the saved reload-check state and the persistent handle.
          // On 'session-ended' both stay, so the reload check can continue after the reload.
          clearItemBState(window.localStorage);
          forgetHandle = tableTrack()?.handle ?? interim?.handle;
        }
        finish({
          item: 'b',
          verdict: 'does_not_work',
          failureReason: 'The item was stopped before it finished.',
          measurements: buildMeasurements(),
        });
      },
      { once: true },
    );

    planesUnsubscribe = query.planes.subscribe(
      'qualify',
      () => {
        planesQualified += 1;
      },
      true,
    );
    meshesUnsubscribe = query.meshes.subscribe(
      'qualify',
      () => {
        meshesQualified += 1;
      },
      true,
    );

    session.addEventListener('selectstart', onSelectStart);
    ctx.setDetail(secondRun ? 'Restoring the saved anchor.' : 'Look around to scan the room.');
    if (secondRun) {
      setNeedsUser(true);
      ctx.setHoldOnSessionEnd(true);
      startRestore();
    } else {
      setNeedsUser(true);
    }
    const stopFrameCallback = ctx.onFrame(onFrame);
    stopFrames = () => {
      stopFrameCallback();
      planesUnsubscribe();
      meshesUnsubscribe();
    };
  });
}
