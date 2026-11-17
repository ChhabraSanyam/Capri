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
