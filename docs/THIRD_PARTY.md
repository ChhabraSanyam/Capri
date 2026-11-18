# Third-party assets

## Placeholder Avatar model

| Field | Value |
|---|---|
| File in this repository | `public/models/capri.vrm` (unmodified copy) |
| Model name | VRM1_Constraint_Twist_Sample (VRM meta `version` v1.0.1) |
| Author | pixiv Inc. |
| Copyright | (c) 2022 pixiv Inc. |
| Source | VRM Consortium sample models: https://github.com/vrm-c/vrm-specification/tree/master/samples/VRM1_Constraint_Twist_Sample |
| Direct file | https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm |
| License | VRM Public License 1.0 (https://vrm.dev/licenses/1.0/) |
| Attribution | Not required by the licensor (`creditNotation: unnecessary` in the VRM meta). It is credited here and in the README anyway. |
| SHA-256 of the file | `12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2` |

### License terms read from the model's own VRM meta

These values come from the `VRMC_vrm.meta` block inside the file, which is what the VRM Public License
calls the License Settings.

| Setting | Value | Meaning for Capri |
|---|---|---|
| `avatarPermission` | `everyone` | Anyone may use it as an avatar. |
| `commercialUsage` | `corporation` | Commercial use allowed, including by companies. |
| `allowRedistribution` | `true` | The file may ship in this repository and in the hosted site. |
| `modification` | `allowModificationRedistribution` | Modified copies may be redistributed. |
| `creditNotation` | `unnecessary` | No credit is required. |
| `allowAntisocialOrHateUsage` | `false` | Capri must not be used for antisocial or hate expression. |
| `allowExcessivelyViolentUsage`, `allowExcessivelySexualUsage`, `allowPoliticalOrReligiousUsage` | `true` | Permitted. |

Other conditions from the VRM Public License 1.0: the model is provided as-is with no warranty (Section 4),
and nothing may imply that pixiv endorses Capri (Section 2(a)(8)). The license grants the right to
redistribute the file, so shipping it in `public/models/` is allowed. This copy is unmodified.

### Cost on Quest (measured from the file, not on a headset)

| Measure | Value |
|---|---|
| File size | 10.8 MB (10,776,032 bytes), of which 1.2 MB is an embedded 2048x2048 thumbnail the app never uses |
| Triangles | 36,470 (24,951 vertices), 3 meshes, 13 primitives, 13 materials, 3 skins |
| Textures | 18 PNGs. Largest: `Body_00` 2048x2048 and `Body_00_nml` 2048x2048. All others are 1024 or smaller |
| Estimated GPU texture memory | About 55 MB with mipmaps, uncompressed RGBA |

This is acceptable for a placeholder at the target height (0.6 m, a single character). It is not
optimised. If the 13.9 ms frame budget (Requirement 29.4) is missed with the avatar visible, reduce the body
textures to 1024x1024 and drop the unused normal maps and the embedded thumbnail. A replacement model
from the user should aim for about 30,000 triangles or fewer and body textures of 1024 or smaller.

### Replacing the model

1. Put the new `.vrm` at `public/models/capri.vrm`, or change the path in `src/config/avatar-config.ts`.
2. Update this file and the README third-party list with the new name, author, source URL, and license.

## Other assets

The Vosk speech model (`vosk-model-small-en-us-0.15`, Apache-2.0) is fetched at build time by
`tools/fetch-vosk-model.ts` and is not committed. Its entry is completed in the README task.

## Voice_Library speech voice

The pre-generated voice lines are synthesised at development time with Piper (`piper-tts`, GPL-3.0-or-later,
a dev tool that is not shipped) using the voice `en_US-kristin-medium` from
https://huggingface.co/rhasspy/piper-voices. The voice was trained from scratch by Bryce Beattie on
LibriVox recordings, which are public domain, so no attribution is required. Details and the setup
commands are in `docs/voice-engine.md`. The Voice_Library itself is generated in task 13.19.

## OPTIONAL animation clips (Requirement 32, task 31.1)

Only the idle gesture has a clip. The other gestures stay procedural. The reasons are listed below the
table. Field names in this table start with "Clip" so that the smoke check for the Avatar model record
above (`checkThirdParty`) still reads the model's own fields.

### Idle clip

| Field | Value |
|---|---|
| Clip file in this repository | `public/animations/idle.vrma` (unmodified copy, 157,664 bytes) |
| Clip license notice shipped with it | `public/animations/LICENSE-idle.txt` (the MIT text, so the hosted site carries the notice next to the file) |
| Clip gesture | idle (10.4 s loop, standing weight shift and breathing; 21 humanoid rotation tracks plus a hips translation track; no finger or expression tracks) |
| Clip format | VRM Animation (`.vrma`, `VRMC_vrm_animation` `specVersion` 1.0) |
| Clip original name | `public/idle_loop.vrma` in the ChatVRM repository |
| Clip author | pixiv Inc. |
| Clip copyright | Copyright (c) 2023 pixiv Inc. |
| Clip source | https://github.com/pixiv/ChatVRM (archived repository, file at commit `b542aa00e19dccf9fc48ba340cf7eee011d2329a`) |
| Clip direct file | https://raw.githubusercontent.com/pixiv/ChatVRM/b542aa00e19dccf9fc48ba340cf7eee011d2329a/public/idle_loop.vrma |
| Clip license | MIT License, from the repository's own `LICENSE` file: https://github.com/pixiv/ChatVRM/blob/main/LICENSE |
| Clip attribution | Required by MIT: keep the copyright and permission notice with every copy. Done in `public/animations/LICENSE-idle.txt` and here. |
| Clip SHA-256 | `ace95ba6dcc0bdf2ed1081c002332b4184441117c8d543b6f642b3d2c5cf99be` (matches the file at the pinned commit) |

Why the license holds: the file sits in pixiv's own repository, which has one MIT `LICENSE` with pixiv as
the copyright holder and no separate asset terms. The README names separate terms only for the external
APIs it calls. MIT allows copying, modification, and redistribution, so the clip may ship in this public
repository and on the hosted site.

Provenance caveat: the repository does not say how the motion was made. The file was exported with
`THREE.GLTFExporter`, and its extra spine node names (`torso_1` to `torso_6`, `neck_2`) match the Sony
mocopi skeleton naming, which suggests pixiv captured it in house. This is an inference, not a statement
from pixiv.

Compatibility check (scratch script, not committed, outside the app):
`@pixiv/three-vrm-animation@3.5.5` (the current `latest`) depends on `@pixiv/three-vrm-core@3.5.5`, the
same core that `@pixiv/three-vrm@3.5.5` installs, and its peer is `three >=0.137`. With super-three 0.185
(`REVISION` 185) from this project's `node_modules`, `GLTFLoader` plus `VRMAnimationLoaderPlugin` parsed
`idle.vrma` (duration 10.375 s), and `createVRMAnimationClip` retargeted it onto `public/models/capri.vrm`
as 22 tracks on the normalized humanoid bones. Task 31.2 installed the package pinned to exactly 3.5.5
(MIT, pixiv Inc., https://github.com/pixiv/three-vrm), with one `three` copy in `npm ls three`. The app
(`src/avatar/clips/index.ts`) keeps only the 21 rotation tracks: it drops the hips position track,
because Capri's position comes from the locomotion code, and it calls `createVRMAnimationHumanoidTracks`
instead of `createVRMAnimationClip`, so no look-at track or `VRMLookAtQuaternionProxy` is involved.

### Gestures without a clip, and why

| Gesture | Result | Reason |
|---|---|---|
| point | stays procedural | `point` aims the arm at a runtime target with `aimArm`. A recorded clip points in one fixed direction, so it cannot replace this gesture. |
| snap/flick | stays procedural | `flick` uses the same aimed solve and reports its release time (`FLICK.releaseS`) to start the hacking beams. A fixed clip cannot aim or report that marker. |
| wave | stays procedural | No permissive clip found that is better than the procedural wave. See the candidates below. |
| celebrate | stays procedural | Same as wave. |
| tease | stays procedural | No permissively licensed hands-on-hips or "tsk tsk" clip was found. |
| shrug | stays procedural | No permissively licensed shrug clip was found. |

### Candidates checked and not used

| Candidate | License, read at the primary source | Decision |
|---|---|---|
| VRoid Project "VRMアニメーション7種セット" (VRMA_01 to VRMA_07, includes VRMA_02 Greeting), https://booth.pm/ja/items/5512385 | pixiv's own terms on that page. They forbid redistributing the motions or modified versions without permission in a form that can be extracted. Commercial use needs the credit line "Character animation credits to pixiv Inc.'s VRoid Project". | Not used. Files in `public/` of a public repository and a static site can be extracted. |
| three-vrm example `packages/three-vrm-animation/examples/models/test.vrma`, https://github.com/pixiv/three-vrm | MIT (repository `LICENSE`, pixiv Inc.) | Not used. It is a 3 s test motion with 3 animated channels and does not match any gesture. |
| Quaternius Universal Animation Library 1 and 2, Standard (free) editions, https://quaternius.itch.io/universal-animation-library and https://quaternius.itch.io/universal-animation-library-2 | CC0 1.0, stated on the itch.io pages, on quaternius.com, and in the `License.txt` inside both zips | Not used. The free editions have no wave, point, cheer, shrug, or hands-on-hips clip. Their `Idle_Loop` is a good CC0 alternative for idle, but it uses an Unreal-style rig and would need converting to a T-pose `.vrma`, while the ChatVRM idle is already a `.vrma`. Paid editions were not checked. |
| Vuena / Popyca "8 Free Blocky Characters" v1.3 (has `wave` and `cheer`), https://vuena.itch.io/blocky-characters-free-sample | CC0 1.0, stated on the page and in the zip's `LICENSE.txt` ("Popyca has waived all copyright...") | Not used, for quality. The wave moves only the right upper arm (60°) and forearm (26°). The cheer moves only the arms and legs. Both are simpler than the procedural gestures, which also move the torso, head, and fingers. The rig is a 22-bone Mixamo-named skeleton with an arms-down rest pose, which would also need a T-pose conversion. |
| fumi2kick "使いどころに困るモーションセット" by rerofumi (VRMA, includes `004_hello_1`, a greeting), https://booth.pm/en/items/5527394 | CC0, stated on the page, with modification and redistribution allowed and no credit required | Not downloaded. BOOTH requires a signed-in pixiv account to download, so the contents could not be inspected. If the user downloads `fm_vrma_motion_pack_01.zip`, `004_hello_1` is a candidate for wave. |
| Adobe Mixamo animations | Adobe's pinned Mixamo FAQ (https://community.adobe.com/questions-696/mixamo-faq-licensing-royalties-ownership-eula-and-tos-589400) lists "Any type of free distribution of character or animation raw files" as not allowed, and says the only thing you cannot do is distribute the raw character and animation files. | Not used. A `.vrma` or `.fbx` in `public/` of a public repository and on a static site is a freely distributed raw animation file. |
