# Hermes integration (Gate H)

Status: **Gate H complete (task 21.3, 2026-11-17).** Sections 1 to 10 are the task 21.1 research and stay as written. The binding record is the "Confirmed surface" section at the end. Task 21.10 may implement only what that section marks as confirmed.

The paths, header names, and field names below are quoted from the upstream project's documentation and source so that the questions in task 21.2 are precise. They are upstream facts, not values for this app. The user's instance may run a different version, a different profile prefix, or a proxy in front.

Research date: 2026-11-17.

## 1. Which "Hermes"

The spec says only "a self-hosted Hermes agent". Candidates found:

| Candidate | What it is | Fits "self-hosted agent"? |
|---|---|---|
| **Hermes Agent by Nous Research** ([repo](https://github.com/NousResearch/hermes-agent), [docs](https://hermes-agent.nousresearch.com/docs/)) | MIT-licensed, self-hosted agent with tools (terminal, files, web), memory, skills, cron jobs, and a messaging gateway. Latest release when researched: [v0.23.2](https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.2) (2026-11-16). Docs and source read at `main` commit [`70f345c`](https://github.com/NousResearch/hermes-agent/tree/70f345c5584cfff55df3b510ba880956493a7183) (2026-11-17). | Yes. Most likely candidate. |
| Nous Research **Hermes models** (Hermes 3, Hermes 4) served by Ollama, vLLM, or llama.cpp | A model family, not an agent. Such servers expose a plain OpenAI-compatible chat endpoint with no task or run concept. | Possible if the user means "a Hermes model I host". Unconfirmed. |
| Web UIs built on Hermes Agent, for example [Hermes Studio](https://github.com/JPeetz/Hermes-Studio) | Third-party dashboards that sit on top of Hermes Agent. Not an agent of their own. | Only as a front end. Its own API, if any, was not researched. |
| `hermes-agent.org` | Third-party site describing Hermes Agent. The upstream README links only `hermes-agent.nousresearch.com` ([README](https://github.com/NousResearch/hermes-agent/blob/70f345c5584cfff55df3b510ba880956493a7183/README.md)). | Not a separate project. Not used as a source. |

No other self-hosted AI agent named "Hermes" with its own HTTP API turned up in searches. Unrelated projects with the same name (for example an IBC relayer, a JavaScript engine) are not agents and are ignored.

**Unknown:** which of these the user runs, and which version. The rest of this file assumes Nous Research Hermes Agent.

## 2. Integration surfaces of Hermes Agent

Upstream lists three ways for external programs to drive the agent ([Programmatic Integration](https://github.com/NousResearch/hermes-agent/blob/70f345c5584cfff55df3b510ba880956493a7183/website/docs/developer-guide/programmatic-integration.md), table at the top):

| Surface | Transport | Usable from a hosted browser page? |
|---|---|---|
| ACP | JSON-RPC over stdio | No. Needs a local process. |
| TUI gateway | JSON-RPC over stdio, or WebSocket `/api/ws` with a single-use ticket per connection obtained from the `hermes gateway attach --json` CLI | No in practice. A browser cannot run the CLI to mint tickets. |
| **API server** | HTTP plus Server-Sent Events (SSE), OpenAI-compatible | **Yes, if enabled with HTTPS in front and CORS configured.** This is the only candidate for Capri. |

## 3. API server: enabling and configuring

Source: [API Server docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server) ([markdown at `70f345c`](https://github.com/NousResearch/hermes-agent/blob/70f345c5584cfff55df3b510ba880956493a7183/website/docs/user-guide/features/api-server.md), sections "Quick Start" and "Configuration").

- Off by default. Enabled with `API_SERVER_ENABLED=true` in `~/.hermes/.env`, then started with `hermes gateway`.
- Environment variables: `API_SERVER_ENABLED` (default `false`), `API_SERVER_PORT` (default `8642`), `API_SERVER_HOST` (default `127.0.0.1`, loopback only), `API_SERVER_KEY` (required), `API_SERVER_CORS_ORIGINS` (default none), `API_SERVER_MODEL_NAME`.
- The same settings can live in `~/.hermes/config.yaml` under `gateway.api_server` (`enabled`, `port`, `host`, `key`, `cors_origins`, `model_name`, `max_concurrent_runs`). Environment variables win over `config.yaml`.
- The server refuses to start if the key is missing, a placeholder, or shorter than 16 characters ([`api_server.py` L3874 to L3899](https://github.com/NousResearch/hermes-agent/blob/70f345c5584cfff55df3b510ba880956493a7183/gateway/platforms/api_server.py#L3874-L3899)).
- The server speaks plain HTTP. No TLS option was found in `api_server.py` or `tcp_site.py` at `70f345c`. Upstream's Docker guide puts TLS in a reverse proxy or tunnel (Caddy, Traefik, nginx, Cloudflare Tunnel) for the separate Webapp ([docker.md, "Behind a tunnel or reverse proxy"](https://github.com/NousResearch/hermes-agent/blob/70f345c5584cfff55df3b510ba880956493a7183/website/docs/user-guide/docker.md)). **Unconfirmed:** an upstream guide for putting the API server itself behind HTTPS.
- Multi-profile routing: with `gateway.multiplex_profiles`, profiles are served under a `/p/<profile>/` prefix and each prefix needs that profile's own key (docs section "Multi-profile routing").
- Concurrency cap: default 10 concurrent runs. Over the cap, run-starting requests get HTTP 429 (docs section "Concurrent-run cap").

## 4. Authentication

- Bearer token in the `Authorization` header, value `Bearer <API_SERVER_KEY>` (docs section "Authentication").
- The source accepts the key only from that header. No query-string token was found ([`api_server.py` `_check_auth`, L1429 to L1447](https://github.com/NousResearch/hermes-agent/blob/70f345c5584cfff55df3b510ba880956493a7183/gateway/platforms/api_server.py#L1429-L1447)). Consequence: the browser `EventSource` API, which cannot set headers, cannot open an authenticated SSE stream. A browser client must read SSE through `fetch` streaming. This matches the design's note on `SseSource`.
- Upstream warning: the key grants the agent's full toolset, including terminal commands, on the Hermes host (docs section "Authentication", Security admonition).
- **Unknown:** whether the user has an extra auth layer in front (Cloudflare Access, Tailscale, basic auth on a proxy). Such a layer could add headers or cookies the browser cannot send cross-origin.

## 5. Request and response formats

Docs section "Endpoints" and the endpoint list in [Programmatic Integration, "OpenAI-Compatible API Server"](https://github.com/NousResearch/hermes-agent/blob/70f345c5584cfff55df3b510ba880956493a7183/website/docs/developer-guide/programmatic-integration.md):

| Endpoint (upstream) | Purpose | Notes |
|---|---|---|
| `POST /v1/chat/completions` | OpenAI Chat Completions. `messages` array, optional `stream: true` | Stateless unless `X-Hermes-Session-Id` is sent. Streaming returns `chat.completion.chunk` events plus a Hermes `hermes.tool.progress` event. `finish_reason` is `cancelled`, `error`, or `length` for non-successful turns. |
| `POST /v1/responses` | OpenAI Responses. `input`, `instructions`, `previous_response_id`, or `conversation` | Server stores history. Tool calls in `output` were already executed by Hermes. |
| `POST /v1/runs` | Start a run. Returns `run_id` with HTTP 202 | Takes `input` and optional `session_id`, `instructions`, `conversation_history`, `previous_response_id`. Supports `Idempotency-Key`. |
| `GET /v1/runs/{run_id}` | Poll run status | Status values seen in docs and source: `queued`, `running`, `waiting_for_approval`, `stopping`, `completed`, `failed`, `cancelled`, `interrupted`, `unknown`. Final text in `output`. |
| `GET /v1/runs/{run_id}/events` | SSE stream of run events | See section 7. |
| `POST /v1/runs/{run_id}/stop` | Interrupt a run | Returns `stopping`, settles as `cancelled`. |
| `POST /v1/runs/{run_id}/approval` | Answer a pending approval | See section 7. |
| `GET /v1/capabilities` | Machine-readable feature flags | Lets a client detect runs, SSE, stop, and approval support for the running version. |
| `GET /v1/models` | Model list | Advertises `hermes-agent` or the profile name. |
| `GET /health`, `/v1/health` | Liveness | Returns a small status object. |

A `system` message (Chat Completions) or `instructions` (Responses, Runs) is layered on top of Hermes' own system prompt, and the agent keeps its tools and memory (docs section "System Prompt Handling").

## 6. Structured output for the Response_Contract

The Response_Contract is `{speech, emotion, animation, action:{type,target,params}}` (Requirement 20.2).

- **No native structured-output support was found.** At `70f345c`, no file under `gateway/platforms/api_server*.py` reads `response_format` or `json_schema`.
- Client-supplied `tools` and `tool_choice` are listed only as idempotency fingerprint fields ([`api_server_openai_routes.py` L90 to L93 and L1012](https://github.com/NousResearch/hermes-agent/blob/70f345c5584cfff55df3b510ba880956493a7183/gateway/platforms/api_server_openai_routes.py#L90-L93)). No code path that hands them to the model as client-executed functions was found. Hermes runs its own tools server-side and reports them as already completed.
- Consequence: the contract can only be requested in the prompt text (system message or `instructions`) and parsed from the reply text. The design's total `validateContract` plus the Tier 1 fallback on invalid replies covers this. Requirement 20.2's "WHERE the confirmed surface supports structured responses" condition is, on this evidence, not met natively.
- **Unconfirmed:** whether the user's configured model reliably returns bare JSON when asked. That depends on the model and provider, not on Hermes.

## 7. Long-running tasks and progress

Docs sections "Runs API", "GET /v1/runs/{run_id}/events", "Jobs API"; [Programmatic Integration, "Terminal run status"](https://github.com/NousResearch/hermes-agent/blob/70f345c5584cfff55df3b510ba880956493a7183/website/docs/developer-guide/programmatic-integration.md).

- **Start and track:** `POST /v1/runs` returns a `run_id`. Progress then comes from either:
  - **SSE** at `/v1/runs/{run_id}/events`: `message.delta`, `message.interim`, `tool.started`, `tool.completed`, `subagent.start`, `subagent.complete`, `approval.request`, and one terminal event `run.completed`, `run.failed`, `run.cancelled`, or `run.interrupted`. A `: keepalive` comment line is sent after 10 s of silence, so a custom parser must skip lines that start with `:`. Resume is supported with `Last-Event-ID` or a `last_seq` query value ([`api_server_runs.py` L1256 to L1281](https://github.com/NousResearch/hermes-agent/blob/70f345c5584cfff55df3b510ba880956493a7183/gateway/platforms/api_server_runs.py#L1256-L1281)). The stream requires the same bearer auth.
  - **Polling** `GET /v1/runs/{run_id}`, which upstream describes as the option for UIs that reconnect after navigation.
- **No numeric progress.** No percentage or step count was found. The Task_Panel would show qualitative progress (tool started, tool finished) rather than the mock's 0, 25, 60, 100 percent.
- **Retention limits:** unconsumed event buffers expire after five minutes. Terminal statuses are kept "briefly" for polling. **Unconfirmed:** the exact retention time.
- **Approvals:** a run can stop in `waiting_for_approval` until `POST /v1/runs/{run_id}/approval` answers it. For unattended API sessions the default policy is `deny`, but upstream says `/v1/runs` and streaming chat clients still receive the approval request ([security.md, `unattended_mode` row](https://github.com/NousResearch/hermes-agent/blob/70f345c5584cfff55df3b510ba880956493a7183/website/docs/user-guide/security.md)). Capri has no approval UI in the spec. **Unknown:** how the user wants this handled.
- **Scheduled jobs:** `/api/jobs` creates cron-style jobs whose results go to a delivery target such as a messaging platform. Not a fit for "tell me when done" inside the session.
- **Webhooks:** Hermes' webhook platform is inbound only: external services POST to Hermes to trigger runs ([webhooks.md](https://github.com/NousResearch/hermes-agent/blob/70f345c5584cfff55df3b510ba880956493a7183/website/docs/user-guide/messaging/webhooks.md)). A static page cannot receive webhooks, so this is not a status channel for Capri.
- **WebSocket:** only the TUI gateway uses one, and it needs CLI-minted tickets (section 2). No browser-usable WebSocket transport.

On this evidence the candidate transports are fetch-streamed SSE on the runs events endpoint, or polling the run status. Which one is used is decided in task 21.3 from the user's answers.

## 8. CORS

Docs section "CORS" and [`api_server.py` L647 to L676 and L1340 to L1363](https://github.com/NousResearch/hermes-agent/blob/70f345c5584cfff55df3b510ba880956493a7183/gateway/platforms/api_server.py#L647-L676).

- Off by default. Enabled by listing exact origins, comma-separated, in `API_SERVER_CORS_ORIGINS` (or `cors_origins` in `config.yaml`). For Capri the entry is the hosted origin from `docs/hosting.md`, `https://capri.sanyamchhabra.in`, with no trailing slash.
- A `*` entry is accepted by the source. It should not be used, because the key unlocks terminal access.
- **A request whose `Origin` is not on the list is rejected with HTTP 403**, including preflight. A browser sees this as a network error, the same as a CORS or mixed-content failure. The design already maps that to `network_or_cors`.
- Allowed request headers: `Authorization`, `Content-Type`, `Idempotency-Key`, `X-Hermes-Session-Id`. `X-Hermes-Session-Key` is not in the list, so a browser cannot send it.
- Allowed methods: `GET, POST, DELETE, OPTIONS`. No `PATCH`.
- No `Access-Control-Expose-Headers` was found, so browser code cannot read custom response headers. Upstream says Chat Completions also echoes the session ID in the JSON body and stream.
- Preflight cache: `Access-Control-Max-Age: 600`. SSE responses carry the CORS headers.
- **Unknown:** whether a proxy or tunnel in front of the user's Hermes adds, strips, or overrides these headers.

## 9. Browser feasibility from the hosted Capri page on Quest

| Issue | Finding | Status |
|---|---|---|
| HTTPS or WSS only | Requirement 19.11, the app's URL guard, and the `connect-src 'self' https: wss: blob:` CSP in `vercel.json` all refuse `http://`. The default Hermes listener is plain HTTP on `127.0.0.1:8642`. | A TLS front end (reverse proxy or tunnel) is required. Unknown whether the user has one. |
| Mixed content | An `https://` page cannot call an `http://` endpoint. Chrome's Local Network Access permission can relax mixed-content blocking for local-network requests ([Chrome blog](https://developer.chrome.com/blog/local-network-access), [blink-dev intent](https://groups.google.com/a/chromium.org/g/blink-dev/c/cwu_RUmBpzY)), but Capri's own CSP still blocks `http:`. | Plain `http://<LAN IP>:8642` is not usable. |
| Trusted certificate | A self-signed certificate on the Hermes front end makes `fetch` fail unless the headset trusts it. | Unconfirmed how Quest Browser handles a cert accepted by visiting the URL first. A publicly trusted cert (Tailscale Serve, Cloudflare Tunnel, Caddy with a real domain) avoids the question. |
| Local Network Access prompt | Chromium asks before a public site reaches a private or loopback address ([Chrome blog](https://developer.chrome.com/blog/local-network-access)). | Unconfirmed for Quest Browser 156. Only relevant if the HTTPS endpoint resolves to a private IP. |
| Bind address | Default `API_SERVER_HOST` is loopback. The Quest cannot reach it unless a proxy on the Hermes machine forwards to it, or the host is changed. | Unknown for the user's setup. |
| CORS | Must list `https://capri.sanyamchhabra.in` (section 8). | Unknown whether the user can set it. |
| Authenticated SSE | `EventSource` cannot send `Authorization`. Use `fetch` streaming. | Confirmed from source. |
| Key in the browser | The key is typed on the Setup_Page and stored in the headset's browser storage for this origin only (Requirement 24, `docs/hosting.md`). It grants terminal access on the Hermes host, so anyone with the headset unlocked, or script running on this origin, could use it. The API server docs describe no read-only or per-client scoped key. Source references to "room grants" for hosted rooms exist and were not researched. | User decision. Requirement 19.12 forbids adding a bridge server to hide the key. |
| Approvals | A run waiting for approval stalls until answered (section 7). | Unknown how the user wants this handled. |

If any of HTTPS, CORS, or the key decision cannot be met, Requirement 19.12 applies: report the constraint and keep the scripted Mock Mode task. No backend or bridge server is added.

## 10. Unknowns that task 21.2 must resolve

1. Which Hermes and which version.
2. The HTTPS URL the Quest can reach, including any `/p/<profile>/` prefix.
3. The auth method in practice (bearer key only, or another layer in front).
4. One working call made from a device other than the Hermes host, with its response.
5. Whether `API_SERVER_CORS_ORIGINS` can include the hosted origin, and whether a proxy changes CORS headers.
6. How long-running tasks should surface (live events, polling, or not at all), and how approval requests are handled.

## Confirmed surface

Recorded in task 21.3 on 2026-11-17. Only what this section marks as confirmed may be implemented in task 21.10. Every statement carries one of three labels:

- **[user]**: the user confirmed it in Gate H part 2 (task 21.2).
- **[checked]**: observed in this task with a read-only request that sends no key (preflights, `GET /health`, TLS handshake).
- **[source]**: read from upstream source. It matches what the user's `GET /v1/capabilities` advertises, but has not been observed on the user's instance. Task 21.10 may build on these shapes, but must treat unknown fields and event names as ignorable, and the first authenticated test on the headset confirms them.

The API key is never written to the repo, logs, docs, or error text. It does not appear anywhere in this file.

### A. Instance and endpoint

| Item | Value | Label |
|---|---|---|
| Product | Nous Research Hermes Agent, API server platform | [user] |
| Version | The user gave none. `GET /health` returns `{"status": "ok", "platform": "hermes-agent", "version": "0.21.4"}` | [checked] |
| Base URL | `https://hermes-api.sanyamchhabra.in`. Not `hermes.sanyamchhabra.in`, which the user corrected. No `/p/<profile>/` prefix. | [user] |
| Front end | Cloudflare Tunnel (`cloudflared`). Responses carry `server: cloudflare`. | [user], [checked] |
| TLS | Certificate subject `CN=sanyamchhabra.in`, SAN `sanyamchhabra.in, *.sanyamchhabra.in`, issuer Google Trust Services `WE1` (Cloudflare's edge certificate), valid 2026-11-05 to 2027-02-03. `curl` reports `ssl_verify_result` 0, so the certificate is publicly trusted. HTTP/2. HSTS `max-age=31536000; includeSubDomains`. | [checked] |
| Reachability | Public over HTTPS. The user's example calls were made against this host. | [user] |
| Where the URL lives in Capri | The user types it on the Setup_Page. It is stored with the other Live Mode settings and is not compiled into the bundle. | Decision for 21.10, from Requirement 24 |

Upstream source used for [source] items: tag `v0.21.4+canary.20260929T070217Z`, commit [`666f313`](https://github.com/NousResearch/hermes-agent/tree/666f313d1d3abd8077291ba464cf0a10f1a6157f) (2026-09-29). Upstream has no plain `v0.21.4` release tag, only canary builds, so the exact build on the user's machine is unknown and this is the newest source that reports 0.21.4. All shapes below were also checked against `main` at `70f345c` (the task 21.1 commit). They agree, except that `main` adds an optional `call_id` to `tool.started` and `tool.completed` ([`main` `api_server_runs.py` L141 to L146](https://github.com/NousResearch/hermes-agent/blob/70f345c5584cfff55df3b510ba880956493a7183/gateway/platforms/api_server_runs.py#L141-L146)). In the table and links below, "canary" means commit `666f313`.

### B. Authentication

- **[user]** Bearer token only: `Authorization: Bearer <API_SERVER_KEY>`. There is no other layer in front: no Cloudflare Access, no cookie, no basic auth.
- **[user]** The user accepts storing the key on the headset through the Setup_Page, in this origin's browser storage (Requirement 24).
- **[source]** The key is read only from the `Authorization` header and compared in constant time. A wrong or missing key returns HTTP 401 with `{"error": {"message": "Invalid gateway API key (API_SERVER_KEY)", "type": "gateway_auth_error", "code": "gateway_auth_failed"}}` ([canary `api_server.py` L1579 to L1608](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/gateway/platforms/api_server.py#L1579-L1608)).
- **[checked]** `GET /health` needs no key and returns CORS headers for the Capri origin, so the Setup_Page can use it as a reachability check before any authenticated call.

### C. Capabilities (as the user ran them)

**[user]** `GET /v1/capabilities` returned `object: "hermes.api_server.capabilities"`, `platform: "hermes-agent"`, `model: "hermes-agent"`, `auth: {type: "bearer", required: true}`, runtime mode `server_agent`, `tool_execution: "server"`, and these features:

| Feature | Value |
|---|---|
| `chat_completions`, `chat_completions_streaming` | true, true |
| `responses_api`, `responses_streaming` | true, true |
| `run_submission`, `run_status`, `run_events_sse`, `run_stop`, `run_steer`, `run_approval_response` | all true |
| `runs_idempotency` | `{supported: true, durable: true, retention_seconds: 86400}` |
| `tool_progress_events`, `approval_events`, `session_chat` | all true |
| `session_continuity_header`, `session_key_header` | `X-Hermes-Session-Id`, `X-Hermes-Session-Key` |
| `audio_api`, `realtime_voice` | false, false |
| `cors` | false at the time the user ran it. CORS has since been enabled (section F). |

Endpoints advertised: `GET /health`, `GET /health/detailed`, `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/runs`, `GET /v1/runs/{run_id}`, `GET /v1/runs/{run_id}/events`, `POST /v1/runs/{run_id}/approval`, `POST /v1/runs/{run_id}/steer`, `POST /v1/runs/{run_id}/stop`, plus session and skills endpoints. Capri uses only the five listed in sections D and E, plus `GET /health`.

### D. Tier 2 chat: `POST /v1/chat/completions`

**[user]** Request the user ran:

```json
{"model": "hermes-agent", "messages": [{"role": "user", "content": "Say hi in five words."}]}
```

**[user]** Response: an OpenAI-style `chat.completion`. `choices[0].message.content` was `"Hi, Sanyam. I am here."`, `choices[0].finish_reason` was `"stop"`, and `usage.prompt_tokens` was 14714. The server adds its own large system prompt, so expect several seconds per reply.

**[user]** `choices[0].message.reasoning_content` carries a long chain of thought. Capri must never speak, show, log, or parse it. Only `choices[0].message.content` is read.

**[source]** Response construction: `{id, object: "chat.completion", created, model, choices: [{index: 0, message: {role: "assistant", content, reasoning_content?}, finish_reason}], usage}`. A turn that produced no text and failed returns HTTP 502 with an OpenAI error envelope, code `agent_incomplete`. A partial turn returns 200 with a non-`stop` `finish_reason` and a `hermes` extras object ([canary `api_server_openai_routes.py` L800 to L840](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/gateway/platforms/api_server_openai_routes.py#L800-L840)). Capri treats any non-200 status, or a `finish_reason` other than `"stop"`, as a failed call and falls back to Tier 1.

**[user]** Persona and contract handling:

- The user's Hermes has its own persona (Yoda) in its system prompt. Capri therefore sends, in every request, a `system` message with Capri's Persona and the Response_Contract instructions (`{speech, emotion, animation, action:{type,target,params}}`, bare JSON only), then the `user` message with the typed text and the Spatial_Context.
- The server has no native structured output (section 6), so Requirement 20.2 is met through the prompt only. Capri parses `message.content` as JSON (tolerating a surrounding code fence), runs it through `validateContract`, and falls back to Tier 1 with the Hermes-unavailable line if parsing or validation fails (Requirements 20.8, 20.9).
- **Unconfirmed:** how reliably the user's model returns bare JSON while its Yoda system prompt is active. A `system` message is layered on top of Hermes' own prompt and does not replace it (section 5).

Capri sends no `X-Hermes-Session-Id` or `X-Hermes-Session-Key`. Each request carries its own persona and context, so calls stay stateless. `stream` is not used for chat.

### E. Long-running tasks: runs plus live step events

**[user]** Transport: live step events from `GET /v1/runs/{run_id}/events` (SSE), read through `fetch` streaming because the key travels in the `Authorization` header and `EventSource` cannot set headers. The Task_Panel shows the current step, not a percentage. Approval requests appear in the Task_Panel with Approve and Deny pinch buttons that call `POST /v1/runs/{run_id}/approval`. This is the single transport for task 21.10 (Requirement 19.7).

All shapes in this section are **[source]**. The user ran no runs call.

**Start a run: `POST /v1/runs`** ([canary `api_server_runs.py` L620 to L756](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/gateway/platforms/api_server_runs.py#L620-L756), history fields L421 to L458)

- Headers: `Authorization`, `Content-Type: application/json`. An `Idempotency-Key` header (1 to 255 visible ASCII characters) is optional and CORS-allowed.
- Body: `input` (required, a string or a messages array; the last message's `content` is the task), optional `instructions` (string, layered on Hermes' system prompt), optional `session_id`, `conversation_history`, `previous_response_id`, `model`. Capri sends `input` (task text plus Spatial_Context) and `instructions` (Capri's Persona and a request for a short final summary).
- Success: HTTP 202, body `{"run_id": "run_<32 hex>", "status": "started", "replayed": false}` ([L461 to L467](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/gateway/platforms/api_server_runs.py#L461-L467)).
- Errors: 400 `Missing 'input' field` or `No user message found in input`, 401 (section B), 409 `idempotency_key_conflict`, 429 when the concurrent-run cap is reached.

**Run status: `GET /v1/runs/{run_id}`** ([L1057 to L1061](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/gateway/platforms/api_server_runs.py#L1057-L1061), record built in `_set_run_status` L258 to L284)

- Body: `{object: "hermes.run", run_id, status, created_at, updated_at, session_id, model, last_event, ...}`. Terminal records add `completed`, `partial`, `interrupted`, and either `output`, `usage`, `runtime` (completed) or `error` (failed). While waiting, `approval` holds the pending `approval.request` event.
- `status` values: `queued`, `running`, `waiting_for_approval`, `stopping`, `completed`, `failed`, `cancelled`, `interrupted`. Terminal set: `completed`, `failed`, `cancelled`, `interrupted` ([canary `api_server_run_idempotency.py` L19](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/gateway/platforms/api_server_run_idempotency.py#L19)).
- Capri may call this once to settle a task whose event stream dropped before a terminal event. It is not a polling loop.

**Event stream: `GET /v1/runs/{run_id}/events`** ([L1064 to L1153](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/gateway/platforms/api_server_runs.py#L1064-L1153))

- Response: HTTP 200, `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, with CORS headers set before the head is flushed ([canary `api_server.py` L1508 to L1516](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/gateway/platforms/api_server.py#L1508-L1516)).
- Framing: each event is `id: <seq>\ndata: <json>\n\n`. There is no `event:` line; the event name is the `event` field inside the JSON ([canary `api_server.py` L258 to L264](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/gateway/platforms/api_server.py#L258-L264)). Comment lines start with `:` and must be skipped: `: open` right after connect, `: keepalive` after 10 s of silence (L236), and `: stream closed` after the terminal event. The stream closes after `: stream closed`.
- Resume: `Last-Event-ID: <seq>` header or `?last_seq=<seq>`. If older events were dropped, a `replay.truncated` frame without an `id:` line comes first. The events request is preflighted anyway because of `Authorization`, and `Last-Event-ID` is not in the allowed request headers (section F), so sending it would fail the preflight. Capri resumes with `?last_seq=` only.
- Common envelope on every event: `{event, run_id, timestamp, ...fields, seq}` ([`_run_event` L176 to L178](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/gateway/platforms/api_server_runs.py#L176-L178), `seq` added at L1101 to L1104).

| `event` | Extra fields | Capri use |
|---|---|---|
| `tool.started` | `tool`, `preview` (L93 to L94) | Current step = `tool`. Show the tool name only. The `preview` here is not passed through the redaction that `tool.completed` uses, so it is not shown. |
| `tool.completed` | `tool`, `duration` (seconds, 3 decimals), `error` (bool), `preview` (redacted, at most 500 characters) (L95 to L96, L101 to L109) | Mark the step done or failed. |
| `message.interim` | `text`, `already_streamed` (L927 to L935) | Optional current-step text, truncated for the panel. |
| `message.delta` | `delta` (L920 to L925) | Ignored. The final text arrives in `run.completed`. |
| `reasoning.available` | `text` (L97) | **Ignored. Chain of thought, never shown or spoken.** |
| `subagent.start`, `subagent.complete` | optional `preview`, and any of `goal`, `status`, `summary`, `subagent_id`, ... (L80 to L85, L337 to L347) | Optional step label from `goal`. |
| `approval.request` | `command` (redacted), `description`, `pattern_key`, `pattern_keys`, `allow_session`, `allow_permanent`, optional `smart_denied`, `request_id`, `choices` (array, a subset of `once`, `session`, `always`, `deny`) ([canary `api_server.py` L106 to L126](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/gateway/platforms/api_server.py#L106-L126), [`tools/approval.py` L862 to L869](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/tools/approval.py#L862-L869), `request_id` set in [`tools/approval_gateway_wait.py` L32](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/tools/approval_gateway_wait.py#L32)) | Show `description` in the Task_Panel with Approve and Deny buttons. The run status becomes `waiting_for_approval` (L850 to L861). |
| `approval.responded` | `choice`, optional `request_id`, `resolved` (L1156 to L1162, L1213) | Hide the approval buttons. |
| `run.completed` | `completed: true`, `partial: false`, `interrupted: false`, `output` (final text), `usage`, `runtime` (L181 to L200, L986) | Task done. Play notify and a `task-complete` line. `output` may be shown as a short bubble. |
| `run.failed` | `completed: false`, `partial`, `interrupted: false`, optional `turn_exit_reason`, `error` (redacted text) | Task failed. Notify plus a line with a short, sanitised reason (Requirement 19.10). |
| `run.cancelled` | `completed: false`, `partial`, `interrupted: true`, or no extra fields when stopped before start or when the task is cancelled (L937 to L947, L958, L974, L988) | Task cancelled. |
| `run.interrupted` | `error: "Gateway shutdown interrupted the run."` | Treated as failed. |

Unknown `event` names are ignored. Terminal events are exactly `run.completed`, `run.failed`, `run.cancelled`, `run.interrupted`.

**Answer an approval: `POST /v1/runs/{run_id}/approval`** ([L1165 to L1216](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/gateway/platforms/api_server_runs.py#L1165-L1216))

- Body: `{"choice": "once" | "deny", "request_id": "<from approval.request>"}`. Approve sends `"once"` and Deny sends `"deny"`. The server also accepts `session`, `always`, the aliases `approve`, `approved`, `allow` (all mean `once`), and `all` or `resolve_all`. Capri uses none of those, so one pinch approves one operation only.
- Success: HTTP 200, `{"object": "hermes.run.approval_response", "run_id", "choice", "request_id", "resolved": <count>}`.
- Errors: 400 `invalid_approval_choice` or `invalid_approval_request`, 409 `approval_not_active` or `approval_not_pending` (already answered or timed out). On 409 Capri hides the buttons and waits for the next event.
- Timeout: an unanswered approval is denied after `approvals.timeout`, default 300 s ([`tools/approval_context.py` L240 to L250](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/tools/approval_context.py#L240-L250)). "Silence is not consent."
- **Unconfirmed:** whether the user's approval policy actually raises approval requests for API runs, or denies them outright (section 7, `unattended_mode`). The buttons only appear if an `approval.request` event arrives.

`POST /v1/runs/{run_id}/stop` and `/steer` exist but Capri has no UI for them, so 21.10 does not implement them.

### F. CORS (preflight results)

**[user]** The user set `API_SERVER_CORS_ORIGINS=https://capri.sanyamchhabra.in` and restarted Hermes. Cloudflare Tunnel sits in front.

**[checked]** All three preflights from `Origin: https://capri.sanyamchhabra.in` pass. Each returned:

```
HTTP/2 200
access-control-allow-origin: https://capri.sanyamchhabra.in
access-control-allow-methods: GET, POST, DELETE, OPTIONS
access-control-allow-headers: Authorization, Content-Type, Idempotency-Key, X-Hermes-Session-Id
access-control-max-age: 600
vary: Origin
server: cloudflare
```

| Request | Preflight asked for | Result |
|---|---|---|
| `OPTIONS /v1/chat/completions` | `POST`, headers `authorization,content-type` | 200, origin allowed |
| `OPTIONS /v1/runs` | `POST`, headers `authorization,content-type` | 200, origin allowed |
| `OPTIONS /v1/runs/x/events` | `GET`, header `authorization` | 200, origin allowed |
| `GET /health` (no key) | none | 200, same CORS headers, body `{"status": "ok", "platform": "hermes-agent", "version": "0.21.4"}` |
| `OPTIONS /v1/chat/completions` from `Origin: https://example.com` | `POST` | 403, no CORS headers. Unlisted origins are refused. |

Cloudflare passes the server's CORS headers through unchanged. No `Access-Control-Expose-Headers` is sent, so Capri cannot read `X-Hermes-*` response headers; it does not need them. `Content-Type` is a CORS-safelisted response header, so `fetch` can read `text/event-stream` and the stream body without extra exposure.

**[source]** The middleware answers `OPTIONS` before routing, which is why `/v1/runs/x/events` preflights with a made-up id ([canary `api_server.py` L824 to L853](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/gateway/platforms/api_server.py#L824-L853), [L1497 to L1520](https://github.com/NousResearch/hermes-agent/blob/666f313d1d3abd8077291ba464cf0a10f1a6157f/gateway/platforms/api_server.py#L1497-L1520)). The allowed request headers include `Authorization` and `Content-Type`, and not `X-Hermes-Session-Key` or `Last-Event-ID`.

### G. Browser feasibility from the hosted Capri page

| Check | Result |
|---|---|
| HTTPS | Met. Public Cloudflare certificate, publicly trusted (section A). No certificate prompt on the Quest is expected. |
| Mixed content and Local Network Access | Not applicable. The endpoint is a public HTTPS host, not a LAN address. |
| Capri CSP | Met. `vercel.json` line 14 sets `connect-src 'self' https: wss: blob: data:`, which allows `https://hermes-api.sanyamchhabra.in`. No CSP change is needed. |
| URL guard (task 21.8, not yet written) | As specified, the guard accepts any `https://` or `wss://` URL, so `https://hermes-api.sanyamchhabra.in` passes as a user-configured endpoint. It must not hard-code or allow-list this host. |
| Mock Mode network guard | Only installed when the resolved mode is Mock (`src/main.ts` line 40, `installMockNetworkGuard` in `src/app/network-guard.ts` line 48). In Live Mode it is not installed, so it does not block Hermes. In Mock Mode it keeps blocking Hermes, as Requirement 23.6 requires. |
| CORS | Met for the Capri origin on all three paths (section F). |
| Auth from a browser | Met. A bearer header is allowed by the preflight. The authenticated SSE stream must use `fetch` streaming (section E). |
| SSE through Cloudflare | **Unconfirmed.** Not observed, because opening a stream needs the key. The server sends `X-Accel-Buffering: no` and a keepalive every 10 s, which keeps the connection well inside Cloudflare's idle timeout. The first authenticated run on the headset confirms that events arrive live rather than buffered. |
| Authenticated call from Quest Browser | **Unconfirmed.** It needs the key, so it was not run here. It is the first check in the task 21.12 hand-off. |
| Backend or bridge server | None added, none needed (Requirement 19.12). |

**Blockers: none.** Live Hermes can proceed to tasks 21.4 to 21.12.

### H. Still unconfirmed

1. The exact Hermes build. `/health` reports 0.21.4; the source used here is the newest 0.21.4 canary.
2. Every [source] shape in section E on the user's instance, until the first authenticated run.
3. Whether the user's model reliably returns bare Response_Contract JSON with its Yoda system prompt active.
4. Whether the user's approval policy raises approval requests for API runs.
5. Live SSE delivery through the Cloudflare Tunnel.
6. Chat latency in seconds. The user's example showed only that the prompt is large (14714 prompt tokens).
