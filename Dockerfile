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

# --- Test stage ---
# CI can target this stage with `docker build --target test` after starting
# postgres + redis via docker-compose. Tests need live DB/Redis so they can't
# run during a normal build.
FROM base AS test
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npx prisma migrate deploy && npm test

# --- Production stage ---
FROM base AS production
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/prisma ./prisma
COPY src ./src

# Run as non-root user (node:24-alpine ships with UID 1000)
USER node

EXPOSE 3000

CMD ["node", "--import", "./src/instrument.js", "src/server.js"]
