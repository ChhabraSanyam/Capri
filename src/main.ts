/**
 * Composition root. Builds the world from `iwsdk.config.json` (through `virtual:iwsdk-project`),
 * creates `CapriApp`, registers the single `CapriSystem`, and wires the 2D entry page.
 *
 * The XR options (immersive AR, `offer: 'none'`, required hand tracking, anchors, hit-test, plane
 * and mesh detection, local-floor reference space) and the IWSDK feature set (spatialUI, scene
 * understanding, environment raycast on; physics, locomotion, grabbing off) live in
 * `iwsdk.config.json`, the project authority. The `virtual:iwsdk-project` object is passed whole.
 * Mock Mode is the default (task 17.6): the mode is resolved first with no credentials, the network guard
 * refuses every outside origin, and the mock home is published as `world.globals.home` for `CapriSystem`.
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
import { selectSmartHomeBackend } from './backends/select-backend.js';
import { resolveMode } from './domain/settings/mode-resolver.js';
import { featureFlags } from './config/feature-flags.js';
import { launchSession, sessionOverridesFor } from './xr/session.js';
import { createEntryPage } from './ui/setup-page/entry-page.js';
import { createMicStep } from './ui/setup-page/mic-step.js';
import { mountModelPreload } from './ui/setup-page/model-preload-view.js';
import { voiceModel } from './audio/voice-model.js';

const logger = createLogger('main');

async function main(): Promise<void> {
  // Mode (task 17.6, Requirements 23.1, 23.2): nothing stores credentials yet (the setup page is
  // task 25), so this is always Mock Mode. Zero configuration, empty localStorage, no prompt.
  const modeState = resolveMode({}, false);
  // First thing, before any request can start: Mock Mode refuses every outside origin (Requirement 23.6).
  const networkGuard = modeState.mode === 'mock' ? installMockNetworkGuard(createLogger('network')) : undefined;
  if (import.meta.env.DEV && networkGuard !== undefined) {
    (window as unknown as { __capriNetworkGuard?: unknown }).__capriNetworkGuard = networkGuard;
  }
  const home = selectSmartHomeBackend(modeState);

  const page = createEntryPage();
  page.setMode(modeState);

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

  world = await World.create(page.sceneContainer, projectOptions);
  const activeWorld = world;

  const app = new CapriApp({
    logger,
    isInSession: () => activeWorld.visibilityState.peek() !== VisibilityState.NonImmersive,
  });
  activeWorld.globals.capri = app;
  // The resolved mode and its smart-home backend. `CapriSystem` reads both (shared interface, task 17.6).
  activeWorld.globals.mode = modeState;
  activeWorld.globals.home = home;
  // Speech output (task 13.20). The playback AudioContext is created in the Enter AR click below.
  // The Voice_Library index loads now and needs no gesture. A missing library leaves bubble and chirp.
  const audio = new AudioEngine({ rng: app.rng, events: app.events, logger: createLogger('audio') });
  activeWorld.globals.speech = audio;
  void audio.loadLibrary();
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
