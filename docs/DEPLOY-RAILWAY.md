# Deploying the PRD Builder MCP App to Railway

> **One-stop guide to running the PRD Builder as a real, externally-reachable
> MCP server that Claude.ai / ChatGPT / Goose can connect to.** Walks through
> the very first deploy to ongoing promotion, with the why behind each step so
> you can debug confidently.

This is the **external-hosting companion** to
[`DEPLOYMENT.md`](DEPLOYMENT.md) (which covers local-stdio use inside Claude
Desktop). You can read this end-to-end if you've never deployed an MCP server
before, or jump straight to [the crash course](#crash-course-5-minutes-to-live)
once you're comfortable.

---

## Why Railway for an MCP App at the start?

MCP clients (Claude.ai, ChatGPT, Goose) open a JSON-RPC stream over HTTP and
hold it. They have **short connection timeouts**. Any platform that cold-starts
the server on first request will regularly time out the client during initialize.

| Platform | Cold start (paid) | Persistent process? | Fit for MCP start |
|----------|------------------|--------------------|-------------------|
| **Railway** | none | ✅ Hobby+ always-on | ✅ best first home |
| Render | none on Starter+ ($7/mo) | ✅ paid tiers | good, paid only |
| Fly.io | 100–500ms suspend | ⚠ suspend mode | good with tinkering |
| Vercel | ~250ms Fluid Compute | ❌ serverless | ❌ wrong for the server half |
| Cloudflare Workers | none | ❌ V8 isolate | ❌ Node SDK not native |

Railway runs a single persistent container, deploys from GitHub on push, and
has a clean healthcheck/graceful-shutdown story. Start here. Move to Fly.io
only when you want multi-region, a managed DB, or self-hosted auth.

---

## What this scaffold adds

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build: compiles UI + server, then serves from a slim runtime image |
| `.dockerignore` | Keeps deps/`dist`/docs out of the build context for fast rebuilds |
| `railway.json` | Railway build/deploy config (Dockerfile builder, `/healthz` healthcheck) |
| `packages/mcp-server/src/http.ts` | New HTTP transport entry using `StreamableHTTPServerTransport`, serves UI bundle + healthcheck + MCP `/mcp` route |
| `packages/mcp-server/src/index.ts` | Refactored to dispatch on `TRANSPORT` env: `stdio` (default) or `http` |
| `packages/mcp-server/package.json` | Adds `express` + `start:http` script so the same package works locally and remotely |

The **Rails of the deploy**: one endpoint serves the MCP protocol, the same
container serves the React UI bundle statically, and a `/healthz` endpoint lets
Railway do zero-downtime deploys. The transport the MCP SDK actually uses for
remote clients is **Streamable HTTP** — the modern replacement for the older
SSE-only transport — so one `POST /mcp` (initialize, tool calls) plus
`GET /mcp` (server → client SSE notifications) plus `DELETE /mcp` (session
teardown) cover the protocol over the wire.

---

## Architecture after this deploy

```
┌─────────────────────────────┐
│   Claude.ai / ChatGPT       │
│   (Settings → Connectors)   │
└───────────────┬─────────────┘
                │ HTTPS  POST /mcp  (initialize, tools/call, …)
                │        GET  /mcp  (SSE notifications back to client)
                │        DELETE /mcp
                ▼
┌────────────────────────────────────────────────────────┐
│  Railway container  (your-app.up.railway.app)           │
│                                                         │
│  node packages/mcp-server/dist/index.js                │
│     │                                                   │
│     ├─ TRANSPORT=http  →  startHttp()  (http.ts)        │
│     │     ├─ Express on $PORT  (Railway-injected)        │
│     │     │   ├─ /mcp   → StreamableHTTPServerTransport  │
│     │     │   │            ↕ prd-tools / prd-handlers   │
│     │     │   ├─ /prd-builder-ui/*  → built Vite bundle │
│     │     │   └─ /healthz → 200 {ok:true}              │
│     │     └─ file-backed PRD store (PRD_STORE_DIR)  │
│     │     └─ MCP_AUTH_TOKEN gate on /mcp routes    │
│     │                                                   │
│     └─ (TRANSPORT=stdio → StdioServerTransport, local)    │
└─────────────────────────────────────────────────────────┘
```

The HTML resource returned by `ui-resources.ts` references
`/prd-builder-ui/assets/main.js` and `/prd-builder-ui/assets/main.css`. The
Express static mount at `/prd-builder-ui` serves those files straight out of
the bundled `ui-dist/` directory copied in the Dockerfile's runtime stage. So
the same container both speaks the MCP protocol *and* hands Claude the rendered
React UI — no second deploy, no CORS to configure.

---

## Crash course: 5 minutes to live

Assuming you already have a Railway account (you do) and the Railway CLI is
optional — the web dashboard works just as well.

```bash
# 1. Create a new git repo (or push this folder to an existing one)
cd /mnt/nas/ben/Documents/full-sync/claude/projects/prd-builder-mcp
git init && git add -A && git commit -m "scaffold Railway deploy"

# 2. Push to GitHub (e.g. github.com/benhedrington/prd-builder-mcp)
gh repo create benhedrington/prd-builder-mcp --public --source=. --push
# or use your own git remote:
#   git remote add origin git@github.com:benhedrington/prd-builder-mcp.git
#   git push -u origin main

# 3. In Railway dashboard:
#    New Project → Deploy from GitHub Repo → pick the repo
#    Railway reads railway.json → builds the Dockerfile → boots the container
#    Settings → Networking → Generate Domain
#       → https://prd-builder-mcp-production.up.railway.app

# 4. Smoke test (replace the domain):
curl https://prd-builder-mcp-production.up.railway.app/healthz
#  → {"ok":true,"ts":178...}

curl https://prd-builder-mcp-production.up.railway.app/
#  → small landing page showing /mcp connection URL

# 5. Plug into Claude.ai:
#    Settings → Connectors → Add custom connector
#    URL: https://prd-builder-mcp-production.up.railway.app/mcp
#    → click Open PRD Builder in a chat to test
```

That's the whole MVP. Everything else here is for going further — persistence,
multi-environment promotion, auth, observability, scaling.

---

## Step-by-step: first deploy

### 1. Push to GitHub

Railway builds from a GitHub repo (or any Docker context, but a repo is the
simplest source of truth). If you don't want a public repo, a private GitHub
repo works identically — Railway is granted access via its OAuth install.

```bash
cd /mnt/nas/ben/Documents/full-sync/claude/projects/prd-builder-mcp
git init
git add -A
git commit -m "initial: PRD Builder MCP + Railway scaffold"
# (optional) gh repo create benhedrington/prd-builder-mcp --source=. --push
git remote add origin git@github.com:benhedrington/prd-builder-mcp.git
git push -u origin main
```

> **Why:** Railway rebuilds on every push to the configured branch. Git is the
> pipeline.

### 2. Create the Railway service

1. Railway dashboard → **New Project** → **Deploy from GitHub repo**.
2. Pick your `prd-builder-mcp` repo.
3. Railway reads `railway.json`, sees the Dockerfile builder, and starts the
   build. The multi-stage Dockerfile compiles the UI and the TypeScript server
   in the `build` stage, then copies only the runtime artifacts into a slim
   `node:20-slim` image.
4. Wait for **Deploy Logs** to say "Live" — usually ~60–90 seconds on first
   build (subsequent builds use Docker layer cache and are ~20s).

> **Why a Dockerfile and not Railway's Nixpacks auto-detect?** Nixpacks can
> auto-build Node apps, but workspaces + Vite + a server-only runtime need
> explicit ordering. The Dockerfile gives you reproducible builds and lets you
> serve the UI bundle from the same container as the server — which is exactly
> what the MCP App's UI resource scheme wants.

### 3. Generate a public domain

Railway assigns an internal URL but doesn't expose a public hostname until you
generate one. In the service → **Settings** → **Networking** →
**Generate Domain**. You'll get something like:

```
https://prd-builder-mcp-production.up.railway.app
```

The HTTP entry uses `$RAILWAY_PUBLIC_DOMAIN` to render the landing page and
log the connect URL, so it'll show you the right thing automatically.

> **Why:** MCP clients need a stable HTTPS URL. Railway's domain gives you TLS
> termination for free — no Caddy/Nginx in front.

### 4. Verify health

```bash
export APP=https://prd-builder-mcp-production.up.railway.app   # change me
curl $APP/healthz        # → {"ok":true,"ts":...}
curl $APP/prd-builder-ui/assets/main.js | head -c 200          # first bytes of the React bundle
curl $APP/               # landing page
```

The MCP endpoint itself is `$APP/mcp`. Don't `curl` that directly with GET —
clients initialize with a POST carrying an `initialize` JSON-RPC request. For a
quick interactive smoke test use the `mcp` CLI or the inspector:

```bash
npx @modelcontextprotocol/inspector \
    --transport http \
    --url $APP/mcp
```

> **Why three checks:** `/healthz` proves the container boots, the static check
> proves the UI bundle is baked into the image (the iframe won't render
> otherwise), the landing page proves the public hostname resolves.

### 5. Connect to Claude.ai

**Claude.ai → Settings → Connectors → Add custom connector**

- Name: `PRD Builder`
- URL: `https://prd-builder-mcp-production.up.railway.app/mcp`

Open a new chat and ask Claude "open a PRD builder for a new feature". You
should see the `open_prd_builder` tool fire and the React UI render inline.

To test the same in **ChatGPT**: Settings → Connected apps → Add new MCP
server, same URL. **Goose**: add to your `~/.config/goose/config.yaml` `mcp:
prd-builder` block with `transport: streamable_http` and `url`.

---

## Environment variables

You don't strictly need any of these on first deploy — `railway.json` already
sets `TRANSPORT=http`, `NODE_ENV=production`, and the Dockerfile sets default
`PORT=3000` and `PRD_STORE_DIR=/data/prds`. But you'll add these as you grow.

| Variable | Default | When to set |
|----------|---------|-------------|
| `PORT` | `3000` | Railway injects automatically — don't override |
| `TRANSPORT` | `http` (Dockerfile) / `stdio` (unset) | Stick with `http` for Railway; set `stdio` to repurpose image for Claude Desktop |
| `NODE_ENV` | `production` | already correct |
| `RAILWAY_PUBLIC_DOMAIN` | auto by Railway | Don't set manually — Railway provides it; the server uses it only to render the landing page |
| `PRD_STORE_DIR` | `/data/prds` | Where PRD JSON files are stored. Mount a **Volume** at `/data` for durability across redeploys — see [persistence](#step-6-persistence) |
| `MCP_AUTH_TOKEN` | _(unset)_ | Bearer token for `/mcp` endpoint. **Now built into `http.ts`** — set this in Railway Variables to enable auth. See [auth](#auth) |
| `LOG_LEVEL` | _(unset)_ | `debug` for verbose handler logs while iterating |

Set them in Railway → service → **Variables**. They're stored encrypted and
injected at container boot.

---

## Step 6: Persistence (so PRDs survive redeploys)

PRDs are now stored as JSON files on disk via `FilePRDStore` (in
`store.ts`). The store writes through to `$PRD_STORE_DIR` on every save and
loads all existing PRDs on startup. To make this durable across Railway
redeploys, mount a volume:

### Quick: Railway Volume

1. Service -> **Settings** -> **Volumes** -> **Add Volume**.
2. Mount path: `/data`  (matches `PRD_STORE_DIR=/data/prds`).
3. That's it -- the container writes JSON files to `/data/prds/<id>.json`;
   Railway keeps them across redeploys. No code changes needed.

### Better: Railway Postgres

1. New → **Database** → **PostgreSQL** → railway provisions it and exposes
   `DATABASE_URL` to your service.
2. `npm i pg` in `packages/mcp-server`, implement `PostgresPRDStore` per
   `DEPLOYMENT.md` Phase 5 Option C, swap the store, redeploy. Same container,
   different env var.

> **Why:** Volume is enough for a single instance + small team. Postgres lets
> you scale to multiple containers and survive container-level failures — do it
> once you have more than one PM team using the tool.

---

## Promotion: dev → stage → prod

Each Railway **Environment** is a parallel deploy of the same service with its
own URL, variables, and (optionally) its own branch trigger.

| Environment | Branch | URL | Variables |
|-------------|--------|-----|-----------|
| `dev` | `main` | `prd-builder-mcp-dev.up.railway.app` | `LOG_LEVEL=debug`, ephemeral volume |
| `stage` | `release/*` tag | `prd-builder-mcp-stage.up.railway.app` | mirrored from prod, scrubbed real data |
| `prod` | `release/*` tag | `prd-builder-mcp-production.up.railway.app` | minimal — `NODE_ENV=production` |

Configure branch triggers in service → **Settings** → **Environment** →
**Deploy branch automatically**. `dev` follows `main`; `stage` and `prod` deploy
on git tags so you don't accidentally ship.

> **Why per-environment URLs:** Claude.ai Connectors URLs are global, so you
> can register a separate connector pointing at `stage` and a separate one
> for `prod` — PMs test in stage without touching the production connector.

---

## Auth <a name="auth"></a>

The server now has **bearer-token auth built into `http.ts`**. It's disabled
by default (no `MCP_AUTH_TOKEN` set = open endpoint). For shared/team use:

1. Generate a random token: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
2. In Railway **Variables**, set `MCP_AUTH_TOKEN=*** -- the server logs `[http] Auth enabled` on boot.
4. Pass the same token to Claude.ai's connector config as the
   `Authorization: Bearer *** header. The middleware also accepts `?token=<token>`
   as a query parameter for SSE/GET connections that can't set headers.

The auth check uses timing-safe comparison and only gates `/mcp` routes --
`/healthz`, `/prd-builder-ui/*`, and the landing page remain open.

> **Why this and not OAuth:** OAuth requires a callback URL, a token endpoint,
> user login dances -- overkill for an internal team tool. A shared bearer
> token is enough until you have actual user identity needs; then add OAuth
> via WorkOS/Auth0 and keep the bearer path for service-to-service.

---

## Observability

Railway shows you container logs in real time by default — that's all you need
at first. Add structured logging to the handlers when you want searchability:

- `npm i pino` and replace `console.error` calls in `http.ts` with a pino
  logger — JSON logs grep well in the Railway log view.
- The MCP SDK emits transport errors to stderr; the try/catch blocks in
  `http.ts` already log them with `[http]` prefixes.
- For metrics, Railway → **Metrics** shows CPU/memory per service. Add a
  `/metrics` endpoint (Prometheus format) only if you wire up something like
  Grafana Cloud — don't bother for an MVP.

---

## Common gotchas

**Tool call returns `Unknown tool`** — The deployed image built from an old
commit. Check Railway → Deploy Logs for the git SHA; the SHA in Claude.ai's
Connectors page refresh is independent — rebuilding the connector is unnecessary.

**Claude.ai Connector says "Couldn't reach server"** — almost always one of:
- public domain wasn't generated (step 3)
- `/mcp` route reachable but the server can't find the UI bundle — check the
  runtime logs for the "Could not locate built UI bundle" message (means the
  Dockerfile's `COPY --from=build /app/ui-dist` step failed silently)
- TLS isn't terminating (it always does on Railway domains — only relevant if
  you're using a custom domain)

**iframe shows a blank white box** — the React bundle loaded but
`ui-resources.ts` is returning the dev-mode HTML (which loads from
localhost:5173). Make sure `NODE_ENV=production` is set in Railway Variables
(it is, by `railway.json`'s `environments.production` block).

**UI reverts to ⬜ between sessions** — in-memory PRD store was reset on a
redeploy. Implement persistence (see [Persistence](#step-6-persistence)).

**Cold start times out Claude.ai** — not a thing on Railway's Hobby+ paid tier
with always-on services. If you are on the trial/usage plan where services can
sleep, upgrade the service to "Always On" (Settings → Advanced) — cheap.

---

## Moving off Railway later

If you outgrow Railway:

- **Fly.io** for multi-region + cheaper compute at scale + full Docker control.
  Replace `railway.json` with a `fly.toml` and `fly deploy`. The Dockerfile is
  untouched.
- **Render** for built-in Postgres/Redis add-ons and a managed feel. Push to
  render.com → New → Web Service → pick the repo → Renderer reads the
  Dockerfile directly; no `render.yaml` needed.
- **Self-hosted / LAN** if you want it on your Unraid box: same Docker image
  pushes to a registry (or just build locally), `docker run -p 3000:3000 -e
  TRANSPORT=http -e PRD_STORE_DIR=/data/prds prd-builder-mcp`. You'd handle TLS
  yourself with Caddy or a Cloudflare Tunnel exposing the LAN service.

The Streamable HTTP endpoint at `/mcp` and the UI bundle at
`/prd-builder-ui/*` work identically on all of them — the scaffold is portable.

---

## TL;DR command sequence

```bash
cd /mnt/nas/ben/Documents/full-sync/claude/projects/prd-builder-mcp
git init && git add -A && git commit -m "scaffold Railway deploy"
gh repo create benhedrington/prd-builder-mcp --source=. --push
# Railway dashboard: New Project → from GitHub → wait for build →
# Settings → Networking → Generate Domain →
export APP=https://prd-builder-mcp-production.up.railway.app
curl $APP/healthz
npx @modelcontextprotocol/inspector --transport http --url $APP/mcp
# Claude.ai → Settings → Connectors → Add custom connector → URL: $APP/mcp
```