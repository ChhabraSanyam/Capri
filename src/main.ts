/**
 * Composition root. Builds the world from `iwsdk.config.json` (through `virtual:iwsdk-project`),
 * creates `CapriApp`, registers the single `CapriSystem`, and wires the 2D entry page.
 *
 * The XR options (immersive AR, `offer: 'none'`, required hand tracking, anchors, hit-test, plane
 * and mesh detection, local-floor reference space) and the IWSDK feature set (spatialUI, scene
 * understanding, environment raycast on; physics, locomotion, grabbing off) live in
 * `iwsdk.config.json`, the project authority. The `virtual:iwsdk-project` object is passed whole.
 * The session mode (tasks 17.6, 25.10) comes from the credential store: Mock Mode with no stored
 * credentials (the zero-config default), Live Mode when the Setup_Page saved "Live mode" with the
 * Home Assistant settings. `SessionMode` installs the Mock Mode network guard exactly while the mode is
 * Mock, puts the mock home or the Home Assistant client behind one `HomeSwitch`, and is published as
 * `world.globals.sessionMode` for `CapriSystem`. Enter AR re-reads the stored settings first.
 * The Enter AR click calls `world.launchXR()`. No code here or in the session calls `getUserMedia`:
 * the microphone is handled by the Mic_Setup_Step on this page before Enter AR. The click also
 * unlocks the playback audio context and prepares the microphone capture context (no microphone
 * is opened).
 */
import { DepthSensingSystem, VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { CapriApp } from './app/app.js';
import { CapriSystem } from './app/capri-system.js';
import { AudioEngine } from './audio/audio-engine.js';
import { MicCapture } from './audio/mic-capture.js';
import { createLogger } from './app/logger.js';
import { installMockNetworkGuard } from './app/network-guard.js';
import { SessionMode } from './app/session-mode.js';
import { featureFlags } from './config/feature-flags.js';
import { launchSession, sessionOverridesFor } from './xr/session.js';
import { createEntryPage } from './ui/setup-page/entry-page.js';
import { createMicStep } from './ui/setup-page/mic-step.js';
import { createConnectHome } from './ui/setup-page/connect-home.js';
import { CredentialStore } from './persistence/credential-store.js';
import { mountModelPreload } from './ui/setup-page/model-preload-view.js';
import { voiceModel } from './audio/voice-model.js';
import { LoadingStatus } from './app/loading-status.js';
import { mountCapriLoad } from './ui/setup-page/capri-load-view.js';

const logger = createLogger('main');

async function main(): Promise<void> {
  // The page's own `fetch`, taken before the Mock Mode guard wraps it. The Live Mode clients and the
  // Setup_Page's "Test connections" wrap it in a `fetch` pinned to each configured origin
  // (`backends/pinned-fetch.ts`), so a credential only ever goes to its own endpoint.
  const directFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined;
  // The only credential persistence (task 25.2). Reading it makes no request.
  const credentials = new CredentialStore();
  // Session mode (task 25.10, Requirements 23.1, 23.2, 23.6). First thing, before any request can
  // start: in Mock Mode the guard refuses every outside origin. Live Mode removes it.
  const sessionMode = new SessionMode({
    store: credentials,
    fetch: directFetch,
    installGuard: () => installMockNetworkGuard(createLogger('network')),
    logger: createLogger('mode'),
  });
  if (import.meta.env.DEV) {
    Object.defineProperty(window, '__capriNetworkGuard', {
      configurable: true,
      get: () => sessionMode.networkGuard,
    });
    (window as unknown as { __capriMode?: unknown }).__capriMode = sessionMode;
  }

  const page = createEntryPage();
  // The badge shows the mode the saved settings resolve to, with any missing setting named.
  page.setMode(credentials.mode.value);
  credentials.mode.subscribe((state) => page.setMode(state));
  createConnectHome({
    elements: page.connect,
    store: credentials,
    fetch: directFetch,
    pageOrigin: window.location.origin,
  });

  // Wired first so the microphone step works even if the world fails to start.
  let world: World | undefined;
  createMicStep({
    elements: page.mic,
    isSessionActive: () => world?.session !== undefined,
  });

  // Model_Preload (task 13.21): load and cache the Vosk model here, on the 2D page, never inside
  // the session. Enter AR stays available while it runs.
  mountModelPreload(page.modelPreloadMount, voiceModel);
  void voiceModel.start();

  // Loading screen (task 27.1): the avatar and voice line progress, on this page and in the scene.
  // Published as `world.globals.loading` below. It never gates Enter AR.
  const loading = new LoadingStatus();
  mountCapriLoad(page.capriLoadMount, loading);

  world = await World.create(page.sceneContainer, projectOptions);
  const activeWorld = world;

  const app = new CapriApp({
    logger,
    isInSession: () => activeWorld.visibilityState.peek() !== VisibilityState.NonImmersive,
  });
  activeWorld.globals.capri = app;
  // The session mode and its smart-home backend (`HomeSwitch`). `CapriSystem` reads both (shared
  // interface, tasks 17.6, 25.10). The mode is locked while an immersive session runs.
  activeWorld.globals.sessionMode = sessionMode;
  activeWorld.globals.loading = loading;
  activeWorld.globals.home = sessionMode.home;
  activeWorld.visibilityState.subscribe((state) => sessionMode.setInSession(state !== VisibilityState.NonImmersive));
  // Speech output (task 13.20). The playback AudioContext is created in the Enter AR click below.
  // The Voice_Library index loads now and needs no gesture. A missing library leaves bubble and chirp.
  const audio = new AudioEngine({ rng: app.rng, events: app.events, logger: createLogger('audio') });
  activeWorld.globals.speech = audio;
  void audio.loadLibrary().then(() => loading.voiceLinesLoaded(audio.voice.index.byId.size));
  // Microphone capture (task 13.25). `CapriSystem` hands it to the STT engine. The capture context is
  // created and its worklet loaded in the Enter AR click below. Nothing here opens the microphone.
  const capture = new MicCapture();
  activeWorld.globals.micCapture = capture;
  activeWorld.registerSystem(CapriSystem);
  // Bonus (Requirement 29.11): real-world depth occlusion of the Avatar, off unless the flag is on.
  if (featureFlags.depthOcclusion) {
    activeWorld.registerSystem(DepthSensingSystem, {
      configData: { enableDepthTexture: true, enableOcclusion: true, useFloat32: true },
    });
  }

  // Dev-only handle so an emulator check can inspect the app without aiming at the page.
  if (import.meta.env.DEV) {
    (window as unknown as { __capri?: unknown }).__capri = { world: activeWorld, app };
  }

  const xr = navigator.xr;
  if (xr === undefined) {
    page.setSupportLine('This browser has no WebXR. Open this page in Quest Browser.');
    return;
  }
  let supported = false;
  try {
    supported = await xr.isSessionSupported('immersive-ar');
  } catch {
    supported = false;
  }
  page.setSupportLine(
    supported
      ? 'Immersive AR is supported. Tap Enter AR. The microphone step above is optional.'
      : 'Immersive AR is not reported as supported here. Tap Enter AR anyway to see the browser prompt.',
  );

  activeWorld.visibilityState.subscribe((state) => {
    if (state !== VisibilityState.NonImmersive) page.clearError();
  });

  page.enableEnterButton(() => {
    // Autoplay policy: create and resume the playback context inside this click.
    void audio.unlock();
    void capture.prepare();
    // The session runs on the settings saved now (an edited URL or token does not change the mode).
    sessionMode.sync();
    page.clearError();
    void launchSession(activeWorld, {
      onFailure: (reason) => page.showError(reason),
      xrOptions: sessionOverridesFor(featureFlags),
    });
  });
}

main().catch((error: unknown) => {
  logger.error('startup failed', error);
  const line = document.getElementById('error-line');
  if (line !== null) {
    line.textContent = `Capri failed to start: ${error instanceof Error ? error.message : String(error)}`;
    line.hidden = false;
  }
});
