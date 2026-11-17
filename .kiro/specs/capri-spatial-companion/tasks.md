# Implementation Plan: Capri Spatial Companion

## Overview

The deadline (Nov 18, 2026, 12:00pm PST) is context only. The plan relies on the order and the cut-line, not on time estimates, and no task asks the user to log or report times. The Milestone 0 spike follows a soft guideline of staying short (about 2 hours of working time) with no timestamp logging.

Implementation language: TypeScript (Vite, IWSDK, Three.js, `@pixiv/three-vrm`, `vosk-browser`). Tests use Vitest and fast-check. All decision logic lives in pure `src/domain/` modules. XR, audio, and UI code are thin adapters behind ports.

Build order is strict: Milestone 0 (feasibility spike), then Steps 1 to 7, then Mock Mode (Step 10a), then one Hermes task (Step 8a), then the first Vercel deploy of the Mock Mode build on the user's custom subdomain (Step 8c). That is the MVD. Everything after the MVD cut-line is Post-MVD. Retargeted clips are an OPTIONAL group at the end.

| Tier | Top-level tasks | Contents |
|---|---|---|
| Milestone 0 | 1, 2 | On-headset feasibility spike, items (a) to (e) |
| MVD | 3 to 20 | Steps 1 to 7 (tasks 3, 5, 7, 9, 11, 13, 15), Mock Mode (17), one scripted Hermes task, `vercel.json`, and first Vercel deploy with the custom subdomain (19), MVD cut-line marker (20) |
| Post-MVD | 21 to 30 | Live Hermes and Tier 2 (21), personality (23), setup and live Home Assistant and CORS docs (25), polish and smoke checks (27), submission deliverables (29). `vercel.json` and the `build:vercel` script are built in task 19.5 (MVD), the deploy and custom subdomain in 19.6 (MVD), and the smoke checks are only added to the build in 27.5 |
| OPTIONAL | 31 | Retargeted animation clips. Cut first. No core task depends on it. |

Working rules for the developer agent (Requirements 1, 7, 29, 30):

- Finish and verify each step before starting the next. Make small commits.
- Each hand-off note task is short and non-blocking. It tells the user what to test, what they should see, and how to open the build on the Quest (HTTPS dev URL, LAN IP, `adb reverse`, or the hosted custom-subdomain URL). The agent writes it and continues to the next task without waiting for a reply (Requirements 7.6, 7.12).
- The agent waits only in three cases: a Milestone 0 failure (state it plainly, give the cheapest workaround, wait for confirmation, Requirement 1.7), the Hermes investigate-then-ask gate (Gate H, task 21.2), and a specific missing input (voice engine, custom subdomain and Vercel domain verification, Home Assistant details, Hermes details).
- If anything fails on the headset outside Milestone 0, state it plainly to the user at once and propose the cheapest workaround, then continue with unaffected work (Requirement 29.8).
- Never ask the user to log timestamps, report elapsed time, or give headset time (Requirement 7.13).
- Ask the user for one input at a time (Requirement 29.10).
- Never run long-lived commands such as `npm run dev` in the foreground. Start the dev server as a background process or ask the user to run it.
- Never write a Hermes endpoint, credential, header, field name, or example call before Gate H (task 21.2) has produced them from the user.
- Milestone 0 findings that bind later tasks (see `docs/spike-report.md`): `speechSynthesis` is missing on Quest Browser, so dynamic text is a bubble plus chirp; the microphone permission and the Vosk model are handled on the 2D page before Enter AR and never inside the AR session; restored anchors are approximate (about 10 cm); and the code never relies on the hand `gamepad`.

## Tasks

- [x] 1. Milestone 0: on-headset feasibility spike
  - [x] 1.1 Write the project plan and confirm IWSDK APIs
    - Create `docs/project-plan.md` with the deadline (Nov 18, 2026, 12:00pm PST), the tier table above, the step order and cut-line from the design cut-line table (no time estimates or budgets), and the proposed project structure
    - Read the IWSDK docs and typings for hand tracking, passthrough, planes, meshes, anchors, depth, and audio, and list which APIs are confirmed available
    - Record the working rules in the plan: strict order with the Mock Mode exception, finish and verify each step on the target, cut order (OPTIONAL, then Post-MVD, never MVD), a short non-blocking hand-off note per step (HTTPS dev URL, hosted custom-subdomain URL, tunnel, or `adb reverse`), the three waiting rules (Milestone 0 failure confirmation, Gate H, a specific missing input), vertical slice over breadth, small commits, secrets only on the device through the Setup_Page, immediate failure reporting with the cheapest workaround, and brief explanations of non-obvious steps
    - Present the structure and the cut-line order to the user before scaffolding, then continue unless the user replies with changes
    - Note in the plan that the spike follows a soft guideline of staying short (about 2 hours of working time), with no timestamp logging
    - _Requirements: 1.2, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 29.6, 29.8, 29.9_

  - [x] 1.2 Scaffold the repository and run pre-flight desk checks
    - Run `npm create @iwsdk@latest` (Node 20.19+, 22.12+, or 24+) and record the exact `@iwsdk/core` version
    - Run `npm ls three` and `vite build` with `@pixiv/three-vrm` imported. Add `resolve.dedupe: ['three']` only if two copies appear
    - Run `vite build` and `vite preview` with `base: '/'` and confirm every asset URL resolves from the root, as it will on the custom subdomain
    - Set `dev.emulator.environment` to `home_office` in IWER and confirm planes appear
    - Import `vosk-browser@0.0.8`, build, and write `tools/fetch-vosk-model.ts` to fetch and repackage `vosk-model-small-en-us-0.15` (including `conf/model.conf`) into git-ignored `public/vosk/`
    - Record each result against assumptions A1, A2, A8, A14, A18 in `docs/spike-report.md` (pre-flight section)
    - _Requirements: 7.10, 9.2, 30.2_

  - [x] 1.3 Build the spike harness
    - Add `spike.html` as a second Vite input and `src/spike/spike-main.ts` that calls `World.create` with the product's XR options (`ImmersiveAR`, `offer: 'none'`, `handTracking`, `anchors`, `hitTest`, `planeDetection`, `meshDetection`)
    - Implement `SpikeItem`, `SpikeResult`, and `Verdict` types, and a `SpikeRunner` with one UIKit row per item (pending, running, needs-user, works, fails) and a pinch-operated `Next` button
    - Implement `src/spike/workarounds.ts` with the pre-written cheapest workaround for every failure, taken from the design failure-workaround table
    - Implement pure `src/spike/report.ts` `buildReport(results)` producing exactly one verdict line per item (a) to (e) and six separate capability rows under item (b)
    - Show the report in a `<textarea>` with a Copy button on the 2D page when the session ends
    - Show each item's exact headset steps in-scene
    - _Requirements: 1.3, 1.4, 1.9, 2.4, 3.8, 4.4, 5.4, 6.4_

  - [ ]* 1.4 Write property test for the spike report
    - **Property 1: Spike report completeness**
    - **Validates: Requirements 1.4, 2.4, 3.8, 4.4, 5.4, 6.4**

  - [x] 1.5 Spike item (a): immersive AR session, passthrough, and hand joints
    - Implement `src/spike/items/a.ts`: start `immersive-ar` with `handTracking`, draw 25 joint spheres per hand from `frame.getJointPose`, and list input sources (`hand` present, `gamepad` absent)
    - Tell the user the exact headset steps: open `https://<LAN-IP>:<port>/spike.html` in Quest Browser, accept the certificate warning, tap Enter AR, put controllers down, hold both hands up, and confirm joints follow the fingers
    - Report plainly whether item (a) works. If it does not work, state the failure and the cheapest workaround (IWSDK ray and grip spaces for a coarse pointing ray), then STOP and WAIT for the user's confirmation before continuing. Spend no further time on this item
    - _Requirements: 1.3, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4_

  - [x] 1.6 Spike item (b): planes, semantic labels, mesh, anchors, hit-test, depth
    - Implement `src/spike/items/b.ts`: subscribe to `XRPlane` and `XRMesh`, read `semanticLabel`, run `EnvironmentRaycastTarget` on dominant pinch, create an `XRAnchor` at the hit and hold it for 300 frames
    - Place a stand-in avatar (capsule with head sphere) using `domain/placement.ts` draft logic on the floor and at a table
    - Run the restart check: save the persistent anchor handle if `requestPersistentHandle` exists, reload, and try `restorePersistentAnchor`
    - Run the optional depth-occlusion bonus probe
    - Tell the user the exact steps: scan the room by looking around, pinch on the floor, then on a table, then reload the page and repeat the anchor check
    - Report six separate rows (planes, semantic labels, mesh, anchors, hit-test, depth occlusion) plainly. On any failure state it, propose the cheapest workaround (semantic labels: manual surface tagging; mesh: planes only; anchors: `localStorage` plus Re-teach lights; hit-test: ray against plane quads), then STOP and WAIT for the user's confirmation
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 1.9, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [x] 1.7 Spike item (c): microphone capture during an immersive session
    - Implement `src/spike/items/c.ts`: on pinch call `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } })`, drive a live level bar from an `AnalyserNode`, and show the mapped failure reason in-scene
    - Tell the user the exact steps: pinch the mic row, allow the permission prompt, speak, and watch the bar move
    - Report plainly whether item (c) works. On failure state the reason and propose the cheapest workaround (request mic permission on the Setup_Page before Enter AR, else Quick_Actions and Hand_Keyboard only), then STOP and WAIT for the user's confirmation
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 1.9, 4.1, 4.2, 4.3, 4.4_

  - [x] 1.8 Spike item (d): vosk-browser with a restricted grammar
    - Implement `src/spike/items/d.ts`: load the model from the same origin and time it, create a recognizer with `["turn on","turn off","come here","[unk]"]`, and prompt each phrase 10 times counting correct results
    - Run the composition probe (fragment grammar `["turn off","that","[unk]"]`, say "turn off that") and the recreate-latency probe (`remove()` plus new recognizer, in ms)
    - Tell the user the exact steps: pinch Start, say each prompted phrase clearly when the row highlights, and repeat until the counter reaches 10 per phrase
    - Report load time in seconds, per-phrase accuracy, composition result, recreate latency, and whether item (d) works. On failure state the cause and propose the cheapest workaround (Quick_Actions and Hand_Keyboard become primary, shrink the grammar), then STOP and WAIT for the user's confirmation
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 1.9, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 1.9 Spike item (e): speechSynthesis availability and voice quality
    - Implement `src/spike/items/e.ts`: check `'speechSynthesis' in window`, wait for `voiceschanged`, list voices, speak one test sentence per English voice, and show Usable and Not usable buttons
    - Tell the user the exact steps: pinch Play for each voice and rate it for a playful hacker-girl character
    - Report plainly whether item (e) works and which voice is usable, if any. If none, state that tier 3 (bubble and chirp) will be used for dynamic text and WAIT for the user's confirmation
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 1.9, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 1.10 Compile the Spike_Report and record capability flags
    - Paste the harness output into `docs/spike-report.md`: one verdict per item (a) to (e), six capability rows under (b), measured numbers, and the user-confirmed workarounds
    - Create `src/config/feature-flags.ts` from the report: `anchorsWork`, `semanticLabelsWork`, `meshWork`, `hitTestWork`, `micInSession`, `voskWorks`, `grammarStrategy` (`'fragments'` or `'utterances'`), `pointPoseGate`, `ttsUsable`, `ttsVoiceURI`
    - Tell the user the plan for any failed item
    - _Requirements: 1.1, 1.4, 11.6, 12.5, 12.6, 16.9, 16.10_

- [ ] 2. Hand-off note: Milestone 0 results
  - **What to test:** each spike item (a) to (e) once on the headset, if not already done
  - **What you should see:** five rows with a clear works or does not work verdict, the six capability rows under (b), and a copyable report. Any failed row shows its cheapest workaround
  - **Open on Quest:** run `npm run dev`, then in Quest Browser open `https://<LAN-IP>:<port>/spike.html` (accept the certificate warning), or run `adb reverse tcp:<port> tcp:<port>` and open `https://localhost:<port>/spike.html`
  - If every item works, continue to Step 1 without waiting. If any item failed, the failure, its cheapest workaround, and the wait for the user's confirmation already happened in that item's task (Requirement 1.7), so continue once the user has confirmed each workaround
  - _Requirements: 1.7, 7.6, 7.12_

- [x] 3. Step 1 [MVD]: scaffold and passthrough
  - [x] 3.1 Configure Vite and the HTTPS dev server
    - Update `vite.config.ts`: `iwsdkDev()`, `base: '/'` for build and dev (the app is served from the root of the custom subdomain), two inputs (`index.html`, `spike.html`), HTTPS dev certificate
    - Add `src/config/asset-url.ts` (`assetUrl(path)` using `import.meta.env.BASE_URL`) so no asset URL or origin is hard-coded
    - Add `.env.example` with dev-only placeholders read only under `import.meta.env.DEV`
    - Set `features.physics: false` in `iwsdk.config.json` and configure the dev emulator
    - _Requirements: 9.6, 9.7, 24.12, 29.1, 30.1, 30.2, 30.8_

  - [x] 3.2 Set up test tooling and the domain purity rule
    - Configure Vitest, fast-check (`numRuns: 100` default), and a `tests/` layout (`unit`, `property`, `component`, `arbitraries`, `fixtures`)
    - Add an ESLint `no-restricted-imports` rule so `src/domain/**` cannot import `three`, `@iwsdk/*`, `vosk-browser`, `window`, or `document`
    - Add `npm run typecheck` and `npm test` (run once, not watch)
    - _Requirements: 9.1, 17.1_

  - [x] 3.3 Build the composition root and frame loop
    - Create `src/main.ts` calling `World.create` with `sessionMode: ImmersiveAR`, `offer: 'none'`, `handTracking: { required: true }`, `anchors`, `hitTest`, `planeDetection`, `meshDetection`, and `features: { spatialUI, sceneUnderstanding, environmentRaycast, physics: false, locomotion: false, grabbing: false }`
    - Create `src/app/` with `events.ts` (typed `AppEvents` bus), `clock.ts`, `rng.ts` (seeded PRNG), `frame-context.ts` (reused buffers), `safe-run.ts`, `logger.ts`, and `capri-system.ts` (single IWSDK system calling `app.tick` with the fixed stage order)
    - Create `src/config/constants.ts`
    - Update `index.html` with a minimal page and an Enter AR button whose click handler calls `world.launchXR()`. Show the failure reason on the page if the session request fails
    - Add the Mic_Setup_Step to the entry page (`src/ui/setup-page/mic-step.ts`): an "Enable microphone" button that calls `getUserMedia({ audio: true })` on the 2D page, stops every track of the returned stream at once, records `granted` or `denied` (in memory and `sessionStorage` key `capri.v1.mic`), and shows that state on the page. The Enter AR click handler and every in-session module never call `getUserMedia` while an AR session is active
    - Keep Enter AR enabled whether or not the microphone was granted. When it was not granted, show a hint beside the button: voice commands need the microphone, and Quick_Actions and Hand_Keyboard are the fallback. This is the same entry page that Mock Mode uses, so the Mock Mode zero-configuration page offers the step and never blocks Enter AR on it
    - Leave a mount point on the page for the voice model progress bar (the Model_Preload is implemented in task 13.21)
    - _Requirements: 9.1, 9.2, 9.3, 9.8, 15.15, 15.16, 15.17, 15.19, 23.11, 29.1_

  - [ ]* 3.4 Write the architecture test
    - Create `tests/unit/arch.test.ts` asserting that no file under `src/domain/` imports `three`, `@iwsdk/*`, `vosk-browser`, or uses `window` or `document`
    - _Requirements: 17.1_

  - [x] 3.5 Implement hand source and hand skeleton rendering
    - Create `src/xr/hands.ts` with a `HandSource` returning per-frame joint positions (wrist, index metacarpal, index proximal, index tip, middle, ring, pinky, and thumb tips) and `tracked`, using `frame.getJointPose` or `fillPoses` with reused buffers
    - Render a visible hand skeleton for each tracked hand using IWSDK hand visuals or small joint meshes
    - Add a guard so no code path reads controller-only inputs, and no code path reads `inputSource.gamepad` (on Quest, hand input sources do expose a `gamepad` with mode `tracked-pointer`, and the code must simply not rely on it)
    - Read the index tip from `xrOrigin.indexTipSpaces` when present (the spike measured it identical to the `index-finger-tip` joint) and from the joint pose otherwise
    - Add a small hand-operated test panel (poke and ray pinch) to the Step 1 build and check on the headset that panel and multipointer interaction by hand works (assumption A6). If the IWSDK multipointer does not activate for hands, use the own-pinch fallback from `domain/pointing/pinch.ts`
    - The Spike (a) workaround is not needed because item (a) works
    - _Requirements: 8.1, 8.2, 8.3, 9.4, 9.5, 9.11, 9.12_

  - [x] 3.6 Implement the hand-tracking-lost monitor and message panel
    - Create pure `src/domain/hand-lost.ts` state machine: starts counting when no hand is tracked, shows after 1.0 s, hides within 0.5 s after tracking resumes
    - Create a "bring your hands into view" panel and a stub `ui/status-chips.ts`, and wire both into `app.tick`
    - _Requirements: 9.9, 9.10_

  - [ ]* 3.7 Write property test for hand-lost timing
    - **Property 11: Hand-lost message timing**
    - **Validates: Requirements 9.9, 9.10**

- [ ] 4. Hand-off note: Step 1
  - **What to test:** enter AR and move both hands
  - **What you should see:** your real room in passthrough, a hand skeleton following each hand, a "bring your hands into view" message that appears after about 1 second with hands out of view and disappears when they return, and a test panel that you can poke or pinch with your hands. Tap "Enable microphone" on the page before Enter AR and allow it. The app never asks for the microphone inside AR
  - **Open on Quest:** run `npm run dev`, then open `https://<LAN-IP>:<port>/` in Quest Browser (accept the certificate warning) and tap Enter AR, or run `adb reverse tcp:<port> tcp:<port>` and open `https://localhost:<port>/`
  - Run `npm run typecheck` and `npm test -- --run`, fix any failures, then continue to the next task without waiting for a reply
  - _Requirements: 7.6, 7.12_

- [x] 5. Step 2 [MVD]: avatar presence
  - [x] 5.1 Add the placeholder VRM, license note, and avatar config
    - Source a free, permissively licensed VRM (CC0 or a VRoid sample under its terms) and place it at `public/models/capri.vrm`. If none can be fetched, tell the user and ask for one, one item at a time
    - Create `docs/THIRD_PARTY.md` recording model name, author, source URL, and license
    - Create `src/config/avatar-config.ts` with the single `AVATAR_VRM_URL = assetUrl('models/capri.vrm')` and `AVATAR_TARGET_HEIGHT_M = 0.6`
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 5.2 Implement pure geometry, look clamp, and blink scheduler
    - Create `src/domain/geometry.ts` with vector helpers, ray-sphere intersection, and `clampLook` (yaw ±70°, pitch ±40°, identity inside limits)
    - Create the blink scheduler (interval drawn from [2 s, 6 s] with the injected `Rng`)
    - _Requirements: 10.8, 10.9, 10.12_

  - [x] 5.3 Implement spawn and idle placement
    - Create `src/domain/placement.ts` with `idleHome(head, floor?)` (1.25 m ahead, rotated 25° to the user's side, on the floor when a floor Surface exists, else `head.y − 0.7`) and `constrainIdlePosition(head, pos)` projecting onto the annulus [1.0 m, 1.5 m]
    - _Requirements: 10.1, 10.11_

  - [ ]* 5.4 Write property test for spawn placement
    - **Property 3: Spawn placement follows the floor**
    - **Validates: Requirements 3.6, 10.1**

  - [ ]* 5.5 Write property test for the idle distance constraint
    - **Property 4: Idle distance constraint**
    - **Validates: Requirements 10.11**

  - [ ]* 5.6 Write property test for look clamping
    - **Property 5: Look direction is clamped**
    - **Validates: Requirements 10.9, 10.12**

  - [ ]* 5.7 Write property test for blink intervals
    - **Property 6: Blink intervals**
    - **Validates: Requirements 10.8**

  - [x] 5.8 Implement the avatar loader
    - Create `src/avatar/avatar-loader.ts`: `GLTFLoader` with `VRMLoaderPlugin`, then `VRMUtils.removeUnnecessaryVertices`, `removeUnnecessaryJoints`, `combineSkeletons`, `combineMorphs`, `rotateVRM0` for VRM 0.x, `frustumCulled = false`
    - Measure `AvatarMetrics` and apply a uniform scale to `AVATAR_TARGET_HEIGHT_M`
    - Return `Err(AvatarLoadError)` on failure
    - _Requirements: 10.2, 10.3, 10.13_

  - [x] 5.9 Implement the procedural animator core
    - Define the `Animator` port, `GestureId`, `Emotion`, and `GestureDef` types, and a reused `PoseBuffer` (`src/avatar/pose-buffer.ts`)
    - Create `src/avatar/procedural-animator.ts` with layers: rest pose, breathing (about 0.01 rad, 4 s), blink, look (torso-frame clamp, 60% head and 40% neck, critically damped), emotion smoothing, mouth `aa` setter, and a keyframed gesture layer
    - Add `gestures/wave.ts` and play it when the avatar first appears. Call `vrm.update(dt)` after bone writes
    - _Requirements: 10.7, 10.8, 10.9, 10.10, 10.12, 29.2, 29.3_

  - [x] 5.10 Add the developer frame-time overlay
    - Create `src/ui/perf-overlay.ts` shown only with `?perf=1`, displaying a rolling frame-time average and worst frame, and call `perfOverlay.sample(dt)` as the last tick stage
    - _Requirements: 29.4, 29.5_

  - [x] 5.11 Wire the avatar into the app
    - Spawn the avatar when the session starts using `idleHome`, apply `constrainIdlePosition` each frame, follow gently when the user turns more than 60° away for more than 3 s, and look at the user's head
    - On load failure show a minimal speech bubble naming the failure and keep the session running
    - Add `depthOcclusion: false` to `src/config/feature-flags.ts`. When it is true, request `depthSensing` and enable depth occlusion on the Avatar materials (bonus feature: depth occlusion works on Quest, and it never gates any other feature). Leave it off until the frame time is measured with it on
    - _Requirements: 10.1, 10.9, 10.10, 10.11, 10.13, 29.11_

- [ ] 6. Hand-off note: Step 2
  - **What to test:** enter AR, look at Capri, move your head side to side, and wait several seconds
  - **What you should see:** Capri in your room (on the floor if a floor was detected, otherwise floating), a wave when she appears, steady breathing, blinks every 2 to 6 seconds, and her head and eyes following you without twisting past a natural range. With `?perf=1` the frame-time overlay shows a value near 13.9 ms or lower
  - **Open on Quest:** run `npm run dev`, then open `https://<LAN-IP>:<port>/?perf=1` in Quest Browser and tap Enter AR, or use `adb reverse tcp:<port> tcp:<port>` and `https://localhost:<port>/?perf=1`
  - The `?perf=1` overlay shows frame time against the 13.9 ms budget (assumption A16). The user does not need to read out or report any number. If the overlay looks over budget, the user may mention it and the developer applies the performance levers in design order
  - Run `npm run typecheck` and `npm test -- --run`, fix any failures, then continue to the next task without waiting for a reply
  - _Requirements: 7.6, 7.12_

- [x] 7. Step 3 [MVD]: spatial interaction
  - [x] 7.1 Implement surface mapping and navigation targets
    - Create `src/domain/surfaces.ts`: total `mapLabel(raw)` (`floor`, `ceiling`, `wall`, `table`, `desk`, and `couch` map to themselves, and everything else maps to `other`, including the Quest labels `wall art`, `door`, and `shelf`; `desk` and `table` both table-class), `moveTarget`, `perchTarget`, and `sitTarget` (table, desk, or couch only)
    - Narrow `SurfaceLabel` to `floor | ceiling | wall | table | desk | couch | other` and keep the raw label in `Surface.rawLabel`
    - _Requirements: 3.1, 11.1, 11.2, 11.3, 11.9_

  - [x] 7.2 Add the destination visibility policy
    - Extend `src/domain/placement.ts` with `visibilityPolicy` (destination within 3.0 m horizontally of the head and between floor and `head.y + 1.0`, otherwise clamped and Capri points at the real target)
    - _Requirements: 8.5, 11.8_

  - [ ]* 7.3 Write property test for label mapping
    - **Property 2: Surface label mapping is total**
    - Include `wall art`, `door`, and `shelf` as examples mapping to `other`, and the `pickTable` selection rule (nearest within seated range, largest area as the tiebreak)
    - **Validates: Requirements 3.1, 11.2, 11.9, 11.10**

  - [ ]* 7.4 Write property test for navigation targets
    - **Property 8: Navigation targets lie on the named surface**
    - **Validates: Requirements 3.7, 11.1, 11.2, 11.3**

  - [ ]* 7.5 Write property test for missing surfaces
    - **Property 9: Missing surface leaves the avatar in place**
    - **Validates: Requirements 11.7**

  - [ ]* 7.6 Write property test for destination visibility
    - **Property 10: Destinations are comfortably visible**
    - **Validates: Requirements 8.5, 11.8**

  - [x] 7.7 Implement the surface store
    - Create `src/xr/scene-surfaces.ts` filling `Surface[]` from `XRPlane` and `XRMesh` entities (reading `semanticLabel` through `_plane` and `_mesh`), and subscribe in `CapriSystem.init`
    - Add pure `pickTable(surfaces, head)` to `src/domain/surfaces.ts`: Quest can report several table-labelled planes (six at peak in the spike), so keep table-class surfaces within comfortable seated range of the head (horizontal distance at most 1.5 m, top between `head.y − 0.9` and `head.y − 0.1`), choose the nearest to the head, and break a tie (within 0.10 m) by the largest area. Use it for `sit_on` and `perch` on a table, and fall back to the nearest table-class surface of any distance when none is in range
    - Use the Y of the floor-labelled plane as the Avatar's standing height (the spike measured floor label −0.034 m and floor hit −0.012 m, so the label plane is the single source). With no floor plane the Avatar floats at `head.y − 0.7`
    - Semantic labels and meshes both work on Quest, so the manual tagging and planes-only workarounds are not needed
    - _Requirements: 3.1, 3.2, 11.6, 11.10, 11.11_

  - [x] 7.8 Implement abilities, locomotion, and the avatar state machine
    - Create `src/domain/actions/abilities.ts` with `SUPPORTED_ACTION_TYPES` (move_to, sit_on, perch, look_at, point_at, remember_place, set_timer, and the four light actions)
    - Create `src/avatar/locomotion.ts` (smooth-damped glide, 0.9 m/s, bob and lean) and the Idle, Moving, Perched, Sitting, Acting, Away state machine
    - When the requested Surface is missing, keep the position and emit a `surface_missing` situation through a `PersonaPort` (plain bubble text until the Persona exists in Step 6)
    - _Requirements: 11.1, 11.2, 11.3, 11.7, 11.8, 17.4_

  - [x] 7.9 Implement point, sit, and perch gestures
    - Create `gestures/point.ts` with the pure `aimArm(shoulderPos, target)` solver (joint limits, index finger extended), `gestures/sit.ts`, `gestures/perch.ts`, and a `look_at` target API on the animator
    - Expose `handEmitterWorld()` (fingertip world position) for the VFX in Step 7
    - _Requirements: 11.2, 11.3, 11.4, 11.5_

  - [x] 7.10 Add developer test controls and wire spatial abilities
    - Add a `?dev=1` hand-operated panel with Come here, Sit on table, Perch on table, Look at me, Point at floor, and Go away, calling the abilities through the animator and locomotion
    - Wire `SurfaceStore` into `app.tick` and the ability dispatcher
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 11.8_

- [ ] 8. Hand-off note: Step 3
  - **What to test:** with the dev panel, press Sit on table, Perch on table, Point at floor, Look at me, and Come here. Try Sit on table in a room section with no table
  - **What you should see:** Capri glides to the table and sits or perches on its edge, points an arm and index finger at the target, and stays put with a short in-character line if the surface is missing. She always stays within view without you walking
  - **Open on Quest:** run `npm run dev`, then open `https://<LAN-IP>:<port>/?dev=1` in Quest Browser, or use `adb reverse tcp:<port> tcp:<port>` and `https://localhost:<port>/?dev=1`. Scan the room first by looking at the floor and table for a few seconds
  - Run `npm run typecheck` and `npm test -- --run`, fix any failures, then continue to the next task without waiting for a reply
  - _Requirements: 7.6, 7.12_

- [x] 9. Step 4 [MVD]: device registration
  - [x] 9.1 Define backend interfaces and the mock home reducer
    - Create `src/backends/types.ts` with `ConnectionState`, `BackendError`, `BackendErrorKind`, `Result<T>`, `LightEntity`, `LightState`, `DeviceCommand`, and `SmartHomeBackend`
    - Create `src/backends/mock/mock-home.ts`: in-memory reducer over `mock.bulb_1` to `mock.bulb_3` (`on`, `off`, `brightnessPct`, `rgb`), `listLights`, `applyCommand` with short simulated latency, `state$`, and no network calls. Rendering and registration come in Step 10a
    - _Requirements: 23.3, 23.4, 23.6, 23.8, 25.2_

  - [x] 9.2 Implement the device registry and naming
    - Create `src/domain/devices/registry.ts` (`add`, `rename`, `remove`, `all`, `byId`, `candidatesByName` matching full name and head-noun aliases, emitting `registry:changed`)
    - Create `src/domain/devices/naming.ts` (friendly name to speakable name, digits spelled out) and `src/domain/speech-lang/lexicon.ts` stub, flagging out-of-lexicon words and offering nickname choices
    - Create `tools/build-lexicon.ts` producing the lexicon from the model `words.txt`
    - _Requirements: 12.4, 12.8, 14.5_

  - [x] 9.3 Implement device persistence
    - Create `src/persistence/local-store.ts`, `device-store.ts` (`LocalStorageDeviceStore` under `capri.v1.devices`), and `anchor-store.ts` (`AnchorDeviceStore` using `XRAnchor` and `requestPersistentHandle` or `restorePersistentAnchor`) with a single factory keyed on `featureFlags.anchorsWork`
    - Tolerate missing or corrupt data by returning defaults
    - Treat restored anchor positions as approximate: the spike measured 95 mm between the saved and the restored position, so a restored marker may be off by roughly 10 cm. The pointing hit radius minimum of 0.15 m still selects it. Keep the "Re-teach lights" action visible whenever any marker exists, and write no label, Persona line, or log that claims a restored position is exact
    - _Requirements: 12.5, 12.6, 12.10, 12.11, 12.12_

  - [ ]* 9.4 Write property test for device persistence
    - **Property 12: Device persistence round trip**
    - **Validates: Requirements 12.4, 12.5, 12.6**

  - [x] 9.5 Implement point capture
    - Create pure `capturePoint(ray, surfaces, hitTest?)` in `src/domain/pointing/capture.ts` (nearest plane quad or mesh box intersection, else the environment-raycast hit, else 2.0 m along the ray)
    - Create `src/xr/hit-capture.ts` using `EnvironmentRaycastTarget`, plus a Nearer and Farther adjuster for the fallback
    - _Requirements: 12.2_

  - [ ]* 9.6 Write property test for point capture
    - **Property 13: Point capture lies on the ray**
    - **Validates: Requirements 12.2**

  - [x] 9.7 Build the device marker, device list, and teach flow
    - Create `src/ui/device-marker.ts` (hex ring, additive `MeshBasicMaterial`, invisible hit sphere, highlight ring and name label)
    - Create `src/ui/panels/device-list` (UIKitML under `public/ui`) listing `SmartHomeBackend.listLights()`, and the teach flow state machine `Idle → AwaitPoint → Captured → PickEntity → Stored`, operated by dominant-hand pinch
    - Add "Teach me your lights" and "Re-teach lights" actions
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.7_

  - [x] 9.8 Wire registration into the app
    - Load the registry at start, render markers for each device, persist on change, and emit `registry:changed`
    - _Requirements: 12.4, 12.5, 12.6, 12.7, 12.8_

  - [ ]* 9.9 Write unit tests for the teach flow
    - Test each state transition, the Nearer and Farther fallback, and rename and remove behaviour
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [ ] 10. Hand-off note: Step 4
  - **What to test:** open "Teach me your lights", point at a real lamp and pinch with your dominant hand, then pick an entry from the floating list. Reload the page and re-enter AR
  - **What you should see:** a hex marker at the lamp position, a list of three test lights to choose from (live Home Assistant lists come in Step 10b), and the marker still there after reload if anchors work, usually within about 10 cm of the lamp (restored anchors are approximate, and "Re-teach lights" stays available), or after "Re-teach lights" if they do not
  - **Open on Quest:** run `npm run dev`, then open `https://<LAN-IP>:<port>/` in Quest Browser, or use `adb reverse tcp:<port> tcp:<port>` and `https://localhost:<port>/`
  - Run `npm run typecheck` and `npm test -- --run`, fix any failures, then continue to the next task without waiting for a reply
  - _Requirements: 7.6, 7.12_

- [x] 11. Step 5 [MVD]: pointing selection
  - [x] 11.1 Implement the pinch detector
    - Create `src/domain/pointing/pinch.ts`: thumb-tip to index-tip distance with hysteresis (on below 0.020 m, off above 0.035 m), per-hand `pinchStart` and `pinchEnd` edge events
    - _Requirements: 13.7, 15.6_

  - [x] 11.2 Implement the ray and selector
    - Create `src/domain/pointing/ray.ts` (origin at the index tip from `xrOrigin.indexTipSpaces`, which matches the `index-finger-tip` joint, direction tip minus proximal, exponential smoothing alpha 0.35, optional point-pose gate from `featureFlags.pointPoseGate`). The spike has no data on the gate, so decide whether it stays on during this task on the headset
    - Create `src/domain/pointing/selector.ts`: effective radius `max(0.15, 0.06 × d)`, candidates within (0, 6 m], gaze-angle tiebreak, 1.0 s clear delay, 250 ms pointed history confirming the value from 200 ms before pinch onset, `selected` expiring after 8 s, and `confirm_pointed` for voice
    - _Requirements: 13.1, 13.2, 13.3, 13.6, 13.7, 13.8, 13.9_

  - [ ]* 11.3 Write property test for pinch hysteresis
    - **Property 21: Pinch detector hysteresis**
    - **Validates: Requirements 13.7, 15.6**

  - [ ]* 11.4 Write property test for pointing geometry
    - **Property 19: Pointing selection geometry**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.6**

  - [ ]* 11.5 Write property test for pointer persistence and confirmation
    - **Property 20: Pointer persistence and confirmation**
    - **Validates: Requirements 13.7, 13.9**

  - [x] 11.6 Implement head gaze and the fake hand source
    - Create `src/xr/head.ts` with the `GazeProvider` port returning the head forward ray
    - Extend `HandSource` to expose the dominant hand (setting `dominantHand`, default right) and create dev-only `src/xr/fake-hands.ts` (`?fakehands`) feeding scripted joint poses to the same pointing code
    - _Requirements: 13.1, 13.6_

  - [x] 11.7 Wire pointing into the app
    - Run `pointing.update(frameCtx)` in `app.tick`, highlight the Pointed_Device marker, orient the avatar's gaze toward it, confirm on dominant pinch, and emit `pointed:changed` and `selected:changed`
    - _Requirements: 13.4, 13.5, 13.7, 13.9_

- [ ] 12. Hand-off note: Step 5
  - **What to test:** point your dominant index finger at a registered marker (other fingers curled), move off it, point at two close markers, and pinch
  - **What you should see:** the marker highlights with a ring, Capri looks at it, the highlight stays about 1 second after you point away, and a pinch confirms the target you were pointing at before the pinch
  - **Open on Quest:** run `npm run dev`, then open `https://<LAN-IP>:<port>/` in Quest Browser, or use `adb reverse tcp:<port> tcp:<port>` and `https://localhost:<port>/`. Values that may need tuning on the headset (ray smoothing, point-pose gate, hit radius) live in `config/constants.ts`, and the user can mention any that feel off
  - Run `npm run typecheck` and `npm test -- --run`, fix any failures, then continue to the next task without waiting for a reply
  - _Requirements: 7.6, 7.12_

- [x] 13. Step 6 [MVD]: voice command loop
  - [x] 13.1 Ask the user for the voice engine decision
    - Ask the user, as one question, which engine the dev-time Voice_Script should use: macOS `say` plus `ffmpeg` (recommended default for the MVD), Piper, or a cloud service (key in dev `.env` only). Wait for the answer before 13.19
    - _Requirements: 16.6, 29.10_

  - [x] 13.2 Implement the speech language core
    - Create `src/domain/speech-lang/phrases.ts` (one declarative table shared by grammar and parser), `grammar-builder.ts` (`buildGrammar(input, strategy)` with fragments or utterances, always including `"[unk]"`, deduplicated, lexicon-filtered), `intent-parser.ts` (normalise, longest-match templates, `Intent` union), and `resolver.ts` (`resolve(intent, ctx)` returning resolved, `clarify` with `no_pointed` or `ambiguous`, `repeat`, or `unsupported`)
    - Map `dim` to 30 percent, `brighten` to 100 percent, and colour names to a fixed RGB table
    - Add a single `processText(text, ctx)` used by speech, Hand_Keyboard, and Quick_Actions
    - Use the `fragments` grammar strategy (`featureFlags.grammarStrategy`, confirmed by the spike). Grammar rebuilds are cheap on the Quest (median 4 ms, max 157 ms)
    - Add a low-confidence rule to the parser: multi-word hypotheses for short or single-word commands are possible (the spike heard "come here" and "turn off" as "turn on turn off"), so a result with contradictory or repeated command verbs, or a short command replaced by unrelated command fragments, returns `{ type: 'repeat' }` and never a device action
    - _Requirements: 14.2, 14.3, 14.4, 14.5, 15.2, 15.3, 15.12, 15.13, 15.14, 15.23, 15.24, 17.2, 22.6, 22.10_

  - [ ]* 13.3 Write property test for grammar completeness
    - **Property 14: Grammar completeness**
    - **Validates: Requirements 12.8, 15.2, 15.3**

  - [ ]* 13.4 Write property test for intent parsing
    - **Property 16: Intent parsing round trip and determinism**
    - **Validates: Requirements 14.2, 17.2**

  - [ ]* 13.5 Write property test for intent resolution
    - **Property 17: Intent resolution outcomes**
    - Include low-confidence multi-word hypotheses such as "turn on turn off" yielding `repeat`
    - **Validates: Requirements 13.8, 14.3, 14.4, 14.5, 15.14, 15.24, 22.6, 22.10**

  - [ ]* 13.6 Write property test for keyboard and speech equivalence
    - **Property 18: Keyboard and speech paths are equivalent**
    - **Validates: Requirements 15.12**

  - [x] 13.7 Implement the Persona and Banter engine
    - Create `src/domain/persona/call-state.ts`, `truncate.ts` (`limitSentences(text, 2)`), `templates.ts` (3 to 6 variants per context, slotted), `action-memory.ts` (ring buffer of 20 actions, `toggleRepeat`), `banter.ts`, and `persona.ts` producing `Utterance` values from situations and `CallState`
    - Enforce claims: `ack` only while pending, `done` only after success, `fail` lines carrying the sanitised backend message
    - _Requirements: 17.8, 17.9, 17.10, 22.1, 22.2, 22.3, 22.4, 22.5, 22.7, 22.8, 22.9, 22.10_

  - [ ]* 13.8 Write property test for the sentence limit
    - **Property 26: Sentence limit**
    - **Validates: Requirements 17.8, 22.2, 22.3**

  - [ ]* 13.9 Write property test for Persona truthfulness
    - **Property 27: Persona truthfulness**
    - **Validates: Requirements 14.7, 18.6, 18.7, 19.9, 19.10, 21.5, 21.6, 22.5, 22.7, 22.8, 22.9**

  - [ ]* 13.10 Write property test for action memory and toggle tease
    - **Property 28: Action memory and toggle tease**
    - **Validates: Requirements 17.9, 17.10, 21.4**

  - [x] 13.11 Implement timers, places, and the notify gesture
    - Create `src/domain/actions/timers.ts` (`TimerService.start/tick`, expiry once, not persisted) and `places.ts` (`PlaceBook.remember/recall`, pointed position first, else gazed, else 1.5 m along the gaze ray) with `src/persistence/places-store.ts` under `capri.v1.places`
    - Add `gestures/notify.ts` and play it with a bubble line on timer expiry
    - _Requirements: 17.4, 17.5, 17.6, 17.7_

  - [ ]* 13.12 Write property test for timers
    - **Property 29: Timers fire on time**
    - **Validates: Requirements 17.6**

  - [ ]* 13.13 Write property test for place memory
    - **Property 30: Place memory round trip**
    - **Validates: Requirements 17.5**

  - [x] 13.14 Author the voice manifest and speech output logic
    - Write `voice/voice-manifest.txt` with all eight categories (greeting, confirm, quip, error, tease, celebrate, thinking, task-complete), 5 to 10 playful lines each (two sentences at most, not mean), and `claims` tags (`ack`, `done`, `fail`, `neutral`)
    - Create `src/domain/speech/voice-manifest.ts` (parser, formatter, validator), `tier-select.ts` (`selectTier`: library for canned lines, `tts` only when `featureFlags.ttsUsable` is true, otherwise `bubble`), `variant-picker.ts` (no immediate repeat, injected `Rng`), and `lip-flap.ts` (`mouthFrom(rms, prev, dt)` with about 40 ms attack and 90 ms release, for tier 1 library audio only)
    - _Requirements: 16.2, 16.3, 16.5, 16.8, 16.9, 16.10, 16.11, 16.12, 22.2_

  - [ ]* 13.15 Write property test for speech tier selection
    - **Property 22: Speech tier selection**
    - Include the Quest Browser case (`ttsUsable = false`): `tts` is never selected
    - **Validates: Requirements 6.5, 16.8, 16.9, 16.10**

  - [ ]* 13.16 Write property test for variant picking
    - **Property 23: No immediate variant repeat**
    - **Validates: Requirements 16.12**

  - [ ]* 13.17 Write property test for the mouth driver
    - **Property 24: Mouth driver bounds**
    - **Validates: Requirements 16.11**

  - [ ]* 13.18 Write property test for the voice manifest
    - **Property 25: Voice manifest round trip and validity**
    - **Validates: Requirements 16.2, 16.3, 16.5, 22.2**

  - [x] 13.19 Build the dev-time Voice_Script and generate the Voice_Library
    - Create `tools/voice-script/generate-voice-library.ts` and `engines/*` for the engine chosen in 13.1: read the manifest, synthesise each line, encode mono MP3 at about 64 kbps with `ffmpeg`, write `public/voice/<id>.mp3` and `public/voice/index.json` (id, category, claims, duration, text hash), and skip unchanged hashes
    - Keep `tools/` out of `src/` imports and out of the bundle. Run the script and commit the generated files
    - _Requirements: 16.1, 16.4, 16.6, 16.7_

  - [x] 13.20 Implement the audio engine and speech output
    - Create `src/audio/audio-engine.ts` (`AudioContext` created and resumed in the Enter AR click handler, separate playback context), `voice-player.ts` (preload greeting and confirm, 12-buffer LRU, `GainNode` and `AnalyserNode`), `sfx-synth.ts` (bubble chirp), `tts-fallback.ts` (tier 2, a flag-guarded no-op: it acts only when `featureFlags.ttsUsable && 'speechSynthesis' in window`, which is false on Quest Browser, and it adds no synthetic mouth oscillator), and `src/avatar/mouth.ts` driving `aa` from the analyser of tier 1 library audio only
    - Route dynamic text (including Hermes replies) to tier 3: speech bubble plus chirp, with the speaking gesture and no audio-synchronised mouth movement. Fall through to tier 3 when a voice file is missing or fails to decode
    - _Requirements: 16.1, 16.8, 16.9, 16.10, 16.11, 16.13, 16.14_

  - [x] 13.21 Implement microphone capture and the STT engine
    - Create `src/audio/mic-capture.ts` (acquire on push-to-talk start and release on end, only when microphone permission was already granted on the 2D page, checked through the Permissions API where supported or the recorded `capri.v1.mic` value; otherwise do not call `getUserMedia`, show Quick_Actions and Hand_Keyboard, and never trigger a prompt inside the AR session. Capture with `AudioContext({ sampleRate: 16000 })` or the context rate (the spike recognizer ran at 48 kHz via `acceptWaveformFloat`), `AudioWorklet` forwarding `Float32Array` chunks, `ScriptProcessorNode` fallback, barge-in stopping current speech)
    - Create `src/audio/stt-engine.ts` implementing `SpeechRecognizerPort` over `vosk-browser` (`setWords(false)`, partial results, `retrieveFinalResult`), and pure `domain/speech-lang/grammar-scheduler.ts` (150 ms debounce, `remove()` then `new KaldiRecognizer(sampleRate, JSON.stringify(phrases))`, queued while push-to-talk is active)
    - Implement the Model_Preload on the 2D entry page (mounted in the slot left by task 3.3): download and cache the 41 MB Vosk model (IndexedDB, done by vosk-browser) before Enter AR with a visible progress indicator and a "Voice model ready" state. The spike measured a 26 s cold load and a 75 ms frame gap while loading, so the STT engine never downloads or initialises the model inside the AR session. If the user enters AR before the model is ready, show Quick_Actions and a "voice loading" status chip, and keep Enter AR available. The Mock Mode entry page offers the same preload and never blocks Enter AR on it
    - Handle low-confidence results from the recognizer: pass multi-word hypotheses for single-word commands (for example "turn on turn off" for "come here") to the parser's low-confidence rule from task 13.2, so Persona asks the user to repeat or use Quick_Actions instead of acting
    - The Spike (c) and (d) workarounds from `featureFlags` apply only if a later headset run shows a failure: with permission denied or the model not ready, use Quick_Actions and Hand_Keyboard
    - _Requirements: 14.1, 15.1, 15.3, 15.4, 15.5, 15.15, 15.16, 15.17, 15.18, 15.19, 15.20, 15.21, 15.22, 15.23, 15.24, 23.11_

  - [ ]* 13.22 Write property test for grammar rebuild timing
    - **Property 15: Grammar rebuild converges within 1 s**
    - **Validates: Requirements 12.8, 15.4, 15.5**

  - [x] 13.23 Build the voice UI panels and seated placement
    - Create `src/domain/ui-placement.ts` (`place(kind, head)` zones: mic orb 0.45 m, Quick_Actions 0.50 m, Hand_Keyboard 0.45 m tilted up, transcript 0.9 m, device list and task panel 0.9 to 1.2 m, status chips 1.2 m)
    - Create `ui/panels/mic-orb`, `transcript`, `quick-actions` (Turn on, Turn off, Dim, Brighten, Come here, Sit on the desk, Go away, Run my evening routine), `ui/hand-keyboard.ts`, and the full `ui/speech-bubble.ts` (bubble plus chirp)
    - _Requirements: 8.4, 8.5, 15.6, 15.7, 15.8, 15.9, 15.10, 15.11, 15.12, 15.13, 16.10_

  - [ ]* 13.24 Write property test for panel placement
    - **Property 46: Panels stay in the seated zones**
    - **Validates: Requirements 8.4, 8.5**

  - [x] 13.25 Wire the voice loop and the interim device runner
    - Add the orchestrator: non-dominant pinch hold-to-talk (400 ms trailing) and mic-orb poke (1.2 s silence or 8 s cap) start push-to-talk, final text goes through `processText`, and results dispatch to avatar abilities, timers, `remember_place`, clarifications, and Persona lines
    - Add an interim `DirectRunner` for light actions: ack line, `applyCommand` on `MockHome`, then a success or failure line. Task 15.8 replaces it with the hacking sequence
    - Tint each Device_Marker from `MockHome.state$` so on and off are visible
    - Rebuild the grammar on `registry:changed` and when places change. On mic failure show Quick_Actions and Hand_Keyboard. Route `confirm_pointed` and "that one"
    - _Requirements: 13.8, 14.1, 14.2, 14.3, 14.4, 14.5, 14.7, 15.4, 15.5, 15.6, 15.7, 15.10, 15.14, 17.3, 17.5, 17.6, 17.11, 22.5, 22.7, 22.9_

  - [ ]* 13.26 Write unit tests for the voice loop edge cases
    - Test an `[unk]`-only result, microphone failure showing Quick_Actions, Quick_Actions parity with the parse path, and deictic with no pointed device
    - _Requirements: 14.4, 15.10, 15.13, 15.14_

- [ ] 14. Hand-off note: Step 6
  - **What to test:** point at a marker, hold a pinch with your non-dominant hand, say "turn off that", then try "come here", "sit on the desk", "set a timer for one minutes", and a nonsense phrase. Also poke the Quick_Actions buttons and open the keyboard
  - **What you should see:** live words in the transcript panel, Capri's confirm line in her own voice with lip movement, the marker changing from lit to dim, a clarification question when nothing is pointed at, "say that again" for nonsense or a garbled multi-word result, and a bubble plus chirp for dynamic text (Quest Browser has no speech synthesis)
  - **Open on Quest:** run `npm run dev`, then open `https://<LAN-IP>:<port>/` in Quest Browser. Before tapping Enter AR, tap "Enable microphone" on the page, allow it, and wait for "Voice model ready" (the first load takes about half a minute and is cached afterwards). Enter AR works without them, with Quick_Actions and the keyboard as the fallback. Or use `adb reverse tcp:<port> tcp:<port>` and `https://localhost:<port>/`
  - Run `npm run typecheck` and `npm test -- --run`, fix any failures, then continue to the next task without waiting for a reply
  - _Requirements: 7.6, 7.12_

- [x] 15. Step 7 [MVD]: hacking VFX
  - [x] 15.1 Implement the hack sequence state machine
    - Create pure `src/domain/actions/hack-sequence.ts` with phases `AIM (0.25 s) → FLICK (0.35 s) → BEAM (0.45 s) → PULSE (0.35 s) → CALL → LINK_HOLD → RESULT`, driven by `dt` and ports `AnimatorPort`, `VfxPort`, `BackendPort`, and `PersonaPort`
    - Dispatch the backend call exactly once, strictly after `pulseEnded`
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_

  - [ ]* 15.2 Write property test for hack sequence ordering
    - **Property 31: Hack sequence ordering**
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5**

  - [x] 15.3 Implement the particle pool
    - Create `src/vfx/particle-pool.ts` with a fixed `VFX_PARTICLE_CAP = 192` (128 sparks, 24 glyphs, 32 glitch lines) that recycles the oldest element when full
    - _Requirements: 18.9, 29.2_

  - [ ]* 15.4 Write property test for the particle cap
    - **Property 32: Particle cap**
    - **Validates: Requirements 18.9**

  - [x] 15.5 Implement the VFX renderers and quality governor
    - Create `src/vfx/hacking-vfx.ts`, `beam.ts`, `glyphs.ts`, `pulse.ts`: one `THREE.Points` for sparks, one `InstancedMesh` for hex glyphs, one `LineSegments` for glitch lines (jittered at 15 Hz with the seeded `Rng`), two ribbon beams, and one pulse ring, cyan `#00f0ff` and magenta `#ff2bd6`, additive `MeshBasicMaterial` and `PointsMaterial` only, 6 draw calls or fewer, no lights, no post-processing
    - Emit from `handEmitterWorld()` to the marker
    - Create `src/vfx/quality-governor.ts` halving spark and glyph counts when the rolling 30-frame time exceeds 12.5 ms
    - _Requirements: 18.3, 18.4, 18.9, 18.10, 29.2_

  - [x] 15.6 Add the VFX sound cues
    - Extend `src/audio/sfx-synth.ts` with oscillator and noise cues: flick whoosh, beam zap, and pulse ping
    - _Requirements: 18.8_

  - [x] 15.7 Implement the flick, shrug, and celebrate gestures
    - Add `gestures/flick.ts` (0.35 s snap with finger spread), `shrug.ts`, and `celebrate.ts` to the procedural animator
    - _Requirements: 18.2, 18.6, 18.7, 21.5, 21.6_

  - [x] 15.8 Replace the interim runner with the hacking sequence
    - Make the orchestrator run every accepted light action through `HackSequence`: gaze at the marker, flick, beams, pulse, backend call, then celebrate plus quip on success or shrug plus the real failure message on failure
    - Keep a faint shimmer in `LINK_HOLD` while the call is pending and keep Persona on `ack` wording
    - Remove `DirectRunner`
    - _Requirements: 14.6, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 22.7, 22.9_

- [ ] 16. Hand-off note: Step 7
  - **What to test:** point at a marker, pinch-hold with the non-dominant hand and say "turn off that", then "turn on that". Watch frame time with `?perf=1`
  - **What you should see:** Capri looks at the marker, flicks her hand, cyan and magenta beams, hex glyphs, and sparks stream to the marker, a pulse lands, the marker changes state, then she celebrates and quips. Frame time stays at or under 13.9 ms during the effect
  - **Open on Quest:** run `npm run dev`, then open `https://<LAN-IP>:<port>/?perf=1` in Quest Browser, or use `adb reverse tcp:<port> tcp:<port>` and `https://localhost:<port>/?perf=1`
  - The `?perf=1` overlay shows frame time during the effect. The user does not need to read out any number. If the effect looks over budget, the user may mention it and the developer applies the performance levers in design order
  - Run `npm run typecheck` and `npm test -- --run`, fix any failures, then continue to the next task without waiting for a reply
  - _Requirements: 7.6, 7.12_

- [x] 17. Step 10a [MVD]: Mock Mode (built right after Step 7, per Requirement 7.1)
  - [x] 17.1 Implement mode resolution and status mapping
    - Create pure `src/domain/settings/mode-resolver.ts` (`resolveMode(creds, liveRequested)`: no credentials gives Mock, incomplete Home Assistant credentials stay Mock and list missing names, incomplete Hermes credentials give `agent: 'absent'`)
    - Create `src/domain/settings/status.ts` mapping each of the four connection states to a distinct indicator state, and a connection test report with one entry per configured integration
    - _Requirements: 23.1, 23.2, 27.3, 27.4, 27.6_

  - [ ]* 17.2 Write property test for status mapping
    - **Property 44: Status mapping and connection test report**
    - **Validates: Requirements 27.2, 27.3, 27.6**

  - [ ]* 17.3 Write property test for the mock backend
    - **Property 39: Mock backend matches its model**
    - **Validates: Requirements 23.4**

  - [x] 17.4 Render the three virtual bulbs
    - Create `src/ui/mock-bulbs.ts`: emissive sphere plus halo sprite per bulb following `MockHome.state$` (on, off, brightness, colour), no real-time lights
    - Place the bulbs head-relative at session start (yaw −35°, +5°, +40°, distance 1.8 to 2.2 m, varied heights) and register them automatically with Device_Markers and names (for example "desk lamp", "floor lamp", "ceiling light")
    - _Requirements: 12.9, 23.3, 23.4_

  - [x] 17.5 Implement the full status chips
    - Complete `src/ui/status-chips.ts`: Home Assistant, Hermes, and mode chips fed by `connection:changed`, updating on the same frame
    - _Requirements: 23.7, 27.1, 27.2, 27.3_

  - [x] 17.6 Wire Mock Mode as the default
    - In `main.ts` resolve the mode at start with no credentials, construct `MockHome`, pass backends to the orchestrator through the shared interfaces, and make no network request to Home Assistant or Hermes
    - Confirm the zero-configuration path: open, optionally Enable microphone and wait for the voice model, Enter AR (allowed without either), point, voice command, hacking effect, bulb change, reaction
    - _Requirements: 8.7, 8.8, 23.1, 23.2, 23.6, 23.7, 23.8, 23.9, 23.11_

  - [ ]* 17.7 Write a unit test that Mock Mode makes no network requests
    - Spy on `fetch` and `WebSocket` across a scripted loop and assert zero calls to Home Assistant or Hermes
    - _Requirements: 23.6_

- [ ] 18. Hand-off note: Mock Mode
  - **What to test:** open the page with no setup, enter AR, and run the whole loop: point at a bulb, say "turn off that", "dim that", "set that to red"
  - **What you should see:** three virtual bulbs floating in your room with markers, a Mock Mode chip, the hacking sequence, and the bulb visibly changing off, dim, or red, followed by a quip. No network requests to Home Assistant
  - **Open on Quest:** run `npm run dev`, then open `https://<LAN-IP>:<port>/` in Quest Browser, or use `adb reverse tcp:<port> tcp:<port>` and `https://localhost:<port>/`. Do not enter any credentials
  - Run `npm run typecheck` and `npm test -- --run`, fix any failures, then continue to the next task without waiting for a reply
  - _Requirements: 7.6, 7.12_

- [ ] 19. Step 8a [MVD]: one scripted Hermes task (no live Hermes code)
  - [x] 19.1 Add the agent interface and the scripted mock task
    - Extend `src/backends/types.ts` with `AgentBackend`, `TaskHandle`, `TaskEvent`, `AgentTaskRequest`
    - Create `src/backends/mock/mock-agent.ts`: scripted "evening routine" task with progress events at fixed offsets (0%, 25%, 60%, 100%) that completes and reports. Add no Hermes endpoint, header, field name, or example call
    - _Requirements: 19.3, 23.5, 23.8, 23.10_

  - [x] 19.2 Implement the task model
    - Create `src/domain/contract/task-model.ts` reducing `TaskEvent`s into `{ state, progress, label }` with non-decreasing progress and final terminal states
    - _Requirements: 19.6_

  - [x] 19.3 Build the Task_Panel and wire the task flow
    - Create `src/ui/panels/task-panel` (progress and label) and the `task` intent flow ("run my evening routine"): acknowledge, show the panel, run the mock task, and play `fidget` playful idles while it runs
    - On completion interrupt idle with `notify` and a `task-complete` line. On failure interrupt with `notify` and a line stating the reason
    - _Requirements: 19.5, 19.6, 19.8, 19.9, 19.10, 23.5, 23.10_

  - [ ]* 19.4 Write unit tests for the scripted task
    - Test progress ordering, completion, and a forced failure path through `TaskModel` and `MockAgent`
    - _Requirements: 19.6, 19.9, 19.10, 23.5_

  - [x] 19.5 Add `vercel.json` and the Vercel build script
    - Create `vercel.json` with `installCommand: "npm ci"`, `buildCommand: "npm run build:vercel"`, `outputDirectory: "dist"`, and one SPA-safe rewrite that sends only extensionless paths to `/index.html`. Static files such as `/spike.html`, `/assets/*`, `/voice/*`, and `/vosk/*` are served first, and a missing file with an extension stays a 404
    - Add `headers` for all routes: `Content-Security-Policy`, `Permissions-Policy: microphone=(self), xr-spatial-tracking=(self), camera=(), geolocation=(), payment=(), usb=()`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Strict-Transport-Security`, plus a long immutable `Cache-Control` (`public, max-age=31536000, immutable`) for `/assets/*` and for `/vosk/*` (the model file name carries its version, so the 41 MB model is downloaded once per visitor)
    - Write the CSP so it never blocks user-configured endpoints: `connect-src 'self' https: wss: blob:` (no plain `http:` or `ws:`), `script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `img-src 'self' data: blob:`, `media-src 'self' blob: data:`, `font-src 'self' data:`, `style-src 'self' 'unsafe-inline'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`
    - Record the trade-off in `docs/hosting.md`: a build-time CSP cannot list the Home Assistant and Hermes URLs the user types on the Setup_Page, so `connect-src` allows any `https:` and `wss:` endpoint, and the remaining controls are `script-src 'self'`, the URL guard, and sending credentials only to the configured endpoint
    - Add the `build:vercel` script to `package.json`: `npm run typecheck`, `npm test -- --run`, the Vosk model fetch and verify, then `vite build`. Any failing step fails the Vercel build, so the previous production deployment stays live
    - Add `tests/unit/vercel-config.test.ts` that parses `vercel.json` and asserts `outputDirectory` is `dist`, `connect-src` contains `https:` and `wss:` but not `http:` or `ws:`, `worker-src` contains `blob:`, `script-src` contains `'wasm-unsafe-eval'`, and the Permissions-Policy allows `microphone` and `xr-spatial-tracking` for `self`, and the `/vosk/(.*)` header entry has a long-lived `Cache-Control`
    - Run `npm run build:vercel` and `vite preview` locally to confirm the build works from the root
    - _Requirements: 30.1, 30.2, 30.3, 30.4, 30.8, 30.9, 30.11, 30.12, 30.13, 30.15_

  - [-] 19.6 Deploy to Vercel and attach the custom subdomain
    - Ask the user for their custom subdomain (one question, for example `capri.<their-domain>`). Never hard-code it in source. It appears only in the README CORS snippets and the submission files
    - Deploy through the Vercel Git integration (the user imports the repository in Vercel, and pushes to the default branch build production) or the Vercel CLI (`vercel login`, `vercel link`, `vercel --prod`), whichever the user prefers. If the subdomain has not arrived yet, deploy to the project's default `*.vercel.app` URL and continue with the next task
    - Ask the user to add the subdomain in the Vercel project (Settings, Domains), add the `CNAME` record that Vercel displays at their DNS provider, and verify the domain in Vercel until it shows as verified (assumption A20). Vercel then issues HTTPS automatically
    - Check the first deployed page for CSP violations in desktop Chrome DevTools (assumption A19). If a directive blocks Vosk, the worker, or an asset, report it and relax only that directive, recording why in `docs/hosting.md`
    - Write the hand-off note: open `https://<custom-subdomain>/` in Quest Browser and confirm that Mock Mode runs with no setup. If the Vosk model or voice files fail to load from the hosted site, report it and propose the cheapest workaround
    - _Requirements: 8.9, 30.3, 30.4, 30.8, 30.10, 30.13, 30.14_

- [ ] 20. Hand-off note: MVD cut-line reached
  - Mark the MVD cut-line as reached in `docs/project-plan.md` and make a commit tagged `mvd-cut-line`. Everything after this task is Post-MVD or OPTIONAL and is cut in that order under schedule pressure (OPTIONAL first, then Post-MVD, never an MVD item). The hosted link from task 19.6 must exist before the cut-line is marked
  - **What to test:** the full demo loop in Mock Mode, once in sequence: wave on entering, point and "turn off that", then "run my evening routine". Run it from the hosted custom-subdomain link as well as the dev server
  - **What you should see:** passthrough presence, pointing highlight, a voice command, the hacking effect, a bulb change and quip, a Task_Panel with progress, and Capri announcing completion
  - **Open on Quest:** the hosted `https://<custom-subdomain>/`, or run `npm run dev` and open `https://<LAN-IP>:<port>/`, or use `adb reverse tcp:<port> tcp:<port>` and `https://localhost:<port>/`
  - Run `npm run typecheck` and `npm test -- --run`, fix any failures, then continue to the next task without waiting for a reply
  - _Requirements: 7.4, 7.6, 7.12_

- [ ] 21. Step 8b [POST-MVD]: live Hermes and Tier 2 (Gate H: investigate, then ask)
  - [ ] 21.1 Gate H, part 1: investigate the real Hermes integration surface
    - Research the real Hermes agent: endpoint shape, authentication, request and response format, streaming behaviour (SSE, WebSocket, or polling), and CORS support. Use web search and the user's repository or docs where available
    - Write findings to a draft `docs/hermes-integration.md`, marking every unknown as unknown. Write no `Hermes_Client` code
    - _Requirements: 19.1_

  - [ ] 21.2 Gate H, part 2: ask the user for the Hermes details and WAIT
    - Ask one item at a time: the Hermes endpoint, then the authentication method, then one working example call. Wait for each answer
    - Do not invent any endpoint, credential, header, or example call. If the user cannot supply them, keep the scripted task for the demo, report that live Hermes is cut, and stop this task group
    - _Requirements: 19.2, 19.3, 29.10_

  - [ ] 21.3 Gate H, part 3: record the confirmed surface and check browser feasibility
    - Update `docs/hermes-integration.md` with the confirmed endpoint shape, auth, request and response format, transport, and CORS findings
    - If the surface cannot be called from a browser because of CORS or authentication, report the constraint to the user and add no backend or bridge server
    - _Requirements: 19.4, 19.7, 19.12, 30.1_

  - [ ] 21.4 Implement the contract, spatial context, and tier router
    - Create `src/domain/contract/response-contract.ts` (`validateContract` total and never throwing, unknown emotion to `neutral`, unknown animation to `none`, `gateAction`), `src/domain/context/spatial-context.ts` (`buildSpatialContext` with exactly five keys, 1 cm rounding, caps of 16 devices and 12 surfaces, 4 KB bound), and `tier-router.ts` (Tier 2 only when connected, fallback with a Hermes-unavailable line on every failure)
    - Add a canned `chat` reply to `MockAgent`
    - _Requirements: 17.3, 17.11, 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9_

  - [ ]* 21.5 Write property test for the spatial context
    - **Property 40: Spatial_Context shape and bound**
    - **Validates: Requirements 17.3, 20.3, 20.4**

  - [ ]* 21.6 Write property test for contract validation
    - **Property 41: Response_Contract validation and action gating**
    - **Validates: Requirements 20.2, 20.5, 20.6, 20.7**

  - [ ]* 21.7 Write property test for tier routing
    - **Property 42: Tier routing and fallback**
    - **Validates: Requirements 17.11, 20.1, 20.8, 20.9**

  - [ ] 21.8 Implement the endpoint URL guard
    - Create `src/domain/settings/url-guard.ts` accepting only `https://` or `wss://` URLs for Home Assistant and Hermes, refusing with an error that names the setting and never includes the value
    - _Requirements: 19.11, 25.9, 26.1, 26.7_

  - [ ]* 21.9 Write property test for the URL guard
    - **Property 34: Endpoint URL guard**
    - **Validates: Requirements 19.11, 25.9, 26.1**

  - [ ] 21.10 Implement the live Hermes adapter from the confirmed surface only
    - Create `src/backends/hermes/hermes-adapter.ts` (`HermesWire`, `TaskEventSource`), `live-hermes-adapter.ts`, and the single transport confirmed in 21.3 (`SseSource` using `fetch` streaming if headers are needed, `WebSocketSource`, or `PollingSource`)
    - Implement only fields recorded in `docs/hermes-integration.md`. Enforce the URL guard and sanitise errors. Add fake transports for tests
    - _Requirements: 19.7, 19.11, 20.2, 24.6, 29.7_

  - [ ]* 21.11 Write property test for task model and transport conformance
    - **Property 43: Task model monotonicity and transport conformance**
    - **Validates: Requirements 19.6, 19.7**

  - [ ] 21.12 Wire Tier 2 into the app
    - Route Hand_Keyboard free-form text that parses to `unknown` through `TierRouter` when Hermes is connected, send `buildSpatialContext` with each request, play the returned emotion and animation and present the speech text as a Speech_Bubble plus chirp (tier 3, because `speechSynthesis` is missing on Quest Browser and `ttsUsable` is false, with no synthetic mouth flap), and gate actions through `gateAction`
    - Swap `MockAgent` for `LiveHermesAdapter` when `resolveMode` yields `agent: 'live'`
    - _Requirements: 16.10, 16.13, 19.5, 19.6, 19.9, 19.10, 20.1, 20.3, 20.5, 20.6, 20.7, 20.8, 20.9_

- [ ] 22. Hand-off note: live Hermes
  - **What to test:** with Hermes credentials entered, start a task by voice, then type a free-form question on the Hand_Keyboard. Then turn Hermes off and try again
  - **What you should see:** the Task_Panel showing real progress, Capri announcing completion or the failure reason, a bubble-and-chirp reply to the free-form question, and an in-character "Hermes is out, Tier 1 is covering" when Hermes is down
  - **Open on Quest:** run `npm run dev`, then open `https://<LAN-IP>:<port>/` in Quest Browser, or use `adb reverse tcp:<port> tcp:<port>` and `https://localhost:<port>/`. Your Hermes URL must be HTTPS
  - Run `npm run typecheck` and `npm test -- --run`, fix any failures, then continue to the next task without waiting for a reply
  - _Requirements: 7.6, 7.12_

- [ ] 23. Step 9 [POST-MVD]: personality and aliveness
  - [ ] 23.1 Implement the idle scheduler
    - Create pure `src/domain/idle-scheduler.ts` choosing idle behaviours (stretch, fidget, glance at a Surface or marker) with random gaps in [8 s, 18 s], reset by any command, and an ignored-reaction plus tease after 60 s without input, limited to playful gestures while a Hermes task runs
    - _Requirements: 19.8, 21.1, 21.2, 21.3_

  - [ ]* 23.2 Write property test for idle cadence
    - **Property 7: Idle cadence and ignored reaction**
    - **Validates: Requirements 21.2, 21.3**

  - [ ] 23.3 Add the personality gestures
    - Add `gestures/stretch.ts`, `glance.ts`, `ignored.ts`, and `tease.ts`, and extend `fidget.ts`
    - _Requirements: 21.1, 21.3, 21.4_

  - [ ] 23.4 Wire personality into the app
    - Run the idle scheduler in `app.tick`, glance at real Surfaces and markers, deliver the ignored tease, apply the repeated-toggle tease through `ActionMemory`, play celebrate with a `celebrate` line on success and shrug on failure
    - Add any missing tease, ignored, and celebrate lines to `voice/voice-manifest.txt` and regenerate the Voice_Library
    - _Requirements: 17.10, 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7_

- [ ] 24. Hand-off note: personality
  - **What to test:** do nothing for about 20 seconds, then 60 seconds, then toggle the same light three times within a minute
  - **What you should see:** idle stretches, fidgets, and glances at real objects at least every 20 seconds, an ignored reaction with a tease line after 60 seconds of no input, and a tease naming the light you kept toggling
  - **Open on Quest:** run `npm run dev`, then open `https://<LAN-IP>:<port>/` in Quest Browser, or use `adb reverse tcp:<port> tcp:<port>` and `https://localhost:<port>/`
  - Run `npm run typecheck` and `npm test -- --run`, fix any failures, then continue to the next task without waiting for a reply
  - _Requirements: 7.6, 7.12_

- [ ] 25. Step 10b [POST-MVD]: setup page, live Home Assistant, CORS docs
  - [ ] 25.1 Implement secret redaction and credential types
    - Create `src/domain/settings/redact.ts` (`SecretRegistry`, `redact(text)` replacing registered secrets of length 4 or more with `[redacted]`) and `credentials.ts` (types, trimming, line-break stripping)
    - Make `app/logger.ts` the only logging path and pass every error-to-UI path through `redact`
    - _Requirements: 24.10, 29.7_

  - [ ] 25.2 Implement the credential store
    - Create `src/persistence/credential-store.ts` (`capri.v1.credentials` in `localStorage`, or `sessionStorage` when "Remember" is off) with `forget()` removing every key and triggering mode re-resolution to Mock
    - _Requirements: 24.5, 24.8, 24.9_

  - [ ]* 25.3 Write property test for secrets never appearing in output
    - **Property 36: Secrets never appear in output**
    - **Validates: Requirements 24.10, 26.6, 26.7, 29.7**

  - [ ]* 25.4 Write property test for mode resolution and credentials
    - **Property 38: Mode resolution and credentials**
    - **Validates: Requirements 23.1, 24.5, 24.9, 27.4**

  - [ ] 25.5 Implement the Home Assistant client
    - Create `src/backends/ha/ha-requests.ts` (pure: `light.` prefix only, `GET /api/states` filtered to `light.`, `POST /api/services/light/turn_on` and `turn_off`, `brightness_pct` clamped 0 to 100, `rgb_color` clamped 0 to 255, bearer header), `ha-errors.ts` (401 `auth`, 404 `not_found`, 5xx `server`, `TypeError` `network_or_cors`, errors built only from enums and fixed text), and `ha-client.ts` (URL guard, 10 s `AbortController` timeout, confirm via `GET /api/states/<id>` when the target is absent from the response, `unsupported_color` from `supported_color_modes`)
    - Add no hard-coded URL, token, or entity ID
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 25.6, 25.7, 25.8, 25.9, 25.10, 25.11, 26.6_

  - [ ]* 25.6 Write property test for request building
    - **Property 33: Home Assistant request building**
    - **Validates: Requirements 25.2, 25.3, 25.4, 25.5, 25.6, 25.7**

  - [ ]* 25.7 Write property test for the timeout boundary
    - **Property 35: Home Assistant timeout boundary**
    - **Validates: Requirements 25.11**

  - [ ]* 25.8 Write the shared backend contract test suite
    - Run one suite against `MockHome` and `HaClient` (mocked `fetch`), and against `MockAgent` and `LiveHermesAdapter` (fake transports)
    - _Requirements: 23.8_

  - [ ] 25.9 Build the full Setup_Page
    - Update `index.html` and `src/ui/setup-page/`: Home Assistant URL, masked long-lived token, Hermes URL, masked Hermes key, Live mode switch, Remember switch, paste support, Quest on-screen keyboard compatibility, Enter AR, Test connections, Forget credentials, the Mic_Setup_Step from task 3.3 ("Enable microphone", granted, denied, or not requested shown on the page, releasing the stream at once), and the Model_Preload progress indicator from task 13.21 (load and cache the Vosk model before Enter AR)
    - Keep Enter AR enabled without the microphone or the model, and show a hint when the microphone is not granted (Quick_Actions and Hand_Keyboard are the fallback). Never prompt for the microphone inside AR
    - Show errors that name the setting and never print its value
    - _Requirements: 15.15, 15.16, 15.19, 15.20, 24.1, 24.2, 24.3, 24.4, 24.8, 24.11, 24.14, 26.7, 27.4, 27.6_

  - [ ] 25.10 Wire Live Mode
    - Resolve the mode from stored credentials, construct `HaClient` for `home: 'live'`, feed `connection:changed` to the chips, build the teach list from live `listLights()`, run connection tests, and deliver in-character failure lines with the CORS troubleshooting hint
    - Confirm credentials go only to their own configured origin
    - _Requirements: 24.6, 24.7, 25.1, 25.8, 26.6, 27.1, 27.2, 27.4, 27.5, 27.6_

  - [ ]* 25.11 Write property test for network egress rules
    - **Property 37: Network egress rules**
    - **Validates: Requirements 17.1, 23.6, 24.6, 24.7**

  - [ ] 25.12 Write the Live Mode sections of the README
    - Create `README.md` with: a plain statement that credentials are stored only on the device, sent only to the endpoints the user configured, and never logged; Home Assistant HTTPS via Nabu Casa, Tailscale HTTPS, and a reverse proxy; the Home Assistant CORS setup with both the UI path (HTTP server, "CORS allowed origins", Home Assistant 2026.8 and later) and the exact `http:` `cors_allowed_origins` YAML snippet for older versions, each using the custom subdomain origin (`https://<custom-subdomain>`) and never another host; the Hermes CORS configuration taken from `docs/hermes-integration.md` (or a clear note that live Hermes was not confirmed); the option of serving the built app from Home Assistant's `/config/www` directory (served at `/local/`) for same-origin use; a one-line note that the dedicated custom subdomain keeps `localStorage` isolated to this app (leaving Remember off is still an option); and how to configure Live Mode
    - _Requirements: 24.13, 26.2, 26.3, 26.4, 26.5, 30.13, 31.8_

- [ ] 26. Hand-off note: Setup and live Home Assistant
  - **What to test:** enter your Home Assistant URL and long-lived token on the setup page, tap Test connections, register a real light, and say "turn off that". Then tap Forget credentials
  - **What you should see:** masked token fields, a connected Home Assistant chip, your real light switching off after the hacking effect, an in-character failure with a CORS hint if CORS is not yet configured, and a return to Mock Mode after Forget credentials
  - **Open on Quest:** run `npm run dev`, then open `https://<LAN-IP>:<port>/` in Quest Browser, or use `adb reverse tcp:<port> tcp:<port>` and `https://localhost:<port>/`. Home Assistant must be reachable over HTTPS and must allow this origin (see the README CORS section)
  - Run `npm run typecheck` and `npm test -- --run`, fix any failures, then continue to the next task without waiting for a reply
  - _Requirements: 7.6, 7.12_

- [ ] 27. Step 11 [POST-MVD]: polish and submission readiness
  - [ ] 27.1 Add the loading screen
    - Create `src/ui/loading.ts` in-scene panel shown while the VRM, voice index, and Vosk model load, with a failure message if loading fails
    - _Requirements: 28.1_

  - [ ] 27.2 Add pause and resume
    - Create `src/ui/pause.ts`: pause freezes the animator clock, stops the mic, and suspends audio contexts. Resume restores them and announces expired timers. React to session `visibilitychange`
    - _Requirements: 28.2_

  - [ ] 27.3 Tune the audio mix
    - Add per-bus gain constants for speech, SFX, and chirp in `config/constants.ts`, route each through its own `GainNode`, and keep the defaults unless the user comments on the balance in a hand-off reply
    - _Requirements: 28.4_

  - [ ] 27.4 Add the smoke checks and the check script
    - Create `tools/checks/*` and `npm run check`: no `three` or DOM import in `domain/`, no `EffectComposer`, material allow-list, no `http://` in `dist`, no hard-coded Home Assistant or Hermes host, no `.env` value in `dist`, a single `.vrm` path in `config/`, valid voice manifest, README required sections present, `.env.example` present, third-party file fields present, `tools/` absent from the bundle, and no controller-only input code
    - _Requirements: 8.2, 8.3, 10.5, 16.7, 18.10, 19.3, 24.12, 30.8_

  - [ ] 27.5 Add the smoke checks to the Vercel build
    - Extend the `build:vercel` script in `package.json` (created in task 19.5) so `npm run check` runs after `vite build`, and re-check that `vercel.json` still points at `dist`. A failing check fails the Vercel build, so the previous production deployment stays live
    - _Requirements: 30.3, 30.4, 30.9_

  - [ ] 27.6 Write the performance note and comfort check
    - Create `docs/performance-note.md` with the frame-time values shown by the `?perf=1` overlay (idle, during VFX, over a 10-minute session) and any levers applied, and `docs/comfort-check.md` covering Avatar distance range, panel placement, and seated reach. Also measure the frame time once with `featureFlags.depthOcclusion` on, and leave the flag on only if the Frame_Budget holds. If a value is needed that the developer cannot see, ask the user once for the overlay reading (a performance measurement required by Requirement 29.5, not a time log)
    - _Requirements: 28.3, 29.3, 29.5_

  - [ ] 27.7 Write the Demo_Path script
    - Create `docs/demo-path.md`: a 2-minute sequence showing passthrough presence, pointing, a voice command, the Hacking_VFX, a quip, and one Hermes task, with the exact words to say and hand actions
    - _Requirements: 8.6, 28.5, 28.6, 28.8_

  - [ ] 27.8 Complete the README
    - Add to `README.md`: running Mock Mode from the hosted custom-subdomain link with no setup, deploying with the Vercel Git integration or CLI and attaching the custom subdomain with the `CNAME` record Vercel displays, loading the dev server in Quest Browser over the local network and through `adb reverse`, Cloudflare Tunnel or ngrok as a last resort only, the Demo_Path summary, and a third-party assets list with licenses including the placeholder VRM
    - _Requirements: 10.6, 28.8, 30.3, 30.5, 30.6, 30.7, 31.7, 31.9_

  - [ ]* 27.9 Write unit tests for loading and pause
    - Test that pause stops the mic and suspends audio, resume restores them, and a load failure shows its message
    - _Requirements: 28.1, 28.2_

- [ ] 28. Hand-off note: polish
  - **What to test:** the loading screen, pause and resume, a 10-minute session with `?perf=1`, the Demo_Path from `docs/demo-path.md`, and the hosted custom-subdomain link in Mock Mode
  - **What you should see:** a loading screen, a clean pause and resume, steady 72 fps, balanced speech and effect volume, and the full Mock Mode loop working from the hosted link
  - **Open on Quest:** open `https://<custom-subdomain>/` in Quest Browser. For local checks use `npm run dev` with `https://<LAN-IP>:<port>/?perf=1` or `adb reverse tcp:<port> tcp:<port>`
  - The audio mix keeps the defaults from task 27.3 unless the user comments on the balance. Frame-time values for `docs/performance-note.md` are collected in task 27.6
  - Run `npm run typecheck` and `npm test -- --run`, fix any failures, then continue to the next task without waiting for a reply
  - _Requirements: 7.6, 7.12_

- [ ] 29. Submission deliverables [POST-MVD]
  - [ ] 29.1 Write the submission text
    - Create `docs/submission-text.md` stating Track Productivity, Division New Experience, and the target of the "Best Agentic Interaction" special award, describing the Avatar, her spatial awareness, and her Persona as the product with Home Assistant and Hermes as plug-in backends
    - _Requirements: 31.3, 31.5, 31.6_

  - [ ] 29.2 Write the demo video plan
    - Create `docs/demo-video-plan.md`: a shot list for a video shorter than 3 minutes showing Mock Mode from the hosted link, hands-only interaction, the signature moment (point, "turn that off", hacking effect, quip), and one Hermes task, ordered so the final video stays under 3 minutes, with a recording method for Quest
    - _Requirements: 31.2, 31.4_

  - [ ] 29.3 Add the submission checklist and finalise links
    - Create `docs/submission-checklist.md` listing the hosted playable link, the demo video, the submission text, the README and `vercel.json`, the Demo_Path, and the deadline (Nov 18, 2026, 12:00pm PST), with a placeholder the user fills with the hosted URL
    - Add the hosted link to `README.md` and `docs/submission-text.md` once the user supplies it
    - _Requirements: 28.7, 28.8, 31.1, 31.10_

- [ ] 30. Hand-off note: final submission
  - **What to test:** open the hosted link on the Quest with no setup and run the Demo_Path once with controllers set down. Record the demo video following `docs/demo-video-plan.md`
  - **What you should see:** Mock Mode working from the hosted link, hands-only control, the signature moment, one Hermes task, and a recording under 3 minutes
  - **Open on Quest:** `https://<custom-subdomain>/` in Quest Browser, then tap Enter AR
  - Remind the user to submit the link, video, and text as listed in `docs/submission-checklist.md`
  - Run `npm run typecheck` and `npm test -- --run`, fix any failures, then continue to the next task without waiting for a reply
  - _Requirements: 7.6, 7.12_

- [ ] 31. OPTIONAL: retargeted animation clips (cut first, only after the MVD cut-line and submission readiness)
  - [ ]* 31.1 Select clips and record licenses
    - Choose permissively licensed clips for idle, wave, point, snap/flick, celebrate, and tease/shrug, and add a license and attribution entry for each to `docs/THIRD_PARTY.md`
    - _Requirements: 32.1, 32.2, 32.5_

  - [ ]* 31.2 Implement the clip animator
    - Create `src/avatar/clips/index.ts` using `@pixiv/three-vrm-animation` to retarget each clip to the Avatar's VRM humanoid bones, with graceful handling of load failures
    - If retargeting takes longer than the schedule allows, stop and keep the Procedural_Animator gesture
    - _Requirements: 32.2, 32.3, 32.7_

  - [ ]* 31.3 Implement the gesture router
    - Create `src/avatar/gesture-router.ts` discovering the clip module through `import.meta.glob('./clips/index.ts')` (empty when absent), and use a clip only when it is loaded, otherwise the procedural gesture
    - _Requirements: 32.4, 32.6_

  - [ ]* 31.4 Write property test for gesture fallback
    - **Property 45: Gesture fallback without clips**
    - **Validates: Requirements 32.4, 32.6**

  - [ ]* 31.5 Write the clip hand-off note
    - **What to test:** trigger wave, point, flick, celebrate, and shrug, then delete `src/avatar/clips/` and rebuild
    - **What you should see:** smoother motion with clips, and identical behaviour from the procedural gestures with the folder removed
    - **Open on Quest:** `npm run dev`, then `https://<LAN-IP>:<port>/` in Quest Browser, or `adb reverse tcp:<port> tcp:<port>` and `https://localhost:<port>/`
    - _Requirements: 32.4, 32.6_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVD. The OPTIONAL group (task 31) contains only optional sub-tasks and is cut first.
- The repository scaffold in task 1.2 is spike preparation. Step 1 (task 3) builds on it, and the Spike items themselves finish before Step 1 begins (Requirement 1.1).
- Tasks 1 to 20 are the MVD. Task 20 marks the MVD cut-line. Tasks 21 to 30 are Post-MVD.
- Mock Mode (task 17) is built right after Step 7 (task 15), per Requirement 7.1. The mock home reducer is created earlier in task 9.1 so the teach flow and voice loop have a backend, and it is reused unchanged.
- Gate H (tasks 21.1 to 21.3) must finish before any live Hermes client code (task 21.10). The scripted Hermes task in task 19 uses no real Hermes surface.
- Each hand-off note tells the user what to test, what they should see, and how to open the build on the Quest. It never blocks the next task. The dev server is started with `npm run dev` outside the agent's foreground shell.
- The agent stops and waits only for a Milestone 0 failure confirmation (tasks 1.5 to 1.9), Gate H (task 21.2), or a specific missing input (voice engine in 13.1, custom subdomain and Vercel domain verification in 19.6, Home Assistant details in 25.10, Hermes details in 21.2).
- Property tests validate universal correctness properties from the design. Unit tests validate specific examples and edge cases.
- Each task references specific requirements for traceability.

## Task Dependency Graph

```json
{
  "waves": [
    {"id": 0, "tasks": ["1.1"]},
    {"id": 1, "tasks": ["1.2"]},
    {"id": 2, "tasks": ["1.3"]},
    {"id": 3, "tasks": ["1.4", "1.5"]},
    {"id": 4, "tasks": ["1.6"]},
    {"id": 5, "tasks": ["1.7"]},
    {"id": 6, "tasks": ["1.8"]},
    {"id": 7, "tasks": ["1.9"]},
    {"id": 8, "tasks": ["1.10"]},
    {"id": 9, "tasks": ["3.1"]},
    {"id": 10, "tasks": ["3.2"]},
    {"id": 11, "tasks": ["3.3", "3.4"]},
    {"id": 12, "tasks": ["3.5"]},
    {"id": 13, "tasks": ["3.6"]},
    {"id": 14, "tasks": ["3.7"]},
    {"id": 15, "tasks": ["5.1", "5.2"]},
    {"id": 16, "tasks": ["5.3", "5.6", "5.7", "5.8", "5.10"]},
    {"id": 17, "tasks": ["5.4", "5.5", "5.9"]},
    {"id": 18, "tasks": ["5.11"]},
    {"id": 19, "tasks": ["7.1", "7.2"]},
    {"id": 20, "tasks": ["7.3", "7.4", "7.5", "7.6", "7.7", "7.8"]},
    {"id": 21, "tasks": ["7.9"]},
    {"id": 22, "tasks": ["7.10"]},
    {"id": 23, "tasks": ["9.1", "9.2"]},
    {"id": 24, "tasks": ["9.3", "9.5"]},
    {"id": 25, "tasks": ["9.4", "9.6", "9.7"]},
    {"id": 26, "tasks": ["9.8", "9.9"]},
    {"id": 27, "tasks": ["11.1", "11.6"]},
    {"id": 28, "tasks": ["11.2", "11.3"]},
    {"id": 29, "tasks": ["11.4", "11.5", "11.7"]},
    {"id": 30, "tasks": ["13.1"]},
    {"id": 31, "tasks": ["13.2", "13.11", "13.14"]},
    {"id": 32, "tasks": ["13.3", "13.4", "13.5", "13.6", "13.7", "13.12", "13.13", "13.15", "13.16", "13.17", "13.18", "13.19", "13.20", "13.21"]},
    {"id": 33, "tasks": ["13.8", "13.9", "13.10", "13.22", "13.23"]},
    {"id": 34, "tasks": ["13.24", "13.25"]},
    {"id": 35, "tasks": ["13.26"]},
    {"id": 36, "tasks": ["15.1", "15.3", "15.6", "15.7"]},
    {"id": 37, "tasks": ["15.2", "15.4", "15.5"]},
    {"id": 38, "tasks": ["15.8"]},
    {"id": 39, "tasks": ["17.1"]},
    {"id": 40, "tasks": ["17.2", "17.3", "17.4", "17.5"]},
    {"id": 41, "tasks": ["17.6"]},
    {"id": 42, "tasks": ["17.7"]},
    {"id": 43, "tasks": ["19.1", "19.2"]},
    {"id": 44, "tasks": ["19.3", "19.4", "19.5"]},
    {"id": 45, "tasks": ["19.6"]},
    {"id": 46, "tasks": ["21.1"]},
    {"id": 47, "tasks": ["21.2"]},
    {"id": 48, "tasks": ["21.3"]},
    {"id": 49, "tasks": ["21.4", "21.8"]},
    {"id": 50, "tasks": ["21.5", "21.6", "21.7", "21.9", "21.10"]},
    {"id": 51, "tasks": ["21.11", "21.12"]},
    {"id": 52, "tasks": ["23.1", "23.3"]},
    {"id": 53, "tasks": ["23.2", "23.4"]},
    {"id": 54, "tasks": ["25.1"]},
    {"id": 55, "tasks": ["25.2", "25.5"]},
    {"id": 56, "tasks": ["25.3", "25.4", "25.6", "25.7", "25.8", "25.9"]},
    {"id": 57, "tasks": ["25.10", "25.12"]},
    {"id": 58, "tasks": ["25.11"]},
    {"id": 59, "tasks": ["27.1", "27.7"]},
    {"id": 60, "tasks": ["27.2"]},
    {"id": 61, "tasks": ["27.3", "27.9"]},
    {"id": 62, "tasks": ["27.6", "27.8"]},
    {"id": 63, "tasks": ["27.4"]},
    {"id": 64, "tasks": ["27.5", "29.1", "29.2"]},
    {"id": 65, "tasks": ["29.3"]},
    {"id": 66, "tasks": ["31.1"]},
    {"id": 67, "tasks": ["31.2"]},
    {"id": 68, "tasks": ["31.3"]},
    {"id": 69, "tasks": ["31.4", "31.5"]}
  ]
}
```
