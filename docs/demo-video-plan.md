# Demo video plan

The plan for the submission video (Requirements 31.2 and 31.4). The video must be shorter than 3:00. The target is 2:30, and the hard ceiling for the exported file is 2:55.

It shows Mock Mode running from the hosted link `https://capri.sanyamchhabra.in`, hands-only interaction, the signature moment (point, speak, hacking effect, real result), and one Hermes task. Every action, phrase, and on-screen label comes from [`docs/demo-path.md`](demo-path.md), the path verified on a Quest 3. Read that file's pre-flight checklist and "Known limits" before recording.

A few terms:

- **AR session**: the immersive mode that **Enter AR** starts. The headset shows the real room through its cameras (passthrough), and Capri and the bulbs are drawn into it.
- **Mock Mode**: the default. Three virtual bulbs and a scripted agent stand in for a smart home and for Hermes. It needs no setup.
- **Live Mode**: optional. Capri controls the user's own Home Assistant lights and sends tasks to the user's own Hermes agent.
- **Hermes**: an AI agent that runs longer tasks in the background. Capri hands it a task, shows progress on the **Task_Panel**, and tells you when it finishes.
- **Pinch**: thumb tip to index fingertip. **Point**: index finger straight, other fingers curled.

## Script rules (from the verified path)

These come from task 27.7 and override older wording in `tasks.md`.

- **All three mock bulbs start off.** The signature moment is **"turn that on"**. Never open with a "turn off" command.
- **Spoken word order is "turn that on" / "turn that off".** Both word orders are recognised by voice (task 32.3). The joined order "turn on that" / "turn off that" is the fallback for a misfired take.
- **Capri says one recorded greeting while she waves on arrival**, once per AR session, picked at random from the voice library's greeting set. It waits for a tracked hand (keep a hand in view after tapping **Enter AR**) and is skipped if none shows within 10 s. It does not replay after the Meta menu, so a retake of the arrival needs a fresh **Enter AR**. Do not script a hello exchange: the user says nothing back.
- **Mock Mode chat replies are canned.** "hello", "what can you do", and "tell me a joke" all get the same reply. Keep chat out of the video.
- **Lines with a bulb name or a result are speech bubbles with chirps, not spoken audio**, because Quest Browser has no speech synthesis. Examples: "Lit up the desk lamp.", the toggle tease. Caption every one of them.
- **Capri picks some lines at random.** Lines marked "for example" below may differ in your take. Caption the line that actually appears.
- **The evening routine changes no bulbs.** It is scripted progress only. Do not imply that it switched lights.
- **Voice recognition takes about 2.5 s** after you stop speaking. Do not cut this wait out of the signature moment (see the editing checklist).

## Shot list (target 2:30)

Video time is the time in the final cut. "Take source" says where the footage comes from, because the cut reorders the recorded take: the signature moment is filmed after arrival and pointing, but it opens the video.

Caption styles used below:

- **SPEECH**: the words the user says, in quotes, bottom centre (for example `"turn that on"`).
- **CAPRI**: what Capri says or shows in a bubble, bottom centre, a different colour from SPEECH.
- **LOWER THIRD**: a short explainer, lower left, 3 to 4 s.

### Shot 1. 0:00 to 0:18. Cold open: the signature moment

- **Take source:** main take, the 0:20 to 0:35 beat of the demo path. Use the uncut real-time clip.
- **On screen:** the real room in passthrough. Capri stands ahead and to the right. The desk lamp hangs dark on the left.
- **Action:** point the right index finger at the desk lamp. A ring appears on it and Capri turns her head to look. Pinch and hold with the left hand, say the phrase, let go.
- **Spoken:** "turn that on"
- **Capri:** the transcript shows "turn that on". She says a recorded acknowledgement (for example "On it. Jacking in."), turns to the lamp, flicks her hand, and sends beams and glyphs to it. A pulse lands on the bulb, which then lights warm white. She celebrates with a quip (for example "Too easy. You're welcome.") and a bubble says the result (for example "Lit up the desk lamp.").
- **Captions:** SPEECH `"turn that on"`. CAPRI the acknowledgement, the quip, and the bubble text.
- **Lower third (at the pointing, about 0:02):** "Point at a light." Then (at the hacking effect, about 0:09): "Say it. Capri hacks it."
- **Framing:** turn the head slowly so the lamp sits left of centre and Capri right of centre. The lamp is 35° left and Capri 25° right of the start direction, which is wider than one recorded eye's frame.

### Shot 2. 0:18 to 0:30. Title and the hosted link

- **Take source:** main take, the 2D page before **Enter AR**.
- **On screen:** Quest Browser with `capri.sanyamchhabra.in` in the address bar, the **Mock Mode** badge, **Microphone: allowed.**, and **Voice model ready.** The hand taps **Enter AR**.
- **Action:** look straight ahead and tap **Enter AR**.
- **Spoken:** none.
- **Capri:** not yet visible.
- **Captions:** title card over the first 3 s: "Capri: a spatial companion for your home". LOWER THIRD: "capri.sanyamchhabra.in · Mock Mode · no setup".

### Shot 3. 0:30 to 0:42. Arrival in the real room

- **Take source:** main take, the 0:00 to 0:10 beat.
- **On screen:** Capri appears about 1.25 m ahead, on the floor if one was scanned, and waves. She breathes, blinks, and follows the head with her eyes. Three dark bulbs hang around her. The status chips above read **Mode: Mock Mode**.
- **Action:** look at Capri, then glance slowly around the room. Raise both hands into view once, open, to show there are no controllers.
- **Spoken:** none from the user. Capri says her recorded greeting while she waves (for example "Hello, human. I'm feeling mischievous."). Caption the line that actually plays as CAPRI.
- **Captions:** LOWER THIRD: "She lives in your real room." Then: "Hands only. No controllers."

### Shot 4. 0:42 to 0:55. Pointing

- **Take source:** main take, the 0:10 to 0:20 beat.
- **On screen:** a ring follows the finger from the desk lamp to the floor lamp. Capri's head follows the ring.
- **Action:** point at the desk lamp, then sweep slowly to the floor lamp straight ahead. Do not pinch the pointing hand.
- **Spoken:** none.
- **Captions:** LOWER THIRD: "She follows where you point."

### Shot 5. 0:55 to 1:08. Colour (cut first if over time)

- **Take source:** main take, the 0:35 to 0:50 beat.
- **On screen:** the second hacking sequence, then the floor lamp lights red. The desk lamp from shot 1 stays lit in the background.
- **Action:** point at the floor lamp, hold the left pinch, say the phrase, let go.
- **Spoken:** "set to red"
- **Capri:** the hacking sequence, then a bubble (for example "Painted the floor lamp red.").
- **Captions:** SPEECH `"set to red"`. CAPRI the bubble text.
- **Trim:** the 2.5 s recognition wait may be shortened here, because shot 1 already showed it in real time.

### Shot 6. 1:08 to 1:28. Quick actions and the toggle tease

- **Take source:** main take, the 0:50 to 1:10 beat. The tease needs three on/off toggles of the same bulb within 60 s of recording time, counting the "turn that on" of shot 1. Run the take at the demo-path pace and it lands.
- **On screen:** the desk lamp goes dark. Then the **Quick actions** panel, low on the right, and the left index finger poking **Turn on** while the right hand points at the lamp. The lamp lights again.
- **Action:** point at the desk lamp, hold the left pinch, say the phrase, let go. When the lamp is dark, keep pointing, poke **Quick actions** if the buttons are hidden, then poke **Turn on** with the left index finger.
- **Spoken:** "turn that off"
- **Capri:** a bubble "Lights out on the desk lamp.", then after the button press she teases (for example "On, off, on, off. The desk lamp is getting dizzy.").
- **Captions:** SPEECH `"turn that off"`. CAPRI both bubble lines. LOWER THIRD (on the poke): "Every command has a poke button too."
- **Trim:** cut the wait while the Quick actions panel expands.

### Shot 7. 1:28 to 1:45. Spatial moves

- **Take source:** main take, the 1:10 to 1:22 beat.
- **On screen:** Capri glides to the scanned desk and sits on it, then glides back to her spot near you.
- **Action:** hold the left pinch, say the first phrase, let go. When she is seated, say the second.
- **Spoken:** "sit on the desk", then "come here"
- **Capri:** no spoken reply to either command. The movement is the response.
- **Captions:** SPEECH both phrases. LOWER THIRD: "She knows your furniture."
- **Requires:** a desk or table in the Quest Space Setup scan. Without one, use "go away" then "come here" (she backs off to about 2.5 m and returns) and change the lower third to "She moves around your room."
- **Trim:** shorten each glide to about 3 s.

### Shot 8. 1:45 to 2:15. One Hermes task

- **Take source:** main take, the 1:22 to 1:50 beat.
- **On screen:** the Task_Panel opens about 30° to the right with the title **Evening routine** and the status **... Running**. Progress runs Getting started 0 %, Checking the lights 25 % (at 2.5 s), Winding down the room 60 % (at 6 s), and All set 100 % (at 10 s). Capri fidgets and glances around while it runs. At the end the panel shows **+ Done** and "Your evening routine is done."
- **Action:** hold the left pinch, say the phrase, let go. Turn the head slowly right so both Capri and the panel are in frame.
- **Spoken:** "run my evening routine"
- **Capri:** a recorded acknowledgement that claims nothing is done yet (for example "Hmm, let me think."). At completion she plays her notification gesture, says a recorded line (for example "Ding! Your task just came through."), celebrates, and a bubble says (for example) "Wrapped up the routine."
- **Captions:** SPEECH `"run my evening routine"`. CAPRI the acknowledgement, the completion line, and the bubble. LOWER THIRD (at the panel): "Capri hands long tasks to an agent (Hermes)." Then: "Mock Mode: a scripted agent stands in." During the trimmed progress: "10 s routine, shortened".
- **Trim:** keep 0 %, 25 %, and 100 %. Cut 60 % or speed-ramp through it. Keep the completion notify and celebration whole.

### Shot 9 (optional). 2:15 to 2:35. Live Mode: a real lamp and real Hermes

Include this shot **only if the full beat has been verified on the headset with the user's own Home Assistant and Hermes**. If it is not verified, drop it and move the closing card to 2:15, which ends the video at 2:30. If it is included, cut shot 5 so the video stays near 2:37.

- **Take source:** a separate Live Mode take, set up off camera, plus phone B-roll of the real lamp.
- **Setup (off camera):** on the 2D page, open **Connect your own home (optional)**, fill in the Home Assistant and Hermes fields, turn on Live Mode, **Save**, **Test connections**. Teach Capri the real lamp with **Teach me your lights** before recording. Switch the real lamp on. Never film the settings form, the URLs with tokens, or the keys.
- **On screen:** the chips read **Live Mode** and **Home Assistant: Connected**. No virtual bulbs. The marker sits on the real lamp.
- **Action:** point at the real lamp, hold the left pinch, say the first phrase, let go. Then say the second phrase.
- **Spoken:** "turn that off", then a Hermes task phrase confirmed on the headset in Live Mode (for example "run my evening routine").
- **Capri:** the hacking effect, then the real lamp switches off and Capri reacts to the result Home Assistant reports. For the Hermes task, the Task_Panel shows qualitative progress from the real agent (step labels, no percentages) and Capri announces the result.
- **Captions:** SPEECH both phrases. CAPRI the lines that appear. LOWER THIRD: "Live Mode: my real lamp, through Home Assistant." Then: "My real Hermes agent."
- **Cut:** split screen or a 2 s cut to the phone B-roll of the physical lamp switching off. This is the proof that the result is real.
- **Trim:** real Hermes runs can take much longer than 10 s. Show the start and the completion, label the gap "sped up", and drop the task from this shot if it does not complete inside one take.

### Shot 10. 2:15 to 2:30 (2:35 to 2:50 with shot 9). Closing card

- **On screen:** a still of Capri in the room, darkened, with text over it.
- **Text:**
  - "Try Capri on Meta Quest 3: **https://capri.sanyamchhabra.in**"
  - "Works in Mock Mode with zero setup. Open the link, tap Enter AR."
  - "Hands only. Optional Live Mode for your own Home Assistant and Hermes."
- **Audio:** let Capri's last chirp or idle sound tail off. No new spoken line.
- **Duration:** 15 s, so a viewer can read and type the link.

### Running times

| Cut | Shots | Length |
| --- | --- | --- |
| Standard | 1 to 8, 10 | 2:30 |
| With Live Mode | 1 to 4, 6 to 10 (shot 5 cut) | about 2:37 |
| With Live Mode and colour | 1 to 10 | about 2:50 (allowed, but no slack) |

## Capture setup on the Quest

### Before every take

- Run the pre-flight checklist in `docs/demo-path.md`: volume up, controllers down, room scanned with the desk included, mic allowed on the 2D page, **Voice model ready.**, Mock Mode badge.
- **Reload the page** before each take. Bulbs start off and the toggle count resets only on a fresh load.
- Clear clutter from the area in front of you and light the room evenly. Passthrough is grainy in a dim room. Avoid a bright window straight ahead.
- Tell anyone in the room that you are recording. Quest 3 and 3S blink a white light while passthrough is recorded or cast ([Meta help](https://www.meta.com/help/quest/882356143198485/)).
- Do not use `?perf=1` in the recorded take. Its overlay would appear in the video.

### Method A (primary): record in the headset

Meta's help describes the steps with controllers ([record video](https://www.meta.com/help/quest/articles/in-vr-experiences/social-features-and-sharing/record-video-oculus/), [camera settings](https://www.meta.com/help/quest/2514032915451395/)). With hands only, open the universal menu with the system hand gesture instead of the Meta button.

1. **Settings, once:** open the universal menu, select **Camera**, then **Camera settings** (top right). Set **Video aspect ratio** to landscape (1920 × 1080). Under **More settings**, set **Frame rate** to the highest offered, **Video compression quality** to the highest (20 Mbps), and **Image stabilisation** to low. Meta's capture guide recommends landscape 1920 × 1080, 36 fps (variable), 20 Mbps, and low stabilisation for in-headset first-person capture ([Meta capture guide](https://developers.meta.com/horizon/resources/video-capture-mr-vr/)). If a microphone audio option appears in Camera settings, turn it on so your spoken commands are recorded.
2. **Start recording on the 2D page, before Enter AR:** universal menu, **Camera**, **Record video**. A red dot appears in the headset.
3. **Do the take** in one continuous run. Do not open the universal menu during the AR session: hiding the session triggers Capri's pause (`src/ui/pause.ts`), which freezes her and stops the microphone.
4. **Stop recording** after you leave AR: universal menu, **Camera**, **Recording**. Trim the menu out in the edit.
5. **Transfer:** the files appear in Files (Media or Recents) and in the Gallery app. On a Mac, use Meta Quest Developer Hub's file manager (Method B) to copy them. Meta's guide notes that its Link-cable copy method does not work on a Mac.

### Method B (fallback): Meta Quest Developer Hub over USB

Use this if Method A drops frames, records no passthrough, or you want 60 fps. It needs developer mode and a USB-C cable.

1. Install Meta Quest Developer Hub (Windows or Mac) and connect the headset.
2. On **Device Manager**, open the **Record Video** settings. Choose **1080p at 60 FPS**. Meta's guide lists 2160p at 60 FPS and 40 Mbps as the maximum, but recording costs headset performance, and Capri's frame budget is tight during the hacking effect, so 1080p is safer.
3. Start and stop with **Record** under Device Actions (Meta documents the shortcut Ctrl+Shift+R; on a Mac use the button) ([MQDH media docs](https://developers.meta.com/horizon/documentation/unity/ts-mqdh-media/)).
4. Copy the files with the MQDH file manager. For files over 500 MB, turn on **Settings > General > Download Large Device Files**.

### Method C (fallback): cast and record on another device

1. On a computer, open `https://www.oculus.com/casting` in Chrome, or open the Meta Horizon app on a phone.
2. In the headset, universal menu, **Camera**, **Cast**, and choose that device. Start casting on the 2D page, before Enter AR.
3. Record the cast: on a Mac, QuickTime Player **File > New Screen Recording** (choose the computer audio source if you have one) or OBS at 1920 × 1080, 30 fps. On a phone, use its screen recorder.
4. Casting is lower quality than Methods A and B. Use it when the others fail.

### Method D (last resort): scrcpy

scrcpy mirrors the headset screen to a computer over adb. It shows a distorted per-eye view that needs cropping, and an older guide says it records no game audio ([VR Wave](https://www.vr-wave.store/en-ca/blogs/virtual-reality-prescription-lenses/how-to-record-passthrough-on-your-quest-2)). Use it only if A, B, and C all fail, and record audio separately.

### B-roll: a phone camera filming the room

Film this in every case. It shows the judges what the headset footage cannot: a person seated, with no controllers, pointing and pinching.

- Mount a phone on a tripod 2 to 3 m away, at chest height, side-on, landscape, 1080p at 30 fps.
- Film one full take alongside the headset recording.
- For the optional Live Mode shot, frame the real lamp so it switches off in shot.
- At the start of each take, clap once with both hands in front of the headset while still on the 2D page. The clap gives a sound and image to line up the phone and headset clips.

### Audio capture

- **Game audio:** Capri's recorded lines, chirps, and hacking sounds come out of the headset speakers. Methods A and B record app audio. Keep headset volume near 70 % so the phone mic does not clip.
- **Your voice:** judges must hear the spoken commands. Use the Camera settings mic option (Method A) if it exists and works while Quest Browser holds the mic. As a safety net, record the phone B-roll audio in every take: it hears your voice and the speakers. In the edit, use the phone track for your voice if the headset track lacks it, and caption every command either way.
- **Test first:** before the real takes, record 30 s on the 2D page and in AR, saying "turn that on" at a bulb. Play it back and check that passthrough is visible, Capri's voice is audible, your voice is audible, and the command still worked during recording.

### Takes

| Take | Count | Purpose |
| --- | --- | --- |
| Test take | 1 | 30 s check of passthrough, audio, and that voice still works while recording |
| Main take (full demo path, shots 2 to 8) | 3 | Pick the best beat from each. Each must run from a fresh reload in demo-path order, because the bulb states and the toggle tease depend on it. |
| Signature pickups (reload, Enter AR, point, "turn that on") | 2 to 3 | A clean real-time clip for shot 1, with the lamp and Capri well framed |
| Phone B-roll | 1 per main take | Hands-only proof and sync |
| Live Mode take (optional) | 2 | Only after the Live Mode beat has been verified on the headset |

Each main take lasts about 2:30 to 3:00 in real time. Plan about 45 minutes, including reloads and voice model warmups.

## Editing checklist

- [ ] Assemble the shots in shot-list order. The cold open (shot 1) comes first, so the signature moment lands within the first 15 to 20 s.
- [ ] Keep shot 1 uncut from the spoken words to the bulb lighting, including the 2.5 s recognition wait. It is the proof that the moment is real.
- [ ] Trim dead time elsewhere: pauses before commands, panel expansion, glides, and the 10 s routine (label it "shortened" or "sped up"). Never cut so that a result appears before the effect that causes it.
- [ ] Caption every spoken command exactly as said (`"turn that on"`, not "turn on that", unless you said the joined order). They match the transcript panel.
- [ ] Caption every Capri line, and always the bubble-only ones (results, the toggle tease, the routine's final bubble). Quest Browser has no speech synthesis, so those lines have no voice, and the bubble is hard to read at 1080p. Use the text from your take, not the "for example" text here.
- [ ] Add the lower thirds and the title card from the shot list.
- [ ] Burn the captions into the video (open captions). Also export an `.srt` if the submission site accepts one.
- [ ] Light colour correction: lift the shadows of the passthrough a little. Apply light stabilisation only if a shot is shaky.
- [ ] Audio: no narration over Capri's lines. If you add music, keep it at least 20 dB under her voice and duck it during speech. Normalise to about -14 LUFS integrated, peaks under -1 dBTP.
- [ ] Mock Mode honesty: shot 8's lower third says a script stands in for Hermes. If shot 9 is used, its lower thirds say Live Mode.
- [ ] Privacy: no Home Assistant URL, token, Hermes key, or Live Mode form appears anywhere. Blur anything that slipped in.
- [ ] Closing card shows `https://capri.sanyamchhabra.in` and "Works in Mock Mode with zero setup" for at least 10 s.
- [ ] **Length:** under 3:00 is mandatory. Target 2:30, export at 2:55 or less. If over, cut shot 5, then shorten shot 7, then shot 9.
- [ ] Watch the export once on a phone with the sound off. It must make sense from the captions alone.
- [ ] Watch it once with sound on headphones. Check that your commands and Capri's lines are audible.

### Export settings

| Setting | Value |
| --- | --- |
| Container and codec | MP4, H.264 (High profile) |
| Resolution | 1920 × 1080 |
| Frame rate | Constant 30 fps. Use 60 fps only if all sources are 60 (Method B). Conform 36 fps variable footage to 30 fps constant. |
| Video bit rate | 12 to 16 Mbps VBR (2-pass if available) |
| Audio | AAC-LC, 48 kHz, stereo, 192 kbps or higher |
| File name | `capri-demo.mp4` |

## Not verified

The following could not be confirmed from Meta's current documentation or on the headset. The test take settles most of them.

- **Passthrough in recordings of Quest Browser WebXR.** Meta's help says Quest 3, 3S, and Pro can record and cast the mixed reality view ([Meta help](https://www.meta.com/help/quest/882356143198485/)), and a community report says mixed reality apps now cast with passthrough instead of black ([Meta forum](https://communityforums.atmeta.com/t5/Get-Help/How-do-I-not-record-cast-passthrough-on-Quest-3/m-p/1252228)). Neither source mentions Quest Browser `immersive-ar` sessions. The recording may show Capri over a black background. If it does, try Method B or C. If all show black, use the phone B-roll as the main room view and the headset clip for close-ups of Capri and the effects, and say so in a lower third.
- **Mic audio in system recordings.** An older version of Meta's camera settings page listed a mic audio option. The current page does not mention it. Whether it records your voice while Quest Browser holds the microphone for voice recognition is unknown. Whether recording interferes with Capri's microphone is also unknown.
- **Frame rates offered in the headset.** Meta's guide recommends 36 fps (variable) in the headset and lists 60 fps through MQDH. Whether the in-headset menu offers 30 or 60 fps on the current software is unverified.
- **Recording cost on Capri's frame budget.** Recording uses headset resources. Whether the hacking effect still runs at 72 fps while recording has not been measured. If the test take stutters, drop to Method A at a lower frame rate or use Method C.
- **Opening the universal menu with hands during AR.** It is expected to hide the session and trigger Capri's pause, which stops the mic. Whether Quest Browser ends the session instead is unverified. The plan avoids the menu during takes.
- **Casting audio and scrcpy on Quest 3.** Whether casting to `oculus.com/casting` carries headset audio, and whether current scrcpy forwards Quest audio or passthrough, were not verified.
- **The MQDH recording shortcut on a Mac.** Meta documents Ctrl+Shift+R. The Mac shortcut was not checked.
- **The Live Mode shot.** The real lamp and real Hermes beat, and the Live Mode Task_Panel progress labels, have not been verified on the headset for this video. Shot 9 stays optional until they are.

## Sources

- [How to record video on Horizon OS and Meta Quest](https://www.meta.com/help/quest/articles/in-vr-experiences/social-features-and-sharing/record-video-oculus/) (Meta help)
- [Additional camera settings on Horizon OS and Meta Quest](https://www.meta.com/help/quest/2514032915451395/) (Meta help)
- [Recording or casting your mixed reality view on Meta Quest](https://www.meta.com/help/quest/882356143198485/) (Meta help)
- [Capture MR and VR Apps for Publishing](https://developers.meta.com/horizon/resources/video-capture-mr-vr/) (Meta developer guide, last updated 2025-06-27)
- [Meta Quest Developer Hub media capture](https://developers.meta.com/horizon/documentation/unity/ts-mqdh-media/) (Meta developer docs)
- [How to record passthrough on your Quest 2](https://www.vr-wave.store/en-ca/blogs/virtual-reality-prescription-lenses/how-to-record-passthrough-on-your-quest-2) (VR Wave, 2023)

Content from these sources was rephrased for compliance with licensing restrictions.
