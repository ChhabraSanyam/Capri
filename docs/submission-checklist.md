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

On 2026-11-17, `git status` showed 56 modified and 77 untracked files on `main`, and `main` was one commit ahead of `origin/main` (`e90fc41`, unpushed). All of them are needed:

- **Read directly by the smoke checks** (`tools/checks/run-checks.ts`):
  - the check code itself: `tools/checks/run-checks.ts`, `tools/checks/rules.ts`, `tools/checks/source-text.ts` (all untracked);
  - `README.md` (modified) and every file it links to. The untracked ones are `docs/demo-path.md`, `docs/performance-note.md`, `docs/comfort-check.md`, `docs/submission.md`, `docs/demo-video-plan.md`, and `docs/submission-checklist.md` (this file). `docs/hermes-integration.md`, `docs/hosting.md`, and `docs/voice-engine.md` are modified;
  - `public/voice/index.json` (modified; the voice manifest check compares it with `voice/voice-manifest.txt`) and `public/ui/task-panel.uikitml` (modified; copied into `dist/ui/`).
- **Needed by `npm run typecheck` and `npm test`:** every modified and untracked file under `src/`, `tests/`, and `tools/`. Modified files import the new ones (for example `src/app/capri-system.ts` imports `src/app/agent-wiring.ts`, `src/app/session-mode.ts`, and `src/app/loading-status.ts`, which are untracked), so committing only the modified files breaks the build.
- **Build inputs:** `package.json`, `package-lock.json` (`npm ci` installs from the lock file), and `index.html`.
- **Not needed by the build, commit anyway:** `docs/submission-text.md` and the spec files under `.kiro/specs/capri-spatial-companion/`.

`dist/`, `.tmp/`, `.env`, and `public/vosk/` are git-ignored and must stay out of the commit. The Vosk model is fetched during the Vercel build.

- [ ] Check locally that the production pipeline passes (needs `public/vosk/`; run `npm run fetch:vosk` and `npm run build:lexicon` first if it is missing):

  ```sh
  npm run typecheck && npm test -- --run && npm run build && npm run check
  ```

  The last line must read `22 of 22 checks passed.`
- [ ] Stage, review, and commit:

  ```sh
  git add README.md index.html package.json package-lock.json docs src tests tools public/ui public/voice .kiro/specs/capri-spatial-companion
  git status --short
  ```

  `git status --short` must print nothing. If it lists a file, it was missed: add it by name. If it lists anything under `dist/`, `.tmp/`, `public/vosk/`, or an `.env` file, stop: that file must not be committed.

  ```sh
  git commit -m "Polish, Live Mode, Hermes tasks, smoke checks, and submission docs"
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
  5. Tap **Enter AR**. Capri appears and waves, and three mock bulbs appear.
  6. Point the right index finger at a bulb, hold a left pinch, say **"turn on that"**, let go. The bulb lights after the hacking effect.
  7. Say **"run my evening routine"**. The task panel runs to completion.
- [ ] Run the rest of the post-deploy smoke check in [`hosting.md`](hosting.md), section "5. Post-deploy smoke check" (cache headers, voice files, no CSP violations).

## 3. Quest-only checks still open

These need the headset. Do them before recording the video, because a result can change the build (step 3 below).

- [ ] **Performance readings.** Follow [`performance-note.md`](performance-note.md), "How to take the reading", steps 1 to 10, starting from `https://capri.sanyamchhabra.in/?perf=1`. Fill every `TBD` in the "Quest readings" table, including the headset, Quest Browser version, and refresh rate line. The depth occlusion rows need the dev server (step 8 there); skip them if short of time and leave depth occlusion off.
- [ ] **Comfort check.** In one seated session, tick the six boxes in [`comfort-check.md`](comfort-check.md), "Headset check (user)": poke reach, ray-pinch reach without turning the shoulders, text readability (including marker labels at 1.8 to 2.2 m), Capri's size at 1.25 m, the hacking effect not strobing, and no strain after 10 minutes. Then change the "Reach, readability, and Avatar scale on the headset" row in that file's summary table to the result.
- [ ] **If a result changes the build** (the performance note says the frame time is over budget, or depth occlusion holds the budget and `depthOcclusion` goes to `true` in `src/config/feature-flags.ts`): make the change, repeat section 1, and repeat the Quest steps in section 2 on the new deployment.
- [ ] **Update the submission text.** In [`submission.md`](submission.md), "Limitations", rewrite "Frame time on the headset is not measured yet" and "Comfort on the headset is not checked yet" with the results, or delete them if both passed. Commit and push the filled-in docs:

  ```sh
  git add docs/performance-note.md docs/comfort-check.md docs/submission.md
  git commit -m "Record Quest performance and comfort results"
  git push origin main
  ```

- [ ] **Optional: live Home Assistant.** Only needed if the video uses shot 9 or the text claims a tested Live Mode. Follow the README section "Live Mode": HTTPS URL, long-lived token, and `https://capri.sanyamchhabra.in` in the CORS allowed origins. Then on the headset follow "Configure Live Mode on the headset", steps 1 to 7. Expect a success line for Home Assistant from **Test connections**, and the status chips in AR reading Live Mode with Home Assistant connected. Teach one real lamp with **Teach me your lights**, then point at it and say "turn off that". The real lamp turns off when the pulse lands. If anything fails, use "Troubleshooting Live Mode" in the README, including the `curl -i -X OPTIONS` preflight check.
- [ ] **Optional: live Hermes.** Same session, with **Hermes URL** and **Hermes key** filled in. Each item below closes one open point in [`hermes-integration.md`](hermes-integration.md), section "H. Still unconfirmed". Write the result next to the matching item in that section.
  1. **Test connections** shows a success line for Hermes. This is the first authenticated call from Quest Browser (section G).
  2. Type a free-form question on the hand keyboard. Capri answers with a bubble and not with the Tier 1 fallback line. That confirms the model returns bare Response_Contract JSON (item 3). Note how many seconds the reply took (item 6).
  3. Say a task phrase, for example "research it and tell me when done". The task panel shows steps as they happen, not all at once at the end. That confirms live event delivery through Cloudflare Tunnel (item 5) and the event shapes (item 2).
  4. Start a task that makes Hermes want to run a shell command. If Approve and Deny appear, approvals work (item 4). If the run finishes without asking, record that the approval policy does not raise requests for API runs.
  5. Item 1, the exact Hermes build, stays open unless `hermes --version` on the server prints more than 0.21.4.

  If Hermes does not work from the headset, leave shot 9 out of the video and keep the "Live Hermes is not yet confirmed end to end" limitation in the submission text.

## 4. Demo video (Requirements 31.2, 31.4)

- [ ] Record following [`demo-video-plan.md`](demo-video-plan.md): the test take first, then three main takes and the signature pickups, each from a fresh reload, with the phone B-roll running. Do not use `?perf=1` in a recorded take.
- [ ] Edit with the plan's "Editing checklist". The video must show Mock Mode from the hosted link (shot 2), hands-only interaction, the signature moment (shot 1), and one Hermes task (shot 8).
- [ ] Check the exported length is under 3:00 (target 2:30, ceiling 2:55):

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
