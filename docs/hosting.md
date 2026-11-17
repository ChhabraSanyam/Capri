# Hosting (Vercel)

Capri is a static Vite build served from the root of the user's custom subdomain (`base: '/'`). There is no backend. The deploy configuration is `vercel.json`, and its checks live in `tests/unit/vercel-config.test.ts`. The first deploy and the subdomain are task 19.6.

## What the Vercel build does

`vercel.json` runs `npm ci`, then `npm run build:vercel`, and serves `dist/`:

```
npm run typecheck
npm test -- --run
npm run fetch:vosk      # downloads the 41 MB Vosk model into the git-ignored public/vosk/
npm run build:lexicon   # builds public/vosk/lexicon.txt from that model
vite build              # copies public/ into dist/
```

Any failing step fails the build, and Vercel keeps serving the previous production deployment. Task 27.5 adds `npm run check` after `vite build`.

Build requirements:

- **Node 22.18 or newer on the 22 line.** `tools/*.ts` run as `node tools/<file>.ts`, which needs Node's built-in TypeScript stripping (unflagged from 22.18). Set the project's Node.js version to `22.x` in Vercel (Settings, General). `.nvmrc` (22.12.0) is not read by Vercel.
- **`unzip` and `tar` on the build machine.** `fetch:vosk` and `build:lexicon` call them. Both are present on macOS. Their presence on the Vercel build image was not checked, so the first deploy (19.6) is the check.
- **The build downloads from `alphacephei.com`.** If that host is down, the build fails and the previous deployment stays live.
- **The voice library is committed.** `public/voice/` (the mp3 files and `index.json`) is in git and is never generated at build time. Only `public/vosk/` is generated.

## What ships in `dist/`

- `public/**/AGENTS.md` guidance files are removed after the build by the `capri:drop-public-agents-files` plugin in `vite.config.ts`.
- Dev-only window handles (`__capri`, `__capriVfx`, and the others) are behind `import.meta.env.DEV`, so Vite drops them. A search of `dist/` for `__capri` finds nothing.
- No source maps are emitted by the production build.
- `public/ui/` is copied whole, so the dev panel and spike panel `.uikitml` files are in `dist/ui/`. The entry page did not request them in the checks below.

## Rewrites and headers

- One rewrite sends only extensionless paths to `/index.html`. Files are served first, and a missing file with an extension stays a 404 (so a missing voice file is an audio error, not an HTML parse error).
- Every route gets the Content-Security-Policy, Permissions-Policy (`microphone` and `xr-spatial-tracking` for `self` only), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, and `Strict-Transport-Security`.
- `/assets/*` and `/vosk/*` get `Cache-Control: public, max-age=31536000, immutable`. The model file name carries its version, so the 41 MB download happens once per visitor. `/voice/*` gets `max-age=604800` without `immutable`, because its file names are not content-hashed.
- `/vosk/lexicon.txt` is derived from the model but its name carries no version, so it is cached as immutable too. If the model version changes, change the lexicon file name or give it its own header entry.

## Content-Security-Policy and its trade-offs

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval';
worker-src 'self' blob:;
connect-src 'self' https: wss: blob: data:;
img-src 'self' data: blob:;
media-src 'self' blob: data:;
font-src 'self' data:;
style-src 'self' 'unsafe-inline';
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

### Home Assistant and Hermes endpoints

A build-time CSP cannot list the Home Assistant and Hermes URLs the user types on the Setup_Page, so `connect-src` allows any `https:` and `wss:` endpoint. Plain `http:` and `ws:` are excluded. This is weaker than an exact allow-list: script on the page could send data to any HTTPS host. The controls that remain are:

- `script-src` allows only same-origin scripts, so injected or third-party scripts do not run (there is no `'unsafe-inline'`).
- `object-src 'none'` and `base-uri 'self'`.
- The app has no third-party scripts.
- `UrlGuard` refuses non-HTTPS endpoints.
- Credentials are sent only to the configured endpoint.

### Two relaxations found in the production build (assumption A19)

The policy in the design (`script-src 'self' 'wasm-unsafe-eval'`, `connect-src 'self' https: wss: blob:`) was run against the production build in headless Chromium. It broke the voice model: the Setup_Page showed "The voice model could not load". Two violations came from the `vosk-browser` worker, which is an inline `blob:` worker and therefore inherits the page's policy:

| Directive | Violation | Cause | Relaxation |
| --- | --- | --- | --- |
| `script-src` | `eval` blocked (fatal, the model never loads) | The Emscripten runtime inside the worker calls `new Function(...)` in `createNamedFunction` while it sets up its error classes. `'wasm-unsafe-eval'` allows WASM compilation only, not `new Function`. | Added `'unsafe-eval'`. |
| `connect-src` | `data:` fetch blocked | The worker fetches its WASM binary from an inlined `data:application/octet-stream;base64,...` URL. | Added `data:`. A `data:` fetch never touches the network. |

Consequences:

- `'unsafe-eval'` applies to the whole page, because a CSP cannot be scoped to one worker. It does not allow inline scripts or other origins, so it matters only if an attacker can already run code on the page, and the `script-src 'self'` restriction on loading is unchanged. The way to drop it is to patch or replace `vosk-browser` so its worker avoids `new Function`, which was not attempted.
- `tests/unit/vercel-config.test.ts` asserts both relaxations, so they cannot be removed by accident.

### Checked on the production build

Served locally with the `vercel.json` rewrites and headers applied, in headless Chromium (task 19.5):

- The entry page loads in Mock Mode, the voice model reaches "Voice model ready", the VRM, lexicon, UI panels, scene JSON, and voice library load, and the console shows no CSP violations.
- With the IWER Quest 3 emulator injected, Enter AR starts an immersive session, the mock bulbs and voice panels are placed, and the voice mp3 files load, with no CSP violations.
- Not covered locally: Quest Browser itself, microphone capture into a Vosk recognizer, and the Hacking VFX. Task 19.6 repeats the CSP check on the deployed site.

## Hosted origin
The hosted origin is `https://capri.sanyamchhabra.in` (no trailing slash, no path). Use this exact string in the README CORS snippets (tasks 25.12 and 27.8) and the submission files. It is deliberately not in `src/` or `vercel.json`. The Home Assistant `cors_allowed_origins` and the Hermes `API_SERVER_CORS_ORIGINS` entries must both list this origin.

## Deploying to Vercel (task 19.6)
Status when this section was written: the repo is a git repository on branch `main` with **no commits and no remote**, the Vercel CLI is **not installed**, and `capri.sanyamchhabra.in` has no DNS record yet. The domain's nameservers are Cloudflare's (`max.ns.cloudflare.com`, `lilith.ns.cloudflare.com`). `npm run build:vercel` passes locally (typecheck, tests, Vosk fetch, lexicon, `vite build`).

### 1. Pick one deploy route
**A. Git integration (recommended: every push to `main` redeploys production).**
1. Commit the work and create an empty GitHub repository (private is fine):
   ```
   git add -A && git commit -m "Capri MVD"      # review `git status` first; artifacts/ holds screenshots you may not want
   git remote add origin git@github.com:<you>/<repo>.git
   git push -u origin main
   ```
2. In Vercel, choose Add New, Project, import that repository.
3. Leave Framework Preset as "Other". `vercel.json` already sets the install command (`npm ci`), build command (`npm run build:vercel`), and output directory (`dist`). Do not override them in the dashboard.

**B. Vercel CLI (no GitHub needed).**
```
npm i -g vercel          # or use `npx vercel@latest` for each command below
vercel login
vercel link              # create a new project named capri, link this folder
vercel --prod            # build on Vercel and promote to production
vercel domains add capri.sanyamchhabra.in capri   # same as step 3 below
```
`vercel link` writes `.vercel/` (git-ignored by the CLI). Without a Git integration, every release needs another `vercel --prod`.

### 2. Set the Node version before the first build
Project Settings, General, Node.js Version: **22.x**, then Save. The build runs `node tools/*.ts` and needs Node 22.18 or newer (22.x resolves to the latest 22 release). `.nvmrc` is not read by Vercel. If the first deploy ran on another version, change it and redeploy.

### 3. Add the domain
1. Project Settings, Domains, Add `capri.sanyamchhabra.in`. Choose "Connect to production" (no redirect).
2. Vercel shows the DNS record to create. For a subdomain this is a `CNAME`. Current Vercel documentation says each project gets its own CNAME target (for example `d1d4fc829fe7bc7c.vercel-dns-017.com`). Older guides use the shared target `cname.vercel-dns.com`, which was not re-verified. **Use the value the Domains page shows.** Do not use a value copied from a document.
3. At the DNS provider (Cloudflare):
   | Type | Name | Target | Proxy status |
   | --- | --- | --- | --- |
   | `CNAME` | `capri` | the value Vercel shows | **DNS only** (grey cloud) |
   Keep the record unproxied. A proxied (orange cloud) record hides Vercel from the DNS check and can break certificate issuance. If Vercel also shows a `TXT` record at `_vercel` (it does so only when the domain is already used by another Vercel account), add that too.
4. Wait for the Domains page to show "Valid Configuration". DNS changes can take minutes, rarely hours. Vercel then issues the HTTPS certificate on its own (nothing to configure). `dig +short CNAME capri.sanyamchhabra.in` should print the target.

### 4. What to expect from the first build
- The Vosk fetch runs `unzip` and `tar` on Vercel's build image. If the build log shows `unzip: command not found` or similar from `npm run fetch:vosk`, report it. The cheapest fixes are, in order: (1) change `tools/fetch-vosk-model.ts` to use a Node-only extractor, (2) commit the extracted model (41 MB, so it needs Git LFS or a release asset).
- If `alphacephei.com` is unreachable, the build fails and the previous deployment stays live.
- The first deployed page gets the CSP check in "Post-deploy smoke check" below. Relax only the directive that blocks something, and record why in this file.

### 5. Post-deploy smoke check
Open `https://capri.sanyamchhabra.in/` (the `*.vercel.app` URL works the same before the domain is verified).
1. The entry page loads over HTTPS with a valid certificate, and DevTools Console shows no `Content-Security-Policy` violations (reload once with the cache disabled).
2. The Mock Mode badge shows, and no setup is needed.
3. The voice model reaches "Voice model ready" (the 41 MB download is slow once, then cached). No `eval`, `data:`, or `blob:` violations from the worker.
4. Network tab: `/vosk/*` and `/assets/*` return `Cache-Control: public, max-age=31536000, immutable`, and `/voice/*.mp3` return 200 with an audio content type (a 404 here must not come back as HTML).
5. On Quest Browser, Enter AR starts an immersive session.
6. The microphone permission prompt appears on the 2D entry page, and allowing it keeps the voice recognizer running into the session.
7. The mock bulbs appear in the room.
8. Say "turn off that" while pointing at a bulb: the bulb turns off and Capri answers.
9. Optional: `/spike.html` loads (a static file served ahead of the SPA rewrite), and `/nonexistent.js` returns 404 rather than `index.html`.

If the Vosk model or voice files fail to load from the hosted site, report the failing request and the console message. The cheapest workaround is usually a CSP relaxation limited to that directive, recorded under "Two relaxations" above.

### Open items for the user
Deploy, domain, and certificate steps need the user's Vercel account and Cloudflare DNS. They cannot be done from this repository, and the Vercel domain verification is the user-confirmed input named in the task list. Task 19.6 is complete only after steps 3 and 5 pass.
