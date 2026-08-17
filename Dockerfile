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
FROM node:22-slim AS web

WORKDIR /build
COPY app/web/package.json app/web/package-lock.json ./
RUN npm ci
COPY app/web/ ./
RUN npm run build

# ── runtime ────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Production dependencies only: @composio/core for the agent's tools, and the
# gitagent runtime the server calls query() on.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The agent IS the repo — these are the files the GAP runtime reads, and they
# are copied wholesale rather than cherry-picked so that adding a skill does
# not silently fail to deploy.
COPY agent.yaml SOUL.md RULES.md ./
COPY skills/ ./skills/
COPY tools/ ./tools/
COPY hooks/ ./hooks/
COPY memory/ ./memory/

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
