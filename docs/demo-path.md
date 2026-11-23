# Demo_Path: Capri in two minutes

This is the scripted demo for judges and for the demo video (Requirements 8.6, 28.5, 28.6, 28.8, 33.60). It runs seated, with hands only, in Mock Mode from the hosted link `https://capri.sanyamchhabra.in`. Mock Mode needs no smart home and no setup: three virtual bulbs appear in your room. Mock Mode has no agent: Hermes is only there when you connect your own (see the optional Live Mode beat).

In two minutes it shows passthrough presence, pointing, a voice command, the hacking effect, a quip, the wrist menu with its Commands list, and Capri moving around your room. The floating mic orb, the "Teach me your lights" orb, Quick actions, the hand keyboard, and the scripted "run my evening routine" task are gone from the app, so this path no longer uses them. Every word, label, and gesture below comes from the current code. Where Capri picks one of several lines at random, the script says "for example".

A few terms:

- **AR session**: the immersive mode that Enter AR starts. The headset shows your real room through its cameras (passthrough), and Capri and the bulbs are drawn into it.
- **Dominant hand**: your right hand. It points, confirms, and pokes the wrist button. Capri has no setting to swap hands yet.
- **Non-dominant hand**: your left hand. Holding a pinch with it is push-to-talk, the only way to talk.
- **Pinch**: thumb tip to index fingertip.
- **Point**: index finger straight, the other fingers curled. A flat open hand does not count as pointing.
- **Wrist button**: a small glowing disc that appears on your left wrist while your left palm faces you. Poke it with your right index fingertip to open or close the menu.
- **Menu**: the panel titled **Capri menu** that the wrist button opens, with the tiles **Status**, **Lights**, **Commands**, **Ask Hermes**, **Give Hermes a task**, and **Close**.

## Try it in 60 seconds (for judges)

1. In Quest Browser, open `https://capri.sanyamchhabra.in`. Put the controllers down.
2. Tap **Enable microphone** and allow it in the browser prompt. This step is optional. Without it, use the menu (step 6).
3. Wait for **Voice model ready.** The first visit downloads about 40 MB. Later visits load it from the headset in a few seconds.
4. Look straight ahead and tap **Enter AR**. Capri appears about 1.25 m in front of you, a little to the right, waves, and says a greeting. Three dark bulbs hang around her.
5. Point your right index finger at the bulb on your left (the desk lamp). A ring appears on it and Capri looks at it. Keep pointing, pinch and hold with your left hand, say **"turn that on"**, then let go. Capri flicks her hand, beams hit the bulb, it lights up, and she brags about it.
6. Turn your left palm toward your face. Poke the glowing dot on your left wrist with your right index finger. The menu opens in front of you. Poke **Commands** to see every phrase Capri understands. Lit rows run when you poke them.

## Pre-flight checklist

Do these before the clock starts.

- [ ] **Volume up.** Capri's recorded lines, chirps, and hacking sounds come out of the headset speakers.
- [ ] **Controllers down.** Hand tracking must be on in the Quest settings, and the headset switches to hands when you put the controllers down. If Capri shows **Bring your hands into view**, hold your hands up in front of the headset.
- [ ] **Room scanned.** Run Space Setup on the Quest so the floor, walls, and furniture are known. With a floor, Capri stands on it; without one, she floats. "Sit on the desk" and "perch on the table" need a desk or table in the scan. Capri's destinations stay inside the detected walls.
- [ ] **Allow the mic on the 2D page.** Tap **Enable microphone** before Enter AR and accept the prompt until the page says **Microphone: allowed.** The spike showed that a first microphone prompt inside AR ends the session, so do not skip this step.
- [ ] **Wait for "Voice model ready."** Enter AR works earlier, but a pinch then shows **Voice loading** in the bubble above Capri and only the menu works.
- [ ] **Fresh page load.** Reload the page before a run. Every mock bulb starts **off**, and the toggle count starts clean.
- [ ] **Seat and space.** Sit facing an open part of the room, at least 2.5 m deep. Everything is placed relative to where your head faces in the first moment of the session, so look straight ahead when you tap Enter AR and hold still for a second.
- [ ] **Know the mode.** The entry page shows the **Mock Mode** badge. If it says Live Mode, open **Connect your own home (optional)**, turn Live Mode off, and select **Save**.

## Where things appear

Positions are relative to your head when the session starts. The default view shows only Capri, the bulbs, and her bubbles. There are no floating buttons or status panels: everything else is in the menu.

| Thing | Where |
| --- | --- |
| Capri | 1.25 m ahead, about 25° to your right, facing you. She holds her spot when you lean or move toward her. Only if your head comes within 0.5 m of her (horizontally) does she step aside. She glides back into view only after you have looked more than 60° away from her for 3 s. Her spot and every move stay inside the detected walls. |
| Desk lamp | 35° to your left, 1.8 m away, a little below eye height |
| Floor lamp | Almost straight ahead, 2.2 m away, lower |
| Ceiling light | 40° to your right, 2.0 m away, above eye height |
| Bubble above Capri | A small dark bubble just over her head. While you hold the left pinch it shows **Listening** and bars that move with your voice, then your words. It hides 2.5 s after the result. If voice cannot run, a pinch shows the reason there for 2.5 s (for example **Mic not allowed** or **Voice loading**). |
| Speech bubble | Capri's own white bubble beside her head. The bubble above her moves up so the two never overlap. |
| Wrist button | On your left wrist, only while your left palm faces you (within 45°). Poke it with your right index fingertip. |
| Menu (**Capri menu**) | Opens 0.5 m straight ahead and 0.2 m below eye level, tilted up toward you. It stays where it opened until it closes. Poke it with either index finger, or aim and pinch. It closes after 30 s untouched (its title row says **Closes after 30 s untouched**), when a tile starts something, on **Close**, or on a second wrist poke. |
| Teach panel | Only while you teach a light (**Lights**, then **Teach a light**): 1.0 m away, 20° to your left. |
| Task panel | Only while a live Hermes task runs: 30° to your right, 1.2 m away. Never in Mock Mode. |

What the menu tiles show:

- **Status**: **Mode** (**Mock Mode**), **Voice** (**Voice ready** or **Voice loading**), **Home Assistant** (**Connected**: the mock home), and **Hermes** (**Not configured** in Mock Mode).
- **Lights**: **Teach a light**, **Re-teach lights**, and the list headed **My lights (3)**. A light that may have moved after a tracking reset reads "approximate, re-teach".
- **Commands**: tabs **Lights**, **Capri**, and **Hermes**, **Prev** and **Next** for pages, and **Type**. Each row shows the phrase to say. A lit row says "Tap to run" and runs when poked. A row with a `<placeholder>` says "Say it" and only shows the phrase.
- **Ask Hermes** and **Give Hermes a task**: in Mock Mode both read **Set up Hermes on the 2D page**, and a poke makes Capri say that Hermes isn't connected.

## The two-minute path

Start the clock when you tap **Enter AR**. Each beat lists what you do, what Capri does, and what to do if it misfires. Voice recognition takes about 2.5 s from the end of your words (median measured on a Quest 3).

How to talk: point with the right hand first, then pinch and hold with the left hand, say the words, and let go. The microphone stays open 0.4 s after you let go. Keep the left hand low or in your lap, palm down or sideways: while the left palm faces you, the wrist button shows and the pinch does not talk. A pinch aimed at the menu counts as a button press and does not start listening either. The finger may drift once you start talking: Capri keeps the bulb you were pointing at.

### 0:00 to 0:10. Arrival (passthrough presence)

- **Do:** Tap **Enter AR** while looking straight ahead. Keep a hand in view. Look at Capri, then glance around the room.
- **Capri:** Appears in your real room, on the floor if one was detected, waves, and says one recorded greeting (for example "Hello, human. I'm feeling mischievous."). She breathes, blinks, and follows your head with her eyes. The three bulbs hang dark around her.
- **Misfire:** If she is missing, look around: she glides back into view after you have looked away for 3 s. If the session does not start, read the line under Enter AR on the 2D page. No greeting means no hand was tracked within 10 s; carry on.

### 0:10 to 0:20. Pointing

- **Do:** Point your right index finger at the desk lamp on your left. Then sweep to the floor lamp straight ahead.
- **Capri:** A ring highlights the bulb you point at, and Capri turns her head to look at it. The ring follows your finger and stays about 1 s after you point away.
- **Misfire:** No ring? Straighten the index finger and curl the others, and bring the hand into view. Do not pinch the pointing hand here: a right pinch confirms the bulb (it turns green), and a confirmed bulb wins over the pointed one for 8 s.

### 0:20 to 0:35. The signature moment: a voice command and the hacking effect

- **Do:** Point at the desk lamp. Pinch and hold with your left hand, say **"turn that on"**, let go.
- **Capri:** The bubble above her shows **Listening**, then "turn that on". She acknowledges with a recorded line (for example "On it. Jacking in."), turns to the lamp, flicks her hand, and sends beams and glyphs to it. A pulse lands on the marker, and only then is the command sent. The bulb lights warm white. She celebrates with a quip (for example "Too easy. You're welcome." or "Hacked it. No firewall stood a chance.") and her speech bubble says the result (for example "Lit up the desk lamp.").
- **Misfire:**
  - She says "Say that again? I didn't catch it." or "Static on the line...": say it again, or use the named form **"turn on the desk lamp"**, which needs no pointing.
  - She says "Point at a light first, then tell me again.": nothing was pointed at when you talked. Point first, then pinch.
  - Voice is not working: use the Commands row in the next-but-one beat.

### 0:35 to 0:50. Colour

- **Do:** Point at the floor lamp. Hold the left pinch, say **"set to red"**, let go.
- **Capri:** The same hacking sequence, then the floor lamp lights red and the bubble says, for example, "Painted the floor lamp red."
- **Misfire:** Say **"set to red floor lamp"** (the spoken form with a name).
- **Alternative:** **"dim that"** sets a bulb to 30 % and **"brighten that"** to 100 %, and the bulb's glow visibly changes.

### 0:50 to 1:20. The wrist menu, the Commands list, and the toggle tease

This beat flips the desk lamp twice more. With the "turn on" at 0:20, that makes three on/off toggles inside 60 s, which triggers a tease.

- **Do:**
  1. Point at the desk lamp, hold the left pinch, say **"turn that off"**, let go.
  2. Turn your left palm toward your face. When the glowing dot shows on the wrist, poke it with your right index finger. The menu opens on **Status**: **Mode: Mock Mode**, **Hermes: Not configured**. Turn the left hand back down.
  3. Poke **Commands**. The **Lights** tab shows "turn that on", "turn that off", "dim that", and "brighten that", each with "Tap to run". The title row reads **Lights 1/2: tap a lit row to run it**. Poke **Capri** to show the movement phrases, then **Lights** again.
  4. Point at the desk lamp with the right index finger again, and poke the **"turn that on"** row with your left index finger.
- **Capri:** The lamp goes dark ("Lights out on the desk lamp."). The menu closes as soon as the row runs, the bubble above her shows "turn that on", and the full hacking sequence lights the lamp again. After this third toggle she teases you by name, for example "On, off, on, off. The desk lamp is getting dizzy."
- **Misfire:**
  - No wrist dot: face the palm straight at your eyes and hold it there for a moment. Do not pinch with the left hand while its palm faces you: Quest uses that gesture for its own system menu, which pauses Capri.
  - The row ran with "Point at a light first": the right finger was not on the lamp. Point, then poke the row again (reopen the menu if it closed).
  - The tease needs three on/off toggles of the same bulb within 60 s. Colour and dim do not count. If you lost time, run "turn that off" once more.

### 1:20 to 1:45. Spatial movement

- **Do:** Hold the left pinch and say **"sit on the desk"**. When she sits, say **"come here"**, then **"look at me"**.
- **Capri:** She glides to the scanned desk or table and sits on it, then glides back to her spot near you and turns her head and eyes to you. These commands have no spoken reply. The movement is the answer.
- **Alternative:** Without a desk or table she stays put and says, for example, "I can't find the desk. Scan that bit of the room and ask again." Use **"go away"** instead: she backs off to about 2.5 m, still in view, and **"come here"** brings her back. With a table, **"perch on the table"** puts her on its edge.
- **Misfire:** Open the menu, poke **Commands**, then **Capri**, and poke the row (**"sit on the desk"**, **"come here"**, **"go away"**, **"perch on the table"**, **"look at me"**). **Next** shows the later rows.

### 1:45 to 2:00. Close

- **Do:** Sit back and look at Capri.
- **Capri:** Back to idle: breathing, blinking, and every 8 to 18 s a stretch, a fidget, or a glance at a bulb or a piece of furniture.

## Phrases that work

The recogniser listens only for a fixed set of phrase pieces (`src/domain/speech-lang/phrases.ts`) and chains them, so word order matters. "the", "a", and "please" may be added or left out. The **Commands** tile in the menu lists the same phrases, built from the same table.

| Say | What happens |
| --- | --- |
| "turn that on", "turn that off", "switch that off", "turn on that", "turn off that" | The pointed bulb. Both word orders work. "this", "it", "that one", "this one" work in place of "that". "turn on" or "turn off" alone also uses the pointed bulb. |
| "turn the desk lamp off", "turn the floor lamp on" | The split order with a bulb name, no pointing needed. |
| "turn on the desk lamp", "turn off the ceiling light" | A named bulb, no pointing needed. The names are desk lamp, floor lamp, and ceiling light. |
| "dim that", "brighten that" | 30 % and 100 % |
| "set to red", "set to red that", "set to blue floor lamp" | Colour. The colours are red, green, blue, purple, pink, orange, yellow, white, cyan, magenta, warm, and cool. |
| "come here", "go away" | She returns to her spot near you, or backs off to about 2.5 m. |
| "sit on the desk", "sit on the table", "sit on the couch" | Needs that surface in the room scan. Desk and table are treated as the same kind. |
| "perch on the table" | She perches on a table edge. Needs a table in the room scan. |
| "look at me" | She turns her head and eyes back to you. |
| "set a timer for one minute" | Timers from one to sixty minutes. She announces the end. |
| "remember this as window" | Saves the bulb you point at, or else the spot you look at. The spoken names are desk, shelf, window, door, bed, tv, and kitchen. Other names must be typed. |
| "look at window", "point at the desk lamp" | She looks or points at a remembered place or a bulb. |
| "ask hermes" | With Hermes connected, opens the Ask Hermes prompt on the Quest system keyboard. In Mock Mode, the not-connected line. |
| "hey capri", "hello", "how are you", "good morning", "what can you do", "tell me a joke" | Chat for Hermes when it is connected. In Mock Mode, the not-connected line, for example "Hermes isn't connected. You can add it on the setup page." |
| "run my evening routine", "watch the door", "research it and tell me when done" | Hermes tasks, only with Hermes connected. In Mock Mode, the not-connected line. |

These forms work only when typed (menu, **Commands**, **Type**), because the spoken grammar has no matching pieces:

- "set that to red", "set the floor lamp to red"

Say "turn that on" and "turn that off" in the demo and in the video. With synthetic speech through the app's Mock Mode grammar (task 32.3), the split forms were recognised and parsed correctly 75 times out of 80 attempts, the same as the joined forms ("turn off that") at 75 out of 80. These counts come from synthetic speech, not from a headset. If a take misfires, the joined form "turn off that" still works.

## Fallbacks when voice misfires

- **Say it again** once. The most common miss in the spike was a short command heard as "turn on turn off". Capri then asks you to repeat instead of acting.
- **Use the name** instead of pointing: "turn on the floor lamp".
- **Commands rows.** Open the menu and poke **Commands**. On the **Lights** tab, "turn that on", "turn that off", "dim that", and "brighten that" act on the bulb you point at with the right hand (or the one you confirmed with a right pinch in the last 8 s). Poke them with the left index finger so the right hand can keep pointing. On the **Capri** tab, "come here", "go away", "sit on the desk", "sit on the table", "sit on the couch", "perch on the table", "look at me", and "point at that" need no target. A poked row closes the menu and runs exactly as if you had said it.
- **Type.** On the **Commands** tile, poke **Type**. The Quest system keyboard opens with the prompt "Type a command for Capri". Type, then press Done. Typing takes longer than the 8 s a confirmed bulb stays selected, so type the name: **set floor lamp to red**, **turn desk lamp off**. Capri pauses while the keyboard is up, because the session is in the background then. If the headset does not offer the system keyboard in AR, **Type** and the two Hermes tiles are hidden and the menu says **Text entry is not available here**.
- **The mic was never allowed**: a left pinch shows **Mic not allowed** in the bubble above Capri, and the **Status** tile's **Voice** chip says so too. Use the Commands rows, or leave AR, tap **Enable microphone** on the 2D page, and enter again.
- **A "Teach me a light" panel opened** (from **Lights**, **Teach a light**): poke **Cancel**. While it waits for a point, the left pinch still talks. On **Is this the spot?** and the light or name lists, the left pinch means **Try again** or next row, so the panel says to finish the step before talking.

## Optional extras (when you have more time)

- **Teach pointer (about 15 s).** Open the menu, poke **Lights**, then **Teach a light**. The menu closes and the **Teach me a light** panel opens on your left. A thin ray runs from your right index fingertip to a small ring where the light would be placed. The ring is blue on a real surface and amber when nothing is hit, in which case it sits 2.0 m along your finger and **Nearer** and **Farther** move it. Poke **Cancel** to leave without changing anything.
- **Hermes honesty (about 10 s).** Say **"run my evening routine"**, or open the menu and poke **Set up Hermes on the 2D page**. Capri answers in a bubble that Hermes isn't connected and can be added on the setup page. She never pretends to run a task.
- **Timer.** Say **"set a timer for one minute"**. She answers, for example, "Timer set for 1 minute. Count on me." A minute later she plays her notification gesture and says, for example, "Time's up! Your timer for 1 minute just ran out."
- **Places.** Look at a spot, for example your window, and say **"remember this as window"**. If you point at a bulb while you say it, the bulb's spot is saved instead. She answers, for example, "Got it. I'll remember window." Then say **"look at window"**.
- **Ignored reaction.** Sit still: no pinches, no pointing, no commands for 60 s. Capri reacts with an annoyed gesture and a tease, for example "Bored already? I can tell." or "Staring is free. Talking is better."
- **Idle life.** While you watch, she stretches, fidgets, or glances at furniture and bulbs every 8 to 18 s.

## Optional Live Mode beat (your own Home Assistant and Hermes)

This beat needs a Home Assistant reachable over `https://` with `https://capri.sanyamchhabra.in` in its CORS allowed origins, and optionally a Hermes Agent set up as in the README section "Hermes Agent". The README sections "Live Mode" and "Home Assistant: CORS allowed origins" explain the setup. Judges do not need it.

1. On the 2D page, open **Connect your own home (optional)**. Fill in **Home Assistant URL** and **Home Assistant long-lived token**. **Hermes URL** and **Hermes key** are optional.
2. Turn on **Live Mode (use my Home Assistant instead of the virtual bulbs)**, select **Save**, then **Test connections**. Each backend gets one result line. The badge now reads **Live Mode**.
3. Tap **Enter AR**. No virtual bulbs appear. In the menu, **Status** reads **Live Mode** and **Home Assistant: Connected**.
4. Poke **Lights**, then **Teach a light**. On **Teach me a light**, point at your real lamp with the right index finger: the ray and ring show where the marker will go. Pinch with the right hand to place it at the ring. On **Which light is it?**, tap the light. A marker appears where the ring was.
5. Point at the lamp, hold the left pinch, and say **"turn that off"**. After the hacking effect your real lamp switches off, and Capri reacts to the result Home Assistant reports. If a request fails, she says so in character and gives the reason, with the origin to allow when it is a CORS failure.
6. With Hermes connected, poke **Ask Hermes** in the menu, type a question on the Quest system keyboard, and press Done. Capri shows a thinking line, then Hermes's answer in her speech bubble. **Give Hermes a task** starts a Hermes run instead: the task panel opens on your right with the current step, **Approve** and **Deny** when Hermes asks permission, and Capri announces the real result. Saying a task phrase such as "research it and tell me when done" also starts a run. Without Hermes, both tiles read **Set up Hermes on the 2D page**.

To return to Mock Mode, turn Live Mode off and select **Save**, or select **Forget credentials**.

## Known limits that affect the demo

- Every mock bulb starts off, so the first command must be "turn on", not "turn off".
- Capri greets you once per AR session: one recorded line from the voice library's greeting set (a different one from the last time) plays while she waves. It waits until the loading card has gone and a hand is tracked, so it never shares the screen with the hand-lost message. If no hand shows up within 10 s, she skips the greeting for that session. Resuming from the Meta menu never repeats it. If the audio did not start, the line shows as a speech bubble with chirps instead. The 60 s ignored timer starts when the greeting ends.
- Mock Mode has no agent. Chat phrases, task phrases, "ask hermes", and the two Hermes tiles all get the not-connected line, and the task panel never opens.
- The Quest system keyboard in AR (**Type**, **Ask Hermes**, **Give Hermes a task**) has not been checked on the headset yet. Capri pauses while it is up.
- The session asks for a boundaryless (`unbounded`) reference space and falls back to `local-floor`. Whether the Quest boundary is gone in Quest Browser has not been checked on the headset yet. If tracking resets (for example after a recenter), the bulbs and Capri are placed again in front of you, and a taught light without an anchor is listed in **Lights** as "approximate, re-teach".
- While your left palm faces you, the wrist button shows and the left pinch does not talk. A left pinch with the palm facing you can open the Quest system menu, which pauses Capri.
- The dominant hand is always the right hand. No setting changes it in the session.
- The ignored reaction needs 60 s of no input, so it does not fit inside the two-minute path.
- Lines outside the recorded voice library, such as "Lit up the desk lamp." and the not-connected line, show as a speech bubble with chirps and no spoken voice, because Quest Browser has no speech synthesis.
- Developer overlays are off by default, on the dev server too: `?hands=1` draws the hand joint dots, `?dev=1` shows the dev panel, `?handtest=1` shows the hand test panel, and `?perf=1` shows the frame-time overlay.
