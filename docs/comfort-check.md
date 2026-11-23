# Comfort check

This records the comfort check for Capri (Requirements 28.3, 33.29 to 33.34, 33.40): Avatar personal space, panel and menu placement, seated reach, head-locked content, motion, flashing, and text size. Each item says what was checked, how, and the result.

Two kinds of result appear below:

- **Checked in code**: read from the constants and placement code, and covered by the unit and property tests named in the row.
- **Headset check (user)**: needs a person wearing a Quest. These rows have a short list of what to look for. They are not ticked yet.

Distances are in metres from the eyes. "Below" and "up" angles are measured from straight ahead at eye level. Positions are relative to where the head faces in the first moment of the session, except the menu, which is placed where the head faces when it opens.

## Summary

| Item | Result |
| --- | --- |
| Avatar personal space: she holds her spot and steps aside only inside 0.5 m | Pass, checked in code |
| Avatar destinations stay in view of a seated user and inside the detected walls | Pass, checked in code |
| No head-locked content except the dev overlay | Pass, checked in code |
| No forced camera motion | Pass, checked in code |
| Avatar glides capped at 0.9 m/s | **Failed, then fixed (task 27.6).** The idle follow glide was not capped |
| Menu and panels in comfortable seated zones, nothing needs standing or walking | Pass, checked in code |
| Flashing and flicker (WCAG 2.3.1) | Pass. The beam glitch jump was halved for margin (task 27.6) |
| Text sizes | Pass for the menu and panels. Marker labels on far lights are small (see the table) |
| Reach, readability, and Avatar scale on the headset | Headset check (user), not done yet |

## Avatar personal space and range

The old 1.0 to 1.5 m idle band, which pushed Capri away when you came closer, is gone (task 33.7).

| Rule | Value | Where | Test |
| --- | --- | --- | --- |
| Idle spot | 1.25 m ahead, 25° to the right | `IDLE_PLACEMENT` | `tests/unit/placement.test.ts` |
| Personal space | Farther than 0.5 m (horizontal) from your head, she keeps her spot as you approach. Inside 0.5 m she steps sideways, out of your way, to just outside the radius. She never backs away | `COMFORT_RADIUS_M`, `personalSpace` in `src/domain/placement.ts` | Property 47 in `tests/property/personal-space.test.ts`, `tests/unit/placement.test.ts` |
| Follow | Glides back to the idle spot only after you look more than 60° away from her for 3 s | `AVATAR_PRESENCE.follow` | `tests/unit/follow.test.ts` |
| Inside the room | The idle spot and every move, sit, and perch destination must be reachable from your head without crossing a detected wall (kept 0.15 m in front of it) and lie inside the room mesh. Otherwise it is pulled toward you. The idle spot tries 25° right, 25° left, 50° right, then 50° left | `ROOM_BOUNDS`, `src/domain/room-bounds.ts` | Property 49 in `tests/property/room-bounds.test.ts`, `tests/unit/room-bounds.test.ts` |
| Move, sit, and perch destinations | At most 3.0 m horizontal, between the floor and 1.0 m above the head | `VISIBILITY_POLICY`, `src/domain/destination-visibility.ts` | `tests/unit/destination-visibility.test.ts` |
| Table choice | Table top at most 1.5 m away and 0.1 to 0.9 m below the head | `TABLE_SELECTION` | `tests/unit/surfaces.test.ts` |
| "Go away" | Idles 2.5 m away, still in view, pulled in front of any wall | `AWAY_PLACEMENT` | |
| Her head turn | At most 70° yaw and 40° pitch from her torso | `LOOK_LIMITS_DEG` | |

Result: pass. She does not move away when you lean toward her, she gives way only when you are within 0.5 m, and no destination needs you to turn around, stand up, or look through a wall to see her.

## Head-locked content

Only the `?perf=1` frame-time overlay is attached to the head (`world.player.head.add` in `src/ui/perf-overlay.ts`; a search of `src/` finds no other). It is a developer tool, off unless the URL asks for it.

Content that follows you does so lazily, or is placed once:

- Menu: placed once when it opens, then fixed in the room until it closes (Property 51 in `tests/property/hud-menu.test.ts`).
- Loading card: placed about 1 m ahead. It glides back in front only after you turn more than 30° away (0.35 s smoothing).
- Hand-lost card: placed once in front of you when it opens, then stays put in the room.
- Transcript bubble and Speech_Bubble: attached to Capri, turning to face you.
- Wrist button: on your left wrist, so it moves with your hand, not your head.

Result: pass.

## Forced camera motion

`features.locomotion` is `false` in `iwsdk.config.json`, and no code in `src/` writes the player rig or camera transform. The session is passthrough AR, so the real room stays where it is and only Capri and the panels move. The `unbounded` reference space (task 33.1) changes how the headset tracks the room, not your viewpoint. Result: pass.

## Avatar motion speed

| Motion | Limit | Result |
| --- | --- | --- |
| Ability glide (move, sit, perch) | 0.9 m/s hard cap (`LOCOMOTION.maxSpeedMps`, `glideStep`) | Pass. `tests/unit/glide.test.ts` |
| Idle follow glide | Was an uncapped spring with 1.2 s smooth time. Simulated peak speed: 1.09 m/s for a 1.77 m trip (you turned about 90°) and 1.69 m/s for a 2.75 m trip (you turned around). | **Fixed in task 27.6.** `capPlanarSpeed` in `src/domain/glide.ts` applies the same 0.9 m/s cap in `src/avatar/avatar-presence.ts`. A test in `tests/unit/glide.test.ts` covers a 2.75 m follow |
| Glide bob and lean | 1.2 cm bob at 2 Hz, lean at most 0.12 rad | Pass |

Capri's motion does not move your viewpoint, so these speeds are about how calm she looks, not about motion sickness. The cap keeps both kinds of glide the same.

## Menu, panel placement, and seated reach

Zones come from `UI_ZONES` and limits from `UI_LIMITS` in `src/config/constants.ts`. Property 46 (`tests/property/seated-zones.test.ts`) checks that, for any head pose, every placed panel, the `hud` menu included, stays inside its distance limits and inside a 60° forward cone. The default view has no floating panels: the mic orb, Quick_Actions, the hand keyboard, the transcript panel, and the status chips were removed in task 33.

| Panel | Interaction | Straight-line distance | Direction |
| --- | --- | --- | --- |
| Wrist button (while the left palm faces you) | Poke with the right index finger | At the left wrist, 3 cm off it | Where your hand is |
| Menu (`hud` zone, on demand) | Poke or ray pinch | 0.54 m | 22° below, straight ahead, tilted 15° up |
| Device list (only while teaching a light) | Ray pinch | 1.0 m | Eye level, 20° left |
| Task_Panel (only while a live Hermes task runs) | Ray pinch | 1.2 m | Eye level, 30° right |
| Dev panel (`?dev=1` only), hand test panel (`?handtest=1` only) | Poke | 0.49 m | 24° below |

Limits: poke panels 0.35 to 0.8 m, ray panels at most 1.6 m. The menu sits low and close, about 0.54 m away, which is within a seated adult's arm reach (roughly 0.6 to 0.7 m). It is 0.49 m wide, so its outer tiles are about 24° to each side. Ray panels are at eye level and no more than 30° to the side. Nothing needs standing, leaning far, or walking (Requirements 8.4, 8.5). The Quest system keyboard is placed by the system, not by Capri. Result: pass in code.

## Flashing and flicker

Checked against WCAG 2.3.1 "Three Flashes or Below Threshold" ([W3C Understanding 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold)). Content passes if nothing flashes more than three times in any one second, or if the flashing area stays below the general flash and red flash thresholds. The area limit is 25% of any 10° visual field ([W3C technique G176](https://www.w3.org/WAI/WCAG22/Techniques/general/G176)). A 10° field is about 0.024 steradians, so the limit is about 0.006 sr. In a headset the visual field is measured directly, so these angles apply as they are.

| Source | Rate | Area | Result |
| --- | --- | --- | --- |
| Glitch lines (32 at most) | Jitter re-rolled at 15 Hz. On each re-roll a quarter of the lines switch off | WebGL lines are 1 pixel wide, about 0.04° on Quest 3 (about 25 pixels per degree). A 7 cm line seen from 0.5 m covers about 0.0001 sr. All 32 together would be about 0.003 sr, and they are spread along the beam | Pass by area. Unchanged |
| Beam glitch jumps | At 15 Hz each cross section has a 14% chance of jumping sideways, so a given spot kinks about twice a second on average and sometimes more than three times | A kink changes about 2 × section length × jump. With 5 cm sections and the old 2 cm jump that is 20 cm²: 0.002 sr at 1 m, but 0.008 sr at 0.5 m, over the limit | **Reduced in task 27.6.** `VFX_RENDER.beam.glitchM` went from 0.02 to 0.01 m. Now a kink is at most 10 cm²: 0.001 sr at 1 m and 0.004 sr at 0.5 m. It reaches the limit only if the middle of the beam passes within about 0.4 m of the eyes. The jumps fade out at both ends of the beam. In Mock Mode the beams run from Capri (1.25 m away at her idle spot) to bulbs 1.8 to 2.2 m away. The 15 Hz look stays |
| Beam brightness and wobble | Wobble is a smooth 2.9 Hz sideways sway. The hold shimmer changes brightness by ±12% of a 22% beam at 1.4 Hz | Small | Pass. Unchanged |
| Device marker flash (`DeviceMarker.pulse`) | One swell to full brightness per hack, 0.35 s. A hack sequence takes at least 2.4 s (aim 0.25 + flick 0.35 + beam 0.45 + pulse 0.35 + reaction 1.0) | Ring up to 0.27 m across | Pass by count: at most one flash per 2.4 s. Unchanged |
| Pulse ring on the device | One growing, fading ring per hack | Up to 0.48 m across | Pass by count. Unchanged |
| Mock bulb on and off | One change per command | | Pass by count |
| Marker breathing, listening bars in the transcript bubble | Smooth changes in size, not brightness | Small | Pass |
| Red flash | WCAG counts "saturated red" as R / (R + G + B) of 0.8 or more. Magenta `#FF2BD6` scores 0.50 and the listening red `#FF4D6D` scores 0.58. No colour in the effect or UI is saturated red | | Pass |

## Text sizes

UIKit sizes are font sizes in panel units. At the panel scale of 0.1, one unit is 1 mm. The Task_Panel uses a 0.125 scale, so one unit is 1.25 mm. Canvas cards and bubbles convert pixels to metres by their width. Angles are font height divided by the straight-line distance. Menu angles use the distance to its centre, 0.54 m.

| Text | Font size | Distance | Angular size |
| --- | --- | --- | --- |
| Menu title | 22 mm | 0.54 m | 2.3° |
| Menu tiles (Status, Lights, Commands, ...) | 16 mm | 0.54 m | 1.7° |
| Menu content buttons (Teach a light, Re-teach lights) | 18 mm | 0.54 m | 1.9° |
| Commands bar (Lights, Capri, Hermes, Prev, Next, Type) | 15 mm | 0.54 m | 1.6° |
| Commands row phrase / help line | 17 mm / 12 mm | 0.54 m | 1.8° / 1.3° |
| Status chip labels / titles | 16 mm / 13 mm | 0.54 m | 1.7° / 1.4° |
| Menu hint line | 14 mm | 0.54 m | 1.5° |
| Device list | 18 to 28 mm | 1.0 m | 1.0° to 1.6° |
| Task_Panel | 21 to 33 mm | 1.2 m | 1.0° to 1.6° |
| Transcript bubble (above Capri) | 22 mm | about 1.25 m | 1.0° |
| Speech_Bubble | 27 mm | 1.0 to 1.5 m | 1.0° to 1.5° |
| Hand-lost card | 19 to 30 mm | 0.8 m | 1.4° to 2.1° |
| Loading card | 20 to 33 mm | about 1.0 m | 1.2° to 1.9° |
| Device marker label (mock bulbs) | 34 mm | 1.8 to 2.2 m | 1.1° to 0.9° |
| Device marker label (a real light 3 m away) | 34 mm | 3.0 m | 0.7° |
| Frame-time overlay (dev) | 14 mm | 0.73 m | 1.1° |

Every menu label you press is 1.6° or larger. The smallest menu text is the Commands help line (1.3°) under each phrase. Marker labels on lights 3 m or more away drop to about 0.7°, which may be hard to read. The ring and Capri's gaze still show which light is pointed at. If the headset check finds them hard to read, scaling the label with distance is the fix. The loading card's hint line is italic, and so are the live partial words in the transcript bubble. Meta's [typography guidance](https://developers.meta.com/horizon/design/styles_typography/) advises against italics in immersive views, so change those if they read poorly.

## Headset check (user)

Not done yet. In one seated session on the Quest, check:

- [ ] The wrist button and every menu tile can be poked without leaning forward, and the menu's outer tiles without turning your shoulders.
- [ ] Device list and Task_Panel buttons can be ray-pinched without turning your shoulders.
- [ ] The menu text (including the Commands help line), the transcript bubble, and the Speech_Bubble read without squinting. Marker labels on the mock bulbs read at 1.8 to 2.2 m.
- [ ] Capri's size and her 1.25 m idle spot feel natural, neither looming nor tiny. Leaning toward her does not make her back off.
- [ ] The hacking effect feels comfortable to watch, and nothing seems to strobe.
- [ ] After 10 minutes, no eye strain or neck strain from where the menu and panels sit.
