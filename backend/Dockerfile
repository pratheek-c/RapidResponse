# =============================================================================
# Stage 1 — builder
# Install production dependencies and bundle TypeScript → JS with Bun.
# Using a pinned minor version for reproducible builds.
# =============================================================================
FROM oven/bun:1.2-alpine AS builder

WORKDIR /app

# ── Dependency installation ──────────────────────────────────────────────────
# Copy manifests first so Docker layer-caches the install step independently
# of source changes.
COPY package.json bun.lock ./
COPY backend/package.json ./backend/

# --frozen-lockfile  : fail if bun.lock is out of date (CI safety)
# --filter backend   : only install the backend workspace
# --production       : skip devDependencies (@types/bun not needed at runtime)
RUN bun install --frozen-lockfile --filter backend --production

# ── Source copy ──────────────────────────────────────────────────────────────
COPY backend/src ./backend/src

# Protocol docs are read at runtime by the ingest script, not at build time.
# Copy them so the image is self-contained (optional — can be mounted instead).
COPY backend/protocols ./backend/protocols

# ── Bundle ───────────────────────────────────────────────────────────────────
# --outdir dist : output to backend/dist/
# --target bun  : emit Bun-compatible JS (keeps Bun built-ins like Bun.serve)
# --splitting   : code-split for smaller chunk loads
# Result: backend/dist/index.js  (+ any dynamic-import chunks)
RUN bun build ./backend/src/index.ts \
      --outdir ./backend/dist \
      --target bun \
      --splitting

# =============================================================================
# Stage 2 — runner
# Minimal runtime image: Bun Alpine + bundled JS + native addon node_modules.
# We keep node_modules because @lancedb/lancedb ships a native .node addon
# that cannot be bundled into a single file.
# =============================================================================
FROM oven/bun:1.2-alpine AS runner

# Install only what is needed for native addons to dlopen correctly.
# ca-certificates : HTTPS calls to AWS / Firebase
# libstdc++       : required by LanceDB's native addon (C++ runtime)
RUN apk add --no-cache ca-certificates libstdc++ && \
    # Create a non-root user for the process
    addgroup -S app && adduser -S app -G app

WORKDIR /app

# ── Copy artefacts from builder ───────────────────────────────────────────────
# node_modules must come along because dist/index.js has external references
# to @lancedb/lancedb (native .node), apache-arrow, etc.
COPY --from=builder --chown=app:app /app/backend/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/backend/dist         ./dist
COPY --from=builder --chown=app:app /app/backend/protocols    ./protocols

# ── Persistent data directory ─────────────────────────────────────────────────
# libSQL (file:///data/rapidresponse.db) and LanceDB (LANCEDB_PATH=/data/lancedb)
# both write here. Mount a named volume at /data in production so data survives
# container replacement.
RUN mkdir -p /data/lancedb && chown -R app:app /data

# ── Runtime defaults (all overridable at container start) ────────────────────
ENV PORT=3000 \
    LIBSQL_URL="file:///data/rapidresponse.db" \
    LANCEDB_PATH="/data/lancedb" \
    S3_RECORDINGS_PREFIX="recordings/" \
    DISPATCH_CITY="Springfield" \
    DISPATCH_DEPT="Springfield Emergency Services"

USER app

EXPOSE 3000

# Healthcheck — backend exposes GET /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

# Use bun directly (not via the package.json scripts) to avoid the
# `prestart` script that calls lsof, which is meaningless in a container.
CMD ["bun", "dist/index.js"]
