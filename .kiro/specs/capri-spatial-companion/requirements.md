# Requirements Document

## Introduction

Capri (working title) is a spatial AI companion for Meta Quest, delivered as a WebXR static site written in TypeScript with the Immersive Web SDK (IWSDK) and Three.js. Capri is a persistent, embodied, anime-style 3D companion that lives in the user's room through passthrough mixed reality. She has a playful, teasing, hacker-girl personality. She moves around the space, perches on real surfaces, reacts to the user, understands what the user points at, and takes real actions: controlling smart lights through Home Assistant and delegating long-running tasks to a self-hosted Hermes agent. Capri is not a plain voice assistant. Her spatial awareness is the product, and Home Assistant and Hermes are plug-in backends.

The signature moment: the user points at a light and says "turn that off". The Avatar looks where the user points, flicks her hand, streams red/magenta "hacking" sparks and glitch lines from her hand toward the light, the light switches off, and she quips.

Submission context: Meta VR Start Developer Competition 2026, Track Productivity, Division New Experience, also targeting the "Best Agentic Interaction" special award. The deadline is Nov 18, 2026, 12:00pm PST. The spec was written on Nov 16, 2026, which leaves two days. The primary builder is the agent because the user has no prior VR experience, so each on-headset step must be explained briefly and the user must be told exactly what to do on the headset.

Hardware and services: Meta Quest 3 or 3S, a real Home Assistant instance with several smart lights, and a self-hosted Hermes agent. The Home Assistant URL, long-lived token, light entity IDs, Hermes endpoint, Hermes authentication, and a Hermes example call are supplied by the user at the time they are needed and are never hard-coded. The app is hosted on Vercel at a custom subdomain that the user supplies and connects to Vercel with a DNS `CNAME` record.

### Milestone 0 findings

Milestone 0 ran on a real Meta Quest 3 (Quest Browser 156), and the user approved continuing with the workarounds. The findings that shape these requirements are recorded in `docs/spike-report.md`:

- `speechSynthesis` does not exist in the Quest_Browser, so dynamic text uses the Speech_Bubble with a chirp and canned lines use the Voice_Library.
- The first microphone permission prompt inside an AR session ended the session, so microphone permission is requested on a 2D page before Enter AR and never inside the session.
- The Vosk model (41 MB) took 26 s to load cold and caused a 75 ms frame gap, so the model loads and caches on a 2D page before Enter AR. The fragments grammar strategy works.
- A persistent anchor restored after a page reload was 95 mm from where it was saved, so restored markers are approximate.
- Quest semantic labels include `wall art`, `door`, and `shelf`, and up to six table-labelled planes can appear at once.
- Hand input sources expose a gamepad with target-ray mode `tracked-pointer`, and `xrOrigin.indexTipSpaces` matches the index fingertip joint.
- Depth occlusion works and is kept as a bonus behind a flag.

### Build order and cut-line

Work proceeds in strict order: Milestone 0 (feasibility spike), then Steps 1 to 11. Each step is finished and verified (tests, build, and the emulator where possible) before the next step starts, and the user gets a short non-blocking hand-off note for testing it on the headset. The developer waits only for a Milestone 0 failure confirmation, the Hermes investigate-then-ask gate, or a specific missing input. The one planned exception is that Mock Mode (Step 10) is built immediately after Step 7 to complete the MVD.

| Tier | Contents |
|------|----------|
| Milestone 0 | Feasibility spike, items a to e (Requirements 1 to 6) |
| MVD (minimum viable demo) | Steps 1 to 7 (Requirements 9 to 18), plus Mock Mode (Requirement 23), then one Hermes task (Requirement 19), then the first Vercel deploy of the Mock Mode build on the custom subdomain (Requirements 8.9, 30.3) |
| Post-MVD | Remaining scope of Steps 8 to 11 (Requirements 19 to 21, 24 to 29, 31), then the headset feedback fixes and HUD declutter (Requirement 33) |
| OPTIONAL | Retargeted animation clips (Requirement 32). No core requirement depends on this tier. |

## Glossary

- **Capri_App**: The complete WebXR application delivered as static files, with no backend or bridge server.
- **Avatar**: The VRM character model representing Capri in the scene.
- **Avatar_Config**: The single configuration path that names the VRM file the Capri_App loads as the Avatar.
- **Procedural_Animator**: The Capri_App component that drives Avatar bones and expressions from code (look-at, eye movement, breathing, blinking, hand gestures, bobbing).
- **Clip_Animator**: The OPTIONAL Capri_App component that plays retargeted animation clips on the Avatar.
- **Spike**: Milestone 0, a short feasibility experiment run before Step 1.
- **Spike_Report**: The plain written report of what works and what does not for each Spike item, stored in the repository and given to the user.
- **Scene_Understanding**: The Capri_App component that consumes plane detection (with semantic labels), mesh detection, anchors, hit-test, and depth data from the WebXR session.
- **Surface**: A detected plane or mesh region with a semantic label such as floor, table, wall, or couch.
- **Device_Registry**: The Capri_App component that stores registered devices, their Home Assistant entity IDs, their names, and their spatial positions.
- **Device_Marker**: The subtle holographic marker rendered at the stored position of a registered light.
- **Pointing_Selector**: The Capri_App component that casts a ray from the dominant hand's index finger and selects Device_Markers.
- **Pointed_Device**: The Device_Marker currently selected by the Pointing_Selector.
- **STT_Engine**: The speech-to-text component, which uses vosk-browser (WASM) with a small English model.
- **Grammar_Builder**: The Capri_App component that builds the restricted Vosk grammar.
- **Push_To_Talk**: The gesture that opens the microphone, either a pinch with the non-dominant hand or a poke on the floating mic orb. **Superseded in part by Requirement 33.23:** the non-dominant hold-pinch is the only Push_To_Talk gesture and the mic orb is removed.
- **Transcript_Panel**: The small holographic panel that shows the live transcript. **Superseded by the Transcript_Bubble (Requirements 33.24 to 33.28).**
- **Quick_Actions**: The floating hand-operated quick-action buttons used when the microphone fails. **Superseded by the Commands_Tile (Requirements 33.49 to 33.51).**
- **Hand_Keyboard**: The pinch-to-open on-screen keyboard used when the microphone fails. **Superseded by the System_Keyboard (Requirements 33.52 to 33.54).**
- **Intent_Parser**: The Tier_1 component that converts recognised text into a structured intent using a deterministic grammar.
- **Tier_1**: The default, fully offline, on-headset intelligence tier.
- **Tier_2**: The intelligence tier that uses Hermes, active only when Hermes is connected.
- **Banter_Engine**: The Tier_1 component that selects templated, context-aware, varied lines and keeps a memory of recent actions.
- **Spatial_Context**: The compact object sent with Tier_2 requests containing the Pointed_Device, gaze target, device list and states, detected Surfaces, and Avatar state.
- **Response_Contract**: The structured Tier_2 response shape `{speech, emotion, animation, action:{type,target,params}}`.
- **Voice_Library**: The shipped set of pre-generated compressed voice lines.
- **Voice_Manifest**: The text file listing every voice line and its category.
- **Voice_Script**: The dev-time script that generates the Voice_Library from the Voice_Manifest.
- **Speech_Output**: The Capri_App component that selects among the three speech output tiers.
- **Speech_Bubble**: A floating text bubble near the Avatar, accompanied by a short chirp sound.
- **Hacking_VFX**: The cyan and magenta glitch beams, hexagon glyphs, sparks, and pulse effects played on a device action.
- **Persona**: The Avatar's conversational character, governed by Requirement 22.
- **HA_Client**: The Capri_App component that calls the Home Assistant REST or WebSocket API from the browser.
- **Hermes_Client**: The Capri_App component that calls the Hermes endpoint from the browser.
- **Task_Panel**: The floating holographic panel that shows Hermes task progress.
- **Mock_Mode**: The default operating mode, in which simulated Home Assistant with 3 virtual light bulbs and a scripted Hermes task replace the real backends and no network calls to Home Assistant or Hermes are made. **Superseded in part by Requirement 33.17:** Mock_Mode has no scripted Hermes task and no AgentBackend.
- **Live_Mode**: The operating mode in which HA_Client and Hermes_Client call real endpoints using user-supplied credentials.
- **Setup_Page**: The 2D web page shown before the "Enter AR" action that collects URLs and tokens, offers the Mic_Setup_Step, and loads the Vosk model.
- **Entry_Page**: The 2D page that holds the "Enter AR" action. In Live_Mode it includes the Setup_Page. In Mock_Mode it is the zero-configuration page that offers the Mic_Setup_Step and the model preload without collecting credentials.
- **Mic_Setup_Step**: The "Enable microphone" control on the Entry_Page that calls `getUserMedia` on the 2D page and immediately releases the returned stream, so that the browser permission is granted before any AR session starts.
- **Model_Preload**: The step on the Entry_Page that downloads the Vosk model, stores it in IndexedDB through vosk-browser, and shows a visible progress indicator, all before Enter AR.
- **Credential_Store**: The on-device browser storage holding the user-supplied Home Assistant and Hermes settings.
- **Status_Indicator**: The visible indicator of connection state for one integration.
- **Quest_Browser**: The Meta Quest Browser running on a Meta Quest 3 or 3S.
- **Frame_Budget**: 13.9 ms per frame, corresponding to 72 fps.
- **Hosted_Site**: The Capri_App hosted on Vercel and served over HTTPS from the root of the user's custom subdomain.
- **Custom_Subdomain**: The subdomain the user owns, attached to the Vercel project through a DNS `CNAME` record and verified in Vercel. Its origin is the Hosted_Site origin.
- **Hand_Off_Note**: A short, non-blocking note after a step stating what to test, what the user should see, and how to open the build on the Quest.
- **Dev_Server**: The Vite HTTPS development server used for on-device testing.
- **Demo_Path**: The scripted 2-minute sequence that demonstrates the full Capri loop.
- **Submission_Package**: The hosted playable link, the demo video, and the submission text.
- **Boundaryless_Space**: The XR reference space that the Quest_Browser documents as running without the Quest room-scale boundary in passthrough sessions (expected to be `unbounded`, confirmed in task 33.1).
- **HUD_Menu**: The world-fixed hand-operated menu that the user opens from the Wrist_Button and that holds the Status, Lights, Commands, Ask Hermes, Give Hermes a task, and Close tiles.
- **Wrist_Button**: The small glowing button shown on the non-dominant wrist while that palm faces the user, poked with the dominant index fingertip to open or close the HUD_Menu.
- **Commands_Tile**: The HUD_Menu tile that lists every supported command phrase, grouped by Lights, Capri, and Hermes, generated from the phrase table.
- **System_Keyboard**: The Meta Quest system keyboard shown on demand during an immersive session for text entry.
- **Transcript_Bubble**: The small bubble above the Avatar that shows the listening state, the live transcript, and short voice failure reasons.
- **Teach_Reticle**: The marker drawn where the teach pointer ray hits the room, marking the position a pinch captures.
- **Comfort_Radius**: The personal-space radius of 0.5 m around the user's head inside which the Avatar steps aside.

## Requirements

### Requirement 1: Milestone 0 governance

**User Story:** As a developer with no prior VR experience, I want the riskiest assumptions checked first with plain reporting, so that no time is lost on dead ends.

#### Acceptance Criteria

1. THE Spike SHALL be completed before work on Step 1 begins.
2. THE Spike SHOULD stay short, with a soft guideline of about 2 hours of working time, and SHALL NOT require timestamp logging or time reports from the user.
3. THE Spike SHALL verify items (a) to (e) on a Meta Quest 3 or 3S in the Quest_Browser.
4. WHEN the Spike ends, THE developer SHALL produce a Spike_Report stating for each of items (a) to (e) whether the item works or does not work.
5. IF a Spike item fails, THEN THE developer SHALL state the failure to the user immediately.
6. IF a Spike item fails, THEN THE developer SHALL propose the cheapest workaround together with the failure statement.
7. IF a Spike item fails, THEN THE developer SHALL wait for user confirmation of the workaround before continuing.
8. WHILE a Spike item is failing, THE developer SHALL spend no further time on that item beyond proposing the workaround.
9. THE developer SHALL tell the user the exact steps to perform on the headset for each Spike item.

### Requirement 2: Spike item (a), immersive AR session with passthrough and hand joints

**User Story:** As a developer, I want to know that passthrough AR and hand tracking work in the Quest_Browser, so that the hands-only product is possible.

#### Acceptance Criteria

1. WHEN the user starts the Spike scene, THE Capri_App SHALL start an immersive AR session with passthrough in the Quest_Browser.
2. WHILE the immersive AR session is active, THE Capri_App SHALL read hand-tracking joint poses for both hands.
3. WHILE the immersive AR session is active with no controller connected, THE Capri_App SHALL continue to report hand-tracking joint poses.
4. THE Spike_Report SHALL state whether item (a) works.

### Requirement 3: Spike item (b), plane detection, mesh detection, anchors, hit-test, and depth

**User Story:** As a developer, I want to know which scene-understanding features work, so that the Avatar can stand on the floor and sit at a table.

#### Acceptance Criteria

1. WHILE the immersive AR session is active, THE Scene_Understanding SHALL report detected planes with semantic labels, including floor, table, wall, and couch where present in the room.
2. WHILE the immersive AR session is active, THE Scene_Understanding SHALL report whether mesh detection is available.
3. WHEN the user performs a pinch on a real surface, THE Scene_Understanding SHALL report a hit-test result for that surface.
4. WHEN a hit-test result is available, THE Scene_Understanding SHALL create an anchor at the hit position and report whether the anchor persists across frames.
5. WHERE depth sensing is available, THE Scene_Understanding SHALL report whether depth occlusion works, treated as a bonus item.
6. THE Spike SHALL show the Avatar standing on the detected floor Surface.
7. THE Spike SHALL show the Avatar sitting on or at a detected table Surface.
8. THE Spike_Report SHALL state separately whether plane detection, semantic labels, mesh detection, anchors, hit-test, and depth occlusion work.

### Requirement 4: Spike item (c), microphone capture during an immersive session

**User Story:** As a developer, I want to know that the microphone works inside an immersive session, so that voice commands are possible.

#### Acceptance Criteria

1. WHEN the user starts the Spike microphone test during an immersive AR session, THE Capri_App SHALL request microphone permission and start audio capture.
2. WHILE audio capture is active, THE Capri_App SHALL display a live input level in the scene.
3. IF microphone permission is denied or capture does not start, THEN THE Capri_App SHALL display the failure reason in the scene.
4. THE Spike_Report SHALL state whether item (c) works.

### Requirement 5: Spike item (d), vosk-browser with a restricted grammar

**User Story:** As a developer, I want to know that Vosk loads and recognises a restricted grammar on the headset, so that Vosk-only speech recognition is viable.

#### Acceptance Criteria

1. WHEN the Spike loads vosk-browser (WASM) with a small English model, THE Spike_Report SHALL record the load time in seconds.
2. WHEN the Spike loads vosk-browser, THE Spike SHALL recognise a restricted grammar that contains the phrases "turn on", "turn off", "come here", and "[unk]".
3. THE Spike SHALL measure recognition accuracy by speaking each grammar phrase 10 times and recording the number of correct recognitions.
4. THE Spike_Report SHALL state the load time, the per-phrase accuracy, and whether item (d) works.
5. IF vosk-browser fails to load or recognise, THEN THE Spike_Report SHALL state the failure cause.

### Requirement 6: Spike item (e), speechSynthesis availability and voice quality

**User Story:** As a developer, I want to know whether speechSynthesis is usable on the Quest_Browser, so that the dynamic-text speech tier can be chosen correctly.

#### Acceptance Criteria

1. THE Spike SHALL report whether the speechSynthesis API exists in the Quest_Browser.
2. WHERE speechSynthesis exists, THE Spike SHALL list the available voices and speak one test sentence with each English voice.
3. WHERE speechSynthesis exists, THE Spike SHALL ask the user to rate each English voice as usable or not usable for the Persona.
4. THE Spike_Report SHALL state whether item (e) works and which voice is usable, if any.
5. WHEN the Spike_Report states that no usable voice exists, THE Speech_Output SHALL skip speechSynthesis and use the Speech_Bubble tier for dynamic text.

### Requirement 7: Strict build order, cut-line, and milestone reporting

**User Story:** As a developer, I want a fixed build order and a visible cut-line, so that a working demo exists before the deadline.

#### Acceptance Criteria

1. THE developer SHALL build Milestone 0 first and then Steps 1 to 11 in numeric order, with the single exception that Mock Mode (Requirement 23) follows Step 7.
2. THE developer SHALL finish and verify each step (typecheck, tests, build, and the IWSDK emulator where possible) before starting the next step.
3. THE MVD SHALL consist of Steps 1 to 7, Mock Mode (Requirement 23), and then one Hermes task (Requirement 19), followed by the first Vercel deploy of the Mock Mode build on the Custom_Subdomain so that a hosted playable link exists at the cut-line.
4. WHEN the MVD is complete, THE project plan SHALL mark the MVD cut-line as reached before the remaining scope of Steps 8 to 11 begins.
5. IF schedule pressure requires cutting scope, THEN THE developer SHALL cut OPTIONAL items first, then the remaining Post-MVD scope, before any MVD item.
6. WHEN a step is finished, THE developer SHALL give the user a Hand_Off_Note stating what to test, what the user should see, and how to open the build on the headset using the HTTPS dev URL, the hosted Custom_Subdomain URL, a tunnel, or `adb reverse`, and SHALL continue to the next task without waiting for the user's reply.
7. THE developer SHALL prefer a working demoable vertical slice over breadth.
8. THE developer SHALL make small commits.
9. THE project plan SHALL record the deadline of Nov 18, 2026, 12:00pm PST as context, together with the step order and the cut-line ordering, and SHALL NOT contain per-step time estimates or time budgets.
10. THE developer SHALL read the official IWSDK documentation and confirm which hand-tracking, passthrough, plane, mesh, anchor, depth, and audio APIs are available before starting Step 1.
11. THE developer SHALL propose a project structure and a milestone plan, ordered by the cut-line and without time estimates, before scaffolding.
12. THE developer SHALL wait for the user only (a) after a Milestone 0 failure, for confirmation of the proposed workaround (Requirement 1.7), (b) at the Hermes investigate-then-ask gate (Requirement 19.1 and 19.2), and (c) when a specific input is missing, such as the voice engine, the Custom_Subdomain, the Home Assistant details, or the Hermes details.
13. THE developer SHALL NOT ask the user to log timestamps, report elapsed time, or give headset time as part of a Hand_Off_Note or a step.

### Requirement 8: Hard competition constraints

**User Story:** As a competition entrant, I want the product to satisfy the competition rules, so that the entry qualifies.

#### Acceptance Criteria

1. THE Capri_App SHALL be fully usable with hands only.
2. THE Capri_App SHALL contain no feature that requires a controller.
3. THE Capri_App SHALL contain no controller-only code path.
4. THE Capri_App SHALL be fully usable while the user is seated and stationary.
5. THE Capri_App SHALL require no walking, teleportation, or standing movement for any interaction.
6. WHEN a first-time user opens the Hosted_Site, THE Capri_App SHALL reach a satisfying interactive state within 10 minutes of the user starting.
7. THE Capri_App SHALL implement the Avatar, its spatial awareness, and its Persona as native Capri_App components, with Home Assistant and Hermes as replaceable plug-in backends.
8. THE Capri_App SHALL be playable by judges without a smart home through Mock_Mode.
9. THE Capri_App SHALL be delivered as a hosted WebXR link.

### Requirement 9: Step 1, scaffold and passthrough

**User Story:** As a developer, I want a running AR scaffold with visible hands, so that every later step can be tested on the headset.

#### Acceptance Criteria

1. THE Capri_App SHALL be written in TypeScript and use Three.js and IWSDK.
2. THE Capri_App SHALL be scaffolded with `npm create @iwsdk@latest`.
3. WHEN the user selects "Enter AR" in the Quest_Browser, THE Capri_App SHALL start an immersive AR session with passthrough.
4. WHILE the immersive AR session is active, THE Capri_App SHALL track both hands.
5. WHILE the immersive AR session is active, THE Capri_App SHALL render a visible hand skeleton for each tracked hand. **Superseded by Requirements 33.6 and 33.7.**
6. THE Capri_App SHALL run in the IWSDK emulator.
7. THE Dev_Server SHALL serve the Capri_App over HTTPS.
8. THE Capri_App SHALL use IWSDK APIs for hand tracking, passthrough or AR session handling, and anchors or planes where IWSDK provides them.
9. IF hand tracking is lost for more than 1.0 s, THEN THE Capri_App SHALL display a message asking the user to bring the hands into view.
10. WHEN hand tracking resumes, THE Capri_App SHALL remove the hand-tracking-lost message within 0.5 s.
11. THE Capri_App SHALL NOT rely on the `gamepad` of any hand input source, because Quest hand input sources expose a `gamepad` with target-ray mode `tracked-pointer` that carries no controller buttons.
12. WHEN the Step 1 headset check runs, THE Capri_App SHALL show a test panel that the user operates by hand, and the developer SHALL record whether panel and multipointer interaction by hand works on the headset.

### Requirement 10: Step 2, avatar presence

**User Story:** As a user, I want to see Capri in my room reacting to me, so that the companion feels present.

#### Acceptance Criteria

1. WHEN the immersive AR session starts, THE Capri_App SHALL render the Avatar in the room, floor-anchored when a floor Surface is detected and floating otherwise.
2. THE Capri_App SHALL load the Avatar from the VRM file named by the Avatar_Config.
3. THE Capri_App SHALL allow the Avatar to be swapped by changing only the single Avatar_Config path.
4. THE Capri_App SHALL bundle a free placeholder VRM model with a permissive license.
5. THE repository SHALL contain a file recording the placeholder VRM model's name, author, source URL, and license.
6. THE Capri_App SHALL display or document the placeholder VRM license in the README third-party asset list.
7. WHILE the Avatar is visible, THE Procedural_Animator SHALL apply an idle breathing motion.
8. WHILE the Avatar is visible, THE Procedural_Animator SHALL blink the Avatar's eyes at randomized intervals between 2 s and 6 s.
9. WHILE the Avatar is visible, THE Procedural_Animator SHALL orient the Avatar's head and eyes toward the user's head position.
10. WHEN the Avatar first appears in a session, THE Procedural_Animator SHALL play a wave gesture.
11. THE Capri_App SHALL keep the Avatar between 1.0 m and 1.5 m from the seated user's head during idle. **Superseded by Requirements 33.29 to 33.31.**
12. THE Procedural_Animator SHALL limit head yaw to 70 degrees and head pitch to 40 degrees relative to the Avatar's torso.
13. IF the VRM file fails to load, THEN THE Capri_App SHALL display an error naming the failure and keep the session running.
14. WHEN the Avatar first appears in a session, THE Speech_Output SHALL play one greeting line from the Voice_Library together with the wave gesture, and SHALL NOT replay the greeting on resume from pause.

### Requirement 11: Step 3, spatial interaction

**User Story:** As a user, I want Capri to move to and sit on real surfaces and to look and point at things, so that she is visibly aware of my room.

#### Acceptance Criteria

1. WHEN a move_to request names a Surface, THE Avatar SHALL walk or float to a position on that Surface.
2. WHEN a sit_on request names a detected table or couch Surface, THE Avatar SHALL move to that Surface and sit on or at it.
3. WHEN a perch request names a detected Surface, THE Avatar SHALL perch on the edge of that Surface.
4. WHEN a look_at request names a target position, THE Procedural_Animator SHALL orient the Avatar's head and eyes toward the target.
5. WHEN a point_at request names a target position, THE Procedural_Animator SHALL extend the Avatar's arm and index finger toward the target.
6. THE Capri_App SHALL implement Step 3 using the capabilities confirmed as working in the Spike_Report.
7. IF the requested Surface is not detected, THEN THE Avatar SHALL remain in the current position and THE Persona SHALL state in character that the Surface was not found.
8. WHILE the Avatar is moving, THE Capri_App SHALL keep the Avatar within a position the seated user can see without walking.
9. WHEN a Surface has a semantic label that is not in the Surface label set (for example `wall art`, `door`, or `shelf`), THE Scene_Understanding SHALL map that Surface to the label `other`.
10. WHEN more than one Surface is table-class, THE Scene_Understanding SHALL select the table-class Surface nearest to the user's head that lies within comfortable seated range, and SHALL break a tie by the largest area.
11. WHERE a floor-labelled plane exists, THE Capri_App SHALL use the Y coordinate of that plane as the Avatar's standing height.

### Requirement 12: Step 4, device registration

**User Story:** As a user, I want to teach Capri where my lights are using only my hands, so that she can act on the right light.

#### Acceptance Criteria

1. THE Capri_App SHALL provide a "Teach me your lights" flow operable with hands only.
2. WHEN the user points at a real light and pinches during the "Teach me your lights" flow, THE Capri_App SHALL capture the pointed-at position.
3. WHEN a position is captured, THE Capri_App SHALL show a floating hand-operated list of Home Assistant light entities.
4. WHEN the user selects an entity from the list, THE Device_Registry SHALL store the entity with the captured position.
5. WHERE the Spike_Report states anchors work, THE Device_Registry SHALL persist each light position as a spatial anchor.
6. WHERE the Spike_Report states anchors do not work, THE Device_Registry SHALL persist each light position in localStorage.
7. WHEN a light is registered, THE Capri_App SHALL render a Device_Marker at the stored position.
8. WHEN the Device_Registry changes, THE Grammar_Builder SHALL rebuild the grammar as specified in Requirement 15.
9. WHILE in Mock_Mode, THE Capri_App SHALL render the 3 virtual light bulbs as registered devices with Device_Markers.
10. WHEN a persisted spatial anchor is restored after a page reload, THE Capri_App SHALL treat the restored Device_Marker position as approximate, with an expected error of up to roughly 10 cm.
11. WHILE any Device_Marker exists, THE Capri_App SHALL keep the "Re-teach lights" action visible. **Superseded by Requirement 33.46:** "Re-teach lights" lives in the HUD_Menu Lights tile.
12. THE Capri_App SHALL NOT state or imply that a restored Device_Marker position is exact.
13. THE Capri_App SHALL open the "Teach me your lights" flow only on a fingertip poke of its orb or a ray-pinch aimed at the orb for a short dwell, and SHALL ignore pinches whose ray only passes near the orb. **Superseded by Requirements 33.36 and 33.46:** the orb is removed and the teach flow opens from the Lights tile.

### Requirement 13: Step 5, pointing selection

**User Story:** As a user, I want to select a light by pointing at it, so that "that one" has a clear meaning.

#### Acceptance Criteria

1. WHILE the immersive AR session is active, THE Pointing_Selector SHALL cast a ray from the dominant hand's index finger using joint poses.
2. WHEN the ray intersects a Device_Marker hit volume, THE Pointing_Selector SHALL set that device as the Pointed_Device.
3. THE Pointing_Selector SHALL use a hit volume for each Device_Marker with a radius of at least 0.15 m.
4. WHEN a Pointed_Device is set, THE Capri_App SHALL highlight it with an outline or ring.
5. WHEN a Pointed_Device is set, THE Procedural_Animator SHALL orient the Avatar's gaze toward the Pointed_Device.
6. IF the ray intersects more than one hit volume, THEN THE Pointing_Selector SHALL choose the candidate nearest to the user's gaze direction.
7. WHEN the user pinches while a Pointed_Device is set, THE Pointing_Selector SHALL confirm the Pointed_Device as the selected target.
8. WHEN the user says "that one" while a Pointed_Device is set, THE Pointing_Selector SHALL confirm the Pointed_Device as the selected target.
9. WHEN the ray no longer intersects any hit volume for 1.0 s, THE Pointing_Selector SHALL clear the Pointed_Device.

### Requirement 14: Step 6, voice command loop

**User Story:** As a user, I want to speak a command and have Capri act on it, so that I can control lights hands-free.

#### Acceptance Criteria

1. WHEN the user performs Push_To_Talk, THE STT_Engine SHALL start recognition.
2. WHEN the STT_Engine produces a final result, THE Intent_Parser SHALL convert the recognised text into a structured intent.
3. WHEN an intent contains a deictic word and a Pointed_Device exists, THE Intent_Parser SHALL resolve the deictic word to the Pointed_Device.
4. IF an intent contains a deictic word and no Pointed_Device exists, THEN THE Persona SHALL ask the user, in character, which device is meant.
5. IF an intent matches more than one device, THEN THE Persona SHALL ask the user which device is meant while the Avatar looks at the candidate devices.
6. WHEN an intent is resolved to a device action, THE Capri_App SHALL execute the device action through the Hacking_VFX sequence in Requirement 18.
7. WHEN an action is accepted, THE Speech_Output SHALL play a confirm line from the Voice_Library.

### Requirement 15: Vosk restricted grammar, push-to-talk, transcript, and microphone fallback

**User Story:** As a user, I want accurate offline speech recognition with a fallback, so that I can always give commands.

#### Acceptance Criteria

1. THE STT_Engine SHALL use vosk-browser (WASM) with a small English model and no other speech recognition service.
2. THE Grammar_Builder SHALL build the restricted grammar dynamically from the following phrase groups: command verbs (turn on, turn off, dim, brighten, set to a colour), deictic words (that, this, it, the one I'm pointing at), registered device names, avatar commands (come here, sit on the desk, look at, point at, remember this as a name, set a timer for a number of minutes, go away), and wake and chat phrases.
3. THE Grammar_Builder SHALL include the token "[unk]" in the grammar.
4. WHEN a device is added to the Device_Registry, THE Grammar_Builder SHALL rebuild the grammar within 1 s.
5. WHEN a device is renamed in the Device_Registry, THE Grammar_Builder SHALL rebuild the grammar within 1 s.
6. WHEN the user pinches with the non-dominant hand, THE Capri_App SHALL start Push_To_Talk.
7. WHEN the user pokes the floating mic orb, THE Capri_App SHALL start Push_To_Talk. **Superseded by Requirement 33.23.**
8. WHILE Push_To_Talk is active, THE Transcript_Panel SHALL show the live transcript. **Superseded by Requirements 33.24 and 33.25.**
9. WHEN Push_To_Talk ends, THE Transcript_Panel SHALL show the final transcript. **Superseded by Requirements 33.25 and 33.26.**
10. IF the microphone fails to start, THEN THE Capri_App SHALL display the Quick_Actions buttons and the Hand_Keyboard. **Superseded by Requirements 33.28, 33.49, and 33.52:** the failure shows in the Transcript_Bubble and the fallback is the Commands_Tile and the System_Keyboard.
11. WHEN the user pinches the Hand_Keyboard open control, THE Capri_App SHALL display the on-screen keyboard. **Superseded by Requirement 33.52.**
12. WHEN the user submits text through the Hand_Keyboard, THE Intent_Parser SHALL process that text as a recognised result. **Superseded by Requirement 33.53.**
13. WHEN the user activates a Quick_Actions button, THE Capri_App SHALL execute the intent assigned to that button. **Superseded by Requirement 33.51.**
14. IF the STT_Engine returns "[unk]" as the whole result, THEN THE Persona SHALL ask the user, in character, to repeat the command.
15. THE Entry_Page SHALL provide the Mic_Setup_Step before the "Enter AR" action.
16. WHEN the user activates the Mic_Setup_Step, THE Entry_Page SHALL call `getUserMedia` on the 2D page and release every track of the returned stream immediately after permission is granted.
17. THE Capri_App SHALL NOT call `getUserMedia` or trigger any microphone permission prompt while an immersive AR session is active.
18. IF microphone permission is denied or not yet granted when the user enters AR, THEN THE Capri_App SHALL start the session with the Quick_Actions buttons and the Hand_Keyboard available and without any microphone prompt. **Superseded in part by Requirements 33.49 and 33.52:** the fallback is the Commands_Tile and the System_Keyboard, and the no-prompt rule stays.
19. WHERE microphone permission has not been granted, THE Entry_Page SHALL allow the "Enter AR" action and SHALL show a hint that voice commands need the microphone and that Quick_Actions and Hand_Keyboard are the fallback. **Superseded in part by Requirements 33.49 and 33.52:** the hint names the Commands_Tile and the System_Keyboard.
20. WHEN the Entry_Page loads and the Vosk model is not cached, THE Entry_Page SHALL start the Model_Preload and display a progress indicator until the model is loaded.
21. WHILE the Model_Preload is running, THE Entry_Page SHALL keep the "Enter AR" action available and SHALL show the Quick_Actions and Hand_Keyboard fallback if the user enters AR before the model is ready. **Superseded in part by Requirements 33.28, 33.49, and 33.52:** the fallback is the Commands_Tile and the System_Keyboard.
22. THE STT_Engine SHALL NOT download or initialise the Vosk model while an immersive AR session is active.
23. THE Grammar_Builder SHALL use the fragments grammar strategy, so that phrase pieces such as "turn off" and "that" can be chained in one utterance.
24. WHEN the STT_Engine returns a multi-word hypothesis for a single-word or short command (for example "turn on turn off" for "come here"), THE Intent_Parser SHALL treat the result as low confidence and SHALL ask the user to confirm or repeat the command instead of executing a device action.
25. THE Grammar_Builder and Intent_Parser SHALL accept the split verb order ("turn that off", "turn it off", "turn this on", "switch that off") and SHALL parse each to the same intent as the joined order ("turn off that").

### Requirement 16: Speech output, voice library, and lip-flap

**User Story:** As a user, I want Capri to speak with a consistent voice without runtime dependencies, so that she sounds alive even when offline.

#### Acceptance Criteria

1. THE Capri_App SHALL include no runtime text-to-speech dependency.
2. THE Voice_Library SHALL contain lines in each of the categories greeting, confirm, quip, error, tease, celebrate, thinking, and task-complete.
3. THE Voice_Library SHALL contain between 5 and 10 variants in each category.
4. THE Voice_Library SHALL be shipped as compressed audio.
5. THE repository SHALL contain a Voice_Manifest that lists each voice line with its category.
6. THE Voice_Script SHALL generate every Voice_Library audio file from the Voice_Manifest at development time.
7. THE Voice_Script SHALL run only at development time and SHALL NOT ship in the runtime bundle.
8. WHEN the Persona selects a line available in the Voice_Library, THE Speech_Output SHALL play that line from the Voice_Library (tier 1).
9. WHERE the capability flag `ttsUsable` is true, WHEN the Persona needs dynamic text not available in the Voice_Library, THE Speech_Output SHALL speak the text with speechSynthesis (tier 2). On the Quest_Browser the flag is false because `speechSynthesis` is missing, so tier 2 is disabled and is a no-op.
10. WHEN the Persona needs dynamic text not available in the Voice_Library and tier 2 is disabled or unavailable, THE Speech_Output SHALL show the text in a Speech_Bubble and play a short chirp (tier 3). This includes dynamic Hermes replies on the Quest_Browser.
11. WHILE the Avatar is speaking audio from the Voice_Library, THE Procedural_Animator SHALL drive the Avatar's mouth expression from the audio amplitude.
12. WHEN the Persona selects a line from a category, THE Speech_Output SHALL avoid repeating the previously played variant of that category.
13. THE Procedural_Animator SHALL NOT drive a synthetic mouth flap for tier 2 speech.
14. WHILE the Speech_Bubble is displayed for tier 3 text, THE Avatar SHALL play the speaking gesture without a mouth movement synchronised to audio.

### Requirement 17: Tier 1 intelligence

**User Story:** As a user, I want Capri to be great with no backend, so that the core product works offline.

#### Acceptance Criteria

1. THE Tier_1 components SHALL run fully on the headset with no network call.
2. THE Intent_Parser SHALL parse intents deterministically from the restricted grammar.
3. THE Tier_1 SHALL resolve spatial context from the Pointed_Device, the gaze target, and the detected Surfaces.
4. THE Avatar SHALL provide the native abilities move_to(surface), sit_on(surface), perch, look_at, point_at, remember_place(name), and timers and reminders.
5. WHEN the user says "remember this as" followed by a name, THE Capri_App SHALL store the pointed-at or gazed-at position under that name through remember_place.
6. WHEN the user says "set a timer for" followed by a number of minutes, THE Capri_App SHALL start a timer for that number of minutes.
7. WHEN a timer expires, THE Avatar SHALL announce the expiry with a notification animation and a spoken or bubble line.
8. THE Banter_Engine SHALL select context-aware templated lines with variation.
9. THE Banter_Engine SHALL keep a memory of the most recent 20 user actions.
10. WHEN the user toggles the same light 3 or more times within 60 s, THE Banter_Engine SHALL select a tease line that refers to the repeated toggling.
11. THE Tier_1 SHALL support every MVD feature with no Tier_2 backend connected.

### Requirement 18: Step 7, hacking VFX

**User Story:** As a user, I want a dramatic hacking effect when Capri acts on a device, so that the signature moment is memorable.

#### Acceptance Criteria

1. WHEN a device action is accepted, THE Procedural_Animator SHALL turn the Avatar's gaze toward the target Device_Marker.
2. WHEN a device action is accepted, THE Procedural_Animator SHALL play the hand-flick animation.
3. WHEN the hand-flick animation plays, THE Hacking_VFX SHALL emit cyan and magenta glitch beams, hexagon glyphs, and sparks from the Avatar's fingers to the target Device_Marker.
4. WHEN the beams reach the target Device_Marker, THE Hacking_VFX SHALL end in a pulse on the device.
5. WHEN the pulse ends, THE HA_Client SHALL fire the device call.
6. WHEN the device call returns success, THE Avatar SHALL play a success reaction and THE Banter_Engine SHALL select a quip.
7. WHEN the device call returns failure, THE Avatar SHALL play a shrug and THE Persona SHALL report the failure.
8. THE Hacking_VFX SHALL play subtle sound effects during the sequence.
9. THE Hacking_VFX SHALL cap the active particle count at a fixed limit chosen to keep the frame time within the Frame_Budget.
10. THE Hacking_VFX SHALL use low-cost materials and no post-processing.

### Requirement 19: Step 8, Hermes long-running task

**User Story:** As a user, I want Capri to delegate long-running tasks to Hermes and tell me when they finish, so that the agentic interaction is visible.

#### Acceptance Criteria

1. BEFORE any Hermes_Client code is written, THE developer SHALL investigate the real Hermes integration surface, including endpoint shape, authentication, request and response format, streaming behavior, and CORS support.
2. BEFORE any Hermes_Client code is written, THE developer SHALL ask the user for the Hermes endpoint, authentication, and one working example call.
3. THE Capri_App SHALL contain no invented Hermes endpoint, credential, or example call.
4. THE developer SHALL record the confirmed Hermes integration surface in a written note in the repository.
5. WHEN the user requests a long-running task such as "watch X", "run my evening routine", or "research Y and tell me when done", THE Avatar SHALL acknowledge the request.
6. WHEN a Hermes task starts, THE Task_Panel SHALL appear and show task progress.
7. THE Hermes_Client SHALL receive task status through the transport the confirmed Hermes surface supports: SSE, WebSocket, or polling.
8. WHILE a Hermes task is running, THE Avatar SHALL play idle playful animations.
9. WHEN a Hermes task completes, THE Avatar SHALL interrupt idle behavior with a notification animation and a spoken or bubble line from the task-complete category.
10. WHEN a Hermes task fails, THE Avatar SHALL interrupt idle behavior with a notification animation and a line that states the failure reason.
11. THE Hermes_Client SHALL call Hermes only over HTTPS or WSS.
12. WHERE the confirmed Hermes surface cannot be called from a browser because of CORS or authentication constraints, THE developer SHALL report the constraint to the user and SHALL NOT add a backend or bridge server.

### Requirement 20: Tier 2 Hermes contract and fallback

**User Story:** As a user, I want free-form conversation and agent actions when Hermes is connected, and a graceful fallback when it is not, so that Capri always responds.

#### Acceptance Criteria

1. WHERE Hermes is connected, THE Hermes_Client SHALL route free-form conversation to Hermes.
2. WHERE the confirmed Hermes surface supports structured responses, THE Hermes_Client SHALL request responses in the Response_Contract shape `{speech, emotion, animation, action:{type,target,params}}`.
3. WHEN the Hermes_Client sends a request, THE Hermes_Client SHALL include a Spatial_Context object containing the Pointed_Device, the gaze target, the device list with states, the detected Surfaces, and the Avatar state.
4. THE Spatial_Context SHALL be compact, with the content limited to those five elements.
5. WHEN a Response_Contract response is received, THE Capri_App SHALL play the named emotion and animation and speak the speech text.
6. WHEN a Response_Contract response contains an action, THE Capri_App SHALL validate that the action type is a supported Avatar ability or device action before executing it.
7. IF the action type is not supported, THEN THE Capri_App SHALL ignore the action and THE Persona SHALL state in character that the action is not possible.
8. IF Hermes is absent or the Hermes call fails, THEN THE Capri_App SHALL fall back to Tier_1.
9. IF Hermes is absent or the Hermes call fails, THEN THE Persona SHALL say in character that Hermes is unavailable and that Tier_1 is handling the request.

### Requirement 21: Step 9, personality and aliveness

**User Story:** As a user, I want Capri to feel alive, so that she is a companion rather than a tool.

#### Acceptance Criteria

1. WHILE the Avatar is idle, THE Procedural_Animator SHALL randomly play idle behaviors including stretches, fidgets, and glances at real objects.
2. WHILE the Avatar is idle, THE Procedural_Animator SHALL trigger an idle behavior at least once every 20 s.
3. IF the user gives no input for 60 s, THEN THE Avatar SHALL play an ignored-reaction animation and a tease line.
4. WHEN the user toggles the same light 3 or more times within 60 s, THE Avatar SHALL tease the user as specified in Requirement 17.
5. WHEN a task or device action succeeds, THE Avatar SHALL play a celebration animation and select a celebrate line.
6. WHEN a task or device action fails, THE Avatar SHALL play a shrug.
7. THE Persona SHALL deliver lines that follow Requirement 22.

### Requirement 22: Persona rules

**User Story:** As a user, I want Capri to speak briefly, in character, and truthfully, so that I enjoy her and trust her reports.

#### Acceptance Criteria

1. THE Persona SHALL present Capri as a playful, teasing, confident hacker-girl who treats the smart home as a system she is "jacking into", with a warm and helpful tone.
2. THE Persona SHALL limit every line to a maximum of 2 short sentences.
3. IF a line exceeds 2 sentences, THEN THE Capri_App SHALL truncate the line to the first 2 sentences before display or speech.
4. THE Persona SHALL use light slang and playful jabs that are not mean.
5. WHEN Capri performs an action, THE Persona SHALL state what Capri did.
6. IF the user's request does not identify a single device, THEN THE Persona SHALL ask which device is meant while the Avatar looks at the candidate devices.
7. THE Persona SHALL state that an action was performed only after the corresponding HA_Client or Hermes_Client call returns success.
8. WHEN a call returns failure, THE Persona SHALL report the real failure from Home Assistant or Hermes in plain words.
9. WHEN a call is pending, THE Persona SHALL state that the action is in progress and SHALL NOT state that the action is complete.
10. IF the user requests an action that Capri does not support, THEN THE Persona SHALL state that Capri cannot do it.

### Requirement 23: Step 10, demo and mock mode

**User Story:** As a judge without a smart home, I want to experience the full loop with zero configuration, so that I can evaluate Capri.

#### Acceptance Criteria

1. WHEN the Capri_App starts with no stored credentials, THE Capri_App SHALL start in Mock_Mode.
2. THE Capri_App SHALL work in Mock_Mode with zero configuration.
3. THE Mock_Mode SHALL simulate Home Assistant with 3 virtual light bulbs rendered in the room.
4. THE Mock_Mode SHALL support on, off, brightness, and colour actions on the 3 virtual light bulbs, and the rendered bulbs SHALL reflect the resulting state.
5. THE Mock_Mode SHALL include a scripted Hermes task with fake progress that completes and reports to the user. **Superseded by Requirements 33.17 and 33.18.**
6. WHILE in Mock_Mode, THE Capri_App SHALL make no network request to Home Assistant or Hermes.
7. WHILE in Mock_Mode, THE Capri_App SHALL display a Mock_Mode Status_Indicator. **Superseded in part by Requirements 33.35 and 33.45:** the indicator is shown in the HUD_Menu Status tile.
8. THE Mock_Mode and Live_Mode backends SHALL share one interface so that the Persona and Procedural_Animator code paths are identical in both modes.
9. WHILE in Mock_Mode, THE Capri_App SHALL support the full loop of pointing, voice command, Hacking_VFX, device state change, and reaction.
10. WHILE in Mock_Mode, THE Capri_App SHALL support a Tier_1 conversation and one scripted Hermes task as the Tier_2 stand-in. **Superseded in part by Requirements 33.17 and 33.18:** the Tier_1 conversation stays and the Tier_2 stand-in is removed.
11. WHILE in Mock_Mode, THE Entry_Page SHALL offer the Mic_Setup_Step and the Model_Preload with progress, and SHALL NOT block the "Enter AR" action on either step.
12. WHILE in Mock_Mode, THE Capri_App SHALL hide the "Teach me your lights" orb by default and SHALL keep the teach flow reachable from the dev panel or a Quick_Actions entry. **Superseded by Requirements 33.36 and 33.46.**

### Requirement 24: Setup page and credential handling

**User Story:** As a user, I want to enter my credentials safely before entering AR, so that my home stays private.

#### Acceptance Criteria

1. THE Setup_Page SHALL be shown before the "Enter AR" action.
2. THE Setup_Page SHALL collect the Home Assistant URL, Home Assistant long-lived token, Hermes URL, and Hermes key.
3. THE Setup_Page SHALL accept pasted values.
4. THE Setup_Page SHALL be operable with the Quest on-screen keyboard.
5. THE Credential_Store SHALL store credentials in browser storage on the headset only.
6. THE Capri_App SHALL send each credential only to the endpoint the user configured for that credential.
7. THE Capri_App SHALL send no credential to the Hosted_Site host or to any server operated by the Capri developer.
8. THE Setup_Page SHALL provide a "forget credentials" button.
9. WHEN the user activates "forget credentials", THE Credential_Store SHALL delete every stored credential and THE Capri_App SHALL switch to Mock_Mode.
10. THE Capri_App SHALL write no credential value to the console, logs, error messages, URLs, or on-screen text.
11. THE Setup_Page SHALL mask the token fields when displayed.
12. THE repository SHALL contain a `.env.example` file used for development only.
13. THE README SHALL state plainly that credentials are stored only on the device, are sent only to the endpoints the user configured, and are never logged.
14. THE Setup_Page SHALL provide the Mic_Setup_Step and the Model_Preload described in Requirement 15, with the microphone permission state (granted, denied, or not requested) and the model load state shown on the page.

### Requirement 25: Home Assistant integration (lights only)

**User Story:** As a user, I want Capri to control my real lights, so that her actions are real.

#### Acceptance Criteria

1. THE HA_Client SHALL call Home Assistant directly from the browser using the REST or WebSocket API.
2. THE HA_Client SHALL list light entities.
3. WHEN the user requests turning a light on, THE HA_Client SHALL call the Home Assistant service that turns the selected light entity on.
4. WHEN the user requests turning a light off, THE HA_Client SHALL call the Home Assistant service that turns the selected light entity off.
5. WHEN the user requests a brightness change, THE HA_Client SHALL set the selected light entity brightness.
6. WHEN the user requests a colour change, THE HA_Client SHALL set the selected light entity colour.
7. THE HA_Client SHALL control light entities only.
8. THE HA_Client SHALL read the Home Assistant URL and long-lived token from the Credential_Store.
9. IF the Home Assistant URL does not begin with `https://` or `wss://`, THEN THE HA_Client SHALL refuse the request and report the reason.
10. THE Capri_App SHALL contain no hard-coded Home Assistant URL, token, or entity ID.
11. IF a Home Assistant request does not complete within 10 s, THEN THE HA_Client SHALL report a timeout failure.

### Requirement 26: HTTPS and WSS, CORS documentation, and same-origin option

**User Story:** As a user, I want clear setup documentation for secure endpoints and CORS, so that Live_Mode works from the browser.

#### Acceptance Criteria

1. THE Capri_App SHALL require HTTPS or WSS for the Home Assistant and Hermes endpoints, with no mixed content.
2. THE README SHALL document setup for Home Assistant HTTPS through Nabu Casa, Tailscale HTTPS, and a reverse proxy.
3. THE README SHALL contain the exact `cors_allowed_origins` snippet for Home Assistant under the `http` integration, using the Custom_Subdomain origin (`https://<custom-subdomain>`) and not any other host, together with the equivalent Home Assistant UI path for versions that configure CORS in the UI.
4. THE README SHALL contain the equivalent CORS configuration for Hermes, using the Custom_Subdomain origin and based on the confirmed integration surface from Requirement 19.
5. THE README SHALL document the option of serving the built Capri_App from Home Assistant's `/config/www` directory for same-origin use.
6. IF a request to Home Assistant or Hermes fails because of a network error or CORS rejection, THEN THE Capri_App SHALL show an in-character failure message and a CORS troubleshooting hint.
7. IF an integration setting is invalid or missing, THEN THE Capri_App SHALL show an error naming the setting without printing its value.

### Requirement 27: Connection status and failure messaging

**User Story:** As a user, I want to see each integration's state and get in-character failure messages, so that I know what is real and what is not.

#### Acceptance Criteria

1. THE Capri_App SHALL display a Status_Indicator for Home Assistant, for Hermes, and for the current mode (Mock_Mode or Live_Mode). **Superseded in part by Requirements 33.35 and 33.45:** the indicators are shown in the HUD_Menu Status tile instead of always-visible chips.
2. WHEN an integration's connection state changes, THE Capri_App SHALL update the corresponding Status_Indicator within 0.5 s.
3. THE Status_Indicator SHALL distinguish at least the states connected, connecting, failed, and not configured.
4. WHERE Live_Mode is selected and required credentials are missing, THE Capri_App SHALL remain in Mock_Mode and display which credential is missing.
5. WHEN an integration fails, THE Persona SHALL deliver an in-character failure message for that integration.
6. WHEN the user requests a connection test, THE Capri_App SHALL report the test result for each configured integration.

### Requirement 28: Step 11, polish and submission readiness

**User Story:** As a submitter, I want a polished, verified build, so that the entry is ready by the deadline.

#### Acceptance Criteria

1. THE Capri_App SHALL display a loading screen while assets and models load.
2. THE Capri_App SHALL support pause and resume of the experience.
3. THE developer SHALL run comfort checks covering the Avatar distance range, panel placement, and seated reach, and record the results.
4. THE developer SHALL tune the audio mix so that Avatar speech, sound effects, and chirps are each audible without masking the others.
5. THE developer SHALL provide a Demo_Path that completes in 2 minutes.
6. THE Demo_Path SHALL show passthrough presence, pointing, a voice command, the Hacking_VFX, a quip, and one Hermes task. **Superseded in part by Requirement 33.60:** the Mock_Mode Demo_Path replaces the Hermes task beat with a Commands_Tile or spatial beat.
7. THE developer SHALL confirm that Mock_Mode works from the Hosted_Site link on a Meta Quest headset.
8. THE repository SHALL contain the README, `vercel.json`, and the Demo_Path script.

### Requirement 29: Engineering rules

**User Story:** As a developer, I want firm engineering rules, so that the build is fast, secure, and comfortable.

#### Acceptance Criteria

1. THE Capri_App SHALL target 72 fps on Meta Quest 3 and 3S.
2. THE Capri_App SHALL use low-cost materials, capped particle counts, and no heavy post-processing.
3. THE developer SHALL tune VRM spring bones and MToon material cost to keep the frame time within the Frame_Budget.
4. WHERE a developer-only frame-time overlay is toggled on, THE Capri_App SHALL display the measured frame time.
5. THE developer SHALL record the measured frame time on the target headset in a performance note in the repository.
6. THE Capri_App SHALL store secrets only on the device through the Setup_Page.
7. THE Capri_App SHALL NOT log tokens.
8. IF a feature fails on the device, including anchors, microphone, Vosk, or speech output, THEN THE developer SHALL tell the user immediately and propose the cheapest workaround.
9. THE developer SHALL explain each non-obvious step briefly and tell the user exactly what to do on the headset.
10. WHEN the developer needs input from the user, THE developer SHALL ask for one item at a time.
11. WHERE the capability flag `depthOcclusion` is true, THE Capri_App SHALL enable depth occlusion of the Avatar as a bonus feature, and WHERE the flag is false or the depth data is absent, THE Capri_App SHALL render without occlusion.

### Requirement 30: Hosting and development workflow

**User Story:** As a developer, I want automated HTTPS hosting on my own subdomain and a reliable dev workflow, so that every step can be tested on the headset and stored data stays isolated to this app.

#### Acceptance Criteria

1. THE Capri_App SHALL consist of static files only, with no backend, proxy, or bridge server.
2. THE Vite configuration SHALL set `base` to `/`, because the Hosted_Site serves the Capri_App from the root of the Custom_Subdomain.
3. THE Capri_App SHALL be deployable to Vercel through the Vercel Git integration or the Vercel CLI.
4. IF the Vercel build fails, THEN THE previously published production deployment SHALL remain unchanged.
5. THE README SHALL describe loading the Dev_Server in the Quest_Browser over the local network.
6. THE README SHALL describe loading the Dev_Server in the Quest_Browser through `adb reverse`.
7. WHERE neither LAN access nor `adb reverse` is available, THE README SHALL mention Cloudflare Tunnel or ngrok as a fallback only.
8. THE Capri_App SHALL load all of its own assets over HTTPS.
9. THE repository SHALL contain a `vercel.json` that configures a static Vite build with output directory `dist`, SPA-safe rewrites that do not turn a missing file with an extension into an HTML response, and the security headers in criteria 11 and 12.
10. THE Hosted_Site SHALL be served over HTTPS from the Custom_Subdomain, with the certificate issued automatically by Vercel, because WebXR requires a secure context.
11. THE `vercel.json` SHALL set a Content-Security-Policy whose `connect-src` allows `'self'`, `https:`, `wss:`, and `blob:`, so that user-configured Home Assistant and Hermes endpoints are not blocked, and whose other directives allow the worker, WASM, and blob use that vosk-browser needs without allowing plain `http:` or `ws:` connections.
12. THE `vercel.json` SHALL set a Permissions-Policy that allows `microphone` and `xr-spatial-tracking` for the page's own origin.
13. THE Hosted_Site SHALL be the only app served from its origin, so that `localStorage` holding credentials and saved light positions is not shared with any other site.
14. WHEN the Custom_Subdomain is needed, THE developer SHALL ask the user for it and SHALL ask the user to add it to the Vercel project, add the DNS `CNAME` record that Vercel displays, and verify the domain in Vercel.
15. THE `vercel.json` SHALL serve the Vosk model file under `/vosk/` with a long-lived `Cache-Control` header (`public, max-age=31536000, immutable`), so that the 41 MB model is downloaded once per version.

### Requirement 31: Deliverables

**User Story:** As a competition entrant, I want all required deliverables defined, so that the submission is complete.

#### Acceptance Criteria

1. THE Submission_Package SHALL include a hosted playable WebXR link.
2. THE Submission_Package SHALL include a demo video shorter than 3 minutes.
3. THE Submission_Package SHALL include submission text.
4. THE demo video SHALL show Mock_Mode working from the hosted link, hands-only interaction, the signature moment, and one Hermes task. **Superseded in part by Requirement 33.60:** the Mock_Mode part shows no scripted Hermes task.
5. THE submission text SHALL state the Track as Productivity, the Division as New Experience, and the target of the "Best Agentic Interaction" special award.
6. THE submission text SHALL describe Capri's Avatar, spatial awareness, and Persona as the product, with Home Assistant and Hermes as plug-in backends.
7. THE README SHALL describe how to run Mock_Mode from the hosted link with no setup.
8. THE README SHALL describe how to configure Live_Mode.
9. THE README SHALL list third-party assets with their licenses.
10. THE Submission_Package SHALL be ready before Nov 18, 2026, 12:00pm PST.

### Requirement 32: OPTIONAL retargeted animation clips

**User Story:** As a developer, I want to optionally add retargeted clips after the core demo works, so that Capri's motion can be richer without putting the core demo at risk.

#### Acceptance Criteria

1. WHERE retargeted animation clips are added, THE Clip_Animator SHALL be implemented only after the MVD cut-line is reached.
2. WHERE retargeted animation clips are added, THE Clip_Animator SHALL provide the clips idle, wave, point, snap/flick, celebrate, and tease/shrug.
3. WHERE retargeted animation clips are added, THE Clip_Animator SHALL retarget each clip to the Avatar's VRM humanoid bones.
4. WHERE retargeted animation clips are added, THE Clip_Animator SHALL fall back to the matching Procedural_Animator gesture if a clip fails to load.
5. WHERE retargeted animation clips are added, THE Capri_App SHALL include a license and attribution entry for each clip.
6. THE Capri_App SHALL satisfy every other requirement with the Clip_Animator absent.
7. WHEN retargeting a clip takes longer than the schedule allows, THE developer SHALL use the Procedural_Animator gesture instead.

### Requirement 33: Headset feedback fixes and HUD declutter [POST-MVD]

**User Story:** As a user testing Capri on the Quest, I want stable positions, a clean view with a menu I summon from my wrist, a visible teach pointer, and no fake Hermes workflow, so that the experience feels calm, honest, and reliable.

#### Acceptance Criteria

1. WHEN the Capri_App starts an immersive AR session, THE Capri_App SHALL request the Boundaryless_Space.
2. IF the Boundaryless_Space is not granted, THEN THE Capri_App SHALL fall back to the `local-floor` reference space and log which reference space was granted.
3. WHEN the active reference space emits a `reset` event, THE Capri_App SHALL, within 0.5 s, re-resolve each anchored Device_Marker position from its anchor, re-place the Mock_Mode bulbs, and recompute the Avatar idle home.
4. IF a reference space reset occurs while a Device_Marker has no anchor, THEN THE Capri_App SHALL flag that Device_Marker position as approximate and offer "Re-teach lights" for it in the HUD_Menu Lights tile.
5. WHILE the Boundaryless_Space or the `local-floor` fallback is active, THE Capri_App SHALL take the Avatar's standing height from the floor-labelled plane as specified in Requirement 11.11.
6. WHERE the page URL contains the query parameter `hands=1`, THE Capri_App SHALL render the hand joint skeleton for each tracked hand.
7. WHERE the page URL lacks the query parameter `hands=1`, THE Capri_App SHALL render no hand joint markers.
8. WHERE the page URL contains the query parameter `dev=1`, THE Capri_App SHALL show the dev panel in development and production builds alike.
9. WHERE the page URL contains the query parameter `handtest=1`, THE Capri_App SHALL show the hand test panel in development and production builds alike.
10. WHERE the page URL contains neither `dev=1` nor `handtest=1`, THE Capri_App SHALL show neither the dev panel nor the hand test panel.
11. WHILE the teach flow waits for a point, THE Capri_App SHALL render a ray from the dominant index fingertip and the Teach_Reticle at the current capture point, updated every frame.
12. WHEN the user pinches while the Teach_Reticle is shown, THE Capri_App SHALL capture the Teach_Reticle position as the light position.
13. THE point capture SHALL choose the environment hit-test result against the real room mesh first, then the nearest labelled plane intersection, then the 2.0 m fallback along the ray.
14. THE point capture SHALL exclude the global or unlabelled room mesh, and every Surface box that contains the user's head, from box intersection.
15. THE point capture SHALL return a capture point whose along-ray distance from the fingertip is greater than 0.05 m.
16. IF the pointing ray hits no surface, THEN THE Capri_App SHALL show the Teach_Reticle at 2.0 m along the ray together with the Nearer and Farther controls.
17. WHILE in Mock_Mode, THE Capri_App SHALL run with no AgentBackend, and THE Hermes Status_Indicator SHALL read "Not configured".
18. WHILE Hermes is not connected, WHEN the user makes a Tier_2 request (a task phrase, an Ask Hermes prompt, or typed chat), THE Persona SHALL reply with one in-character line stating that Hermes is not connected and can be added on the Setup_Page.
19. THE Commands_Tile SHALL contain no one-tap entry that starts the evening routine task.
20. WHERE Hermes is connected in Live_Mode, THE Task_Panel SHALL show task progress and approvals as specified in Requirement 19.
21. WHILE the Avatar is visible, THE Procedural_Animator SHALL keep the Avatar's hair hanging downward from the head and settled at rest within 2 s after the Avatar's head stops moving.
22. WHERE the hair spring-bone fix is unavailable, THE Procedural_Animator SHALL hold the hair joints in the VRM rest pose.
23. THE Capri_App SHALL provide Push_To_Talk only through the non-dominant hold-pinch gesture and SHALL render no floating mic orb.
24. WHILE Push_To_Talk is active, THE Transcript_Bubble SHALL show above the Avatar a listening animation driven by the microphone input level.
25. WHEN the STT_Engine produces a partial or final result, THE Transcript_Bubble SHALL show the result text.
26. WHEN the final result has been handled, THE Transcript_Bubble SHALL hide within 3 s.
27. WHILE the Speech_Bubble and the Transcript_Bubble are both due on screen, THE Capri_App SHALL stack the two bubbles or replace one with the other so that they do not overlap, with each bubble facing the user's head.
28. IF the microphone is not allowed or the voice model is still loading when Push_To_Talk starts, THEN THE Transcript_Bubble SHALL show the reason for 2.5 s and then hide.
29. WHILE the user's head is farther than the Comfort_Radius from the Avatar, THE Avatar SHALL keep the current position when the user moves closer.
30. WHEN the user's head comes within the Comfort_Radius of the Avatar, THE Avatar SHALL step sideways, across the head-to-Avatar direction, to a position outside the Comfort_Radius.
31. WHEN the Avatar has been outside the user's view for the follow timeout (more than 60° from the head forward for more than 3 s), THE Avatar SHALL glide back to the idle home.
32. THE Capri_App SHALL accept an Avatar destination or idle home only when the segment from the user's head to the candidate crosses no detected wall plane and the candidate lies inside the room mesh bounds.
33. IF a candidate Avatar destination or idle home fails the room check in criterion 33.32, THEN THE Capri_App SHALL pull the candidate toward the head until the room check passes.
34. WHILE the Avatar is moving, THE Avatar glide speed SHALL stay at or below 0.9 m/s.
35. WHILE the HUD_Menu is closed, THE Capri_App SHALL show no status chips, Quick_Actions panel, keyboard button, or device list panel in the scene.
36. THE Capri_App SHALL render no "Teach me your lights" orb in any mode.
37. WHILE the non-dominant palm faces the user's head (palm normal within 45° of the direction to the head), THE Capri_App SHALL show the Wrist_Button on the non-dominant wrist.
38. WHEN the dominant index fingertip pokes the Wrist_Button, THE Capri_App SHALL toggle the HUD_Menu between open and closed.
39. THE Wrist_Button SHALL respond only to a fingertip poke, because the Quest system reserves the palm-up pinch for its system menu.
40. WHEN the HUD_Menu opens, THE Capri_App SHALL place the HUD_Menu once in front of the user inside the seated zone and SHALL keep the HUD_Menu fixed in the world until it closes.
41. THE HUD_Menu SHALL be operable by fingertip poke and by ray-pinch.
42. IF the HUD_Menu receives no interaction for 30 s, THEN THE Capri_App SHALL close the HUD_Menu.
43. WHEN a HUD_Menu tile starts a flow, THE Capri_App SHALL close the HUD_Menu.
44. THE HUD_Menu SHALL contain the tiles Status, Lights, Commands, Ask Hermes, Give Hermes a task, and Close.
45. WHEN the user opens the Status tile, THE HUD_Menu SHALL show the mode, Home Assistant, Hermes, and voice Status_Indicators.
46. WHEN the user opens the Lights tile, THE HUD_Menu SHALL offer "Teach a light", "Re-teach lights", and the list of registered lights.
47. WHEN a live Hermes task runs, THE Capri_App SHALL show the Task_Panel and its approval buttons while the HUD_Menu is closed.
48. THE Capri_App SHALL keep the loading card and the hand-lost panel behaviour unchanged by the HUD_Menu.
49. THE Commands_Tile SHALL list every command type the grammar supports, grouped as Lights, Capri, and Hermes, with the exact phrase to say on each row.
50. THE Commands_Tile SHALL build the list from the phrase table, so that every command type in the phrase table appears in the list.
51. WHEN the user taps a Commands_Tile row whose command needs no parameter, THE Capri_App SHALL run that command through the same text-processing path as speech.
52. WHEN the user activates a text-entry tile, THE Capri_App SHALL open the System_Keyboard.
53. WHEN the user submits text through the System_Keyboard, THE Intent_Parser SHALL process that text as a recognised result.
54. IF the System_Keyboard is unsupported in the immersive session, THEN THE HUD_Menu SHALL hide the text-entry tiles and show a line stating that text entry is unavailable.
55. WHILE Hermes is connected, WHEN the user submits text from the Ask Hermes tile, THE Hermes_Client SHALL send the text as a chat request and THE Speech_Output SHALL show the reply in the Avatar's Speech_Bubble.
56. WHILE Hermes is connected, WHEN the user submits text from the Give Hermes a task tile, THE Hermes_Client SHALL start a long-running task and THE Task_Panel SHALL show the task steps and approvals.
57. WHEN the user says "ask hermes", THE Capri_App SHALL open the Ask Hermes prompt with the System_Keyboard.
58. WHILE Hermes is not connected, THE Ask Hermes and Give Hermes a task tiles SHALL show the label "Set up Hermes on the 2D page".
59. THE Setup_Page Hermes section SHALL contain one plain sentence stating what Hermes does in Capri.
60. THE Mock_Mode Demo_Path SHALL contain no "run my evening routine" beat and SHALL use a Commands_Tile beat or a spatial beat in its place.
61. THE README, Demo_Path, demo video plan, submission documents, and animation clips note SHALL describe the HUD_Menu, the Commands_Tile, the System_Keyboard, Ask Hermes and Give Hermes a task, the teach pointer, the Boundaryless_Space, and the Comfort_Radius behaviour, and SHALL describe the mic orb, the teach orb, and the Mock_Mode scripted Hermes routine as removed.
62. WHEN the docs change, THE repository smoke checks (`npm run check`) SHALL confirm that every README link resolves.
