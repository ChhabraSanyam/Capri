# Capri

Capri is a spatial AI companion for Meta Quest. She stands in your real room in passthrough AR,
sees what you point at, talks back with a personality, and hacks your lights with a burst of
effects. You use her seated, with your hands only: no controllers.

The avatar, her spatial awareness, and her personality are the product. Home Assistant (real lights)
and Hermes Agent (questions and real long-running tasks) are optional plug-ins. Without them, Capri
runs in Mock Mode with three virtual bulbs and no agent.

**Try it:** open **https://capri.sanyamchhabra.in** in Quest Browser.

## Quick start for judges

Mock Mode is the default and needs no account, no smart home, and no configuration.

1. On a Quest 3, open `https://capri.sanyamchhabra.in` in Quest Browser and put the controllers down.
2. Tap **Enable microphone** and allow it (optional; buttons work without it).
3. Wait for **Voice model ready** (about 40 MB on the first visit, cached afterwards).
4. Look straight ahead and tap **Enter AR**.
5. Point your right index finger at a bulb, pinch and hold with your left hand, say **"turn that on"**,
   and let go.
6. Turn your left palm toward you and poke the glowing dot on that wrist with your right index finger.
   The menu opens. **Commands** lists every phrase, and a lit row runs when you poke it.

The full two-minute script, with the exact words, hand actions, and fallbacks, is in
[`docs/demo-path.md`](docs/demo-path.md).

## Features

- **Presence in your room.** A VRM avatar placed on the detected floor (or floating when there is
  none), 1.25 m ahead and to your right. She breathes, blinks, and follows your head with her eyes.
  She holds her spot when you come closer and steps aside only inside a 0.5 m comfort radius. She
  re-homes only after you have looked away from her for 3 s, and every destination stays inside the
  detected walls.
- **Pointing selection.** Point with the right index finger and a ring highlights the bulb; Capri
  looks at it. A right pinch confirms it for 8 s.
- **A clear view and a wrist menu.** By default you see only Capri, the lights, and her bubbles. With
  the left palm facing you, a small button shows on the left wrist. Poking it with the right index
  finger opens a menu in front of you with **Status**, **Lights**, **Commands**, **Ask Hermes**,
  **Give Hermes a task**, and **Close**. It stays fixed in the room and closes after 30 s untouched.
- **Commands list.** The **Commands** tile lists every command the grammar supports, in **Lights**,
  **Capri**, and **Hermes** tabs with pages. Rows that need no parameter run on a poke, through the
  same path as speech. **Type** opens the Meta Quest system keyboard for typed commands.
- **Teach your lights.** From **Lights**, **Teach a light**: a thin ray from your right index fingertip
  and a ring show where the marker will land, and a right pinch places it there. In Live Mode you then
  pick the Home Assistant light it is. The position is saved with a WebXR anchor and restored,
  approximately, on the next visit.
- **Voice push-to-talk.** Hold a left-hand pinch and speak. A small bubble above Capri shows that she
  is listening, then your words. Recognition runs on the headset with Vosk and a restricted grammar,
  so no audio leaves the device. Commands cover on/off, dim/brighten, 12 colours, named lights,
  timers, remembered places, and spatial moves ("come here", "go away", "sit on the desk", "perch on
  the table", "look at me").
- **Hacking VFX.** For every light command Capri flicks her hand and sends beams, glyphs, sparks, and
  a pulse to the bulb. The command is sent only when the pulse lands. A quality governor halves
  particle emission when frames run long.
- **Tier 1 offline intelligence and banter.** Every deterministic command is parsed and answered
  locally. Capri reacts to results with recorded lines and context-aware banter, for example teasing
  you after three toggles of the same bulb within 60 s.
- **Tier 2 with Hermes (optional).** **Ask Hermes** (or saying "ask hermes") opens the system keyboard,
  and the question goes to your Hermes Agent as chat; the reply shows in Capri's speech bubble.
  **Give Hermes a task**, or a spoken task phrase, starts a live Hermes run, shown on the Task_Panel
  with its steps, and Hermes approval requests appear there with **Approve** and **Deny** buttons.
  Without Hermes, both tiles read "Set up Hermes on the 2D page" and Capri says in character that
  Hermes isn't connected. If Hermes fails, Tier 1 answers in character.
- **Greeting.** Capri says one recorded greeting while she waves on arrival, once per AR session.
- **Stable room tracking.** The session asks for the boundaryless `unbounded` reference space, with
  `local-floor` as the fallback. On a tracking reset the bulbs and Capri are placed again in front of
  you, and lights without an anchor are flagged in **Lights** for re-teaching.
- **Personality idles.** Stretches, fidgets, and glances at real furniture and bulbs every 8 to 18 s,
  and an annoyed tease after 60 s of no input.
- **Pause and resume.** The Quest system menu or a hidden page pauses animation, timers, effects, the
  microphone, and audio. Resume restores them and announces timers that ran out.
- **Loading screen.** An in-scene card shows the avatar, voice library, and voice model loading, and a
  failure message if the avatar does not load.
- **Audio mix.** Speech, chirp, and effect sounds each have their own bus level and pass through a
  shared limiter (`AUDIO_MIX` in `src/config/constants.ts`).

Removed after headset feedback (task 33): the floating mic orb, the "Teach me your lights" orb, the
always-visible status chips, Quick_Actions, and device list, the custom hand keyboard (replaced by
the Quest system keyboard), and the scripted Mock Mode agent with its evening routine and canned chat.

## How it works

- **Static site, no backend.** The app is static files on Vercel. There is no Capri server, proxy, or
  bridge. In Live Mode the headset's browser calls your Home Assistant and your Hermes directly.
- **Pure domain plus XR shell.** `src/domain/` holds the logic (intent parsing, pointing, persona,
  task model, settings) with no Three.js, DOM, or IWSDK imports, so it is unit-tested under Node. The
  XR shell (`src/xr/`, `src/avatar/`, `src/vfx/`, `src/ui/`, `src/audio/`) is built on
  [IWSDK](https://iwsdk.dev/), Meta's WebXR toolkit, and calls the domain through ports.
- **One system, fixed stages.** The composition root is `src/main.ts`. The single IWSDK system,
  `src/app/capri-system.ts`, calls `CapriApp.tick` (`src/app/app.ts`) with a fixed stage order.
- **Backends behind one interface.** `src/backends/` has a mock and a live home
  (`mock/mock-home.ts`, `ha/ha-client.ts`) and the live agent (`hermes/live-hermes-adapter.ts`).
  Mock Mode has no agent. The mode is resolved from the stored settings.
- **Menu and Commands.** The wrist button and menu are a pure state machine and layout
  (`src/domain/hud/`) drawn by `src/ui/hud/` and wired in `src/app/hud-wiring.ts`. The Commands list
  is built from the phrase table (`src/domain/commands/command-catalog.ts`), so it always matches the
  speech grammar. Typed text from the system keyboard (`src/ui/system-keyboard.ts`) goes through
  `src/app/text-entry.ts`.
- **Tier 1 and Tier 2.** Tier 1 (`src/domain/contract/tier-router.ts` and `src/domain/persona/`)
  handles every deterministic intent on the device and is enough for every feature. Tier 2 sends
  free-form chat and tasks to Hermes and validates each reply against a response contract before
  acting. Any failure falls back to Tier 1.
- **Speech output.** Recorded lines come from a pre-generated voice library (`public/voice/`). Lines
  that are not in the library show as a speech bubble with chirps.
- **Entry page first.** The 2D page (`index.html`) asks for the microphone before Enter AR
  (`src/ui/setup-page/mic-step.ts`), because a microphone prompt inside the AR session ends the
  session.

## Your credentials

Home Assistant and Hermes credentials are **stored only on this device**, **sent only to the
endpoints you enter**, and **never logged**. Mock Mode uses no credentials. Details are under
[Live Mode](#live-mode), "Your credentials".

## Requirements

- **Meta Quest 3 or 3S with Quest Browser**, hand tracking on. Tested on Quest 3 with Quest Browser
  156. Controllers are not supported.
- **HTTPS.** WebXR needs a secure context. The hosted site is HTTPS, and the dev server uses a local
  certificate.
- **No speech synthesis on Quest.** Quest Browser has no `speechSynthesis`, so dynamic lines (for
  example Hermes replies) appear as a speech bubble with a chirp instead of a spoken voice.

## Development

Needs Node 22.18 or newer (the `tools/*.ts` scripts run with Node's built-in TypeScript support).

```sh
npm install
npm run fetch:vosk      # downloads the 41 MB Vosk model into public/vosk/ (git-ignored; needs unzip and tar)
npm run build:lexicon   # builds public/vosk/lexicon.txt from that model
npm run dev             # HTTPS dev server on port 8081 plus a managed desktop browser
```

`npm run dev` starts the IWSDK-managed dev server and opens a desktop browser running IWER, IWSDK's
browser-based XR emulator, set to a Quest 3
([Testing your experience](https://iwsdk.dev/guides/02-testing-experience.html)).

To open the dev server on the headset:

- **Local network:** open `https://<your-computer-LAN-IP>:8081/` in Quest Browser and accept the
  certificate warning once. `npx @iwsdk/cli dev status` lists the network URLs.
- **USB:** run `adb reverse tcp:8081 tcp:8081`, then open `https://localhost:8081/`.
- **Last resort only:** if neither works, a Cloudflare Tunnel or ngrok URL in front of the dev server.
  It is a different origin, so saved settings and the CORS entries for your backends do not carry
  over.

The dev server looks like the hosted site by default. Developer overlays need a URL parameter, in
dev and production builds alike: `?perf=1` for the frame-time overlay, `?hands=1` for the hand joint
dots, `?dev=1` for the dev panel, and `?handtest=1` for the hand test panel.

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | Unit and property tests (Vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run voice` | Regenerates the voice library in `public/voice/` with Piper. Needs the one-time setup in [`docs/voice-engine.md`](docs/voice-engine.md). The library is committed, so normal development does not need this. |
| `npm run build:vercel` | The full production pipeline: typecheck, tests, Vosk fetch, lexicon, `vite build` into `dist/` |

## Deployment

Capri deploys to Vercel as a static build: `vercel.json` sets the build command, the `dist` output,
the rewrites, and the security headers. Use either the Vercel Git integration (every push to `main`
redeploys) or the Vercel CLI (`vercel --prod`), set the project's Node.js version to 22.x, then add
your subdomain under the project's Domains and create the `CNAME` record that Vercel displays. If a
build fails, the previous production deployment stays live. Step-by-step instructions, the
Content-Security-Policy, and a post-deploy smoke check are in [`docs/hosting.md`](docs/hosting.md).

## Live Mode

Capri runs in Mock Mode with no setup: virtual bulbs, no agent, and no requests leave the page. Live Mode connects her to your own Home Assistant (real lights) and, optionally, your own
[Hermes Agent](https://hermes-agent.nousresearch.com/docs/) (real long-running tasks). The app is
static files only. There is no Capri server in between: the headset's browser talks straight to
your Home Assistant and your Hermes.

The examples below use the origin of the hosted site, `https://capri.sanyamchhabra.in`. If you
deploy Capri yourself, use **your own deployment's origin** everywhere this one appears. An origin
is the scheme plus host (plus port, if not the default), with no path and no trailing slash.

### Your credentials

- **Stored only on this device**, in the browser's storage for this site.
- **Sent only to the endpoints you enter.** The Home Assistant token goes only to your Home
  Assistant URL. The Hermes key goes only to your Hermes URL. Neither is ever sent to the host that
  serves Capri or to anyone else.
- **Never logged.** No token or key is written to the console, error messages, URLs, or on-screen
  text.
- **Remember on this device** off: the settings are kept in session storage and are cleared when you
  close the tab.
- **Forget credentials** removes every stored setting and returns Capri to Mock Mode.

The hosted site runs alone on its own subdomain, so its browser storage is not shared with any other
site. You can still leave Remember off.

### What you need

| Backend | Required for Live Mode | You need |
| --- | --- | --- |
| Home Assistant | Yes | An `https://` URL the headset can reach, a long-lived access token, and the Capri origin in Home Assistant's CORS allowed origins |
| Hermes Agent | No (without it, Capri says Hermes isn't connected) | The API server enabled, an `https://` URL in front of it, its key, and the Capri origin in `API_SERVER_CORS_ORIGINS` |

Both must be HTTPS. Capri refuses `http://` and `ws://` endpoints before sending anything, and the
site's Content-Security-Policy blocks them too, because an HTTPS page cannot call plain HTTP (mixed
content).

### Configure Live Mode on the headset

1. Set up HTTPS and CORS for Home Assistant (next sections) and, if you use it, Hermes.
2. Open the Capri site in Quest Browser. Open **Connect your own home (optional)**.
3. Fill in **Home Assistant URL** (for example `https://abc123.ui.nabu.casa`, no path) and
   **Home Assistant long-lived token**. Paste is fine; spaces and line breaks are trimmed.
4. Optionally fill in **Hermes URL** and **Hermes key**.
5. Turn on **Live Mode**. Choose whether to **Remember on this device**. Select **Save**.
6. Select **Test connections**. Each backend gets one result line. A network or CORS failure also
   shows the exact origin to allow (see Troubleshooting).
7. Select **Enter AR**. In AR, the menu's **Status** tile shows Live Mode and the state of each
   backend. Teach your lamps from **Lights**, **Teach a light**.

To go back to Mock Mode, turn Live Mode off and save, or select **Forget credentials**.

### Home Assistant: long-lived access token

In Home Assistant, open your user profile, the **Security** tab, then **Long-lived access tokens**,
and create a token ([REST API: Authentication](https://contributors.home-assistant.io/core/internals/rest-api/#authentication)).
It is shown once. Paste it into Capri.

The token can do anything that Home Assistant user can do. Capri uses it only to list `light.`
entities and call `light.turn_on` and `light.turn_off`, which do not need an administrator. Creating
a separate non-administrator user for Capri and making the token from that user limits what a
leaked token can do. You can revoke the token on the same page at any time.

### Home Assistant: HTTPS URL

The headset must reach Home Assistant over HTTPS with a certificate the browser trusts. A
self-signed certificate or a plain `http://homeassistant.local:8123` address does not work.
Choose one ([Remote access to Home Assistant](https://www.home-assistant.io/docs/configuration/remote/)):

- **Home Assistant Cloud (Nabu Casa).** In Home Assistant, go to **Settings** > **Home Assistant
  Cloud**, sign in, and turn on **Remote access**. The link shown there (`https://<id>.ui.nabu.casa`)
  is your Home Assistant URL
  ([Nabu Casa: Enabling remote access](https://support.nabucasa.com/hc/en-us/articles/26474279202973-Enabling-remote-access-to-Home-Assistant)).
  Your own Home Assistant still answers the requests, so the CORS setting below is still needed.
  Reverse-proxy settings do not apply to cloud connections
  ([HTTP integration: Reverse proxies](https://www.home-assistant.io/integrations/http/#reverse-proxies)).
- **Tailscale HTTPS.** The Tailscale app for Home Assistant has a `share_homeassistant` option that
  serves Home Assistant with a Tailscale certificate, for example
  `https://homeassistant.tail1234.ts.net`
  ([Tailscale app docs, `share_homeassistant`](https://github.com/hassio-addons/addon-tailscale/blob/f3409342286fd782b204e5c86144ac32fac62588/tailscale/DOCS.md#option-share_homeassistant)).
  The setup in those docs: keep SSL off in Home Assistant, turn on **Trust X-Forwarded-For** and add
  `127.0.0.1` to **Trusted proxies** (**Settings** > **System** > **Network** > **HTTP server**),
  enable MagicDNS and HTTPS certificates on the Tailscale DNS admin page, then restart the app.
  - **Serve** reaches only devices on your tailnet, so the headset itself must be on the tailnet.
    Whether a Tailscale client runs on your Quest was not checked for this README.
  - **Funnel** makes the URL reachable from the internet with no client on the headset. It also
    exposes your Home Assistant login page to the internet. It needs the `funnel` node attribute in
    your tailnet policy.
- **A reverse proxy** such as Caddy or nginx, with a real certificate for a domain you own (for
  example from Let's Encrypt). In Home Assistant, turn on **Trust X-Forwarded-For** and add the
  proxy's address to **Trusted proxies**, or Home Assistant blocks the proxied requests
  ([HTTP integration: Reverse proxies](https://www.home-assistant.io/integrations/http/#reverse-proxies)).
  The proxy must pass `OPTIONS` requests and the `Access-Control-*` response headers through
  unchanged.

### Home Assistant: CORS allowed origins

Capri is served from a different origin than your Home Assistant, so Home Assistant must allow the
Capri origin. Which method applies depends on your Home Assistant version.

**Home Assistant 2026.8 and later (UI).** Go to **Settings** > **System** > **Network**, find the
**HTTP server** section, and add the origin to **CORS allowed origins**:

```
https://capri.sanyamchhabra.in
```

Saving restarts Home Assistant. An administrator must then confirm the new settings within
5 minutes, or Home Assistant goes back to the previous ones
([HTTP integration: Options in the UI](https://www.home-assistant.io/integrations/http/#options-in-the-ui)).

From 2026.8, an existing `http:` block in `configuration.yaml` is imported into the UI on the first
start after the upgrade, and a repair issue ("The HTTP YAML configuration is deprecated") asks you to
remove it. After the import, the YAML block is ignored, so edit CORS in the UI
([HTTP integration: Migrating from YAML](https://www.home-assistant.io/integrations/http/#migrating-from-yaml)).

**Before Home Assistant 2026.8 (YAML).** Add this to `configuration.yaml` and restart Home
Assistant. If you already have an `http:` block, add only the `cors_allowed_origins` key to it.

```yaml
http:
  cors_allowed_origins:
    - https://capri.sanyamchhabra.in
```

The origin must match exactly: `https://capri.sanyamchhabra.in` does not allow
`http://capri.sanyamchhabra.in` ([HTTP integration docs before 2026.8, `cors_allowed_origins`](https://github.com/home-assistant/home-assistant.io/blob/6fe71edf41ae1447ebd8a33445c9ef4181ef19f8/source/_integrations/http.markdown)).

List only the Capri origin. Do not add `*` or other hosts.

### Hermes Agent

Tested against Nous Research Hermes Agent 0.21.4 behind Cloudflare Tunnel. The details and sources
are in `docs/hermes-integration.md`, section "Confirmed surface".

1. **Enable the API server.** In `~/.hermes/.env`:

   ```
   API_SERVER_ENABLED=true
   API_SERVER_KEY=<a random secret of at least 16 characters>
   API_SERVER_CORS_ORIGINS=https://capri.sanyamchhabra.in
   ```

   Then start it with `hermes gateway`. The server refuses to start if the key is missing, a
   placeholder, or shorter than 16 characters. The same settings can go in `~/.hermes/config.yaml`
   under `gateway.api_server` (`enabled`, `key`, `cors_origins`). Environment variables win over
   `config.yaml`. Restart Hermes after changing them.
2. **CORS.** `API_SERVER_CORS_ORIGINS` takes exact origins, comma-separated. Use the Capri origin
   with no trailing slash. Requests from any other origin, including the browser's preflight, get
   HTTP 403. Do not use `*`.
3. **HTTPS in front.** The API server speaks plain HTTP on `127.0.0.1:8642` by default, so put an
   HTTPS front end before it. A Cloudflare Tunnel (`cloudflared`) pointed at `http://127.0.0.1:8642`
   works: Cloudflare passes the server's CORS headers through unchanged. Caddy, nginx, or Tailscale
   Funnel with a trusted certificate are alternatives (not tested with Capri). Do not put Cloudflare
   Access or another login page in front: the browser cannot get through it (see Troubleshooting).
4. **Enter the HTTPS URL** (for example `https://hermes-api.example.com`, no path) and the key on the
   Setup_Page.

**Warning: the Hermes key gives terminal access on the machine running Hermes.** It unlocks the
agent's full toolset, including shell commands. Anyone who has the key, or can use your unlocked
headset while it is stored there, can run commands on that machine. Hermes has no read-only or
per-app key. Use a key only for Capri, keep Remember off if others use the headset, and change the
key if you suspect it leaked.

In AR, reach Hermes from the menu: **Ask Hermes** sends a typed question as chat, and **Give Hermes a
task** starts a run. Saying "ask hermes" opens the same question prompt, and saying a task phrase
(for example "research it and tell me when done") starts a run. Tasks you give Capri run as Hermes
runs. When Hermes asks for approval (for example before a
command), the request appears on the Task_Panel with **Approve** and **Deny** buttons. Approve allows
that one operation only. An approval left unanswered is denied by Hermes after its timeout
(300 s by default).

### Same-origin option: serve Capri from Home Assistant's `/config/www`

Home Assistant serves files in its `www` folder at `/local/`
([HTTP integration: Hosting files](https://www.home-assistant.io/integrations/http/#hosting-files)).
If Capri is served from there, it has the same origin as Home Assistant, so the Home Assistant CORS
setting is not needed. This option has not been tested with Capri. Steps:

1. Fetch the voice model, then build with the matching base path:
   `npm run fetch:vosk && npm run build:lexicon && npm run build -- --base=/local/capri/`.
   The default build uses base `/` (set in `vite.config.ts`), which would point every asset at the
   wrong path. Whether every IWSDK-loaded file follows the changed base was not checked: look for
   404s in the browser's network panel.
2. Copy the contents of `dist/` to `/config/www/capri/`. If you created `www/` for the first time,
   restart Home Assistant.
3. Open `https://<your-home-assistant>/local/capri/index.html` (with `index.html`: there is no
   rewrite to it).

Check these before relying on it:

- **WebXR needs HTTPS.** Open the page through your HTTPS Home Assistant URL (Nabu Casa, Tailscale,
  or a reverse proxy). Over `http://` the browser does not allow immersive AR.
- **The headers in `vercel.json` do not apply.** The Content-Security-Policy, Permissions-Policy,
  `Strict-Transport-Security`, `Referrer-Policy`, and long cache headers come from Vercel, and Home
  Assistant sends its own headers instead. In the browser's developer tools, check the response
  headers of `index.html`: whether there is any CSP (without one the page loses that protection),
  that no `Permissions-Policy` blocks `microphone` or `xr-spatial-tracking`, and that the `.wasm`,
  `.js`, and model files load with correct content types. Without the cache headers the 41 MB voice
  model may be fetched again on later visits.
- **Storage is shared with Home Assistant.** Capri's stored credentials sit in the same browser
  storage as the Home Assistant frontend and any custom cards you installed, and any script on that
  origin can read them. Consider leaving Remember off.
- **Anyone who knows the URL can load the files.** Files in `www` need no login. The build contains
  no credentials, so this exposes only the app itself.
- **Hermes is still another origin.** Its `API_SERVER_CORS_ORIGINS` must then list your Home
  Assistant origin instead of the Capri site's.

### Troubleshooting Live Mode

| What you see | Likely cause | What to do |
| --- | --- | --- |
| "Network or CORS" failure, with "Origin to allow in ...: https://..." | The browser blocked the request. Browsers report a CORS rejection, an unreachable host, and a bad certificate as the same network error, so the page cannot tell them apart. | Add the origin shown, exactly (scheme, no trailing slash, no path), then restart Home Assistant or Hermes. Open the endpoint URL in Quest Browser to check it loads with a valid certificate. |
| The URL is refused before anything is sent | The URL starts with `http://` or `ws://`. An HTTPS page cannot use plain HTTP (mixed content). | Use the `https://` URL from Nabu Casa, Tailscale, a reverse proxy, or a tunnel. |
| Home Assistant 401 | The token is wrong, revoked, or pasted incompletely. | Create a new long-lived token and paste it again. |
| Hermes 401 | The key does not match `API_SERVER_KEY`. | Paste the key again. Restart Hermes if you changed the key. |
| CORS failure only through a proxy or tunnel | Something in front (Cloudflare Access, a login page, basic auth, or a proxy rule) answers the browser's `OPTIONS` preflight itself, with a redirect or without `Access-Control-Allow-Origin`. The preflight carries no token, so a login layer always rejects it. | Remove the login layer for this hostname, or let `OPTIONS` through to the backend. Check with the command below. |
| Home Assistant 400 or blocked requests behind a proxy | **Trust X-Forwarded-For** or **Trusted proxies** not set. | Set both under **Settings** > **System** > **Network** > **HTTP server**. |
| Timeout | Home Assistant did not answer within 10 s. | Check that the URL is reachable from the headset's network. |

To check a preflight from a computer (it needs no token, so it is safe to run and share):

```sh
curl -i -X OPTIONS "https://<your-home-assistant>/api/services/light/turn_on" \
  -H "Origin: https://capri.sanyamchhabra.in" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type"
```

A working setup answers `200` with `access-control-allow-origin: https://capri.sanyamchhabra.in`.
For Hermes, use `https://<your-hermes>/v1/runs` instead. A redirect, a login page, or a `403`
means the origin is not allowed or something in front answered instead.

## Known limitations

- **Restricted voice grammar.** The recogniser knows a fixed set of phrase pieces
  (`src/domain/speech-lang/phrases.ts`), so speech outside them is not understood. "turn that off"
  and "turn off that" both work. Some forms work only when typed, for example "set the floor lamp to
  red". Results arrive about 2.5 s after you stop talking (median on a Quest 3). The working phrases
  are listed in [`docs/demo-path.md`](docs/demo-path.md) and on the **Commands** tile.
- **Hands only.** Hand tracking is required and controllers are not supported. The right hand is
  always the pointing hand and the wrist button is always on the left; there is no setting to swap.
  While the left palm faces you, the left pinch does not talk.
- **Not yet checked on the headset.** The wrist button and menu, the system keyboard in AR, the teach
  pointer, the hair fix, personal space, and whether the `unbounded` session removes the Quest
  boundary were tested in code and in the IWER emulator only. If the system keyboard is not offered
  in AR, **Type** and the Hermes tiles are hidden and the menu says text entry is not available.
  Capri pauses while the keyboard is up.
- **Spoken voice only for recorded lines.** Quest Browser has no speech synthesis, so lines outside
  the voice library (including every Hermes reply) are a bubble with chirps.
- **Approximate light positions.** Taught lights restore from saved anchors about 10 cm from where
  they were taught (95 mm measured once after a reload).
- **Mock Mode has no agent.** Every bulb starts off, and chat phrases, task phrases, and the Hermes
  tiles get the line that Hermes isn't connected.
- **Hermes depends on your setup.** Approval buttons appear only if your Hermes approval policy raises
  approval requests for API runs; otherwise Hermes may deny them itself. Hermes reports steps, not
  percentages. Chat needs your model to return bare JSON, and Capri falls back to Tier 1 when it
  does not. Live event streaming through Cloudflare and an authenticated call from Quest Browser are
  listed as unconfirmed in [`docs/hermes-integration.md`](docs/hermes-integration.md) (section H).
- **Tested hardware.** Only a Quest 3 on Quest Browser 156 was tested. Quest 3S is a target but was
  not tested.
- **Content-Security-Policy trade-offs.** `connect-src` allows any `https:` endpoint (the backend URLs
  are typed at run time) and `script-src` includes `'unsafe-eval'` for the Vosk worker. See
  [`docs/hosting.md`](docs/hosting.md).
- **Untested options.** Serving Capri from Home Assistant's `/config/www` and HTTPS fronts other than
  Cloudflare Tunnel for Hermes were not tested.

## Docs

| File | Contents |
| --- | --- |
| [`docs/demo-path.md`](docs/demo-path.md) | The two-minute demo script, where things appear, the menu tiles, working phrases, fallbacks |
| [`docs/submission.md`](docs/submission.md) | Competition submission text: form fields, short and long descriptions, limitations |
| [`docs/demo-video-plan.md`](docs/demo-video-plan.md) | Shot list and Quest recording method for the demo video (under 3 minutes) |
| [`docs/submission-checklist.md`](docs/submission-checklist.md) | Deploy, headset checks, video, and form steps before the deadline |
| [`docs/project-plan.md`](docs/project-plan.md) | Step order, cut-line, project structure, IWSDK API check |
| [`docs/spike-report.md`](docs/spike-report.md) | Milestone 0 headset results and the capability flags they set, plus the boundaryless session and system keyboard follow-ups |
| [`docs/hosting.md`](docs/hosting.md) | Vercel build, headers, CSP, deploy and domain steps |
| [`docs/hermes-integration.md`](docs/hermes-integration.md) | How you reach Hermes in Capri, the confirmed Hermes API surface, and what is still unconfirmed |
| [`docs/voice-engine.md`](docs/voice-engine.md) | Piper setup, the chosen voice, loudness |
| [`docs/performance-note.md`](docs/performance-note.md) | Frame-time measurements and performance levers |
| [`docs/comfort-check.md`](docs/comfort-check.md) | Personal space, menu and panel placement, and seated reach checks |
| [`docs/THIRD_PARTY.md`](docs/THIRD_PARTY.md) | Third-party assets in detail |
| [`docs/animation-clips.md`](docs/animation-clips.md) | Optional idle animation clip: Quest checks, adding and removing clips |

IWSDK guides: [minimal scene](https://iwsdk.dev/guides/01b-minimal-scene.html) and
[IWER emulator controls](https://iwsdk.dev/guides/02-testing-experience.html#iwer-controls).

## Third-party assets

- Placeholder Avatar `public/models/capri.vrm`: "VRM1_Constraint_Twist_Sample" by pixiv Inc.,
  (c) 2022 pixiv Inc., licensed under the [VRM Public License 1.0](https://vrm.dev/licenses/1.0/).
  Source: https://github.com/vrm-c/vrm-specification/tree/master/samples/VRM1_Constraint_Twist_Sample.
  Unmodified. Details in `docs/THIRD_PARTY.md`. To swap the Avatar, replace that file or change the
  path in `src/config/avatar-config.ts`.
- Voice lines `public/voice/*.mp3`: synthesised at development time with Piper and the voice
  `en_US-kristin-medium` (US English female, single speaker, trained from scratch by Bryce Beattie on
  public-domain LibriVox recordings, https://brycebeattie.com/files/tts/). Voice models:
  https://huggingface.co/rhasspy/piper-voices. Regenerate with `npm run voice` (setup in
  `docs/voice-engine.md`). Details in `docs/THIRD_PARTY.md`.
- Speech model `vosk-model-small-en-us-0.15` by Alpha Cephei, licensed under Apache 2.0 (listed on
  the [official Vosk models page](https://alphacephei.com/vosk/models)). It is downloaded at build
  time by `npm run fetch:vosk`, repackaged as `.tar.gz`, and served from `/vosk/`. It is not
  committed.
- Optional idle animation clip `public/animations/idle.vrma`: `idle_loop.vrma` from
  [pixiv/ChatVRM](https://github.com/pixiv/ChatVRM), (c) 2023 pixiv Inc., MIT License (notice in
  `public/animations/LICENSE-idle.txt`). Unmodified. Details in `docs/THIRD_PARTY.md`.
- npm dependencies keep their own licenses, for example `vosk-browser` (Apache-2.0), `@iwsdk/core`,
  `three` (super-three), `@pixiv/three-vrm`, and `@pixiv/three-vrm-animation` (MIT).

## License

- **Capri's own code:** License: TBD by the author. There is no `LICENSE` file yet.
- **Avatar model:** VRM Public License 1.0, with the conditions read from the model's own metadata in
  `docs/THIRD_PARTY.md` (for example, no antisocial or hate use and no implied endorsement by pixiv).
- **Voice:** Piper voice `en_US-kristin-medium` by Bryce Beattie, trained on public-domain LibriVox
  recordings; no attribution is required and it is credited anyway. The Piper engine
  (GPL-3.0-or-later) is a development tool and does not ship with the app.
- **Vosk model:** Apache 2.0, per the [Vosk models page](https://alphacephei.com/vosk/models).
