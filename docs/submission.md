# Capri: submission text

Submission text for the Meta VR Start Developer Competition 2026 (Requirements 31.3, 31.5, 31.6). Every claim below is taken from the current code and from the project docs: `README.md`, `docs/demo-path.md`, `docs/spike-report.md`, `docs/hermes-integration.md`, `docs/performance-note.md`, and `docs/comfort-check.md`. The limitations section lists what has not been verified.

## Form fields

| Field | Value |
| --- | --- |
| Title | Capri |
| Tagline | A spatial AI companion who stands in your room, sees what you point at, and hacks your lights. |
| Track | Productivity |
| Division | New Experience |
| Special award targeted | Best Agentic Interaction |
| Platform | Meta Quest 3 and 3S, Quest Browser (WebXR, passthrough AR) |
| Input | Hand tracking only. No controllers. |
| Play position | Seated, stationary |
| Playable link | https://capri.sanyamchhabra.in |
| Setup needed | None. Mock Mode is the default. |
| Time to try | About 2 minutes for the scripted path |
| Built with | IWSDK, Three.js, three-vrm, Vosk (vosk-browser), Piper (dev-time voice generation) |
| Source and docs | `README.md` (setup, Live Mode, third-party licenses), `docs/demo-path.md` (the 2-minute script) |

Shorter taglines, if a form limits length:

- "Point at a lamp, say 'turn on that', and Capri hacks it."
- "An embodied AI companion for your real room, hands only."

## Short version (about 100 words)

Capri is a spatial AI companion for Meta Quest. She stands in your real room in passthrough AR, the mode where the headset shows your room through its cameras. Point at a lamp with your right index finger, hold a pinch with your left hand, and say "turn on that". Capri looks at the lamp, flicks her hand, and sends a beam of hacking effects to it. The light changes only when the effect lands, and she reports what really happened. She teases, fidgets, and glances at your furniture. Hands only, seated. The hosted link opens in Mock Mode, so no smart home or setup is needed.

## Long version (about 550 words)

Capri is a spatial AI companion for Meta Quest 3 and 3S. She is an animated VRM avatar who stands on your real floor in passthrough AR. She breathes, blinks, follows your head with her eyes, and glides back into view if you look away for 3 seconds. Every 8 to 18 seconds she stretches, fidgets, or glances at a bulb or a piece of furniture the headset has detected. Leave her alone for a minute and she gets bored and says so.

You control her with your hands while seated. Point your right index finger at a light and a ring highlights it, and Capri turns her head to look at it. Hold a pinch with your left hand to talk. Say "turn on that", "dim that", or "set to red", and she resolves "that" to the light you pointed at. Then she flicks her hand and sends beams, glyphs, and sparks to the bulb. The command goes out only when the pulse lands, and she reacts to the real result with a recorded line and a quip. Toggle the same lamp three times in a minute and she teases you about it. If voice fails, eight poke buttons and a hand keyboard do the same jobs.

Capri is not a wrapper around a chatbot or a smart-home app. The avatar, her awareness of where your devices and furniture are, and her personality are the product, and they all run in the browser on the headset. Home Assistant and Hermes Agent are optional plug-ins behind one interface. Without them, Capri runs in Mock Mode with three virtual bulbs and a scripted agent, and that is what the hosted link opens by default.

The agentic part is where her space meets an agent. With Hermes Agent connected, a question typed on the hand keyboard goes to Hermes together with a compact description of the room: which light you are pointing at, what you are looking at, every light with its state and position, the detected surfaces, and where Capri stands. Hermes must answer in a fixed structure: what to say, an emotion, a gesture, and at most one action. Capri checks the reply before acting. An action runs only if its target exists in the room and its values are valid, and it then goes through the same hacking sequence as a spoken command. Anything else is dropped, and Capri says in character that she cannot do it. Spoken task phrases start long-running Hermes runs. A task panel shows the step Hermes is on. When Hermes asks permission, for example before a shell command, Approve and Deny buttons appear, and one pinch approves one operation only.

Capri does not claim results she has not received. Acknowledgement lines cannot use completion wording, a light result comes from the backend's answer, and a task's closing line comes from its final state, never from a timer. If Hermes is down or replies badly, the on-device tier answers instead.

Capri is a static site with no backend. Speech recognition runs on the headset with Vosk and a restricted grammar, so no audio leaves the device. Her spoken lines come from a pre-generated voice library. Credentials for Home Assistant and Hermes are stored only on the headset and sent only to the endpoints you enter.

## How to try it

Mock Mode needs no account, no smart home, and no configuration.

1. On a Quest 3 or 3S, open `https://capri.sanyamchhabra.in` in Quest Browser. Put the controllers down so hand tracking takes over.
2. Tap **Enable microphone** and allow it. This is optional: the buttons work without it.
3. Wait for **Voice model ready**. The first visit downloads about 40 MB. Later visits load it from the headset's cache.
4. Sit facing an open part of the room, look straight ahead, and tap **Enter AR**.
5. Point your right index finger at the bulb on your left. Pinch and hold with your left hand, say **"turn on that"**, and let go.
6. Say **"run my evening routine"** (or poke that button on **Quick actions**) to watch a scripted agent task run on the task panel.

The full two-minute script, with the exact words, hand actions, and a fallback for each step, is in `docs/demo-path.md`. Say "turn off that", not "turn that off": the voice grammar is word-order sensitive (see Limitations).

## Key features

- **Presence in your room.** A VRM avatar on the detected floor, or floating when there is no floor. Idle distance is held between 1.0 and 1.5 m.
- **Pointing selection.** A ring follows the light you point at, and Capri looks at it. A right pinch confirms a light for 8 seconds.
- **Push-to-talk voice.** Hold a left pinch, or poke the mic orb. Commands cover on and off, dim and brighten, 12 colours, named lights, timers from 1 to 60 minutes, remembered places, and moves ("come here", "go away", "sit on the desk").
- **Hacking effect.** Hand flick, beams, glyphs, sparks, and a pulse for every light command. The command is sent when the pulse lands.
- **Personality.** 58 recorded voice lines, quips on success, a shrug on failure, a tease after three toggles of the same light within 60 seconds, idle stretches and glances, and an annoyed reaction after 60 seconds of no input.
- **Fallbacks without voice.** Quick actions (eight poke buttons) and a hand keyboard for typed commands and free-form questions.
- **Live Mode (optional).** Teach Capri your real lamps by pointing and pinching. Each position is saved with a WebXR anchor and restored on the next visit.
- **Hermes Agent (optional).** Free-form chat with room context, long-running tasks with live steps, and approval buttons.
- **Pause and resume.** Opening the Quest system menu pauses animation, timers, effects, the microphone, and audio. Resume announces timers that ran out.

## The agentic angle (Best Agentic Interaction)

Capri connects an agent to a physical room through pointing, voice, and a body. These are the parts that make it agentic, with the files that implement them.

- **Pointing plus voice.** "that", "this", "it", "that one", and "this one" resolve to the light you confirmed with a right pinch in the last 8 seconds, otherwise to the light you are pointing at. The pointed light is latched when push-to-talk starts, so the finger may drift while you talk. With nothing pointed at, Capri asks you to point first instead of guessing. (`src/domain/speech-lang/resolver.ts`, `src/app/voice-loop.ts`)
- **Spatial context sent to the agent.** Every Hermes request carries a context with exactly five parts: the pointed light, the gaze target (a light within 8° of your head direction, else the surface you look at), up to 16 lights with name, state, brightness, and position rounded to 1 cm, up to 12 surfaces from Quest scene understanding, and Capri's own position, mode, and emotion. It is capped at 4 KB and contains no Home Assistant entity ID, URL, token, or key. (`src/domain/context/spatial-context.ts`)
- **A response contract that gates actions.** Hermes is asked for `{speech, emotion, animation, action: {type, target, params}}`. Hermes has no native structured output, so Capri parses the reply text and validates every field. Unknown emotions become neutral. Gestures that belong to other systems (pointing, the hack flick, sitting) are refused. An action runs only if its target resolves to a real light, remembered place, or detected surface and its values validate, and then it goes through the same hack sequence and result handling as a spoken command. A rejected action is dropped and Capri says in character that she cannot do it. Hermes's chain-of-thought field is never read. (`src/domain/contract/response-contract.ts`, `src/domain/contract/tier-router.ts`)
- **Long-running runs with live steps and approvals.** Task phrases start a Hermes run. Capri reads its event stream through `fetch` streaming, because the key travels in a header that `EventSource` cannot send. The task panel shows the current step (the tool Hermes is using) and a Cancel button. When Hermes raises an approval request, its description appears with Approve and Deny buttons. Approve allows that one operation only. While a task runs, Capri keeps to small idle gestures, and when it ends she plays a notification gesture and gives the real outcome, including the reason on failure. (`src/backends/hermes/live-hermes-adapter.ts`, `src/app/task-flow.ts`)
- **Truthfulness.** Capri never says an action is done before the real result arrives. Acknowledgement lines are checked so they carry no completion wording. A light result comes from the backend's answer, and an error or a malformed answer counts as a failure. A task's closing line comes from the task's final state. The prompt sent to Hermes tells it not to claim actions are done, because Capri reports results herself. (`src/domain/actions/hack-sequence.ts`, `src/domain/persona/persona.ts`, `src/domain/speech/voice-manifest.ts`)
- **Two tiers.** Tier 1 parses and answers every deterministic command on the headset, offline. Tier 2 (Hermes) handles free-form chat and tasks. Any Tier 2 failure, such as no connection, a timeout, or an invalid reply, falls back to Tier 1 with an in-character line.

In Mock Mode, the same flow runs against a scripted agent: "run my evening routine" and "research it and tell me when done" complete with progress, and "watch the door" fails with a reason, so judges can see the task panel and the failure handling without a Hermes server.

## How it's built

- **IWSDK, Three.js, and three-vrm.** IWSDK is Meta's WebXR toolkit. The app requests an `immersive-ar` session with hand tracking, plane and mesh detection, hit-test, and anchors. The avatar is a VRM model rendered with three-vrm and MToon materials and animated by a procedural animator (breathing, blinking, gaze, keyframed gestures). There are no clip animations.
- **Pure domain plus XR shell.** Intent parsing, pointing, the persona, the task model, the response contract, and the spatial context live in `src/domain/` with no Three.js, DOM, or IWSDK imports, and are covered by unit and property tests that run under Node.
- **Vosk offline speech.** `vosk-model-small-en-us-0.15` runs in the browser through `vosk-browser`, with a restricted grammar built from fixed phrase pieces. No audio leaves the device.
- **Pre-generated Piper voice library.** Quest Browser has no `speechSynthesis`, so 58 lines were synthesised at development time with Piper and the `en_US-kristin-medium` voice and ship as MP3 files. Any other line, including every Hermes reply, appears as a speech bubble with a chirp.
- **Static site, no backend.** The app is static files on Vercel. There is no Capri server, proxy, or bridge. In Live Mode the headset's browser calls your Home Assistant and your Hermes directly, over HTTPS only.
- **Credentials on the device only.** Home Assistant and Hermes credentials are stored in this site's browser storage on the headset, sent only to the endpoints you enter, and never logged. "Forget credentials" removes them and returns Capri to Mock Mode.

## Accessibility and comfort

- Hands only and seated. Nothing needs standing, walking, or teleporting. Locomotion is off, and the app never moves your viewpoint.
- Poke panels sit low, about 0.55 m from the eyes, where a seated hand rests. Panels that use a pinch ray sit at eye level, no more than 30° to the side.
- Every voice command has a non-voice route: Quick actions, the hand keyboard, or poking the mic orb instead of pinching.
- Capri idles 1.0 to 1.5 m away and never comes closer. Her glides are capped at 0.9 m/s.
- Nothing is head-locked except an opt-in developer frame-time overlay (`?perf=1`).
- The hacking effect was checked against the WCAG 2.3.1 flash rules, and the beam's glitch jump was halved for extra margin. No colour in the effect or UI counts as saturated red under WCAG.
- Everything you press or must read to act is at least 1.8° tall. Labels on lights 3 m or more away are about 0.7°, which may be hard to read.
- Speech recognition is on-device and microphone use is opt-in. The app works fully without the microphone.

Details are in `docs/comfort-check.md`.

## Limitations

- **Restricted voice grammar.** Word order matters. "turn off that" works by voice, and "turn that off" works only when typed. Results arrive about 2.5 s after you stop talking (median measured on a Quest 3 in the platform spike, 28 of 30 test commands recognised).
- **Spoken voice only for recorded lines.** Lines outside the voice library, including every Hermes reply, are a speech bubble with chirps. The arrival greeting is recorded but not played: Capri waves silently.
- **Mock Mode is scripted.** Every chat phrase gets the same canned reply, every bulb starts off, and the evening routine reports progress without changing the bulbs.
- **Live Hermes is not yet confirmed end to end.** The Hermes client is built against the API surface confirmed on the author's Hermes Agent 0.21.4 instance, the cross-origin preflights for the Capri origin were checked, and the client is tested with fake transports. An authenticated call from Quest Browser and live event delivery through Cloudflare Tunnel are not yet confirmed. Approval buttons appear only if the Hermes approval policy raises approval requests for API runs. Hermes reports steps, not percentages. Chat needs the model to return bare JSON, and Capri falls back to Tier 1 when it does not.
- **Frame time on the headset is not measured yet.** The target is 72 fps (13.9 ms per frame) on Quest 3 and 3S. The only measurement so far is in the desktop emulator, which says nothing about Quest frame time. A one-time shader compile hitch on the first hacking effect after a page load is likely.
- **Comfort on the headset is not checked yet.** The comfort rules above are checked in code and tests. The seated headset check of reach, readability, and avatar scale is still open.
- **Right hand only.** The right hand always points. There is no setting to swap hands.
- **Approximate light positions in Live Mode.** A restored anchor landed 95 mm from where it was saved, in one measurement after a reload.
- **Tested hardware.** The platform spike ran on a Quest 3 with Quest Browser 156. Quest 3S was not tested.
- **Placeholder avatar.** The VRM is a sample model from the VRM Consortium, not a custom character.

## Credits and licenses

- **Avatar:** "VRM1_Constraint_Twist_Sample" by pixiv Inc. (VRM Consortium sample models), (c) 2022 pixiv Inc., VRM Public License 1.0 (https://vrm.dev/licenses/1.0/). Unmodified. Nothing here implies endorsement by pixiv.
- **Voice:** Piper voice `en_US-kristin-medium`, trained by Bryce Beattie on public-domain LibriVox recordings (https://huggingface.co/rhasspy/piper-voices). Piper itself (GPL-3.0-or-later) is a development tool and does not ship with the app.
- **Speech model:** `vosk-model-small-en-us-0.15` by Alpha Cephei, Apache 2.0 (https://alphacephei.com/vosk/models), used through `vosk-browser` (Apache 2.0).
- **Libraries:** IWSDK (`@iwsdk/core`), Three.js (`super-three`), and `@pixiv/three-vrm` (MIT), each under its own license.
- **Optional backends:** Home Assistant and Nous Research Hermes Agent. Neither is bundled. Users connect their own.

Full details are in `docs/THIRD_PARTY.md` and the README section "Third-party assets".
