# Canchas SaaS

[![CI](https://github.com/Gaston-Paulich94/canchas-saas/actions/workflows/ci.yml/badge.svg)](https://github.com/Gaston-Paulich94/canchas-saas/actions/workflows/ci.yml)

SaaS multi-tenant de gestión para complejos deportivos (pádel, fútbol, tenis).
Mercado: Argentina. Reservas + panel de administración + reporting, con foco en
WhatsApp y Mercado Pago.

> Estado: **MVP casi completo** — 8 de las 9 fases. Queda pendiente
> notificaciones por WhatsApp (fase 7, pospuesta) y probar los cobros contra
> Mercado Pago: el código está hecho y testeado, pero nunca corrió contra MP.

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

### Autenticación y anti fuerza bruta

- better-auth en nuestro Postgres. Contraseña de 12 caracteres como mínimo.
- Login y registro van **solo** por Server Action: `/sign-in/email` y
  `/sign-up/email` están deshabilitados por HTTP. Motivo: el rate-limit de
  better-auth corre en su router HTTP y no cubre las llamadas `auth.api.*`
  desde el servidor, así que dejar los dos caminos abiertos significaba un
  login sin freno. De paso, por ese endpoint se podían crear usuarios sin
  complejo, salteando el alta normal.
- Rate-limit propio con contador en Postgres (sirve con varias instancias):
  10 intentos por cuenta cada 15 min, 20 por IP cada 10 min, y 5 registros por
  IP por hora. Las claves se guardan en HMAC: la tabla no tiene emails ni IPs
  en claro. Si el contador falla, el intento se rechaza.
- Un usuario pertenece a un único complejo (`UNIQUE(user_id)` en `profiles`) y
  la policy RLS de bootstrap es de **solo lectura**, para que la capa de base
  de datos no permita insertarse en un complejo ajeno ni cambiarse el rol.

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

# 5. (Opcional) Datos de demo para recorrer la app
pnpm db:seed      # `--reset` la regenera

# 6. App
pnpm dev          # http://localhost:3000
```

Flujo: `/register` crea el complejo y su dueño → `/dashboard`.

El seed arma "Complejo Demo" (3 canchas con horarios, clientes y reservas del
mes) más un "Complejo Vecino" para comprobar el aislamiento. Usuarios:
`dueno@demo.test`, `staff@demo.test` y `vecino@demo.test`, contraseña
`Demo-Canchas-2026`. Solo corre contra una base local.

## Comandos

| Comando | Qué hace |
|---------|----------|
| `pnpm dev` | entorno local |
| `pnpm build` / `pnpm start` | build standalone / servir |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | genera migración Drizzle desde el schema |
| `pnpm db:migrate` | aplica migraciones (rol admin) + crea `app_user` |
| `pnpm db:seed` | datos de demo en local (`--reset` regenera) |
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

| # | Fase | Estado |
|---|------|--------|
| 1 | Scaffold + auth + base multi-tenant con RLS | ✅ |
| 2 | Gestión de canchas | ✅ |
| 3 | Disponibilidad semanal + generación de turnos | ✅ |
| 4 | Reservas, con doble booking bloqueado en la DB | ✅ |
| 5 | Gestión de clientes | ✅ |
| 6 | Cobros con Mercado Pago | ✅ código · falta probar contra MP |
| 7 | Notificaciones por WhatsApp | ⏸ pospuesta |
| 8 | Panel del dueño | ✅ |
| 9 | Reporting | ✅ |

Una feature a la vez, con su Definition of Done: `pnpm typecheck`, `pnpm lint`,
tests en los caminos críticos y el checklist del skill `seguridad`.
