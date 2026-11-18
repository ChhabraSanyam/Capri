# Performance note

This note covers the frame budget for Capri (Requirements 29.1 to 29.5, 29.11). It lists the measured cost of the scene, one run in the desktop emulator, the levers applied and not applied, the decision on depth occlusion, and the table for the Meta Quest readings.

> **Status: the Quest readings are not in yet.** Every number in the "Desktop emulator" section comes from a MacBook (Apple M1) running IWER, IWSDK's browser-based WebXR emulator. It shows that the app runs and what it draws. It says nothing about the frame time on a Quest 3 or 3S. The Quest numbers go in the [Quest readings](#quest-readings-to-be-filled-in-by-the-user) table, using the steps in [How to take the reading](#how-to-take-the-reading).

## Budget and what the overlay shows

- Target: 72 fps on Quest 3 and 3S, so 13.9 ms per frame (`FRAME_BUDGET_MS` in `src/config/constants.ts`).
- The `?perf=1` overlay (`src/ui/perf-overlay.ts`) is a small card fixed 0.7 m in front of your eyes and 0.2 m below them. It works in the hosted build and in the dev server.
  - Line 1, `avg X ms (N fps)`: the mean frame interval over the last 120 frames (about 1.7 s at 72 fps).
  - Line 2, `worst Y ms / budget 13.9`: the longest frame interval in the same 120 frames.
  - Green means at or under 13.9 ms. Red means over.
- The overlay measures the time between frames (the `dt` the frame loop receives). Quest Browser runs WebXR at the display refresh rate, 72 Hz by default. So when the app keeps up, `avg` reads about 13.9 ms and never lower. The overlay cannot show how much headroom is left. A missed frame shows up as a `worst` near 27.8 ms (two refresh intervals), and a run of them pushes `avg` above 13.9.
- If `avg` sits near 11.1 ms, the headset is running at 90 Hz. That is fine, but write down which rate you saw.

## Static cost of the scene (from the code and the model)

| Item | Cost | Source |
| --- | --- | --- |
| Avatar model (placeholder VRM) | 36,470 triangles, 24,951 vertices, 3 meshes, 13 primitives, 13 materials, 3 skins | `docs/THIRD_PARTY.md` |
| Avatar textures | 18 PNGs. `Body_00` and `Body_00_nml` are 2048×2048, all others 1024 or smaller. About 55 MB of GPU memory with mipmaps, uncompressed RGBA | `docs/THIRD_PARTY.md` |
| Avatar materials | All 13 are MToon. 7 of them (body, bottoms, shoes, tops, back hair, face, hair) have `worldCoordinates` outlines, which three-vrm draws as a second pass of the same mesh. So the Avatar is 20 draws per eye | Read from the VRM file. Outlines are not switched off in code |
| Spring bones | 22 springs, 79 joints, 13 colliders in 12 groups, plus 14 node constraints. All are simulated every frame in `vrm.update(dt)` | Read from the VRM file. `src/avatar/procedural-animator.ts` |
| Load-time trims | `VRMUtils.removeUnnecessaryVertices`, `removeUnnecessaryJoints`, `combineSkeletons`, `combineMorphs` | `src/avatar/avatar-loader.ts` |
| Lights | One hemisphere light and one directional light (MToon renders black without lights). No shadows | `AVATAR_PRESENCE.lights` |
| Hacking VFX | At most 192 active elements (`VFX_PARTICLE_CAP`): 128 sparks, 24 glyphs, 32 glitch lines in pools, plus 2 beams and 1 pulse ring. At most 5 draw calls (sparks, glyphs, lines, beams, pulse). Unlit additive materials only. Nothing is drawn when the effect is idle | `src/config/constants.ts`, `src/vfx/hacking-vfx.ts` |
| Quality governor | Rolling window of 30 frames, sampled only while the effect plays. Halves spark and glyph emission when the window averages above 12.5 ms. Goes back to full emission at the next sequence only if the last window averaged 11 ms or less. Frames over 100 ms are ignored | `VFX_RENDER.governor`, `src/vfx/quality-governor.ts` |
| UI | UIKit panels (Horizon kit): device list, Quick_Actions, Hand_Keyboard (on demand), transcript, status chips, Task_Panel (while a task runs), hand-lost card (on demand). Canvas cards: mic orb label, Teach orb, Speech_Bubble, one label per device marker, loading card, frame-time overlay. The dev panel and hand test panel appear only in a dev build or with `?dev=1` | `public/ui/*.uikitml`, `src/ui/` |
| Post-processing | None. No `EffectComposer` | Requirement 29.2 |
| Physics | Off (`features.physics: false`), so Havok is not in the bundle | `iwsdk.config.json` |
| Depth occlusion | Off (`featureFlags.depthOcclusion: false`). Depth sensing is not requested | `src/config/feature-flags.ts` |
| Framebuffer and foveation | three.js defaults: framebuffer scale 1.0, fixed foveation 1.0 (the strongest setting). The app changes neither | Read in the emulator |

### Per-frame allocation policy

The hot paths (pointing, hands, animator, VFX, UI updates) allocate nothing per frame. Vectors and typed arrays are class fields created at construction. Canvas text is redrawn only when it changes. The one exception is the frame-time overlay, which redraws its 512×128 canvas 4 times a second while `?perf=1` is on. Allocation is allowed on events only: spawning, a follow trigger, opening a bubble, a voice result.

## Desktop emulator measurement (not a Quest measurement)

**Setup.** `npx @iwsdk/cli dev up` dev server, a separate headless Chromium 1255 (Playwright) on an Apple M1 MacBook (ANGLE Metal), IWER emulating a Meta Quest 3 in the `home_office` room, Mock Mode, `https://localhost:8081/?perf=1`, frame-rate limit off. The script wraps `CapriApp.tick` to record the same `dt` the overlay samples, plus the CPU time of all frame stages (`tick`). It reads `renderer.info` for draw calls and triangles. The frame buffer was 1280×720. A Quest 3 renders about 2064×2208 per eye, so the GPU fill cost here is a small fraction of the headset's.

**Results.** Two runs on fresh pages, with idle sampled for 10 s and four hack sequences played back to back with `__capriVfx.run()`.

| Scenario | Frames | Mean interval | p95 | Worst | Mean CPU in frame stages | p95 CPU | Draw calls, both eyes | Triangles, both eyes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Idle, run 1 | 1,480 | 6.76 ms | 7.8 ms | 10.4 ms | 0.32 ms | 0.4 ms | 116 | 147,960 |
| Hack VFX ×4, run 1 | 1,738 | 6.95 ms | 7.9 ms | 131.9 ms | 0.35 ms | 0.5 ms | 116 to 128 | up to 148,680 |
| Idle, run 2 | 1,470 | 6.81 ms | 7.9 ms | 9.0 ms | 0.33 ms | 0.4 ms | 116 | 147,960 |
| Hack VFX ×4, run 2 | 1,723 | 7.01 ms | 8.2 ms | 24.4 ms | 0.37 ms | 0.5 ms | 116 to 128 | up to 148,680 |

The overlay itself read `avg 6.8 ms (146 fps)` and `worst 8.3 ms` at idle, and `avg 7.2 ms (139 fps)` and `worst 8.7 ms` during a hack. Through one hack sequence the VFX used 1 draw call (flick), 4 (beam), 5 (pulse), 2 (hold), 1 (fade) and 0 at rest, and the pool peaked at 154 of 192 elements. The governor never reduced emission here, because the emulator frame interval stayed near 7 ms.

**What this shows.**

- The 116 draw calls at idle are 58 per eye: the scene is drawn once for each eye. The Avatar is 20 of them per eye. Its 36,470 triangles plus the outline passes make about 71,000 of the 74,000 triangles per eye, so the outline passes alone are about 34,000 triangles per eye.
- The app logic is cheap. All frame stages together, including spring bones and the procedural animator, took 0.3 to 0.4 ms on the M1. Expect it to take several times longer on the Quest CPU. That has not been measured.
- The first hack sequence on a fresh page has a hitch (131.9 ms and 24.4 ms worst in the two runs), and the number of shader programs goes from 15 to 20. That is three.js compiling the VFX shaders the first time they draw. The same hitch is likely on the headset, once per page load.
- This run does not show GPU time on Quest, thermal throttling over 10 minutes, Vosk recognition cost (the emulator run had no microphone), or depth occlusion cost.

## Findings for the Quest reading

1. **The quality governor will probably always halve emission at 72 Hz.** The governor averages the frame interval. At 72 Hz that interval is about 13.9 ms even when the app is on budget, which is above the 12.5 ms trip point. So after the first 30 frames of the first hack, sparks and glyphs drop to half and stay there, because recovery needs 11 ms or less and 72 Hz never gets there. The effect stays visible (it was designed to work at half emission), so this is not a comfort or correctness problem. But it means the governor does not do what the design intends. Nothing was changed, because the design fixes the 12.5 ms value and the device reading should decide the fix. A likely fix after the reading: trip when the window averages more than about 14.6 ms (roughly one missed frame in 20 at 72 Hz) and recover at 14.0 ms or less. Check `__capriVfx.stats().quality.reduced` in a dev build to confirm.
2. **MToon outlines double the Avatar's triangle count.** This is design lever 1 and the first thing to apply if the Quest reading is over budget.
3. **First-hack shader compile hitch.** If it shows on the headset as a visible stutter on the first hack, compile the VFX materials during loading, for example with `renderer.compileAsync` while the effect is hidden. Not applied.

## Levers

Applied:

- VRM trims at load (unused vertices and joints removed, skeletons and morphs merged).
- No post-processing, no shadows, no physics, unlit additive VFX with hard caps and a quality governor.
- three.js default fixed foveation (1.0, the strongest setting).
- Glitch jump of the hacking beams halved from 2 cm to 1 cm (`VFX_RENDER.beam.glitchM`). This was done for photosensitivity margin, not frame time. See `docs/comfort-check.md`.

Not applied yet. These are the design levers in order, to use only if the Quest reading is over budget:

1. MToon outlines off (`outlineWidthMode: none`). Saves 7 draws and about 34,000 triangles per eye.
2. Fewer spring bones and colliders. Turn springs off outside the gestures that need them. There are 22 springs and 79 joints today.
3. Lower framebuffer scale (`renderer.xr.setFramebufferScaleFactor`, set before the session starts). Foveation is already at the strongest setting.
4. Swap MToon for a toon-lite `MeshLambertMaterial` or `MeshBasicMaterial` on the same textures.
5. Halve the VFX caps through `QualityGovernor` (see finding 1 first).

Model-side lever, outside the code: shrink the two 2048 body textures to 1024 and drop the unused normal maps. Each 2048 map is about 22 MB with mipmaps, so this takes texture memory from about 55 MB to about 16 MB (`docs/THIRD_PARTY.md` has the starting figures).

## Depth occlusion decision

**Depth occlusion stays off by default.** It works on Quest (spike: 2411 of 2412 frames had depth data, and a stand-in hid behind the user's hand), but its frame time has never been measured on the headset. The emulator cannot measure it either: IWER's depth data and its GPU cost are not those of Quest. The design says to leave the flag off until the Frame_Budget is shown to hold with it on, and nothing has shown that yet. If the "depth occlusion on" rows in the table below hold at about 13.9 ms average with no regular 27.8 ms worst frames, set `depthOcclusion: true` in `src/config/feature-flags.ts`. Otherwise it stays off. Either way, depth never gates any other feature (Requirement 29.11).

## Quest readings (to be filled in by the user)

> **Placeholder. No value below has been measured yet.** Replace each `TBD` with the overlay reading from the headset. Do not copy the emulator numbers into this table.

Headset: `TBD` (Quest 3 or 3S). Quest Browser version: `TBD`. Refresh rate seen (72 or 90 Hz): `TBD`. Build: `TBD` (hosted link or dev server).

| Scenario | Depth occlusion | avg (ms) | worst (ms) | Overlay colour | Notes |
| --- | --- | --- | --- | --- | --- |
| Idle, Capri in view, 30 s after Enter AR | off | TBD | TBD | TBD | |
| During the hack VFX (first hack after a reload) | off | TBD | TBD | TBD | |
| During the hack VFX (second or later hack) | off | TBD | TBD | TBD | |
| During Vosk recognition (holding push-to-talk and speaking) | off | TBD | TBD | TBD | |
| Idle after 10 minutes in the session | off | TBD | TBD | TBD | Thermal check |
| Idle, Capri in view | on | TBD | TBD | TBD | Dev build with the flag on |
| During the hack VFX | on | TBD | TBD | TBD | Dev build with the flag on |

## How to take the reading

1. **Open the page with the overlay.**
   - Hosted build: in Quest Browser open `https://capri.sanyamchhabra.in/?perf=1`.
   - Dev server: run `npm run dev`, then run `npx @iwsdk/cli dev status` and open one of the `runtimeUrls.network` addresses with `?perf=1` added, for example `https://192.168.1.107:8081/?perf=1`. Accept the local certificate warning. Over USB instead: run `adb reverse tcp:8081 tcp:8081` and open `https://localhost:8081/?perf=1`.
2. **Prepare as for the demo.** Put the controllers down so hand tracking is on. Tap **Enable microphone** and allow it. Wait for **Voice model ready.** Look straight ahead and tap **Enter AR**.
3. **Find the overlay.** It is a small dark card with green or red text, just below the centre of your view. It moves with your head. It is the only thing in Capri that does.
4. **Idle.** Wait 30 seconds after Capri waves. Look at her and keep your head still for 10 seconds. Write down the `avg` value you see most of the time, and the highest `worst` value you see in those 10 seconds.
5. **During the hack VFX.** Reload the page first, enter AR again, and wait for idle. Point your right index finger at a bulb, pinch and hold with your left hand, say "turn on that", and let go. Watch the overlay while the beams fly. The effect lasts about 2 seconds, so the `worst` value matters most here. Write down the first hack on its own line, then do two more hacks and write down the highest `avg` and `worst` from those.
6. **During Vosk recognition.** Pinch and hold with your left hand and say a longer command, for example "run my evening routine". Read the overlay while you speak and for about 2 seconds after you let go, while Capri is still recognising.
7. **After 10 minutes.** Stay in the session for 10 minutes. Use Capri now and then or just look around. Then repeat step 4.
8. **Depth occlusion on (dev server only).** Set `depthOcclusion: true` in `src/config/feature-flags.ts`, save, and wait for the dev server to reload. Do not commit or deploy this change. Open the dev URL with `?perf=1`, repeat steps 4 and 5, and write the results in the "on" rows. Put the flag back to `false` afterwards. If you would rather not edit code, say so and the developer will make the change for that one test.
9. **What counts as on budget.** At 72 Hz: `avg` close to 13.9 ms and green, and `worst` mostly under about 20 ms. One 27.8 ms `worst` now and then (for example on the first hack) is a single dropped frame. If `avg` stays above 13.9 ms or turns red, the build is over budget, and the levers above are applied in order.
10. **Note anything else you see:** stutter, a visible drop in the effect, the headset getting warm, or the refresh rate if `avg` reads near 11.1 ms.
