# Animation clips: hand-off note (task 31.5)

This note covers the OPTIONAL retargeted animation clips (Requirement 32). It tells you what to check on
the Quest, how to add a clip, how to remove the clips, and one CC0 wave clip you could add.

## What ships

- **One clip, for idle only.** `public/animations/idle.vrma` is `idle_loop.vrma` from
  [pixiv/ChatVRM](https://github.com/pixiv/ChatVRM), MIT, with the notice in
  `public/animations/LICENSE-idle.txt`. License, source commit, and SHA-256 are in
  [`THIRD_PARTY.md`](THIRD_PARTY.md), section "OPTIONAL animation clips".
- **Every gesture stays procedural.** Wave, point, flick, celebrate, tease, shrug, sit, and perch use the
  procedural animator. The reasons per gesture are in the `THIRD_PARTY.md` table "Gestures without a clip,
  and why". In short, point and flick aim at a runtime target, and no permissive clip was better than the
  procedural wave, celebrate, tease, or shrug.
- **Library:** `@pixiv/three-vrm-animation` pinned to exactly 3.5.5 in `package.json`. It retargets the
  clip's humanoid rotation tracks onto the Avatar's VRM bones. A `.vrma` file is a VRM Animation: a glTF
  file holding motion for the standard VRM humanoid bones, so one file fits any VRM model.
- **How the idle clip plays.** It is a base pose layer under the procedural layers
  (`src/avatar/procedural-animator.ts`, `setBaseLayer`). It replaces the procedural rest pose and breathing
  only while she is free and still. It crossfades out (spring, `ANIMATOR.baseLayerSmoothTimeS` = 0.25 s in
  `src/config/constants.ts`) when any gesture other than `glance` starts, and while she is moving, sitting,
  perching, or acting. The rule is `idleBaseAllowedInMode` and `idleBaseGoal` in
  `src/domain/idle-base-gate.ts`. Look, blink, mouth, and expressions stay procedural on top of it.
- **When it loads.** Lazily, after the Avatar has spawned (`attachClips` in `src/avatar/gesture-router.ts`,
  called from `src/avatar/avatar-presence.ts`). The clip code and the library sit in their own chunk. Until
  the clip arrives, or if it fails, she uses the procedural idle, and the console logs
  `idle clip ready in … ms` or `idle clip unavailable, keeping the procedural idle`.
- **Switches.** `featureFlags.clipIdle` in `src/config/feature-flags.ts` is `true`. In a dev build,
  `?clipidle=0` turns the clip off and `?clipidle=1` turns it on for one page load. Production builds
  ignore the parameter and use the flag.
- **Routing.** `src/avatar/gesture-router.ts` finds the clip module with
  `import.meta.glob('./clips/index.ts')`. It sends a gesture to a clip only when that clip is loaded,
  and otherwise to the procedural gesture.

## What to test on the Quest

**Open on Quest:** run `npm run dev`, then open `https://<LAN-IP>:<port>/` in Quest Browser (accept the
local certificate warning), or run `adb reverse tcp:<port> tcp:<port>` and open `https://localhost:<port>/`.
`npx @iwsdk/cli dev status` lists the network URLs under `data.runtimeUrls.network`. Add `?perf=1` to show
the frame-time overlay, for example `https://<LAN-IP>:<port>/?perf=1`.

| Check | How | What you should see |
| --- | --- | --- |
| Idle clip visible when idle | Enter AR, let the arrival wave finish, then watch her for 15 s without input | A slow weight shift from one leg to the other and visible breathing in the torso and shoulders, looping about every 10 s. Her eyes and head still follow you. The console shows `idle clip ready in … ms (… bones)` |
| Wave crossfade | Exit AR with the Meta button and tap **Enter AR** again without reloading. She waves on each later spawn, now with the clip already loaded | The body eases from the clip pose into the wave and back over about a quarter second. No snap or one-frame jump of the arms, spine, or hips at the start or end |
| Celebrate crossfade | Point at a bulb and say **"turn that on"** (or poke **Turn on** on Quick actions) | The flick, then the celebrate, each start and end without a pop. Between them she settles back into the idle clip |
| Sit and perch stay procedural | Say **"sit on the desk"**, or poke **Sit on table** or **Perch on table** on the dev panel (shown in dev builds, or with `?dev=1`). Needs a desk or table in Space Setup | The glide and the seated pose look the same as with `?clipidle=0`. The idle clip does not play while she moves, sits, or perches, and fades back in after **Come here** |
| Compare with the clip off | Reload the dev URL with `?clipidle=0` (or `?clipidle=0&perf=1`) and repeat the checks | The procedural idle: breathing and small sways, no leg weight shift. Every gesture looks identical to the clip-on run apart from the start and end blend |
| Frame time | Keep `?perf=1` on for both runs, about a minute each, idle and during a hacking effect | The overlay stays within the 13.9 ms budget (72 fps) with the clip on, close to the `?clipidle=0` reading. Note both values in [`performance-note.md`](performance-note.md) if they differ |

Gestures you may also notice: idle stretches, fidgets, and the 60 s ignored reaction also fade the clip out
while they play. A `glance` keeps the clip on, because it only turns the head and eyes.

## How to add another clip

1. **Check the license at the primary source.** Read the license on the author's own page and in any file
   inside the download. Use only CC0, MIT, or a license that allows redistributing the raw file in a public
   repository and on a static site. Those files can be downloaded by anyone, which is why the VRoid Project
   set and Mixamo were rejected (see `THIRD_PARTY.md`). Record the source URL, author, license, and
   SHA-256 in a new row of `THIRD_PARTY.md`, ship any required notice next to the file (as
   `LICENSE-idle.txt` does), and add a line to the README "Third-party assets" list.
2. **Put the `.vrma` in `public/animations/`.** It must be a VRM Animation file (`VRMC_vrm_animation`).
   An `.fbx` or plain glTF clip has to be converted to `.vrma` first. Keep only bone rotations that make
   sense on Capri: the app drops the hips position track, because locomotion owns her position.
3. **Register it in the clip module, `src/avatar/clips/index.ts`.** Add an `assetUrl('animations/<name>.vrma')`
   constant next to `IDLE_CLIP_URL` and load it with `createVrmaLoader()` and `vrmAnimationFrom()`, as
   `loadIdleClip` does.
   - For an idle variant, retarget it with `createClipPoseLayer` and return it from `loadIdleClip`.
   - For a gesture, export `loadGestureClips(vrm)` returning a `ClipAnimator` (the interface in
     `src/avatar/gesture-router.ts`): `has(g)` is true only for gestures whose clip loaded, and
     `play`, `stop`, `update`, `releasePosture`, and `dispose` drive the playing clip. Do not add clips for
     `point` or `flick`, which must aim at a target and report the flick release marker.
4. **The router picks it up.** `GestureRouter.attachClips` calls `loadGestureClips` when the module exports
   it, and from then on routes each gesture with a loaded clip to it. Gestures without one stay procedural.
   No other file changes.
5. **Verify.** Run `npm run --if-present typecheck`, `npm test -- --run`, `npm run build`, and
   `npm run check`. The smoke check's "required assets present" rule reads every `assetUrl('...')` literal in
   `src/`, so it fails if the new file is missing from `dist/`. Then repeat the Quest checks above.

## How to remove the clips safely

Remove the clip module and the clip file **together**:

```sh
rm -r src/avatar/clips
rm public/animations/idle.vrma public/animations/LICENSE-idle.txt
```

With both gone, the gesture router's glob is empty, the app builds and runs fully procedural, the clip tests
in `tests/unit/clip-animator.test.ts` skip themselves, and `npm run check` passes. Also delete the idle clip
rows from `THIRD_PARTY.md` and the README "Third-party assets" list, and optionally
`npm uninstall @pixiv/three-vrm-animation`.

To turn the clip off without deleting anything, set `featureFlags.clipIdle` to `false`.

**Do not delete only `idle.vrma`.** The clip module still declares `IDLE_CLIP_URL`, so the smoke check
requires `animations/idle.vrma` in `dist/`. `npm run check` then fails with 21 of 22 checks passing (the
"required assets present" check fails). The Vercel build runs `npm run check` after `vite build`
(`build:vercel` in `package.json`), so that deploy fails and the previous production deployment stays live.

## Optional: a CC0 wave clip from BOOTH

rerofumi's motion set "使いどころに困るモーションセット" (fumi2kick) on BOOTH,
https://booth.pm/en/items/5527394, is listed as CC0, with modification and redistribution allowed and no
credit required. It contains `004_hello_1`, a greeting that could replace the procedural wave. BOOTH needs
a signed-in pixiv account to download, so the files have not been inspected.

If you want to try it:

1. Sign in to BOOTH, download `fm_vrma_motion_pack_01.zip`, and check that the license text inside the zip
   matches the page (CC0).
2. Put `004_hello_1.vrma` in `public/animations/` (for example as `wave.vrma`) and tell the agent. It then
   follows "How to add another clip": a `THIRD_PARTY.md` row with the SHA-256, a `loadGestureClips` that
   provides `wave`, and the Quest wave check above.
3. Compare it on the Quest with the procedural wave and keep whichever looks better. Keep the procedural
   wave if the clip has no finger or torso motion, as with the CC0 candidates already rejected.
