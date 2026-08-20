# Badger, as one container: the agent, the server, and the built UI.
#
# Two stages so the shipped image carries no frontend toolchain — Vite, its
# 250-odd dev dependencies and the TypeScript compiler exist only long enough
# to produce app/web/dist.
#
# Configuration arrives as real environment variables, never a baked-in .env.
# tools/scripts/_env.mjs loads a file when one exists and shrugs when it does
# not, which is exactly the container case.

# ── build the frontend ─────────────────────────────────────────────────────
FROM node:24-slim AS web

WORKDIR /build
COPY app/web/package.json app/web/package-lock.json ./
RUN npm ci
COPY app/web/ ./
RUN npm run build

# ── runtime ────────────────────────────────────────────────────────────────
FROM node:24-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Production dependencies only: @composio/core for the agent's tools, the
# gitagent runtime the server calls query() on, and pg.
#
# Then strip what none of them runs. Three declared dependencies pull a large
# tree — @opentelemetry at 84MB, pi-ai at 45MB, and a client SDK for every
# model provider the runtime supports even though Badger only ever calls
# Vertex — and 102MB of the 164MB is files that exist for a compiler or a
# reader rather than for Node: source maps, .d.ts declarations, TypeScript
# sources, and package documentation. Measured, not estimated. It leaves 61MB.
#
# Two deliberate exclusions. LICENSE.md, COPYING.md and NOTICE.md are kept:
# thirteen packages ship their licence as markdown, and stripping licence text
# out of an image you distribute is not a size optimisation. And .mts/.cts are
# left alone, since Node does load those.
#
# The cost is honest and small: `--enable-source-maps` below still applies to
# our own code, which is plain .mjs with no maps either way, but a stack frame
# inside a dependency is now less precise. Worth 102MB.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
 && find node_modules -type d \
      \( -name test -o -name tests -o -name __tests__ -o -name docs -o -name examples \) \
      -prune -exec rm -rf {} + \
 && find node_modules -type f \
      \( -name '*.map' -o -name '*.d.ts' -o -name '*.ts' -o -name '*.md' \) \
      ! -iname 'license*' ! -iname 'copying*' ! -iname 'notice*' -delete

# The agent IS the repo — these are the files the GAP runtime reads, and they
# are copied wholesale rather than cherry-picked so that adding a skill does
# not silently fail to deploy.
# AGENTS.md is here because the runtime reads it into the system prompt
# (dist/loader.js:172). Leaving it out made production run on a different
# prompt from every local test — the one divergence nobody would think to
# look for.
COPY agent.yaml SOUL.md RULES.md AGENTS.md ./
COPY skills/ ./skills/
COPY tools/ ./tools/
COPY hooks/ ./hooks/
COPY memory/ ./memory/

# The index builder, and only it. `ensureIndexBuild` spawns this file by path
# when the index is missing or stale, so an image without it can never rebuild
# — the spawn fails, the cooldown starts, and search silently stays live for
# the life of the container. It imports nothing outside tools/, so one file is
# the whole dependency; the rest of scripts/ is seeding and evaluation, which
# has no business in a production image.
COPY scripts/index-build.mjs ./scripts/

# The schema, and the thing that applies it. The server runs outstanding
# migrations at boot (see server.mjs) rather than leaving them to a step
# somebody has to remember between `gcloud run deploy` and the first request.
COPY scripts/db-migrate.mjs ./scripts/
COPY migrations/ ./migrations/

# The product that consumes it.
COPY app/server/ ./app/server/
COPY --from=web /build/dist ./app/web/dist

# Never run as root. The app writes nothing outside its own tree.
RUN chown -R node:node /app
USER node

# Cloud Run injects PORT and the server prefers it; this is the fallback and
# what `docker run -p 8080:8080` will use. The server handles SIGTERM itself,
# so in-flight answers finish streaming when an instance is recycled.
ENV BADGER_PORT=8080
EXPOSE 8080

CMD ["node", "--enable-source-maps", "app/server/server.mjs"]
