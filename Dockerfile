FROM node:24-alpine AS base

# --- Build stage ---
FROM base AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run lint

# Note: there is deliberately no `test` stage. The test suite needs a live
# Postgres and Redis, which a `docker build` cannot provide, and CI runs it
# directly against service containers in .github/workflows/verify.yml. A
# build stage that duplicated that setup would only drift out of sync with
# the one that actually gates merges and deploys.

# --- Production stage ---
FROM base AS production
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
# --omit=optional matters as much as --omit=dev here. `prisma` (the CLI) is an
# *optional peer* of `@prisma/client`, so the lockfile marks it and its whole
# subtree `devOptional` and `--omit=dev` alone still installs it — dragging
# @prisma/config, @prisma/dev, deepmerge-ts, fast-uri, hono and valibot into
# the runtime image along with their advisories, none of which the running app
# ever loads. Omitting optional deps too removes all of it and halves
# node_modules (~455MB → ~224MB). The client keeps working because the
# generated client + engine are copied from the build stage below; only the
# CLI (needed for `migrate`/`generate`, which run elsewhere) goes away.
RUN npm ci --omit=dev --omit=optional

COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/prisma ./prisma
COPY src ./src

# Run as non-root user (node:24-alpine ships with UID 1000)
USER node

EXPOSE 3000

# L2: liveness probe for orchestrators that don't define their own (Docker
# Swarm, plain `docker run`, local compose). Kubernetes ignores this in favor
# of its own livenessProbe/readinessProbe config, so it's additive, not a
# replacement. Uses busybox's wget (ships with node:alpine) rather than curl,
# which isn't installed here.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "--import", "./src/instrument.js", "src/server.js"]
