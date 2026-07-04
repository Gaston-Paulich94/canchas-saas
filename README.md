# Canchas SaaS

SaaS multi-tenant de gestión para complejos deportivos (pádel, fútbol, tenis).
Mercado: Argentina. Reservas + panel de administración + reporting, con foco en
WhatsApp y Mercado Pago.

> Estado: **Fase 1** — scaffold + autenticación + base multi-tenant.

## Stack

- Next.js 16 (App Router) · TypeScript estricto · Tailwind 4 + shadcn/ui
- PostgreSQL + Drizzle ORM (migraciones versionadas)
- better-auth (en nuestro Postgres)
- pnpm · Docker (standalone) listo para VPS

## Arquitectura (monolito modular en capas)

Organización por **feature module** (vertical slice) en `src/modules/<feature>/`,
cada uno atravesando las capas:

- `presentación` → `src/app/**` (route handlers, Server Components, UI)
- `aplicación` → `modules/<f>/application/**` (use-cases, autorización)
- `dominio` → `modules/<f>/domain/**` (entidades, reglas, schemas Zod)
- `infraestructura` → `modules/<f>/infrastructure/**` (repos Drizzle, crypto, etc.)

El núcleo (aplicación + dominio) no conoce Next.js, Drizzle ni Mercado Pago.

## Seguridad multi-tenant: dos capas INDEPENDIENTES

1. **Filtro de aplicación**: cada query del repository filtra por `tenant_id`
   (`where eq(table.tenantId, ctx.tenantId)`).
2. **RLS de Postgres**: políticas `FORCE ROW LEVEL SECURITY` que filtran por
   `current_setting('app.tenant_id')`. La app las activa con `withTenant()`
   (abre transacción + `set_config('app.tenant_id', …, true)`).

Si una capa se misconfigura, la otra sostiene. El `tenant_id` y el rol se
derivan SIEMPRE de la sesión en el servidor, nunca de input del cliente.

### Dos roles de base de datos (RLS real)

| Variable | Rol | Uso |
|----------|-----|-----|
| `DATABASE_URL` | admin/owner | **solo migraciones** (DDL, crear roles, RLS) |
| `APP_DATABASE_URL` | `app_user` (no-owner, **NOBYPASSRLS**) | **runtime de la app** |

Como la app corre con `app_user` (sin privilegios de owner ni BYPASSRLS), RLS se
aplica de verdad. Además `FORCE ROW LEVEL SECURITY` somete incluso al owner.
`pnpm db:migrate` crea/actualiza `app_user` tomando usuario y contraseña de
`APP_DATABASE_URL`.

> El cliente `postgres.js` usa `prepare: false` (compatible con poolers en
> transaction mode).

## Puesta en marcha (local)

Requisitos: Node ≥ 22, pnpm, Docker (para la DB y/o los tests).

```bash
# 1. Dependencias
pnpm install

# 2. Variables de entorno
cp .env.example .env
#   Generá los secretos:
node -e "console.log('BETTER_AUTH_SECRET=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('MP_TOKEN_ENC_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
#   Pegalos en .env.

# 3. Base de datos local (Postgres en Docker)
docker compose up -d db

# 4. Migraciones (crea rol app_user + tablas + RLS)
pnpm db:migrate

# 5. App
pnpm dev          # http://localhost:3000
```

Flujo: `/register` (crea complejo + owner) → `/dashboard` (muestra el complejo).

## Comandos

| Comando | Qué hace |
|---------|----------|
| `pnpm dev` | entorno local |
| `pnpm build` / `pnpm start` | build standalone / servir |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | genera migración Drizzle desde el schema |
| `pnpm db:migrate` | aplica migraciones (rol admin) + crea `app_user` |
| `pnpm test` | tests (Vitest + testcontainers) |

> Los tests de integración levantan Postgres con **testcontainers**: necesitás
> Docker corriendo.

## Docker / Compose

```bash
docker compose up --build      # db → migrate (one-shot) → app
```

- `db`: Postgres con healthcheck.
- `migrate`: corre `pnpm db:migrate` una vez (rol app_user + tablas + RLS).
- `app`: Next.js standalone, corre como usuario no-root con `app_user`.

En el MVP deployamos en **Vercel**; este compose deja el camino listo para el
VPS con Caddy.

## Endurecimiento pendiente para prod

- Pinnear imágenes Docker por **digest** + escanear con Trivy.
- Caddy como reverse proxy con TLS; no exponer Postgres.
- `pnpm audit` / Snyk y `gitleaks` en CI.
- Cifrado de tokens MP ya implementado (`AES-256-GCM`, `MP_TOKEN_ENC_KEY`).

## Orden de construcción

Fase 1 (esta) → canchas → calendario → reservas → clientes → pagos (MP) →
WhatsApp → panel admin → reporting. Una feature a la vez, con su Definition of
Done (typecheck, lint, skill `seguridad`, tests críticos).
