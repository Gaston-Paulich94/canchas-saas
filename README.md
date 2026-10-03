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

## Mercado Pago (cobros)

Modelo **marketplace**: cada complejo conecta su propia cuenta por OAuth y la
plata cae ahí; la plataforma retiene `MP_MARKETPLACE_FEE_PERCENT`.

### Configuración fuera del código

1. Creá una aplicación en <https://www.mercadopago.com.ar/developers> (Checkout
   Pro, con modelo marketplace). De ahí salen `MP_CLIENT_ID` y `MP_CLIENT_SECRET`.
2. Cargá el **redirect URI** en el panel: `{APP_PUBLIC_URL}/api/mp/oauth/callback`.
3. Configurá el **webhook** apuntando a `{APP_PUBLIC_URL}/api/mp/webhooks/payment`
   y copiá la *clave secreta* que genera el panel a `MP_WEBHOOK_SECRET`.
4. Creá **cuentas de prueba** (un vendedor y un comprador): el flujo completo
   solo se puede probar entre cuentas de prueba.

`APP_PUBLIC_URL` tiene que ser alcanzable por Mercado Pago. En local usá un túnel
(`ngrok http 3000` o `cloudflared`) y cargá esa misma URL en el panel.

### Cómo se cobra

1. La cancha necesita `price_per_hour` cargado (define el importe).
2. En el detalle de la reserva, *Generar link de pago*: el backend calcula el
   importe (`precio/hora × duración`), crea la preferencia y devuelve el link.
3. Se le pasa el link al cliente. Cuando paga, Mercado Pago notifica al webhook
   y el estado del pago se actualiza solo.

### Garantías de seguridad del flujo

- El **importe** lo calcula siempre el backend; nunca llega del cliente.
- El **webhook** valida firma HMAC-SHA256 en tiempo constante, rechaza
  notificaciones fuera de ±5 min (replay) y **re-consulta el pago a la API de
  MP**: el cuerpo de la notificación nunca define el estado.
- Los **tokens OAuth** se guardan cifrados (AES-256-GCM) y solo se descifran en
  memoria al llamar a MP. Nunca se loguean ni se envían al cliente.
- El webhook llega sin sesión: resuelve su tenant con la función acotada
  `resolve_payment_tenant()` (rol `payment_resolver`, NOLOGIN, que solo puede
  leer esa columna) y sigue operando bajo RLS. No hay bypass.
- Solo el **owner** conecta/desconecta la cuenta que recibe la plata; el staff
  puede cobrar pero no cambiarla.

## Endurecimiento pendiente para prod

- **IP real para el rate-limit de login**: detrás de Caddy, fijar
  `header_up X-Real-IP {remote_host}`. Sin eso el límite por IP se puede
  falsear (el límite por cuenta sigue vigente). En Vercel ya viene fijado.
- Pinnear imágenes Docker por **digest** + escanear con Trivy.
- Caddy como reverse proxy con TLS; no exponer Postgres.
- `pnpm audit` / Snyk y `gitleaks` en CI.
- Cifrado de tokens MP ya implementado (`AES-256-GCM`, `MP_TOKEN_ENC_KEY`).

## Orden de construcción

Fase 1 (esta) → canchas → calendario → reservas → clientes → pagos (MP) →
WhatsApp → panel admin → reporting. Una feature a la vez, con su Definition of
Done (typecheck, lint, skill `seguridad`, tests críticos).
