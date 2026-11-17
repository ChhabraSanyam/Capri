/**
 * The single IWSDK system and the only frame entry point. It hands the frame to `CapriApp.tick`,
 * which runs the fixed stage order. `main.ts` stores the app in `world.globals`.
 *
 * `init` also wires the XR adapters to the app: the hand source (readFrame stage), the hand
 * skeleton, the hand-lost monitor and panel plus the status chips stub (the `vfxUi` stage), and the
 * Step 1 hand test panel. Every teardown goes into `cleanupFuncs`. `setStage` keeps one handler per
 * stage, so later tasks that need `vfxUi` extend the handler registered here instead of replacing it.
 *
 * Voice UI (task 13.23). `VoiceUi` (mic orb, transcript, Quick_Actions, Hand_Keyboard) is built after the
 * registration, published as `world.globals.voiceUi`, and driven from the `pointing` and `vfxUi`
 * stages. Its panels are registered as pinch-aim rectangles. The voice loop (task 13.25) sets its
 * handlers. The speech bubbles are updated in the `vfxUi` stage.
 *
 * The avatar (task 5.11) uses the `idle` and `animator` stages, and the `readFrame` stage also fills
 * the head pose and rescans the floor plane. A later task that needs one of these stages must extend
 * the handler registered here.
 *
 * The plane and mesh queries feed the `SurfaceStore` (task 7.7), which `readFrame` rescans. The store
 * is published as `world.globals.surfaces` for the ability dispatcher. The floor height still comes
 * from `FloorTracker`.
 *
 * Spatial abilities (task 7.10). An `AvatarController` runs in the `orchestrator` stage, before the
 * `idle` stage, so presence reads this frame's pose. It uses the store as its `SurfaceSource`, the
 * presence's animator and head, and a `PlainBubblePersona` (updated in the `vfxUi` stage) for the
 * missing-surface line. An `AbilityDispatcher` is published as `world.globals.abilities`. The
 * hand-operated dev panel (dev builds or `?dev=1`) calls it. A later orchestrator task extends the `orchestrator`
 * handler registered here.
 *
 * Device registration (task 9.8). `DeviceRegistration` owns the registry, stores, markers, teach flow,
 * floating list panel, and the teach orb. Its `updatePointing` runs inside the shared `pointing`
 * stage handler and its `updateUi` at the end of the `vfxUi` handler below.
 *
 * Voice loop (task 13.25). The `Persona` (lines go through a `SpeechQueue` into the audio engine) is the
 * abilities' persona too. `VoiceLoop` is created after the pointing wiring and runs in the `voice` stage.
 * The `orchestrator` stage runs the avatar controller, then the timers. Light commands run through the
 * `HackRunner` (task 15.8): gaze, flick, beams and pulse, then the backend call, then the reaction to the
 * real result. Runs queue in order and the controller is the acting body. The runner updates in the
 * `orchestrator` stage after the controller. The markers are tinted from the backend's light states.
 *
 * Hermes task flow (task 19.3). In Mock Mode `selectAgentBackend` gives the scripted agent, and a `TaskFlow`
 * (acknowledge, Task_Panel, playful idles, notify and the real outcome) is handed to the voice loop. With no
 * agent the voice loop keeps the "Hermes is unavailable" line. The flow updates in the `orchestrator` stage
 * and the panel in the `vfxUi` stage. The panel is a pinch-aim rectangle.
 *
 * Pointing (task 11.7). `PointingWiring` extends the `pointing` handler: it runs after the
 * registration, selects the marker the dominant index finger points at, confirms it on a dominant
 * pinch, highlights the marker, turns the Avatar's gaze to it, and emits `pointed:changed` and
 * `selected:changed`. Marker highlight is driven by those changes and the marker pulse already runs in
 * `registration.updateUi`, so the `vfxUi` handler needs no extra call.
 */
import { PanelDocument, PanelUI, Quaternion, Vector3, XRMesh, XRPlane, createSystem } from '@iwsdk/core';
import { createLogger } from './logger.js';
import { DeviceRegistration } from './device-registration.js';
import { PointingWiring } from './pointing-wiring.js';
import { createLazyLexicon } from './lexicon-loader.js';
import { VoiceLoop } from './voice-loop.js';
import { TaskFlow } from './task-flow.js';
import type { CapriApp } from './app.js';
import { AbilityDispatcher, describeDispatch } from '../avatar/ability-dispatcher.js';
import { AvatarController } from '../avatar/avatar-controller.js';
import { MouthDriver } from '../avatar/mouth.js';
import type { AudioEngine } from '../audio/audio-engine.js';
import { MicCapture } from '../audio/mic-capture.js';
import { SpeechQueue } from '../audio/speech-queue.js';
import { SttEngine } from '../audio/stt-engine.js';
import { voiceModel } from '../audio/voice-model.js';
import { createSpeechPresenter } from '../ui/speech-presenter.js';
import { AvatarPresence } from '../avatar/avatar-presence.js';
import { observeLightStates, selectAgentBackend } from '../backends/select-backend.js';
import type { SmartHomeBackend } from '../backends/types.js';
import type { ModeState } from '../domain/settings/mode-resolver.js';
import { wireModeAndConnections } from './mode-wiring.js';
import { AVATAR_PRESENCE } from '../config/constants.js';
import { featureFlags, resolvePointPoseGate } from '../config/feature-flags.js';
import { DEV_ACTION_LABELS } from '../domain/actions/dev-actions.js';
import { HackRunner } from '../domain/actions/hack-runner.js';
import { TimerService } from '../domain/actions/timers.js';
import { TaskPanelModel } from '../domain/task-panel-view.js';
import type { Vec3 } from '../domain/geometry.js';
import { Persona } from '../domain/persona/persona.js';
import { manifestFromVoiceIndex } from '../domain/speech/voice-index.js';
import { isPerfOverlayRequested } from '../domain/frame-stats.js';
import { HandLostMonitor } from '../domain/hand-lost.js';
import { createDeviceStore } from '../persistence/anchor-store.js';
import { LocalStorageDeviceStore } from '../persistence/device-store.js';
import { LocalStoragePlaceStore, openPlaceBook } from '../persistence/places-store.js';
import { PerfOverlay } from '../ui/perf-overlay.js';
import { HandLostPanel } from '../ui/hand-lost-panel.js';
import { DevPanel, shouldShowDevPanel } from '../ui/dev-panel.js';
import { HandTestPanel, shouldShowHandTestPanel } from '../ui/hand-test-panel.js';
import { MockBulbs } from '../ui/mock-bulbs.js';
import { SpeechBubble } from '../ui/speech-bubble.js';
import { VoiceUi } from '../ui/voice-ui.js';
import { TaskPanel } from '../ui/panels/task-panel.js';
import { StatusChips } from '../ui/status-chips.js';
import { HackingVfx } from '../vfx/hacking-vfx.js';
import { HandSkeleton } from '../xr/hand-skeleton.js';
import { FloorTracker } from '../xr/floor-tracker.js';
import { createFakeHandSource, fakeHandsMode } from '../xr/fake-hands.js';
import { createGazeRay, createHeadGazeProvider } from '../xr/head.js';
import { createXrHandSource, type HandSource } from '../xr/hands.js';
import { createWebXrAnchorPort } from '../xr/anchors.js';
import { VfxDevHandle } from './vfx-dev.js';
import { SurfaceStore } from '../xr/scene-surfaces.js';

/** Where the plain persona's bubble goes before the Avatar or the head has a position. */
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

export class CapriSystem extends createSystem({
  panels: { required: [PanelUI, PanelDocument] },
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
}) {
  private app!: CapriApp;

  init(): void {
    const app = this.globals.capri as CapriApp | undefined;
    if (app === undefined) {
      throw new Error('CapriSystem needs world.globals.capri. main.ts must set it before registering the system.');
    }
    this.app = app;

    const world = this.world;
    const player = world.player;
    const getRigMatrix = (): ArrayLike<number> => {
      player.updateWorldMatrix(true, false);
      return player.matrixWorld.elements;
    };
    const xrHands = createXrHandSource({
      getSession: () => world.xrSession,
      getFrame: () => world.xrFrame,
      getReferenceSpace: () => world.xrReferenceSpace,
      getRigMatrix,
      readIndexTipLocal: (side, out) => {
        const tip = player.indexTipSpaces[side].position;
        // IWSDK leaves the group at the origin until the hand has reported a pose.
        if (tip.x === 0 && tip.y === 0 && tip.z === 0) return false;
        out[0] = tip.x;
        out[1] = tip.y;
        out[2] = tip.z;
        return true;
      },
    });
    // Dev only (`?fakehands`): scripted joints replace the WebXR hand source and feed the same code.
    // The condition is a build-time constant, so the production bundle drops `fake-hands.ts`.
    let hands: HandSource = xrHands;
    if (import.meta.env.DEV) {
      const mode = fakeHandsMode(window.location.search);
      if (mode !== 'off') {
        const fake = createFakeHandSource(mode, { getRigMatrix });
        hands = fake;
        const dev = window as unknown as { __capriFakeHands?: unknown };
        dev.__capriFakeHands = fake;
        this.cleanupFuncs.push(() => {
          delete dev.__capriFakeHands;
        });
      }
    }
    const skeleton = new HandSkeleton(player, hands);
    this.cleanupFuncs.push(() => skeleton.dispose());

    // Standing height comes from the floor-labelled plane (Requirement 11.11).
    const floor = new FloorTracker(this.queries.planes.entities, AVATAR_PRESENCE.floorScanIntervalS);
    // Planes and meshes become Surfaces (task 7.7). Published for the ability dispatcher.
    const surfaceStore = new SurfaceStore();
    this.cleanupFuncs.push(surfaceStore.attach(this.queries.planes, this.queries.meshes));
    world.globals.surfaces = surfaceStore;
    this.cleanupFuncs.push(() => {
      if (world.globals.surfaces === surfaceStore) delete world.globals.surfaces;
    });
    if (import.meta.env.DEV) {
      (window as unknown as { __capriSurfaces?: unknown }).__capriSurfaces = surfaceStore;
      this.cleanupFuncs.push(() => {
        delete (window as unknown as { __capriSurfaces?: unknown }).__capriSurfaces;
      });
    }
    // Reused every frame: the head's world pose goes into `frame.head`.
    const headPosition = new Vector3();
    const headRotation = new Quaternion();
    // The skeleton is drawn in the same stage so it never shows a frame-old pose.
    this.cleanupFuncs.push(
      app.setStage('readFrame', (frame) => {
        hands.read(frame);
        skeleton.sync(frame);
        player.head.getWorldPosition(headPosition);
        player.head.getWorldQuaternion(headRotation);
        headPosition.toArray(frame.head.position);
        headRotation.toArray(frame.head.orientation);
        floor.update(frame.dt);
        surfaceStore.update(frame.dt);
      }),
    );

    // Spatial abilities (tasks 7.8, 7.10). The controller needs the presence's animator and head, and
    // the presence needs the controller as its body, so the presence is reached through a holder.
    const presenceRef: { current: AvatarPresence | undefined } = { current: undefined };
    // Speech output (task 13.20) and the Persona (task 13.25). Every Persona line goes through the
    // speech queue, which plays them one after another through the audio engine. The Voice_Library
    // index gives the Persona its tier 1 lines once it has loaded. Without it, lines are bubble and chirp.
    const speech = world.globals.speech as AudioEngine | undefined;
    const speechQueue = new SpeechQueue(speech);
    this.cleanupFuncs.push(() => speechQueue.dispose());
    const spoken: { text: string; claims: string; libraryId: string | undefined }[] = [];
    const persona = new Persona({
      rng: app.rng,
      clock: app.clock,
      deliver: (line) => {
        if (import.meta.env.DEV) {
          spoken.push({ text: line.text, claims: line.claims, libraryId: line.libraryId });
          if (spoken.length > 50) spoken.shift();
        }
        speechQueue.enqueue(line);
      },
    });
    if (speech !== undefined) {
      void speech.loadLibrary().then(() => persona.setManifest(manifestFromVoiceIndex(speech.voice.index)));
    }
    // Speech bubbles fade and turn to the head in the `vfxUi` stage.
    const bubbles: SpeechBubble[] = [];
    const controller = new AvatarController({
      surfaces: { all: () => surfaceStore.surfaces },
      persona,
      getAnimator: () => presenceRef.current?.proceduralAnimator,
      getHead: () => presenceRef.current?.currentHead,
    });
    const abilities = new AbilityDispatcher({
      controller,
      surfaces: { all: () => surfaceStore.surfaces },
      getHead: () => presenceRef.current?.currentHead,
    });
    world.globals.abilities = abilities;
    this.cleanupFuncs.push(() => {
      if (world.globals.abilities === abilities) delete world.globals.abilities;
    });

    // Avatar presence (task 5.11). It loads the VRM now and spawns her when the session starts.
    const presence = new AvatarPresence({
      world,
      rng: app.rng,
      logger: createLogger('avatar'),
      depthOcclusion: featureFlags.depthOcclusion,
      getFloorY: () => floor.floorY,
      body: controller,
    });
    presenceRef.current = presence;
    this.cleanupFuncs.push(() => {
      presenceRef.current = undefined;
      presence.dispose();
    });
    // Device registration (task 9.8): registry, persistence, markers, teach flow, panel, and the orb.
    // The store is read now, on the 2D page before AR. Anchors are restored once the session starts.
    const store = createDeviceStore({
      flags: featureFlags,
      anchors: createWebXrAnchorPort({
        getSession: () => world.xrSession ?? undefined,
        getReferenceSpace: () => world.xrReferenceSpace ?? null,
      }),
    });
    // The mode and the smart-home backend come from `main.ts` (task 17.6), which resolved the mode
    // with no credentials. Everything below uses only the `SmartHomeBackend` interface.
    const modeState = this.globals.mode as ModeState | undefined;
    const backend = this.globals.home as SmartHomeBackend | undefined;
    if (modeState === undefined || backend === undefined) {
      throw new Error('CapriSystem needs world.globals.mode and world.globals.home. main.ts must set them first.');
    }
    const lexicon = createLazyLexicon(createLogger('lexicon'));
    const registration = new DeviceRegistration({
      world,
      events: app.events,
      logger: createLogger('devices'),
      backend,
      store,
      handleSource: new LocalStorageDeviceStore(),
      lexicon,
      getSurfaces: () => surfaceStore.surfaces,
      getAvatarPosition: () => (presence.isSpawned ? presence.position : undefined),
      dominant: hands.dominantHand,
    });
    this.cleanupFuncs.push(() => registration.dispose());
    // Marker tint (task 13.25): each marker shows its light's state, so on and off are visible.
    const lightStates = observeLightStates(backend);
    if (lightStates !== undefined) {
      registration.applyLightStates(lightStates.value);
      this.cleanupFuncs.push(lightStates.subscribe((states) => registration.applyLightStates(states)));
    }
    // Mock Mode bulbs (task 17.4): three virtual bulbs placed head-relative at session start and
    // registered as devices, so pointing, voice, and the hack sequence work with no teaching step.
    // Their look follows the backend state only. Updated in the `vfxUi` stage below.
    const mockBulbs =
      backend.kind === 'mock' && lightStates !== undefined
        ? new MockBulbs({
            world,
            states: lightStates,
            registerDevices: (devices) => registration.registerWithoutSaving(devices),
            getFloorY: () => floor.floorY,
            logger: createLogger('mock-bulbs'),
          })
        : undefined;
    if (mockBulbs !== undefined) {
      this.cleanupFuncs.push(() => mockBulbs.dispose());
      if (import.meta.env.DEV) {
        const dev = window as unknown as { __capriMockBulbs?: unknown };
        dev.__capriMockBulbs = mockBulbs;
        this.cleanupFuncs.push(() => {
          delete dev.__capriMockBulbs;
        });
      }
    }
    // Voice UI panels (task 13.23): mic orb, transcript, Quick_Actions, and the Hand_Keyboard, placed
    // once in the seated zones. Published as `world.globals.voiceUi`. The voice loop (task 13.25) sets
    // the handlers and feeds it the transcript. Until then a press only logs. The panels are added to
    // the pinch aim rules, so a pinch aimed at them never confirms a device.
    const voiceUi = new VoiceUi(world, {
      logger: createLogger('voice-ui'),
      dominant: hands.dominantHand,
      model: voiceModel,
    });
    world.globals.voiceUi = voiceUi;
    this.cleanupFuncs.push(voiceUi.registerUiRects((getRect) => registration.addUiRect(getRect)));
    this.cleanupFuncs.push(() => {
      if (world.globals.voiceUi === voiceUi) delete world.globals.voiceUi;
      voiceUi.dispose();
    });
    if (import.meta.env.DEV) {
      const dev = window as unknown as { __capriVoiceUi?: unknown };
      dev.__capriVoiceUi = voiceUi;
      this.cleanupFuncs.push(() => {
        delete dev.__capriVoiceUi;
      });
    }

    // Pointing selection (task 11.7). The `pointing` stage is shared with the registration: its
    // handler runs the teach flow and orb first, then the pointing wiring. The wiring is told
    // whether the teach flow was idle at the start of the frame, so a pinch that drives the flow
    // (or finishes it) never also confirms a device. A pinch aimed at a panel or the orb is a button
    // press and is ignored too.
    const pointing = new PointingWiring({
      events: app.events,
      hands,
      gaze: createHeadGazeProvider(),
      getTargets: () => registration.pointTargets,
      getUiAim: () => registration.getUiAim(),
      view: {
        setHighlight: (pointedId, selectedId) => registration.setHighlight(pointedId, selectedId),
        lookAt: (target) => controller.lookAt(target),
      },
      requirePointPose: resolvePointPoseGate(window.location.search, import.meta.env.DEV),
      logger: createLogger('pointing'),
    });
    this.cleanupFuncs.push(() => pointing.dispose());
    this.cleanupFuncs.push(
      app.setStage('pointing', (frame) => {
        const teachIdle = registration.isTeachIdle;
        registration.updatePointing(frame);
        voiceUi.updatePointing(frame);
        pointing.update(frame, teachIdle);
      }),
    );
    if (import.meta.env.DEV) {
      const dev = window as unknown as { __capriPointing?: unknown };
      dev.__capriPointing = pointing;
      this.cleanupFuncs.push(() => {
        delete dev.__capriPointing;
      });
    }

    // Hacking VFX (task 15.5): beams, glyphs, sparks, and the pulse. Published as `world.globals.vfx`. It
    // is hidden and costs nothing until a stage starts. It emits from the Avatar's fingertip, plays its
    // sound cues through the audio engine, and pulses the device marker the pulse lands on. The `vfxUi`
    // stage below updates it.
    const vfx = new HackingVfx({
      world,
      rng: app.rng,
      getEmitter: () => presenceRef.current?.proceduralAnimator?.handEmitterWorld(),
      sfx: speech,
      onMarkerPulse: (target, durationS) => {
        for (const record of registration.registry.all()) {
          const p = record.position;
          if (Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z) < 0.05) {
            registration.markerFor(record.id)?.pulse(durationS);
          }
        }
      },
    });
    world.globals.vfx = vfx;
    this.cleanupFuncs.push(() => {
      if (world.globals.vfx === vfx) delete world.globals.vfx;
      vfx.dispose();
    });

    // Voice loop (task 13.25). The microphone object comes from `main.ts` (it prepares it inside the
    // Enter AR click). Only the STT engine gets the barge-in, so Capri stops talking once, when the
    // user starts to.
    const capture = (world.globals.micCapture as MicCapture | undefined) ?? new MicCapture();
    const stt = new SttEngine({ model: voiceModel, capture, bargeIn: () => speechQueue.interrupt() });
    const placeStore = openPlaceBook(new LocalStoragePlaceStore());
    const timers = new TimerService(app.clock);
    const gazeProvider = createHeadGazeProvider();
    const gazeScratch = createGazeRay();
    // Light commands (task 15.8): every accepted light action plays the hacking sequence, then the
    // backend call fires, then the reaction follows the real result. Actions queue in order. The
    // sequence plays celebrate and shrug itself, so the Persona's call lines drop their gesture.
    // `controller` is the acting body, so she does not walk off during a sequence.
    const hackRunner = new HackRunner({
      getAnimator: () => presenceRef.current?.proceduralAnimator,
      vfx,
      backend,
      persona: { say: (request) => persona.say(request, { gestures: false }) },
      body: controller,
      resolveTarget: (device) => {
        const known = registration.registry.byId(device.id)?.position;
        if (known !== undefined) return known;
        // The device was removed while queued: aim 1.5 m ahead of the head, so the effect still has a target.
        if (!gazeProvider.read(app.frame, gazeScratch)) return { x: 0, y: 1, z: -1.5 };
        const { origin, direction } = gazeScratch;
        return { x: origin.x + direction.x * 1.5, y: origin.y + direction.y * 1.5, z: origin.z + direction.z * 1.5 };
      },
      events: app.events,
      onError: (error, phase) => createLogger('hack').warn(`hack sequence ${phase} port failed: ${String(error)}`),
    });
    this.cleanupFuncs.push(() => hackRunner.dispose());
    // Hermes task flow (task 19.3). The agent is the scripted mock in Mock Mode and absent otherwise
    // (never substituted), so without one the voice loop keeps the "Hermes is unavailable" line. The
    // Task_Panel is display-only plus a Cancel/Dismiss button and is a pinch-aim rectangle.
    const agent = selectAgentBackend(modeState);
    const taskModel = new TaskPanelModel();
    let taskFlow: TaskFlow | undefined;
    let taskPanel: TaskPanel | undefined;
    if (agent !== undefined) {
      taskFlow = new TaskFlow({
        agent,
        persona,
        getAnimator: () => presenceRef.current?.proceduralAnimator,
        panel: taskModel,
        rng: app.rng,
        logger: createLogger('task'),
      });
      const flow = taskFlow;
      const panel = new TaskPanel(world, taskModel, () => flow.pressButton(), hands.dominantHand);
      taskPanel = panel;
      this.cleanupFuncs.push(() => {
        flow.dispose();
        panel.dispose();
      });
      this.cleanupFuncs.push(registration.addUiRect(() => panel.getRect()));
      this.cleanupFuncs.push(this.queries.panels.subscribe('qualify', (entity) => panel.attach(entity)));
      for (const entity of this.queries.panels.entities) panel.attach(entity);
      if (import.meta.env.DEV) {
        const dev = window as unknown as { __capriTasks?: unknown };
        dev.__capriTasks = { flow, panel, model: taskModel, agent };
        this.cleanupFuncs.push(() => {
          delete dev.__capriTasks;
        });
      }
    }
    const voiceLoop = new VoiceLoop({
      events: app.events,
      clock: app.clock,
      logger: createLogger('voice'),
      stt,
      ui: voiceUi,
      registry: registration.registry,
      places: placeStore.book,
      pointing,
      persona,
      abilities,
      runner: hackRunner,
      timers,
      getAnimator: () => presenceRef.current?.proceduralAnimator,
      getSurfaces: () => surfaceStore.surfaces,
      getHead: () => presenceRef.current?.currentHead,
      getGazeRay: () => {
        if (!gazeProvider.read(app.frame, gazeScratch)) return undefined;
        return { origin: { ...gazeScratch.origin }, direction: { ...gazeScratch.direction } };
      },
      getUiAim: () => registration.getUiAim(),
      canTalk: () => registration.isTeachIdle,
      getDominant: () => hands.dominantHand,
      getLexicon: () => (lexicon.generated ? lexicon : undefined),
      ...(taskFlow === undefined ? {} : { tasks: taskFlow }),
    });
    this.cleanupFuncs.push(() => {
      voiceLoop.dispose();
      stt.dispose();
      placeStore.detach();
    });
    this.cleanupFuncs.push(app.setStage('voice', (frame) => voiceLoop.update(frame)));
    // The controller runs first so presence reads this frame's pose, then the timers are checked.
    this.cleanupFuncs.push(
      app.setStage('orchestrator', (frame) => {
        controller.update(frame.dt);
        hackRunner.update(frame.dt);
        voiceLoop.updateOrchestrator();
        taskFlow?.update(frame.dt, frame.time);
      }),
    );
    if (import.meta.env.DEV) {
      const dev = window as unknown as { __capriVoice?: unknown };
      dev.__capriVoice = { loop: voiceLoop, stt, backend, persona, speechQueue, spoken, timers, places: placeStore.book, hackRunner };
      this.cleanupFuncs.push(() => {
        delete dev.__capriVoice;
      });
    }
    this.cleanupFuncs.push(this.queries.panels.subscribe('qualify', (entity) => registration.panel.attach(entity)));
    // A panel whose document loaded before this subscription still needs binding.
    for (const entity of this.queries.panels.entities) registration.panel.attach(entity);
    this.cleanupFuncs.push(this.queries.panels.subscribe('qualify', (entity) => voiceUi.attach(entity)));
    for (const entity of this.queries.panels.entities) voiceUi.attach(entity);
    if (import.meta.env.DEV) {
      const dev = window as unknown as { __capriTeach?: unknown };
      dev.__capriTeach = registration;
      this.cleanupFuncs.push(() => {
        delete dev.__capriTeach;
      });
    }

    this.cleanupFuncs.push(app.setStage('idle', (frame) => presence.updateIdle(frame)));
    // Speech output (task 13.20). `main.ts` publishes the engine. Its bubble and speaking gesture go to
    // the Avatar, and the mouth follows tier 1 library audio only. The engine samples the analyser
    // first so the mouth sees this frame's amplitude.
    if (speech !== undefined) {
      const speechBubble = new SpeechBubble(world, AVATAR_PRESENCE.bubble.widthM);
      bubbles.push(speechBubble);
      speech.setPresenter(
        createSpeechPresenter({
          bubble: speechBubble,
          getAvatarPosition: () => presenceRef.current?.position ?? ORIGIN,
          getHeadPosition: () => presenceRef.current?.currentHead?.position ?? ORIGIN,
          getAnimator: () => presenceRef.current?.proceduralAnimator,
        }),
      );
      const mouth = new MouthDriver(speech, () => presenceRef.current?.proceduralAnimator);
      this.cleanupFuncs.push(() => {
        speech.cancel();
        speech.setPresenter(undefined);
        speechBubble.dispose();
      });
      this.cleanupFuncs.push(
        app.setStage('animator', (frame) => {
          speech.update(frame.dt);
          mouth.update(frame.dt);
          presence.updateAnimator(frame);
        }),
      );
    } else {
      this.cleanupFuncs.push(app.setStage('animator', (frame) => presence.updateAnimator(frame)));
    }
    if (import.meta.env.DEV) {
      const dev = window as unknown as { __capriPresence?: unknown; __capriAbilities?: unknown };
      dev.__capriPresence = presence;
      dev.__capriAbilities = { controller, dispatcher: abilities };
      this.cleanupFuncs.push(() => {
        delete dev.__capriPresence;
        delete dev.__capriAbilities;
      });
    }

    const vfxViewer = new Vector3();
    let vfxDev: VfxDevHandle | undefined;
    if (import.meta.env.DEV) {
      // Dev only (the condition is a build-time constant, so the production bundle drops the handle):
      // `window.__capriVfx.run()` rehearses the effect at a marker with a stub backend and a silent Persona.
      // The real light commands go through the `HackRunner` above.
      vfxDev = new VfxDevHandle({
        vfx,
        app,
        getAnimator: () => presenceRef.current?.proceduralAnimator,
        getDevices: () => registration.registry.all(),
      });
      const dev = window as unknown as { __capriVfx?: unknown };
      dev.__capriVfx = vfxDev;
      this.cleanupFuncs.push(vfxDev.installKeys());
      this.cleanupFuncs.push(() => {
        delete dev.__capriVfx;
      });
    }

    // Hand-tracking-lost message (Requirements 9.9, 9.10) and the status chips stub, both in the
    // ui stage so they see this frame's hand state from the readFrame stage.
    const monitor = new HandLostMonitor();
    const handLostPanel = new HandLostPanel(world);
    // Status chips (task 17.5): Mode, Home Assistant, Hermes, Voice. Published as
    // `world.globals.statusChips` so the mode wiring (task 17.6) can call `setMode`. Display only.
    const statusChips = new StatusChips(app.events, { world, dominant: hands.dominantHand });
    world.globals.statusChips = statusChips;
    // Mode chip and the Home Assistant and Hermes chips (task 17.6): current states now, changes later.
    this.cleanupFuncs.push(wireModeAndConnections(app.events, statusChips, modeState, backend, agent));
    this.cleanupFuncs.push(() => handLostPanel.dispose());
    this.cleanupFuncs.push(() => {
      if (world.globals.statusChips === statusChips) delete world.globals.statusChips;
      statusChips.dispose();
    });
    this.cleanupFuncs.push(this.queries.panels.subscribe('qualify', (entity) => statusChips.attach(entity)));
    for (const entity of this.queries.panels.entities) statusChips.attach(entity);
    if (import.meta.env.DEV) {
      const dev = window as unknown as { __capriStatusChips?: unknown };
      dev.__capriStatusChips = statusChips;
      this.cleanupFuncs.push(() => {
        delete dev.__capriStatusChips;
      });
    }
    this.cleanupFuncs.push(
      app.setStage('vfxUi', (frame) => {
        if (frame.inSession) {
          handLostPanel.setVisible(monitor.update(frame.time, frame.hands.left.tracked || frame.hands.right.tracked));
        } else {
          monitor.reset();
          handLostPanel.setVisible(false);
        }
        statusChips.setVoice(voiceUi.status);
        statusChips.update(frame);
        // The animator stage has run, so the fingertip is this frame's. The dev sequence goes first so
        // its stages reach the VFX before the VFX draws.
        vfx.bindAnimator(presenceRef.current?.proceduralAnimator);
        vfxDev?.update(frame.dt);
        // The viewer is the camera. Its world position follows the headset in a session.
        world.camera.getWorldPosition(vfxViewer);
        vfx.update(frame.dt, vfxViewer.x, vfxViewer.y, vfxViewer.z, frame.time);
        mockBulbs?.update(frame);
        registration.updateUi(frame);
        voiceUi.updateUi(frame);
        taskPanel?.update(frame);
        for (let i = 0; i < bubbles.length; i += 1) {
          bubbles[i]!.update(frame.dt, frame.head.position[0]!, frame.head.position[2]!);
        }
      }),
    );

    // Developer frame-time overlay (Requirements 29.4, 29.5): only with `?perf=1`, last tick stage.
    if (isPerfOverlayRequested(window.location.search)) {
      const perfOverlay = new PerfOverlay(world);
      this.cleanupFuncs.push(() => perfOverlay.dispose());
      this.cleanupFuncs.push(app.setStage('perf', (frame) => perfOverlay.sample(frame.dt)));
    }

    // Developer controls for the spatial abilities (task 7.10): dev builds, or `?dev=1` in any build.
    if (shouldShowDevPanel(window.location.search)) {
      const devLogger = createLogger('dev-panel');
      const devPanel = new DevPanel(world, devLogger, (id) =>
        describeDispatch(DEV_ACTION_LABELS[id], abilities.runDevAction(id)),
      );
      this.cleanupFuncs.push(() => devPanel.dispose());
      this.cleanupFuncs.push(registration.addUiRect(() => devPanel.getRect()));
      if (import.meta.env.DEV) {
        (window as unknown as { __capriDevPanel?: unknown }).__capriDevPanel = devPanel;
        this.cleanupFuncs.push(() => {
          delete (window as unknown as { __capriDevPanel?: unknown }).__capriDevPanel;
        });
      }
      this.cleanupFuncs.push(this.queries.panels.subscribe('qualify', (entity) => devPanel.attach(entity)));
      for (const entity of this.queries.panels.entities) devPanel.attach(entity);
    }

    if (shouldShowHandTestPanel(window.location.search)) {
      const panel = new HandTestPanel(world, createLogger('hand-test'));
      this.cleanupFuncs.push(() => panel.dispose());
      this.cleanupFuncs.push(registration.addUiRect(() => panel.getRect()));
      this.cleanupFuncs.push(this.queries.panels.subscribe('qualify', (entity) => panel.attach(entity)));
      // A panel whose document loaded before this subscription still needs binding.
      for (const entity of this.queries.panels.entities) panel.attach(entity);
    }
  }

  update(dt: number, time: number): void {
    this.app.tick(dt, time);
  }
}
