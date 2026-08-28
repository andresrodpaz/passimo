# syntax=docker/dockerfile:1
#
# Passimo production image.
#
# Multi-stage so the runtime layer carries the built application, the traced
# server dependencies, and nothing else — no pnpm store, no dev dependencies, no
# source. Built for Railway; identical locally via
# `docker compose --profile app up --build`.

# -----------------------------------------------------------------------------
# Dependencies
# -----------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# The lockfile is authoritative: a deploy that quietly resolves a different tree
# than CI tested is the class of difference nobody finds until production.
RUN corepack pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Build
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# `output: 'standalone'` in next.config.mjs emits .next/standalone with only the
# server dependencies the build actually traced.
RUN corepack pnpm build

# -----------------------------------------------------------------------------
# Runtime
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Unprivileged. A loyalty platform holding customer data has no business running
# its web tier as root.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# The migration runner and the migrations themselves.
#
# They ship in the image rather than running as a separate Railway job so that
# "deploy" and "schema is current" cannot come apart: the start command applies
# pending migrations and only then boots the server, and an advisory lock in the
# runner makes two replicas starting together safe (see scripts/migrate.ts).
#
# `pg` resolves from the traced node_modules the standalone output already
# carries, because lib/db/pool.ts imports it.
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate.ts ./scripts/migrate.ts
COPY --from=builder --chown=nextjs:nodejs /app/db/migrations ./db/migrations

# Writable upload directory for STORAGE_DRIVER=local. Mount a volume here in
# production, or set STORAGE_DRIVER=s3 — an unmounted container filesystem loses
# every uploaded logo on the next deploy. See docs/INFRASTRUCTURE.md.
RUN mkdir -p /app/.uploads && chown nextjs:nodejs /app/.uploads
VOLUME ["/app/.uploads"]

USER nextjs
EXPOSE 3000

# Same check Railway's healthcheckPath uses, so `docker run` locally reports the
# same readiness the platform will.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations first, then the server. `node server.js` is the standalone entry
# point; it receives SIGTERM directly (no shell wrapper swallowing it), which is
# what lets lib/db/pool.ts drain the connection pool on a rolling deploy.
CMD ["sh", "-c", "node --experimental-strip-types scripts/migrate.ts && exec node server.js"]
