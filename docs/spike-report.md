# Spike report

Milestone 0 results. The file starts with the pre-flight desk checks from task 1.2, which run on the development machine without a headset. The headset results (items (a) to (e)), the capability flags, and the assumption register status follow, compiled by task 1.10 from the report the user pasted after running the full spike on a real Meta Quest 3.

## Pre-flight desk checks (task 1.2)

Environment: macOS, Node v26.8.1, npm 11.19.0. The scaffold's `.nvmrc` says 22.12.0 and `engines` allows `>=20.19 <21`, `>=22.12 <23`, or `>=24`.

### Pinned versions

| Package | Pinned version | Where |
|---|---|---|
| `@iwsdk/core` | **1.1.0** (exact, no caret) | `dependencies` |
| `@iwsdk/cli`, `@iwsdk/vite-plugin-dev`, `@iwsdk/reference` | 1.1.0 | `devDependencies` |
| `@iwsdk/create` (scaffolder) | 1.1.0 | one-off |
| `three` | `npm:super-three@0.185.0` (npm `overrides` too) | `dependencies` |
| `@pixiv/three-vrm` | 3.5.5 (exact) | `dependencies` |
| `vosk-browser` | 0.0.8 (exact) | `dependencies` |
| `vite` | `^7.1.4` (7.3.8 installed) | `devDependencies` |

Scaffold command and options:

```bash
node <@iwsdk/create@1.1.0>/dist/cli.js capri-scaffold --yes --target ar --language ts \
  --no-git --no-install --no-grabbing --no-physics --scene-understanding --environment-raycast \
  --skip-reference-warmup
```

The files were then copied into the repository root without overwriting anything, and `npm install` was run. The resulting `iwsdk.config.json` has `world.xr.mode: "ar"`, `handTracking`, `anchors`, `planeDetection`, `meshDetection`, `hitTest`, and `world.features` with `locomotion: false`, `grabbing: false`, `physics: false`, `sceneUnderstanding: true`, `environmentRaycast: true`, `spatialUI`.

### Results against the assumptions

| ID | Assumption | Result | Evidence and notes |
|---|---|---|---|
| A1 | IWSDK 1.1.x behaves as documented | **Confirmed on desktop** | Scaffold created with `@iwsdk/core@1.1.0` (`npm view`: `latest` is 1.1.0, `next` is 1.2.0-rc.0). `npm run typecheck` and `npm run build` pass. In IWER, `xr enter` starts an `immersive-ar` session with enabled features `local-floor`, `bounded-floor`, `hand-tracking`, `anchors`, `hit-test`, `plane-detection`, `mesh-detection`. Headset behaviour is decided by items (a) and (b). |
| A2 | One copy of `three` | **Confirmed, no change needed** | `npm ls three` shows only `three@npm:super-three@0.185.0` in every branch, including every `@pixiv/three-vrm-*` package. A production build importing `GLTFLoader` from `three/addons/loaders/GLTFLoader.js`, `VRMLoaderPlugin`, `VRMUtils`, and `vosk-browser` succeeded, and the bundles contain one three revision marker (`"185"`). The scaffold's `vite.config.ts` already sets `resolve.dedupe` for `three` and the `@pmndrs/uikit*` packages, so nothing was added. |
| A8 | `vosk-browser@0.0.8` bundles under Vite and loads a model from the same origin | **Confirmed in desktop Chromium** | Build succeeds. In headless Chromium 159 (Playwright) served over HTTPS from `vite preview`, `createModel('/vosk/vosk-model-small-en-us-0.15.tar.gz')` resolved in about 0.9 s, a `KaldiRecognizer(16000, grammar)` with the grammar `["turn on","turn off","come here","[unk]"]` was created, 1.5 s of silence was accepted, and `remove()` and `terminate()` ran without errors. This is a desktop result only. Load time on the Quest is measured in item (d). |
| A14 | IWER hand emulation cannot pose individual fingers | **Not confirmed. The opposite looks true for this IWER version.** | The IWSDK CLI exposes `xr set-hand-pose` with named poses (`point`, `pinch`, `open`, `fist`, and others) and per-finger overrides, plus `xr get-hand-state` with wrist, index-tip and thumb-tip positions. Step 5 can probably drive pointing through IWER without the dev-only `FakeHands` provider. Keep `FakeHands` as the fallback until Step 5 checks that a `point` pose gives a usable index-tip and proximal direction. This does not change the plan or the order. |
| A18 | The official model archive needs repackaging | **Confirmed, and simpler than assumed** | `vosk-model-small-en-us-0.15.zip` (41.2 MB) already contains `conf/model.conf` and `conf/mfcc.conf`, so no config file has to be written. The only repackaging is zip to `tar.gz` with a top-level folder (we use `model/`, matching the vosk-browser README). vosk-browser logs `strip_first_component: true`, so the folder name is not significant. The macOS `tar` adds `._*` AppleDouble entries unless `COPYFILE_DISABLE=1` is set, and the tool sets it. `tools/fetch-vosk-model.ts` (`npm run fetch:vosk`) writes `public/vosk/vosk-model-small-en-us-0.15.tar.gz` (41.2 MB, git-ignored). |

### Other pre-flight checks

| Check | Result |
|---|---|
| Root base path (Requirement 30.2) | The scaffold used `base: './'`. It is now `base: '/'` in `vite.config.ts`. `vite build` then `vite preview` over HTTPS: every `href` and `src` in the built HTML, every `assets/*` chunk referenced from the bundles, and every file copied from `public/` returned HTTP 200 from the root (18 of 18). No asset URL is relative to the page. |
| Emulator rooms | `dev.emulator.environment` is `home_office` (changed from the scaffold's `sunlit_living_room`). With the dev server and the managed headless Chromium running, `xr enter` started the session and `ecs find` returned **13 `XRPlane` entities** and **9 `XRMesh` entities**. The raw `XRPlane` component value only exposes `_plane` as an opaque object through the CLI, so semantic labels were not read here. |
| `three-vrm` import | Builds and bundles (see A2). A real VRM load is tested in Step 2. |

### Findings that affect later tasks

1. **`words.txt` is not in the small model.** The official `vosk-model-small-en-us-0.15` archive contains `am/`, `conf/`, `graph/{Gr.fst,HCLr.fst,disambig_tid.int,phones/word_boundary.int}`, and `ivector/`. It has no `graph/words.txt` and no `graph/phones.txt`. Task 9.2's `tools/build-lexicon.ts` ("produce the lexicon from the model `words.txt`") needs another source for the word list, for example the word symbol table inside `HCLr.fst`/`Gr.fst`, or a separate pronunciation lexicon. Decide this in task 9.2. It also bears on A9 (which grammar words are in the vocabulary), which item (d) tests on the headset.

   **Resolved in task 9.2.** `graph/Gr.fst` (the language model) embeds the decoder's word symbol table in its OpenFst header. The table is named `exp/chain_a/tdnn/lgraph/words.txt` and holds 152,217 symbols. `tools/build-lexicon.ts` (with the parser in `tools/fst-symbols.ts`) reads it straight from the model archive, keeps plain lowercase words (letters and inner apostrophes), and writes 152,035 words to `public/vosk/lexicon.txt` (git-ignored, about 1.3 MB). It uses `graph/words.txt` first if a future model ships one. Run `npm run fetch:vosk` and then `npm run build:lexicon`; the Vercel build (task 19.5) must run both. `HCLr.fst` has no symbol table in its header, so it is not used. The table is the language-model vocabulary, which is the decoder's own word list, but whether `HCLr.fst` pronounces every one of those words was not checked. Spot checks: `lamp`, `light`, `bedside`, `kitchen`, `couch`, `sofa`, `desk`, `bulb`, `hue`, `ikea`, and `tv` are present, while brand names such as `lifx`, `nanoleaf`, and `govee` are not, so those device names get nickname choices. Until the runtime adapter loads `lexicon.txt`, `src/domain/speech-lang/lexicon.ts` uses a small hand-curated `FALLBACK_LEXICON`.
2. **The scaffold template contains demo content** (`src/robot*.ts`, `src/panel.ts`, `public/ui/*.uikitml`, `public/audio/chime.mp3`, two scene-asset files, and stock assets loaded from a jsDelivr CDN URL in `src/assets.ts`). Task 3.3 replaces `src/index.ts` with `src/main.ts`. The CDN reference conflicts with the "no hard-coded origin" rule (Requirement 30.8) unless it is removed in the same task.
3. **`public/**/AGENTS.md` files are copied into `dist/`** by Vite (for example `dist/ui/AGENTS.md`). They are harmless, but the Vercel build (task 19.5) should not ship them. **Resolved in task 19.5:** the `capri:drop-public-agents-files` plugin in `vite.config.ts` removes them from `dist/` after the copy.
4. **The scaffold added files for several AI harnesses** (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/`, `.codex/`, `.github/`, `.agents/`). They are left in place.
5. **IWSDK dev workflow.** `npm run dev` runs `iwsdk dev restart --open --foreground`, which opens a managed Chromium window (installed on first use through Playwright, about 190 MB). The dev server is HTTPS on port 8081 with the network URLs shown in `iwsdk dev status`.
6. **`@meta-quest/metavr`** is a scaffolded dev dependency that collects usage data under the Meta Platform Technologies SDK License. It is not used by the product. Remove it with `npm uninstall @meta-quest/metavr` if the user prefers.
7. **`npm audit`** reports 3 high-severity advisories in transitive dependencies after install. Not reviewed or changed.

## Milestone 0 headset results (task 1.10)

Device and browser: Meta Quest 3, Quest Browser `OculusBrowser/156`. Source: the report the user pasted after running the full spike on the headset. Every number below comes from that report. Nothing was measured on any other device.

### Verdicts

- (a) AR session, passthrough, hand joints: **works**
- (b) Planes, labels, mesh, anchors, hit-test, depth: **works**
  - planes: works
  - semantic labels: works
  - mesh detection: works
  - anchors: works
  - hit-test: works
  - depth occlusion: works
- (c) Microphone during the AR session: **works**, with one constraint (see below)
- (d) Vosk speech recognition (restricted grammar): **works**
- (e) speechSynthesis voices: **does not work**

### Item (a): immersive AR, passthrough, hand joints

| Measurement | Value |
|---|---|
| `environmentBlendMode` | `alpha-blend` |
| Hand tracking granted | yes |
| Joints per hand | 25 of 25, both hands |
| Controller seen | no |
| Input sources | both `hand`, each with `gamepad` present and `targetRayMode` `tracked-pointer` |
| `xrOrigin.indexTipSpaces` vs the `index-finger-tip` joint | mean 0.0 mm, max 0.0 mm over 670 frames |
| Seconds to stable tracking | 1.5 |

Note: the design says hand input sources have no gamepad. On this device they do. The harness still passed because the pass rule is "both hands report poses, no controller connected".

### Item (b): scene understanding

| Measurement | Value |
|---|---|
| Features granted | planes, meshes, anchors, hitTest, depth: all yes |
| Plane entities, max | 15 |
| Mesh entities, max | 8 |
| Semantic label peak counts | ceiling 1, couch 2, door 1, floor 1, shelf 1, table 6, wall art 2, wall 4 |
| Labels available on | planes and meshes |
| Hit-test | 2 hits, 0 empty |
| Anchor creation method | `XRHitTestResult.createAnchor` |
| Persistent handle API | yes |
| Depth frames with data | 2411 of 2412 |
| Floor label Y / floor hit Y / difference | -0.034 m / -0.012 m / 22 mm |
| Floor stand-in source | the label "floor" plane |
| Label under the floor pinch / table pinch | floor / table |
| Table top above floor | 0.72 m |
| Stand-in avatar placement | on the floor; at the table hit |
| `anchor_floor` | 1998 good frames, 0 lost, 3 mm drift |
| `anchor_table` | 1540 good frames, 0 lost, 2 mm drift, persistent handle saved |
| Depth occlusion (user answer) | the stand-in hid behind the user's hand, so occlusion works |
| Persistent restore after page reload | restored in place, restore distance 95 mm |

### Item (c): microphone inside the AR session

| Measurement | Value |
|---|---|
| Secure context | yes |
| Permission result | granted |
| Track sample rate | 48000 Hz, mono |
| Echo cancellation, noise suppression, auto gain control | all applied |
| `AudioContext` | running at 48 kHz |
| Session visibility | `visible` at start and at end |
| Session object unchanged | yes |
| XR frames during capture | 177, max gap 19 ms |
| Peak level | -19 dBFS |
| Seconds to first voice | 1.5 |

**Constraint.** An earlier attempt lost the AR session while the microphone permission prompt was open. The first permission prompt inside the AR session therefore ends the session. A later attempt succeeded once permission was already granted. Request microphone permission on the 2D setup page before Enter AR.

### Item (d): Vosk with a restricted grammar

| Measurement | Value |
|---|---|
| Model | `vosk-model-small-en-us-0.15`, 39.3 MB gzip tarball, served by the LAN dev server |
| Cold load | `libraryImportMs` 2510, `loadSeconds` 26.03, IndexedDB cache absent |
| Recognizer creation after load | 26 ms |
| Capture method | `AudioWorklet`, max capture lag 56 ms |
| Audio blocks | 2151 captured, 1812 passed to Vosk |
| "turn on" | 10 of 10 |
| "turn off" | 9 of 10 (misheard as "turn on turn off") |
| "come here" | 9 of 10 (misheard as "turn on turn off") |
| Overall | 28 of 30 (93%) |
| Correct results with an extra `[unk]` | 0 of 28 |
| Out-of-grammar "set a timer for five minutes" | 3 of 3 rejected as `[unk]` |
| Chaining probe (fragment grammar, "turn off that") | works, 3 of 3 |
| Suggested grammar strategy | `fragments` |
| Prompt to result, median | 2490 ms |
| Recreate, small grammar | 157, 146, 2, 5, 2, 2 ms (median 4, max 157) |
| Recreate, large grammar (33 phrases) | 3, 5 ms |
| Recreate under the 1000 ms budget | yes |
| XR frames | 16497; max frame gap 75 ms while loading, 41 ms while recognising |

How the harness fed audio (read from `src/spike/items/d-vosk.ts` and `d.ts`, not from the pasted report): it used a default `AudioContext`, so the recognizer was created at the context rate (48 kHz) and given the samples with `acceptWaveformFloat`. No 16 kHz context was tried.

### Item (e): speechSynthesis

| Measurement | Value |
|---|---|
| `window.speechSynthesis` | missing |
| `SpeechSynthesisUtterance` class | missing |

Failure: `window.speechSynthesis` does not exist in Quest Browser, so no voice can be listed or rated.

Workaround (the design's cheapest, tier 3): show a speech bubble and play a chirp for dynamic text. The tier 1 pre-generated voice library stays the primary voice and is used for the canned lines. Free-form replies, including dynamic Hermes replies, appear as a bubble with a chirp. The `speechSynthesis` tier is disabled by the capability flag `ttsUsable: false`.

Confirmation status: the workaround is the design's own tier 3 and the user's report states this consequence. No separate confirmation message was recorded in the pasted report.

### Capability flags

Recorded in `src/config/feature-flags.ts`.

| Flag | Value | Reason |
|---|---|---|
| `anchorsWork` | `true` | Anchors held with 0 lost frames. Persistent handle saved and restored after reload (95 mm off). |
| `semanticLabelsWork` | `true` | Labels present on planes and meshes. |
| `meshWork` | `true` | 8 meshes at peak. |
| `hitTestWork` | `true` | 2 hits, 0 empty. |
| `micInSession` | `true` | Capture works in the session once permission is already granted. The first prompt inside the session lost the session. |
| `voskWorks` | `true` | Loads and recognises on the headset, 28 of 30. |
| `grammarStrategy` | `'fragments'` | Chaining worked 3 of 3. |
| `pointPoseGate` | `true` | The spike has no data on the gate, so the design default (on) stays. Step 5 decides. |
| `ttsUsable` | `false` | `speechSynthesis` is missing. |
| `ttsVoiceURI` | `undefined` | No voice exists. |

### Assumption register status after the headset spike

| ID | Status | Evidence and what it changes |
|---|---|---|
| A1 | **Confirmed on headset** | `immersive-ar` with hand tracking, anchors, hit-test, planes, meshes, and depth were granted on Quest Browser 156. No change. |
| A3 | **Confirmed** | 25 of 25 joints on both hands. `xrOrigin.indexTipSpaces` equals the `index-finger-tip` joint (0.0 mm over 670 frames), so it is a usable second source for the index tip. The fallback (ray/grip spaces) is not needed. |
| A4 | **Confirmed** | Labels are populated on planes and meshes. The manual tagging fallback is not needed. Raw labels seen include `wall art`, which is not in the design's label set and must map to `other`. Six table-labelled entities appeared at peak, so Step 3 needs a rule for choosing among several tables. |
| A5 | **Confirmed, with a measured error** | A persistent anchor was restored in place after a page reload, 95 mm from where it was saved (one measurement). In-session drift was 2 to 3 mm. `AnchorDeviceStore` is the primary store. `localStorage` stays as the fallback and "Re-teach lights" stays visible. The `bounded-floor` fallback is not needed. |
| A6 | **Premise not borne out, not resolved** | Both hand input sources have a `gamepad` and `tracked-pointer` mode. Whether the IWSDK multipointer activates for hands was not tested. Keep the own-pinch fallback and check panel interaction in Step 1. |
| A7 | **Confirmed with a constraint** | `getUserMedia` works in the session once permission is granted. The first permission prompt inside the session lost the AR session. The design's fallback "request permission on the Setup page before Enter AR" is now required, not optional. A 16 kHz `AudioContext` was not tried. The recognizer ran at the 48 kHz context rate. |
| A8 | **Confirmed on headset** | `vosk-browser@0.0.8` loaded the model on the Quest and recognised speech. The self-hosted UMD fallback is not needed. |
| A9 | **Partly confirmed** | The small model accepted dynamic grammars (the 4-phrase grammar, the fragment grammar, and a 33-phrase grammar) and rejected out-of-grammar speech as `[unk]`. Whether out-of-vocabulary grammar words are dropped with a warning was not reported. The missing `words.txt` finding from pre-flight is still open for task 9.2. |
| A10 | **Confirmed** | Fragment chaining gave "turn off that" 3 of 3. `grammarStrategy` is `fragments`. |
| A11 | **Confirmed** | Recreate max 157 ms (the first one), median 4 ms. The large grammar took 3 and 5 ms. All are under 1000 ms. No debounce change and no pre-building of the next recognizer is needed. |
| A12 | **Confirmed, worse than "may be absent"** | `speechSynthesis` and `SpeechSynthesisUtterance` are missing. Tier 2 is disabled and tier 3 (bubble and chirp) carries all dynamic text. The synthetic mouth flap for tier 2 has no use on this device. |
| A14 | **Unchanged** | It concerns IWER on the desktop. The headset spike does not test it. The pre-flight finding stands. |
| A16 | **Not tested**, with data for later | The spike did not measure MToon or spring bones. Frame gaps seen: 19 ms during mic capture, 75 ms while the Vosk model loaded, 41 ms while recognising. Step 2 still owns A16. Step 6 should look at the 41 ms gap with `?perf=1`. |
| A18 | **Confirmed on headset** | The repackaged `tar.gz` model loaded and recognised on the Quest. |
| A2, A13, A15, A17, A19, A20 | **Not tested** | The spike does not cover them. |

### Plan for the failed item and the constraints

- Item (e) failed. The plan is tier 3 for dynamic text (bubble and chirp) and tier 1 (voice library) for canned lines. No further time goes into `speechSynthesis`.
- Item (c) passed with a constraint. The Setup_Page requests microphone permission before Enter AR. If permission is not granted there, the app shows Quick_Actions and Hand_Keyboard and does not prompt inside the AR session.
- The Vosk model took 26.03 s to load cold over the LAN dev server, with no cache. It must load on the Setup_Page before Enter AR, as the design already says. The warm-cache load time and the load time from Vercel were not measured.
- The anchor restore error of 95 mm is a single measurement. The design has no numeric tolerance for it. It is smaller than the 0.15 m minimum hit-volume radius, so pointing at a restored marker should still select it. The marker itself can sit about 10 cm from the lamp until "Re-teach lights".
