# Dockerfile for the PRD Builder MCP App
# Multi-stage: build UI + server, then run on a slim Node image.
# The single runtime image serves the MCP protocol (Streamable HTTP) on /mcp
# and the built React UI bundle at /prd-builder-ui — matching the HTML
# served by ui-resources.ts.

# ──────────────────────────────────────────────
# Stage 1: build
# ──────────────────────────────────────────────
FROM node:20-slim AS build

WORKDIR /app

# Copy workspace manifests first for layer caching.
# NOTE: npm workspaces require all package.json files to exist before `npm ci`,
# so we copy them all up front.
COPY package.json package-lock.json* ./
COPY tsconfig.json ./
COPY vite.config.ts ./
COPY packages/shared/package.json      packages/shared/
COPY packages/prd-engine/package.json  packages/prd-engine/
COPY packages/mcp-server/package.json   packages/mcp-server/
COPY packages/ui/package.json           packages/ui/

# Install all workspace deps (devDeps included — needed for the build).
RUN npm ci --no-audit --no-fund

# Copy source.
COPY packages/ ./packages/

# Build ordered by dependency: shared → engine → ui → mcp-server.
# The root `npm run build` runs `npm run build --workspaces`, which executes in
# the order listed in `workspaces` (shared, engine, mcp-server, ui). To be safe
# and explicit we build the leaf deps first.
RUN npm run build --workspace @prd-builder/shared \
 && npm run build --workspace @prd-builder/engine \
 && npm run build --workspace @prd-builder/ui \
 && npm run build --workspace @prd-builder/mcp-server

# Stage the built UI bundle where the HTTP server's static route expects it.
# ui-resources.ts references /prd-builder-ui/assets/main.js and .../main.css,
# so we copy packages/ui/dist → ui-dist/ (a flat, portable location baked into
# the runtime image).
RUN mkdir -p ui-dist && cp -r packages/ui/dist/. ./ui-dist/

# ──────────────────────────────────────────────
# Stage 2: runtime
# ──────────────────────────────────────────────
FROM node:20-slim AS runtime

ENV NODE_ENV=production
# HTTP transport for remote (Railway) deploys. Bridge code flips to stdio when
# TRANSPORT=stdio, so the same image also works for local Claude Desktop if you
# ever want to run it that way.
ENV TRANSPORT=http
ENV PORT=3000
# Where file-backed PRD persistence lives (see DEPLOYMENT.md Phase 5 Option A).
# Mount a Railway volume here for durability across redeploys.
ENV PRD_STORE_DIR=/data/prds
# MCP_AUTH_TOKEN is set via Railway Variables (not in Dockerfile for security).
# If unset at runtime, auth is disabled (open endpoint — fine for dev, not prod).

WORKDIR /app

# Production deps only.
COPY package.json package-lock.json* ./
COPY packages/shared/package.json     packages/shared/
COPY packages/prd-engine/package.json packages/prd-engine/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/ui/package.json         packages/ui/
RUN npm ci --omit=dev --no-audit --no-fund

# Copy compiled server + workspace source maps/types the deps expect.
COPY --from=build /app/packages/mcp-server/dist  packages/mcp-server/dist
COPY --from=build /app/packages/shared/dist      packages/shared/dist
COPY --from=build /app/packages/prd-engine/dist  packages/prd-engine/dist
# The React UI bundle — served statically by the HTTP entry.
COPY --from=build /app/ui-dist                    ui-dist

# Persistence directory — mount a Railway Volume at /data via the Railway UI.
# (Railway doesn't support the Docker VOLUME instruction; use Settings > Volumes)
RUN mkdir -p /data/prds

# Railway injects PORT; the HTTP entry listens on $PORT.
EXPOSE 3000

# Healthcheck hits /healthz — Railway uses this for zero-downtime deploys.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start the unified entry; TRANSPORT=http routes to the HTTP path,
# TRANSPORT=stdio (or unset) keeps the local-stdio behaviour for Claude Desktop.
CMD ["node", "packages/mcp-server/dist/index.js"]