# ─── Overwatch Production Dockerfile ──────────────────────────────────────────
# Multi-stage build: install deps + build → lean production image

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Install OpenSSL (required by Prisma)
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy workspace package files first for layer caching
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/

RUN npm ci

# Copy all source
COPY . .

# Railway passes service variables as Docker build args.
# Declare it so prisma.config.ts can resolve env('DATABASE_URL').
ARG DATABASE_URL
ENV DATABASE_URL=$DATABASE_URL

# Build order: shared types → client bundle → prisma client → server tsc
RUN npm -w shared run build && \
    npm -w client run build && \
    npx prisma generate --config=server/prisma.config.ts && \
    npm -w server run build

# ── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:22-slim AS production

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy package files and install production deps only
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/

RUN npm ci --omit=dev

# Copy built artifacts from builder
COPY --from=builder /app/shared/dist shared/dist
COPY --from=builder /app/shared/package.json shared/package.json
COPY --from=builder /app/server/dist server/dist
COPY --from=builder /app/server/prisma server/prisma
COPY --from=builder /app/server/prisma.config.ts server/prisma.config.ts
COPY --from=builder /app/client/dist client/dist
# Prisma 7 generates client into @prisma/client (not .prisma)
COPY --from=builder /app/node_modules/@prisma/client node_modules/@prisma/client

ENV NODE_ENV=production

# Run migrations then start the server
CMD npx prisma migrate deploy --config=server/prisma.config.ts && node server/dist/index.js
