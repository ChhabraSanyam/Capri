/**
 * Milestone 0 spike harness entry (served as `/spike.html`).
 *
 * Starts the world with the product's XR options, puts one UIKit runner panel in front of the
 * user, and shows the Markdown report on the 2D page when the AR session ends.
 *
 * Differences from the product options, on purpose:
 * - `handTracking` is optional here. The product requires it, but the spike must still be able to
 *   start a session on a headset without hand tracking so that it can report that fact.
 * - `depthSensing` is requested as optional. A session cannot add a feature later, and item (b)
 *   has a depth-occlusion bonus probe. The product keeps depth sensing off.
 * - The harness does not load the project scene (`virtual:iwsdk-project`). It has its own panel.
 */
import {
  DepthSensingSystem,
  PanelDocument,
  PanelUI,
  RayInteractable,
  ReferenceSpaceType,
  SessionMode,
  Vector3,
  VisibilityState,
  World,
  createSystem,
  type UIKitDocument,
} from '@iwsdk/core';
import { SPIKE_ITEMS } from './item-list.js';
import { clearItemBState } from './items/b.js';
import { clearItemCState } from './items/c.js';
import { clearItemDState } from './items/d.js';
import { buildReport } from './report.js';
import { clearSpikeResults, loadSpikeResults, saveSpikeResults } from './results-store.js';
import { SPIKE_PANEL_URL, SpikePanelView } from './spike-panel.js';
import { createSpikePage } from './spike-page.js';
import { SpikeRunner } from './spike-runner.js';

/** UIKit units are centimetres, so 560 units at this scale is about 0.9 m wide. */
const PANEL_SCALE = 0.16;
const PANEL_DISTANCE_M = 1.2;
const PANEL_DROP_M = 0.1;
/** If no session has started this long after the click, show a hint on the page. */
const SESSION_START_HINT_MS = 15000;

const headPosition = new Vector3();
const headForward = new Vector3();

/** An ECS system whose only job is to hand over the loaded panel document. */
function createPanelHandoverSystem(onDocument: (document: UIKitDocument) => void) {
  return class SpikePanelHandoverSystem extends createSystem({
    panels: { required: [PanelUI, PanelDocument] },
  }) {
    init(): void {
      this.cleanupFuncs.push(
        this.queries.panels.subscribe('qualify', (entity) => {
          const document = entity.getValue(PanelDocument, 'document') as UIKitDocument | undefined;
          if (document !== undefined) onDocument(document);
        }),
      );
    }
  };
}

async function main(): Promise<void> {
  const page = createSpikePage();
  const container = document.getElementById('scene-container') as HTMLDivElement;

  const world = await World.create(container, {
    xr: {
      sessionMode: SessionMode.ImmersiveAR,
      offer: 'none',
      referenceSpace: {
        type: ReferenceSpaceType.LocalFloor,
        fallbackOrder: [ReferenceSpaceType.Local, ReferenceSpaceType.Viewer],
      },
      features: {
        handTracking: true,
        anchors: true,
        hitTest: true,
        planeDetection: true,
        meshDetection: true,
        depthSensing: { usage: 'gpu-optimized', format: 'float32' },
      },
    },
    render: { fov: 70, near: 0.01, far: 50 },
    features: {
      spatialUI: { kit: 'horizon', preferredColorScheme: 'dark' },
      sceneUnderstanding: true,
      environmentRaycast: true,
      physics: false,
      locomotion: false,
      grabbing: false,
    },
  });

  // Item (b) depth probe. This system only learns whether depth sensing was granted when a
  // session starts, so it must be registered now, before the session. It is not auto-registered.
  world.registerSystem(DepthSensingSystem);

  const restored = loadSpikeResults(window.localStorage);
  const runner = new SpikeRunner(
    SPIKE_ITEMS,
    {
      world,
      onResultsChanged: (results) => saveSpikeResults(window.localStorage, results),
      onSessionEnded: (results) => page.showReport(buildReport(results)),
    },
    restored,
  );
  if (restored.length > 0) page.showReport(buildReport(restored));

  if (import.meta.env.DEV) {
    // Dev-only handle so an automated emulator check can press Start without aiming at the panel.
    (window as unknown as { __capriSpike?: unknown }).__capriSpike = { world, runner };
  }

  world.registerSystem(
    createPanelHandoverSystem((panelDocument) => {
      try {
        runner.attachView(new SpikePanelView(panelDocument));
      } catch (error) {
        page.showError(
          `The spike panel could not be set up: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );

  const panel = world.createTransformEntity();
  panel.addComponent(PanelUI, { config: SPIKE_PANEL_URL });
  panel.addComponent(RayInteractable);
  const panelObject = panel.object3D;
  if (panelObject === undefined || panelObject === null) {
    throw new Error('The spike panel entity has no object3D.');
  }
  panelObject.scale.setScalar(PANEL_SCALE);
  panelObject.position.set(0, 1.35, -PANEL_DISTANCE_M);

  /** Place the panel in front of the head once per session, facing the user. */
  const placePanelInFrontOfHead = (): void => {
    let stop: () => void = () => undefined;
    stop = world.onXRFrame(() => {
      stop();
      world.player.head.getWorldPosition(headPosition);
      world.player.head.getWorldDirection(headForward);
      // Object3D.getWorldDirection returns the local +Z axis, and the head looks down -Z, so flip it.
      headForward.y = 0;
      if (headForward.lengthSq() < 1e-6) headForward.set(0, 0, 1);
      headForward.normalize().negate();
      panelObject.position.set(
        headPosition.x + headForward.x * PANEL_DISTANCE_M,
        headPosition.y - PANEL_DROP_M,
        headPosition.z + headForward.z * PANEL_DISTANCE_M,
      );
      // Panels are single-sided and face +Z: yaw by atan2(dx, dz) toward the head.
      panelObject.rotation.set(
        0,
        Math.atan2(headPosition.x - panelObject.position.x, headPosition.z - panelObject.position.z),
        0,
      );
    });
  };

  let startHintTimer: number | undefined;
  world.visibilityState.subscribe((state) => {
    const active = state !== VisibilityState.NonImmersive;
    if (active) {
      if (startHintTimer !== undefined) window.clearTimeout(startHintTimer);
      startHintTimer = undefined;
      page.clearError();
      placePanelInFrontOfHead();
    }
    runner.setSessionActive(active);
  });

  page.enableClearButton(() => {
    clearSpikeResults(window.localStorage);
    clearItemBState(window.localStorage);
    clearItemCState(window.localStorage);
    clearItemDState();
    window.location.reload();
  });

  const xr = navigator.xr;
  let supported = false;
  if (xr === undefined) {
    page.setSupportLine('This browser has no WebXR. Open this page in Quest Browser.');
  } else {
    try {
      supported = await xr.isSessionSupported('immersive-ar');
    } catch {
      supported = false;
    }
    page.setSupportLine(
      supported
        ? 'Immersive AR is supported. Tap Enter AR, then put the controllers down.'
        : 'Immersive AR is not reported as supported here. Tap Enter AR anyway to see the browser prompt.',
    );
  }

  if (xr !== undefined) {
    page.enableEnterButton(() => {
      page.clearError();
      world.launchXR();
      startHintTimer = window.setTimeout(() => {
        if (world.visibilityState.peek() === VisibilityState.NonImmersive) {
          page.showError(
            'The AR session did not start. Check for a permission prompt in the headset, then tap Enter AR again.',
          );
        }
      }, SESSION_START_HINT_MS);
    });
  }
}

main().catch((error: unknown) => {
  const line = document.getElementById('error-line');
  if (line !== null) {
    line.textContent = `The spike harness failed to start: ${error instanceof Error ? error.message : String(error)}`;
    line.hidden = false;
  }
  console.error(error);
});
