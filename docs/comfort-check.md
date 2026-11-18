# Comfort check

This records the comfort check for Capri (Requirement 28.3): Avatar distance range, panel placement, seated reach, head-locked content, motion, flashing, and text size. Each item says what was checked, how, and the result.

Two kinds of result appear below:

- **Checked in code**: read from the constants and placement code, and covered by the unit and property tests named in the row.
- **Headset check (user)**: needs a person wearing a Quest. These rows have a short list of what to look for. They are not ticked yet.

Distances are in metres from the eyes. "Below" and "up" angles are measured from straight ahead at eye level. All positions are relative to where the head faces in the first moment of the session.

## Summary

| Item | Result |
| --- | --- |
| Avatar idle distance 1.0 to 1.5 m | Pass, checked in code |
| Avatar destinations stay in view of a seated user | Pass, checked in code |
| No head-locked content except the dev overlay | Pass, checked in code |
| No forced camera motion | Pass, checked in code |
| Avatar glides capped at 0.9 m/s | **Failed, then fixed in this task.** The idle follow glide was not capped |
| Panels in comfortable seated zones, nothing needs standing or walking | Pass, checked in code |
| Flashing and flicker (WCAG 2.3.1) | Pass. The beam glitch jump was halved for margin in this task |
| Text sizes | Pass for panels. Marker labels on far lights are small (see the table) |
| Reach, readability, and Avatar scale on the headset | Headset check (user), not done yet |

## Avatar distance range

| Rule | Value | Where | Test |
| --- | --- | --- | --- |
| Idle spot | 1.25 m ahead, 25° to the right | `IDLE_PLACEMENT` | `tests/unit/placement.test.ts` |
| Idle distance band, enforced every frame | 1.0 to 1.5 m horizontal | `constrainIdlePosition` in `src/domain/placement.ts` | `tests/unit/placement.test.ts` |
| Follow | Glides back to the idle spot after you look more than 60° away for 3 s | `AVATAR_PRESENCE.follow` | `tests/unit/follow.test.ts` |
| Move, sit, and perch destinations | At most 3.0 m horizontal, between the floor and 1.0 m above the head | `VISIBILITY_POLICY`, `src/domain/destination-visibility.ts` | Property 10 in `tests/unit/destination-visibility.test.ts` |
| Table choice | Table top at most 1.5 m away and 0.1 to 0.9 m below the head | `TABLE_SELECTION` | `tests/unit/surfaces.test.ts` |
| "Go away" | Idles 2.5 m away, still in view | `AWAY_PLACEMENT` | |
| Her head turn | At most 70° yaw and 40° pitch from her torso | `LOOK_LIMITS_DEG` | |

Result: pass. She never comes closer than 1.0 m while idle, and no destination needs the user to turn around or stand up to see her.

## Head-locked content

Only the `?perf=1` frame-time overlay is attached to the head (`world.player.head.add` in `src/ui/perf-overlay.ts`; a search of `src/` finds no other). It is a developer tool, off unless the URL asks for it.

Content that follows you does so lazily, with a lag, so it never sticks to your view:

- Loading card: placed about 1 m ahead. It glides back in front only after you turn more than 30° away (0.35 s smoothing).
- Hand-lost card: placed once in front of you when it opens, then stays put in the room.
- Transcript: turns toward you at most 0.5 rad/s, and only once you are more than 12° off its axis.
- Status chips: follow with a threshold. Speech_Bubble: turns to face you beside Capri's head.

Result: pass.

## Forced camera motion

`features.locomotion` is `false` in `iwsdk.config.json`, and no code in `src/` writes the player rig or camera transform. The session is passthrough AR, so the real room stays where it is and only Capri and the panels move. Result: pass.

## Avatar motion speed

| Motion | Limit | Result |
| --- | --- | --- |
| Ability glide (move, sit, perch) | 0.9 m/s hard cap (`LOCOMOTION.maxSpeedMps`, `glideStep`) | Pass. `tests/unit/glide.test.ts` |
| Idle follow glide | Was an uncapped spring with 1.2 s smooth time. Simulated peak speed: 1.09 m/s for a 1.77 m trip (you turned about 90°) and 1.69 m/s for a 2.75 m trip (you turned around). | **Fixed in this task.** `capPlanarSpeed` in `src/domain/glide.ts` now applies the same 0.9 m/s cap in `src/avatar/avatar-presence.ts`. A test in `tests/unit/glide.test.ts` covers a 2.75 m follow |
| Glide bob and lean | 1.2 cm bob at 2 Hz, lean at most 0.12 rad | Pass |

Capri's motion does not move your viewpoint, so these speeds are about how calm she looks, not about motion sickness. The cap keeps both kinds of glide the same.

## Panel placement and seated reach

Zones come from `UI_ZONES` and limits from `UI_LIMITS` in `src/config/constants.ts`. Property 46 (`tests/unit/ui-placement.test.ts`) checks that, for any head pose, every panel stays inside its distance limits and inside a 60° forward cone.

| Panel | Interaction | Straight-line distance | Direction |
| --- | --- | --- | --- |
| Mic orb | Poke | 0.54 m | 34° below, 25° left |
| Quick_Actions | Poke | 0.57 m | 29° below, 15° right |
| Hand_Keyboard (on demand) | Poke | 0.55 m | 35° below, 20° right, tilted 25° up |
| Transcript | Look | 0.91 m | 6° below, ahead |
| Device list | Ray pinch | 1.0 m | Eye level, 20° left |
| Task_Panel (while a task runs) | Ray pinch | 1.2 m | Eye level, 30° right |
| Status chips | Look | 1.23 m | 12° up, ahead |
| Dev panel, hand test panel (dev builds or `?dev=1` only) | Poke | 0.49 m | 24° below |

Limits: poke panels 0.35 to 0.8 m, ray panels at most 1.6 m. Every poke target sits low, where a seated hand rests, about 0.55 m away, which is within a seated adult's arm reach (roughly 0.6 to 0.7 m). Ray panels are at eye level and no more than 30° to the side. Nothing needs standing, leaning far, or walking (Requirements 8.4, 8.5). Result: pass in code.

## Flashing and flicker

Checked against WCAG 2.3.1 "Three Flashes or Below Threshold" ([W3C Understanding 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold)). Content passes if nothing flashes more than three times in any one second, or if the flashing area stays below the general flash and red flash thresholds. The area limit is 25% of any 10° visual field ([W3C technique G176](https://www.w3.org/WAI/WCAG22/Techniques/general/G176)). A 10° field is about 0.024 steradians, so the limit is about 0.006 sr. In a headset the visual field is measured directly, so these angles apply as they are.

| Source | Rate | Area | Result |
| --- | --- | --- | --- |
| Glitch lines (32 at most) | Jitter re-rolled at 15 Hz. On each re-roll a quarter of the lines switch off | WebGL lines are 1 pixel wide, about 0.04° on Quest 3 (about 25 pixels per degree). A 7 cm line seen from 0.5 m covers about 0.0001 sr. All 32 together would be about 0.003 sr, and they are spread along the beam | Pass by area. Unchanged |
| Beam glitch jumps | At 15 Hz each cross section has a 14% chance of jumping sideways, so a given spot kinks about twice a second on average and sometimes more than three times | A kink changes about 2 × section length × jump. With 5 cm sections and the old 2 cm jump that is 20 cm²: 0.002 sr at 1 m, but 0.008 sr at 0.5 m, over the limit | **Reduced in this task.** `VFX_RENDER.beam.glitchM` went from 0.02 to 0.01 m. Now a kink is at most 10 cm²: 0.001 sr at 1 m and 0.004 sr at 0.5 m. It reaches the limit only if the middle of the beam passes within about 0.4 m of the eyes. The jumps fade out at both ends of the beam. In Mock Mode the beams run from Capri (at least 1.0 m away) to bulbs 1.8 to 2.2 m away. The 15 Hz look stays |
| Beam brightness and wobble | Wobble is a smooth 2.9 Hz sideways sway. The hold shimmer changes brightness by ±12% of a 22% beam at 1.4 Hz | Small | Pass. Unchanged |
| Device marker flash (`DeviceMarker.pulse`) | One swell to full brightness per hack, 0.35 s. A hack sequence takes at least 2.4 s (aim 0.25 + flick 0.35 + beam 0.45 + pulse 0.35 + reaction 1.0) | Ring up to 0.27 m across | Pass by count: at most one flash per 2.4 s. Unchanged |
| Pulse ring on the device | One growing, fading ring per hack | Up to 0.48 m across | Pass by count. Unchanged |
| Mock bulb on and off | One change per command | | Pass by count |
| Mic orb, Teach orb, marker breathing | 0.4 to 1.4 Hz changes in size, not brightness | | Pass |
| Red flash | WCAG counts "saturated red" as R / (R + G + B) of 0.8 or more. Magenta `#FF2BD6` scores 0.50 and the listening red `#FF4D6D` scores 0.58. No colour in the effect or UI is saturated red | | Pass |

## Text sizes

UIKit sizes are font sizes (em) in panel units. At the panel scale of 0.1, one unit is 1 mm. The status chips and Task_Panel use a 0.125 scale, so one unit is 1.25 mm. Canvas cards convert pixels to metres by their width. Angles are em height divided by the straight-line distance.

| Text | Font size | Distance | Angular size |
| --- | --- | --- | --- |
| Quick_Actions buttons | 18 mm | 0.57 m | 1.8° |
| Hand_Keyboard keys | 18 to 22 mm | 0.55 m | 1.9° to 2.3° |
| Mic orb label | 21 mm | 0.54 m | 2.2° |
| Transcript | 16 to 28 mm | 0.91 m | 1.0° to 1.8° |
| Device list | 18 to 28 mm | 1.0 m | 1.0° to 1.6° |
| Task_Panel | 21 to 33 mm | 1.2 m | 1.0° to 1.6° |
| Status chips | 20 to 30 mm | 1.23 m | 0.9° to 1.4° |
| Speech_Bubble | 27 mm | 1.0 to 1.5 m | 1.0° to 1.5° |
| Hand-lost card | 19 to 30 mm | 0.8 m | 1.4° to 2.1° |
| Loading card | 20 to 33 mm | about 1.0 m | 1.2° to 1.9° |
| Device marker label (mock bulbs) | 34 mm | 1.8 to 2.2 m | 1.1° to 0.9° |
| Device marker label (a real light 3 m away) | 34 mm | 3.0 m | 0.7° |
| Frame-time overlay (dev) | 14 mm | 0.73 m | 1.1° |

Everything you press or must read to act is 1.8° or larger. The smallest panel text, about 0.9° to 1.0°, is secondary labels (chip titles, transcript hints). Marker labels on lights 3 m or more away drop to about 0.7°, which may be hard to read. The ring and Capri's gaze still show which light is pointed at. If the headset check finds them hard to read, scaling the label with distance is the fix. The loading card's hint line is italic. Meta's [typography guidance](https://developers.meta.com/horizon/design/styles_typography/) advises against italics in immersive views, so change that line if it reads poorly.

The overlay text was cut off at the right edge ("budget 13" instead of "budget 13.9"). Its font went from 34 px to 30 px in this task, and the emulator render now shows the full line.

## Headset check (user)

Not done yet. In one seated session on the Quest, check:

- [ ] Mic orb, Quick_Actions, and Hand_Keyboard can be poked without leaning forward.
- [ ] Device list and Task_Panel buttons can be ray-pinched without turning your shoulders.
- [ ] Transcript, status chips, and Speech_Bubble read without squinting. Marker labels on the mock bulbs read at 1.8 to 2.2 m.
- [ ] Capri's size and her 1.25 m idle distance feel natural, neither looming nor tiny.
- [ ] The hacking effect feels comfortable to watch, and nothing seems to strobe.
- [ ] After 10 minutes, no eye strain or neck strain from where the panels sit.
