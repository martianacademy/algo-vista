# Multi-stage build for algo-vista project
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY bots/package*.json ./bots/

# Install dependencies
RUN npm ci
RUN cd bots && npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/bots/node_modules ./bots/node_modules
COPY . .

# Build Next.js app
ENV NEXT_TELEMETRY_DISABLED 1
RUN npm run build

# Production image, copy all files and run
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built Next.js app
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy bots and their dependencies
COPY --from=builder /app/bots ./bots
COPY --from=deps /app/bots/node_modules ./bots/node_modules

# Copy environment template (users should mount their own .env)
COPY --from=builder /app/.env* ./

RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

# Default command runs Next.js app
# To run bots, override with: docker run <image> node bots/crypto/cex/auto-trading/auto-trading-futures-binance.js
CMD ["node", "server.js"]
