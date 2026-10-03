# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Imagen de producción de la app Next.js (output: standalone).
# Multi-stage: deps → builder → runner. El runner corre como usuario no-root.
#
# Nota de seguridad (prod): pinnear las imágenes base por DIGEST (no por tag
# mutable) y escanear con Trivy antes de publicar. Acá usamos tag fijo para el
# MVP; ver README → "Endurecimiento pendiente para prod".
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# ── deps: instala dependencias con lockfile congelado ────────────────────────
FROM base AS deps
# pnpm-workspace.yaml también: ahí viven los `overrides` y el `auditConfig`.
# Sin ese archivo, `--frozen-lockfile` aborta por desajuste con el lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ── builder: compila Next en modo standalone ─────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Variables SOLO de build (placeholders) para que la validación de env.ts no
# falle durante `next build`. Los valores REALES se inyectan en runtime.
ENV NODE_ENV=production \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    APP_DATABASE_URL=postgres://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build_time_placeholder_secret_32_chars_min \
    BETTER_AUTH_URL=http://localhost:3000 \
    MP_TOKEN_ENC_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    MP_CLIENT_ID=build_time_placeholder \
    MP_CLIENT_SECRET=build_time_placeholder \
    MP_WEBHOOK_SECRET=build_time_placeholder \
    MP_MARKETPLACE_FEE_PERCENT=0 \
    APP_PUBLIC_URL=http://localhost:3000
RUN pnpm build

# ── migrator: corre `pnpm db:migrate` (tiene source + node_modules, sin build) ─
FROM base AS migrator
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["pnpm", "db:migrate"]

# ── runner: imagen final mínima ──────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Usuario no-root provisto por la imagen.
USER node
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
