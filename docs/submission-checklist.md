# Submission checklist

The checklist for the Meta VR Start Developer Competition 2026 entry (Requirements 28.7, 28.8, 31.1 to 31.10). Work through the sections in order: the first section deploys the current build, and every later check runs against that deployment.

**Deadline: Nov 18, 2026, 12:00pm PST** (20:00 UTC, which is 01:30 on Nov 19 in India). Aim to submit a few hours early.

| Deliverable | Value | Source |
| --- | --- | --- |
| Hosted playable link | https://capri.sanyamchhabra.in | [`hosting.md`](hosting.md) |
| Demo video (shorter than 3:00) | `VIDEO_URL_TBD` (fill in after upload) | [`demo-video-plan.md`](demo-video-plan.md) |
| Submission text | Paste from the file | [`submission.md`](submission.md) |
| Track | Productivity | [`submission.md`](submission.md), "Form fields" |
| Division | New Experience | same |
| Special award | Best Agentic Interaction | same |
| README and deploy config | `README.md`, `vercel.json` | [`../README.md`](../README.md), [`../vercel.json`](../vercel.json) |
| Demo_Path (the 2-minute script) | `docs/demo-path.md` | [`demo-path.md`](demo-path.md) |

## 1. Commit and deploy the current build

Vercel builds from the git checkout, not from this machine. `npm run build:vercel` runs typecheck, the tests, `vite build`, and `npm run check`. Every file those steps read must be committed, or the Vercel build fails and the previous deployment stays live.

The earlier list (2026-11-17) has since been committed and pushed: `main` matches `origin/main` at `3c04d80`. On 2026-11-18, after the task 33 headset-feedback changes, `git status` on `main` showed modified, deleted, and new files. All of them belong in the next commit, the deletions included:

- **Modified** (100 files): `README.md`, `index.html`, `iwsdk.config.json` (the boundaryless reference space; Vite and the build read it), `public/ui/device-list.uikitml`, docs under `docs/`, most of `src/` and `tests/`, and the spec files under `.kiro/specs/capri-spatial-companion/`.
- **Deleted** (15 files; the Vercel checkout still has them until the deletion is committed):
  - `public/ui/hand-keyboard.uikitml`, `public/ui/quick-actions.uikitml`, `public/ui/status-chips.uikitml`, `public/ui/transcript.uikitml`
  - `src/backends/mock/mock-agent.ts`, `src/domain/devices/teach-orb.ts`, `src/domain/keyboard-model.ts`, `src/ui/hand-keyboard.ts`, `src/ui/teach-orb.ts`
  - `src/ui/panels/mic-orb.ts`, `src/ui/panels/quick-actions.ts`, `src/ui/panels/status-chips-panel.ts`, `src/ui/panels/transcript.ts`
  - `tests/unit/panel-layout.test.ts`, `tests/unit/teach-orb-press.test.ts`
- **New** (34 files; modified files import them, so committing only the modified files breaks `npm run typecheck`):
  - `public/ui/hud-menu.uikitml` (copied into `dist/ui/`)
  - `src/app/hud-wiring.ts`, `src/app/space-reset.ts`, `src/app/text-entry.ts`
  - `src/domain/bubble-stack.ts`, `src/domain/commands/command-catalog.ts`, `src/domain/dev-query.ts`, `src/domain/room-bounds.ts`, `src/domain/pointing/capture-history.ts`
  - `src/domain/hud/hud-model.ts`, `src/domain/hud/hud-view.ts`, `src/domain/hud/palm-facing.ts`, `src/domain/hud/wrist-poke.ts`
  - `src/ui/hud/hud-menu.ts`, `src/ui/hud/wrist-button.ts`, `src/ui/system-keyboard.ts`, `src/ui/teach-pointer.ts`, `src/ui/transcript-bubble.ts`
  - `tests/property/`: `command-catalog`, `dev-query`, `hud-menu`, `personal-space`, `point-capture`, `room-bounds`, `seated-zones`, `tier-routing`, and `transcript-bubble` (each `.test.ts`)
  - `tests/unit/`: `dev-query`, `hair-spring`, `hud-view`, `palm-facing`, `room-bounds`, `space-reset`, and `system-keyboard` (each `.test.ts`)

The smoke checks (`tools/checks/run-checks.ts`) read `README.md` and every file it links to, `public/voice/index.json`, and the `public/ui/*.uikitml` files copied into `dist/ui/`. `dist/`, `.tmp/`, `.env`, and `public/vosk/` are git-ignored and must stay out of the commit. The Vosk model is fetched during the Vercel build.

- [ ] Check locally that the production pipeline passes (needs `public/vosk/`; run `npm run fetch:vosk` and `npm run build:lexicon` first if it is missing):

  ```sh
  npm run typecheck && npm test -- --run && npm run build && npm run check
  ```

  The last line must read `22 of 22 checks passed.`
- [ ] Stage, review, and commit:

  `git add -A` with paths stages new, changed, and deleted files under those paths, so the 15 deletions are committed too:

  ```sh
  git add -A README.md index.html iwsdk.config.json package.json package-lock.json docs src tests tools public/ui public/voice .kiro/specs/capri-spatial-companion
  git status --short
  ```

  `git status --short` must print nothing. If it lists a file, it was missed: add it by name (`git add -A <path>`, or `git rm <path>` for a deleted one). If it lists anything under `dist/`, `.tmp/`, `public/vosk/`, or an `.env` file, stop: that file must not be committed.

  ```sh
  git commit -m "Headset feedback: wrist menu, Commands tile, system keyboard, teach pointer, boundaryless session, personal space"
  git push origin main
  ```

- [ ] In the Vercel dashboard, open the new deployment's build log. It must end with `22 of 22 checks passed.` and the deployment must be promoted to production. If a `FAIL` line appears, it names the check and the file. Commit the missing file and push again.

## 2. Hosted link (Requirement 31.1)

- [ ] **HTTPS and headers.** On the Mac:

  ```sh
  curl -sI https://capri.sanyamchhabra.in/ | grep -iE '^HTTP/|content-security-policy|permissions-policy|strict-transport-security'
  ```

  Expect `HTTP/2 200` and all three headers.
- [ ] **Fresh profile on desktop.** This proves Mock Mode needs no saved state:

  ```sh
  open -na "Google Chrome" --args --user-data-dir="$(mktemp -d)" https://capri.sanyamchhabra.in
  ```

  Expect the **Mock Mode** badge, no setup form in the way, and **Voice model ready** after the 41 MB download. Close that window when done. A desktop browser cannot enter AR, so this does not replace the Quest check.
- [ ] **Quest Browser, clean state.** In Quest Browser, clear this site's data (Settings, Privacy, Clear browsing data) or open a private window, so no saved credentials or cached model remain. Then:
  1. Open `https://capri.sanyamchhabra.in`. The page loads with no certificate warning.
  2. The **Mock Mode** badge shows. Do not open **Connect your own home**.
  3. Put the controllers down. Tap **Enable microphone** and allow it.
  4. Wait for **Voice model ready**.
  5. Tap **Enter AR**. Capri appears, waves, and says her greeting, and three mock bulbs appear. Nothing else floats in view: no hand joint dots, buttons, or status panels.
  6. Point the right index finger at a bulb, hold a left pinch, say **"turn that on"**, let go. The bulb lights after the hacking effect.
  7. Turn the left palm toward you and poke the wrist dot with the right index finger. The **Capri menu** opens on **Status** with **Mode: Mock Mode** and **Hermes: Not configured**. Poke **Commands**, point at a dark bulb with the right hand, and poke the **"turn that on"** row with the left index finger. The bulb lights after the hacking effect.
  8. Say **"run my evening routine"**. Capri answers in a bubble that Hermes isn't connected, and no task panel opens.
- [ ] Run the rest of the post-deploy smoke check in [`hosting.md`](hosting.md), section "5. Post-deploy smoke check" (cache headers, voice files, no CSP violations).

## 3. Quest-only checks still open

These need the headset. Do them before recording the video, because a result can change the build (step 3 below).

- [ ] **Performance readings.** Follow [`performance-note.md`](performance-note.md), "How to take the reading", steps 1 to 10, starting from `https://capri.sanyamchhabra.in/?perf=1`. Fill every `TBD` in the "Quest readings" table, including the headset, Quest Browser version, and refresh rate line. The depth occlusion rows need the dev server (step 8 there); skip them if short of time and leave depth occlusion off.
- [ ] **Comfort check.** In one seated session, tick the boxes in [`comfort-check.md`](comfort-check.md), "Headset check (user)": menu poke reach, ray-pinch reach without turning the shoulders, text readability (including marker labels at 1.8 to 2.2 m), Capri's size at 1.25 m and her personal space, the hacking effect not strobing, and no strain after 10 minutes. Then change the "Reach, readability, and Avatar scale on the headset" row in that file's summary table to the result.
- [ ] **Task 33 pieces on the headset.** Each one has been tested in code and in the desktop emulator only. Use `https://capri.sanyamchhabra.in` in Mock Mode unless noted. If one fails, add it to "Limitations" in [`submission.md`](submission.md) and to "Known limits" in [`demo-path.md`](demo-path.md).
  1. **Boundary.** Enter AR and look for the Quest boundary in passthrough. Walk across where it used to be: the bulb markers stay put. With USB remote DevTools, the console shows `[capri:xr-space] reference space: unbounded granted` (or a warning naming the fallback). Fill in the "Headset results" table in [`spike-report.md`](spike-report.md), section "Follow-up, 2026-11-18: boundaryless session".
  2. **Wrist menu.** With the left palm facing you, the dot appears within about a quarter second and hides when you turn the palm away. A right index poke opens the menu straight ahead, a little below eye level; a second poke closes it. The menu stays in place when you turn your head, closes after 30 s untouched, and closes when a row runs. Note whether Quest's own palm menu icon shows over the dot or opens during the poke. A left pinch with the palm down still talks.
  3. **System keyboard.** On **Commands**, poke **Type**. The Quest system keyboard shows (at once, or after one pinch), Capri pauses while it is up, and **turn desk lamp off** plus Done switches the desk lamp off. If the menu shows **Text entry is not available here** instead, the keyboard is unsupported in this session. Fill in the "Headset checks" table in `spike-report.md`, section "Follow-up, 2026-11-18: Quest system keyboard".
  4. **Teach pointer.** Menu, **Lights**, **Teach a light**. A thin ray runs from the right index fingertip to a ring. On a wall or table the ring sits on the surface (blue). Pointing at open space puts it 2.0 m along the finger (amber) with **Nearer** and **Farther**. In Live Mode, a right pinch places the marker at the ring, never at the hand. Poke **Cancel** to leave in Mock Mode.
  5. **Hair.** Watch Capri for 15 s, then turn your head quickly and stop. Her hair hangs down and settles within about 2 s. It never floats up or sticks out.
  6. **Personal space.** Lean toward Capri: she holds her spot. Stand up and step to within about half a metre of her: she steps aside, not back. Face a nearby wall and say **"go away"**: she stays on your side of the wall.
- [ ] **If a result changes the build** (the performance note says the frame time is over budget, or depth occlusion holds the budget and `depthOcclusion` goes to `true` in `src/config/feature-flags.ts`): make the change, repeat section 1, and repeat the Quest steps in section 2 on the new deployment.
- [ ] **Update the submission text.** In [`submission.md`](submission.md), "Limitations", rewrite "Frame time on the headset is not measured yet" and "Comfort on the headset is not checked yet" with the results, or delete them if both passed. Commit and push the filled-in docs:

  ```sh
  git add docs/performance-note.md docs/comfort-check.md docs/submission.md
  git commit -m "Record Quest performance and comfort results"
  git push origin main
  ```

- [ ] **Optional: live Home Assistant.** Only needed if the video uses shot 9 or the text claims a tested Live Mode. Follow the README section "Live Mode": HTTPS URL, long-lived token, and `https://capri.sanyamchhabra.in` in the CORS allowed origins. Then on the headset follow "Configure Live Mode on the headset", steps 1 to 7. Expect a success line for Home Assistant from **Test connections**, and the menu's **Status** tile in AR reading Live Mode with Home Assistant connected. Teach one real lamp (menu, **Lights**, **Teach a light**), then point at it and say "turn that off". The real lamp turns off when the pulse lands. If anything fails, use "Troubleshooting Live Mode" in the README, including the `curl -i -X OPTIONS` preflight check.
- [ ] **Optional: live Hermes.** Same session, with **Hermes URL** and **Hermes key** filled in. Each item below closes one open point in [`hermes-integration.md`](hermes-integration.md), section "H. Still unconfirmed". Write the result next to the matching item in that section.
  1. **Test connections** shows a success line for Hermes. This is the first authenticated call from Quest Browser (section G).
  2. In the menu, the Hermes tiles read **Ask Hermes** and **Give Hermes a task** (not **Set up Hermes on the 2D page**). Poke **Ask Hermes** (or say "ask hermes"), type a free-form question on the system keyboard, and press Done. Capri answers with a bubble and not with the Tier 1 fallback line. That confirms the model returns bare Response_Contract JSON (item 3). Note how many seconds the reply took (item 6).
  3. Say a task phrase, for example "research it and tell me when done", or poke **Give Hermes a task** and type one. The task panel shows steps as they happen, not all at once at the end. That confirms live event delivery through Cloudflare Tunnel (item 5) and the event shapes (item 2).
  4. Start a task that makes Hermes want to run a shell command. If Approve and Deny appear, approvals work (item 4). If the run finishes without asking, record that the approval policy does not raise requests for API runs.
  5. Item 1, the exact Hermes build, stays open unless `hermes --version` on the server prints more than 0.21.4.

  If Hermes does not work from the headset, leave shot 9 out of the video and keep the "Live Hermes is not yet confirmed end to end" limitation in the submission text.

## 4. Demo video (Requirements 31.2, 31.4)

- [ ] Record following [`demo-video-plan.md`](demo-video-plan.md): the test take first, then three main takes and the signature pickups, each from a fresh reload, with the phone B-roll running. Do not use `?perf=1` in a recorded take.
- [ ] Edit with the plan's "Editing checklist". The video must show Mock Mode from the hosted link (shot 2), hands-only interaction, the signature moment (shot 1), and the wrist menu with a Commands row (shots 6 and 7). Hermes appears only in the optional Live Mode shot 9, and no Mock Mode shot shows a Hermes task.
- [ ] Check the exported length is under 3:00 (standard cut about 2:15, ceiling 2:55):

  ```sh
  mdls -name kMDItemDurationSeconds capri-demo.mp4
  ```

  The value must be below 180, and should be 175 or lower.
- [ ] Upload the video where the submission form asks (for example YouTube, unlisted or public, not private). Open the link in a signed-out browser window to confirm it plays.
- [ ] Replace `VIDEO_URL_TBD` in the table at the top of this file with the link.

## 5. Submission form (Requirements 31.3, 31.5, 31.10)

- [ ] Paste the fields from [`submission.md`](submission.md), "Form fields": title, tagline, playable link `https://capri.sanyamchhabra.in`, platform, input, play position.
- [ ] Select **Track: Productivity**, **Division: New Experience**, and the special award **Best Agentic Interaction**.
- [ ] Paste the description: the "Long version" if the form allows about 550 words, else the "Short version". Add "How to try it" if the form has an instructions field. Paste the remaining sections where the form has room for them.
- [ ] Paste the video link.
- [ ] If the form asks for a source or docs link, give the repository and point to `README.md` (Mock Mode from the hosted link, Live Mode setup, third-party licenses).
- [ ] Submit before **Nov 18, 2026, 12:00pm PST**. Keep the confirmation email or screenshot.

## 6. Final link check

- [ ] Every link in the README resolves. This runs as part of `npm run check`, and section 1 already ran it. To rerun it on its own after `npm run build`:

  ```sh
  npm run check:smoke
  ```

  The line `PASS  README links resolve` must appear.
- [ ] The hosted link in the README, `docs/submission.md`, the video's title card and closing card, and the form all read `https://capri.sanyamchhabra.in`.
