# Demo_Path: Capri in two minutes

This is the scripted demo for judges and for the demo video (Requirements 8.6, 28.5, 28.6, 28.8). It runs seated, with hands only, in Mock Mode from the hosted link `https://capri.sanyamchhabra.in`. Mock Mode needs no smart home and no setup: three virtual bulbs appear in your room and a scripted agent stands in for Hermes.

In two minutes it shows passthrough presence, pointing, a voice command, the hacking effect, a quip, and one Hermes task. Every word, label, and gesture below comes from the current code. Where Capri picks one of several lines at random, the script says "for example".

A few terms:

- **AR session**: the immersive mode that Enter AR starts. The headset shows your real room through its cameras (passthrough), and Capri and the bulbs are drawn into it.
- **Dominant hand**: your right hand. It points and confirms. Capri has no setting to swap hands yet.
- **Non-dominant hand**: your left hand. Holding a pinch with it is push-to-talk.
- **Pinch**: thumb tip to index fingertip.
- **Point**: index finger straight, the other fingers curled. A flat open hand does not count as pointing.

## Try it in 60 seconds (for judges)

1. In Quest Browser, open `https://capri.sanyamchhabra.in`. Put the controllers down.
2. Tap **Enable microphone** and allow it in the browser prompt. This step is optional. Without it, use the buttons described in step 6.
3. Wait for **Voice model ready.** The first visit downloads about 40 MB. Later visits load it from the headset in a few seconds.
4. Look straight ahead and tap **Enter AR**. Capri appears about 1.25 m in front of you, a little to the right, and waves. Three dark bulbs hang around her.
5. Point your right index finger at the bulb on your left (the desk lamp). A ring appears on it and Capri looks at it. Keep pointing, pinch and hold with your left hand, say **"turn on that"**, then let go. Capri flicks her hand, beams hit the bulb, it lights up, and she brags about it.
6. No voice? Poke **Quick actions** on the small panel low on your right, keep pointing at a bulb with your right hand, and poke **Turn on** with your left index finger.
7. Say **"run my evening routine"** or poke that button. A task panel tracks the progress, and Capri tells you when it is done.

## Pre-flight checklist

Do these before the clock starts.

- [ ] **Volume up.** Capri's recorded lines, chirps, and hacking sounds come out of the headset speakers.
- [ ] **Controllers down.** Hand tracking must be on in the Quest settings, and the headset switches to hands when you put the controllers down. If Capri shows **Bring your hands into view**, hold your hands up in front of the headset.
- [ ] **Room scanned.** Run Space Setup on the Quest so the floor, walls, and furniture are known. With a floor, Capri stands on it; without one, she floats. "Sit on the desk" needs a desk or table in the scan.
- [ ] **Allow the mic on the 2D page.** Tap **Enable microphone** before Enter AR and accept the prompt until the page says **Microphone: allowed.** The spike showed that a first microphone prompt inside AR ends the session, so do not skip this step.
- [ ] **Wait for "Voice model ready."** Enter AR works earlier, but the mic orb then reads **Voice loading** and only the buttons work.
- [ ] **Fresh page load.** Reload the page before a run. Every mock bulb starts **off**, and the routine and the toggle count start clean.
- [ ] **Seat and space.** Sit facing an open part of the room, at least 2.5 m deep. Everything is placed relative to where your head faces in the first moment of the session, so look straight ahead when you tap Enter AR and hold still for a second.
- [ ] **Know the mode.** The entry page shows the **Mock Mode** badge. If it says Live Mode, open **Connect your own home (optional)**, turn Live Mode off, and select **Save**.

## Where things appear

Positions are relative to your head when the session starts.

| Thing | Where |
| --- | --- |
| Capri | 1.25 m ahead, about 25° to your right, facing you. She glides back into view if you look more than 60° away for 3 s. |
| Desk lamp | 35° to your left, 1.8 m away, a little below eye height |
| Floor lamp | Almost straight ahead, 2.2 m away, lower |
| Ceiling light | 40° to your right, 2.0 m away, above eye height |
| Mic orb | Low on your left, within reach (0.45 m). Its label reads **Tap to talk**, **Listening**, **Voice loading**, or **Mic off**. |
| Quick actions | Low on your right, within reach. Compact at first: **Quick actions** and **Keyboard**. Poke **Quick actions** to show the eight buttons. |
| Transcript | Straight ahead, just below eye height. It shows **Listening**, then your words. |
| Status chips | Straight ahead, above eye height: **Mode: Mock Mode**, **Home Assistant: Connected**, **Hermes: Connected**, **Voice: Voice ready** (or **Voice loading**) |
| Task panel | 30° to your right, 1.2 m away, while a task runs |
| My lights panel and the **Teach me your lights** orb | The panel is on your left. The orb floats beside Capri. Neither is needed in Mock Mode. |

## The two-minute path

Start the clock when you tap **Enter AR**. Each beat lists what you do, what Capri does, and what to do if it misfires. Voice recognition takes about 2.5 s from the end of your words (median measured on a Quest 3).

How to talk: point with the right hand first, then pinch and hold with the left hand, say the words, and let go. The microphone stays open 0.4 s after you let go. Keep the left hand low or in your lap. A pinch aimed at a panel or the orb counts as a button press and does not start listening. The finger may drift once you start talking: Capri keeps the bulb you were pointing at.

### 0:00 to 0:10. Arrival (passthrough presence)

- **Do:** Tap **Enter AR** while looking straight ahead. Look at Capri, then glance around the room.
- **Capri:** Appears in your real room, on the floor if one was detected, and waves. She breathes, blinks, and follows your head with her eyes. The three bulbs hang dark around her. The chips above read **Mock Mode**.
- **Misfire:** If she is missing, look around: she glides back into view after you have looked away for 3 s. If the session does not start, read the line under Enter AR on the 2D page.

### 0:10 to 0:20. Pointing

- **Do:** Point your right index finger at the desk lamp on your left. Then sweep to the floor lamp straight ahead.
- **Capri:** A ring highlights the bulb you point at, and Capri turns her head to look at it. The ring follows your finger and stays about 1 s after you point away.
- **Misfire:** No ring? Straighten the index finger and curl the others, and bring the hand into view. Do not pinch the pointing hand here: a right pinch confirms the bulb (it turns green), and a confirmed bulb wins over the pointed one for 8 s.

### 0:20 to 0:35. The signature moment: a voice command and the hacking effect

- **Do:** Point at the desk lamp. Pinch and hold with your left hand, say **"turn on that"**, let go.
- **Capri:** The transcript shows "turn on that". She acknowledges with a recorded line (for example "On it. Jacking in."), turns to the lamp, flicks her hand, and sends beams and glyphs to it. A pulse lands on the marker, and only then is the command sent. The bulb lights warm white. She celebrates with a quip (for example "Too easy. You're welcome." or "Hacked it. No firewall stood a chance.") and a bubble says the result (for example "Lit up the desk lamp.").
- **Misfire:**
  - She says "Say that again? I didn't catch it." or "Static on the line...": say it again, or use the named form **"turn on the desk lamp"**, which needs no pointing.
  - She says "Point at a light first, then tell me again.": nothing was pointed at when you talked. Point first, then pinch.
  - Voice is not working: poke **Quick actions**, then, while the right hand points at the lamp, poke **Turn on** with the left index finger.

### 0:35 to 0:50. Colour

- **Do:** Point at the floor lamp. Hold the left pinch, say **"set to red"**, let go.
- **Capri:** The same hacking sequence, then the floor lamp lights red and the bubble says, for example, "Painted the floor lamp red."
- **Misfire:** Say **"set to red floor lamp"** (the spoken form with a name). Quick actions has no colour button. On the **Keyboard**, type **set floor lamp to red** and poke **Send**.
- **Alternative:** **"dim that"** sets a bulb to 30 % and **"brighten that"** to 100 %, and the bulb's glow visibly changes.

### 0:50 to 1:10. Quick actions and the toggle tease

This beat flips the desk lamp twice more. With the "turn on" at 0:20, that makes three on/off toggles inside 60 s, which triggers a tease.

- **Do:** Point at the desk lamp, hold the left pinch, say **"turn off that"**, let go. When the bulb has gone dark, keep pointing at it with the right hand, poke **Quick actions** if the buttons are hidden, then poke **Turn on** with the left index finger.
- **Capri:** The lamp goes dark ("Lights out on the desk lamp."), then lights up again from the button. After the third toggle she teases you by name, for example "On, off, on, off. The desk lamp is getting dizzy."
- **Misfire:** The tease needs three on/off toggles of the same bulb within 60 s. Colour and dim do not count. If you lost time, send one more "turn off that" or **Turn off**.

### 1:10 to 1:22. Spatial movement

- **Do:** Hold the left pinch and say **"go away"**. When she has moved, say **"come here"**.
- **Capri:** She glides back to about 2.5 m, then returns to her spot near you. Neither command has a spoken reply.
- **Alternative:** If your Space Setup has a desk or table, say **"sit on the desk"** (or poke **Sit on the desk**). She glides to it and sits on it. Without one she stays put and says, for example, "I can't find the desk. Scan that bit of the room and ask again."
- **Misfire:** Poke **Go away** and **Come here** on Quick actions.

### 1:22 to 1:50. One Hermes task

- **Do:** Hold the left pinch, say **"run my evening routine"**, let go. Or poke **Run my evening routine** on Quick actions.
- **Capri:** She acknowledges without claiming anything is done (for example "Hmm, let me think." or "Crunching the numbers."). The task panel opens on your right with the title **Evening routine** and the status **... Running**. Progress moves through Getting started 0 %, Checking the lights 25 % (after 2.5 s), Winding down the room 60 % (6 s), and All set 100 % (10 s). While it runs she fidgets and glances around. When it ends, the panel shows **+ Done** and "Your evening routine is done." She plays her notification gesture, says a recorded completion line (for example "Ding! Your task just came through."), and closes with a celebration and a bubble such as "Wrapped up the routine."
- **Misfire:** Poke the Quick actions button. The routine is scripted progress only: it does not change the bulbs.

### 1:50 to 2:00. Close

- **Do:** Aim a hand at **Dismiss** on the task panel and pinch, or leave it: it closes 10 s after the task ends. Look back at Capri.
- **Capri:** Back to idle: breathing, blinking, and every 8 to 18 s a stretch, a fidget, or a glance at a bulb or a piece of furniture.

## Phrases that work

The recogniser listens only for a fixed set of phrase pieces (`src/domain/speech-lang/phrases.ts`) and chains them, so word order matters. "the", "a", and "please" may be added or left out.

| Say | What happens |
| --- | --- |
| "turn on that", "turn off that" | The pointed bulb. "this", "it", "that one", "this one" work in place of "that". "turn on" or "turn off" alone also uses the pointed bulb. |
| "turn on the desk lamp", "turn off the ceiling light" | A named bulb, no pointing needed. The names are desk lamp, floor lamp, and ceiling light. |
| "dim that", "brighten that" | 30 % and 100 % |
| "set to red", "set to red that", "set to blue floor lamp" | Colour. The colours are red, green, blue, purple, pink, orange, yellow, white, cyan, magenta, warm, and cool. |
| "come here", "go away" | She returns to her spot near you, or backs off to about 2.5 m. |
| "sit on the desk", "sit on the table", "sit on the couch" | Needs that surface in the room scan. Desk and table are treated as the same kind. |
| "set a timer for one minute" | Timers from one to sixty minutes. She announces the end. |
| "remember this as window" | Saves the bulb you point at, or else the spot you look at. The spoken names are desk, shelf, window, door, bed, tv, and kitchen. Other names must be typed. |
| "look at window", "point at the desk lamp" | She looks or points at a remembered place or a bulb. |
| "run my evening routine" | The scripted task that completes |
| "watch the door" | The scripted task that fails (see below) |
| "research it and tell me when done" | A second scripted task that completes |
| "hey capri", "hello", "how are you", "good morning", "what can you do", "tell me a joke" | In Mock Mode these all get the same canned reply: "Mock Mode here, so my smart friend is a script today. I'll keep it light." |

These forms work only when typed on the Hand_Keyboard, because the spoken grammar has no matching pieces:

- "turn that off", "turn that on", "turn the desk lamp off"
- "set that to red", "set the floor lamp to red"

Say "turn off that" in the demo and in the video. "turn that off" is not recognised by voice.

## Fallbacks when voice misfires

- **Say it again** once. The most common miss in the spike was a short command heard as "turn on turn off". Capri then asks you to repeat instead of acting.
- **Use the name** instead of pointing: "turn on the floor lamp".
- **Poke the mic orb** instead of pinching. It listens until 1.2 s of silence, or 8 s at most.
- **Quick actions**: **Turn on**, **Turn off**, **Dim**, and **Brighten** act on the bulb you point at with the right hand (or the one you confirmed with a right pinch in the last 8 s). **Come here**, **Sit on the desk**, **Go away**, and **Run my evening routine** need no target. Poke with the left index finger so the right hand can keep pointing.
- **Keyboard**: poke **Keyboard** on Quick actions. Type with pokes, then poke **Send** (or **Close**). Typing takes longer than the 8 s a confirmed bulb stays selected, so type the name: **set floor lamp to red**, **turn desk lamp off**.
- **The mic was never allowed**: the chip reads **Mic not allowed** and Quick actions opens by itself. Leave AR, tap **Enable microphone** on the 2D page, and enter again.
- **A "Teach me a light" panel opened**: a pinch landed on the **Teach me your lights** orb beside Capri. Poke **Cancel**. Push-to-talk does not work while that panel is open.

## Optional extras (when you have more time)

- **Failure path (about 10 s).** Say **"watch the door"**. The task panel shows **Door watch**, then "Looking for the door" and "Connecting to the camera" (25 %). After 5 s it shows **x Failed** with "I can't see the door from here." Capri says a recorded error line (for example "Ugh, that didn't work."), then gives the reason with a shrug. She never claims the task worked.
- **Timer.** Say **"set a timer for one minute"**. She answers, for example, "Timer set for 1 minute. Count on me." A minute later she plays her notification gesture and says, for example, "Time's up! Your timer for 1 minute just ran out." Do not start it right before the routine, or the two announcements overlap.
- **Places.** Look at a spot, for example your window, and say **"remember this as window"**. If you point at a bulb while you say it, the bulb's spot is saved instead. She answers, for example, "Got it. I'll remember window." Then say **"look at window"**.
- **Ignored reaction.** Sit still: no pinches, no pointing, no commands for 60 s. Capri reacts with an annoyed gesture and a tease, for example "Bored already? I can tell." or "Staring is free. Talking is better."
- **Idle life.** While you watch, she stretches, fidgets, or glances at furniture and bulbs every 8 to 18 s.

## Optional Live Mode beat (your own Home Assistant)

This beat needs a Home Assistant reachable over `https://` with `https://capri.sanyamchhabra.in` in its CORS allowed origins. The README sections "Live Mode" and "Home Assistant: CORS allowed origins" explain the setup. Judges do not need it.

1. On the 2D page, open **Connect your own home (optional)**. Fill in **Home Assistant URL** and **Home Assistant long-lived token**. **Hermes URL** and **Hermes key** are optional.
2. Turn on **Live Mode (use my Home Assistant instead of the virtual bulbs)**, select **Save**, then **Test connections**. Each backend gets one result line. The badge now reads **Live Mode**.
3. Tap **Enter AR**. The chips read **Live Mode** and **Home Assistant: Connected**. No virtual bulbs appear.
4. Poke or pinch the **Teach me your lights** orb beside Capri. Follow **Teach me a light**: point at your real lamp with the right index finger and pinch. On **Which light is it?**, tap the light. A marker appears where you pointed.
5. Point at the lamp, hold the left pinch, and say **"turn off that"**. After the hacking effect your real lamp switches off, and Capri reacts to the result Home Assistant reports. If a request fails, she says so in character and gives the reason, with the origin to allow when it is a CORS failure.
6. Without a configured Hermes, "run my evening routine" gets the line "My smart friend isn't answering. I'll handle it on my own." (or a similar one). The scripted task is never substituted in Live Mode.

To return to Mock Mode, turn Live Mode off and select **Save**, or select **Forget credentials**.

## Known limits that affect the demo

- Every mock bulb starts off, so the first command must be "turn on", not "turn off". The task 20 hand-off note and the task 29.2 video plan open with "turn off that" or "turn that off". The second is not recognised by voice.
- Capri waves on arrival but says nothing. The greeting lines exist in the voice library and are preloaded, but nothing plays them.
- In Mock Mode, every chat phrase ("hello", "what can you do", "tell me a joke") gets the same canned reply.
- The evening routine reports progress only and changes no bulbs.
- The dominant hand is always the right hand. No setting changes it in the session.
- The ignored reaction needs 60 s of no input, so it does not fit inside the two-minute path.
- Lines outside the recorded voice library, such as "Lit up the desk lamp.", show as a speech bubble with chirps and no spoken voice, because Quest Browser has no speech synthesis.
