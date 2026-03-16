# =============================================================================
# Stage 1 — builder
# Install dependencies and run `tsc && vite build` to produce frontend/dist/.
# VITE_* vars are build-time ARGs — Vite inlines them into the JS bundle.
# =============================================================================
FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

# ── Dependency installation ──────────────────────────────────────────────────
# Copy manifests first so Docker layer-caches the install step independently
# of source changes.
COPY package.json bun.lock ./
COPY frontend/package.json ./frontend/

# --frozen-lockfile  : fail if bun.lock is out of date (CI safety)
# --filter frontend  : only install the frontend workspace
# devDependencies ARE needed here (tsc, vite, @vitejs/plugin-react, etc.)
RUN bun install --frozen-lockfile --filter frontend

# ── Source copy ──────────────────────────────────────────────────────────────
COPY frontend/ ./frontend/

# ── Build-time env vars (Firebase public keys + API base URLs) ──────────────
# These are intentionally baked into the Vite bundle — Firebase client-side
# keys are designed to be public. VITE_API_BASE and VITE_WS_BASE are left
# empty by default so the frontend uses relative URLs (Caddy proxies to backend).
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_STORAGE_BUCKET=""
ARG VITE_FIREBASE_MESSAGING_SENDER_ID=""
ARG VITE_FIREBASE_APP_ID=""
ARG VITE_API_BASE=""
ARG VITE_WS_BASE=""

ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID \
    VITE_API_BASE=$VITE_API_BASE \
    VITE_WS_BASE=$VITE_WS_BASE

# ── Build ────────────────────────────────────────────────────────────────────
# `bun run build` runs `tsc && vite build` → output in frontend/dist/
WORKDIR /app/frontend
RUN bun run build

# =============================================================================
# Stage 2 — runner
# Serve the static bundle with Caddy. Caddy also acts as reverse proxy to the
# backend container, handling REST, SSE, and WebSocket upgrade.
# Caddy runs as non-root by default — no USER instruction needed.
# =============================================================================
FROM caddy:2-alpine AS runner

# Copy the compiled static assets
COPY --from=builder /app/frontend/dist /srv

# Inject the Caddyfile from the repo root
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 80

# Caddy's default CMD is: caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
# No override needed.
