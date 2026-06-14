# CLAUDE.md — Canchas SaaS (Promethix)

> Lo lee Claude Code en cada sesión. Es la memoria permanente del proyecto:
> stack, arquitectura, convenciones y reglas de seguridad. Los playbooks de
> tareas puntuales viven en `.claude/skills/`.

## Qué estamos construyendo

SaaS multi-tenant de gestión para complejos deportivos (canchas de pádel,
fútbol 5/11, tenis). Cada complejo es un **tenant** aislado. Mercado: Argentina.
Diferenciador: reservas y notificaciones nativas por WhatsApp + UI en es-AR +
cobros en pesos con Mercado Pago. Producto = reservas + panel de administración
completo + reporting.

## Stack (cerrado)

- **Next.js 16** (App Router) + **TypeScript** estricto
- **Tailwind CSS** + **shadcn/ui**
- **PostgreSQL** (gestionado en MVP → self-hosted en Docker en prod)
- **Drizzle ORM** (DB-agnóstico, queries tipadas, migraciones versionadas)
- **better-auth** (vive en nuestro Postgres; sin lock-in de proveedor)
- **Mercado Pago** para pagos, modelo marketplace/OAuth (la plata cae en la
  cuenta de cada complejo)
- **Evolution API** como gateway de WhatsApp (modo Baileys en MVP → Cloud API
  oficial en prod) + **n8n** como orquestador del bot
- **Vercel** (MVP) → **VPS Hostinger con Docker Compose** (prod), reverse proxy
  **Caddy**
- Gestor de paquetes: **pnpm**

## Arquitectura: monolito modular en capas

Un solo deployable, pero con fronteras internas limpias. Cuatro capas:

1. **Presentación** — route handlers, Server Components, UI shadcn. Valida todo
   input con Zod en el borde.
2. **Aplicación (use-cases / servicios)** — lógica de negocio y autorización por
   tenant. NO contiene SQL ni detalles de HTTP.
3. **Dominio** — entidades y reglas: reserva, cancha, tenant, cliente.
4. **Infraestructura (adapters)** — repos Drizzle, cliente Mercado Pago, gateway
   WhatsApp, verificación de webhooks.

Regla de oro: el núcleo (Aplicación + Dominio) no conoce Next.js, Drizzle ni
Mercado Pago. Esos son detalles de los adapters, intercambiables. Por eso migrar
de Supabase a Postgres dockerizado, o de Baileys a Cloud API, toca solo la
infraestructura.

Organización por **feature module** (vertical slice): cada módulo (auth, tenants,
canchas, reservas, pagos, reporting) atraviesa las capas y vive en su carpeta.

### Patrones que usamos (con criterio)

- **Repository**: el acceso a datos va detrás de interfaces; Drizzle es el detalle.
- **Service layer / use-cases**: la lógica sale de los route handlers.
- **Validación en el borde** con Zod en todo límite (forms, actions, API, webhooks).
- **Dependency inversion**: se inyecta el cliente de DB ya scopeado por tenant y
  los clientes externos.
- **Manejo tipado de errores**: nunca se filtran stack traces al cliente.

### Anti-sobre-ingeniería

Para el MVP NO hacemos DDD táctico completo, CQRS ni event sourcing. Usamos los
patrones de arriba (que dan beneficio real) y sumamos más estructura solo si una
feature concreta lo justifica.

## Multi-tenant

- Toda tabla de negocio lleva `tenant_id` (uuid, FK a `tenants`).
- Aislamiento en DOS capas: (1) un cliente de Drizzle scopeado por el `tenant_id`
  del usuario autenticado, que filtra TODA query; (2) RLS de Postgres como defensa
  en profundidad.
- El `tenant_id` NUNCA viene del cliente: se deriva de la sesión de better-auth.

## Seguridad (no negociable)

El código debe ser seguro ante todo tipo de vulnerabilidades conocidas, no solo
el OWASP Top 10. Antes de cerrar CUALQUIER feature, ejecutá el skill
`seguridad` (`.claude/skills/seguridad/SKILL.md`) y pasá su checklist.

Las dos áreas de mayor riesgo en esta app: (1) aislamiento de tenant — un complejo
jamás debe ver datos de otro; (2) verificación de firma del webhook de Mercado
Pago — única fuente de verdad de un pago, nunca confiar en el redirect del front.

## Definition of Done (por feature)

Una feature está terminada cuando: compila, pasa `pnpm typecheck`, pasa
`pnpm lint`, pasa el checklist del skill `seguridad`, y tiene tests en los caminos
críticos (auth, aislamiento de tenant, webhook de pago).

## Comandos

- `pnpm dev` — entorno local
- `pnpm build` / `pnpm typecheck` / `pnpm lint`
- `pnpm db:generate` / `pnpm db:migrate` — migraciones Drizzle
- `pnpm test` — tests
- `docker compose up` — levanta el stack completo (prod / migración a VPS)

## Orden de construcción (feature por feature)

Construimos y commiteamos una feature a la vez. No avanzar hasta que la actual
cumpla el Definition of Done.

1. Scaffold + auth (better-auth) + base multi-tenant (tenants, profiles, RLS)
2. Gestión de canchas (CRUD)
3. Calendario de disponibilidad + slots horarios
4. Reservas (crear/cancelar/modificar, con bloqueo de doble booking a nivel DB)
5. Gestión de clientes
6. Pagos con Mercado Pago (OAuth del complejo + preferencia + webhook firmado)
7. Notificaciones WhatsApp (Evolution API + n8n)
8. Panel de administración (dashboard del dueño)
9. Reporting (ocupación, ingresos, horarios pico, clientes frecuentes)

## Reglas de trabajo para Claude Code

- Antes de escribir código, proponé un plan corto con un mini threat-modeling de
  la feature y esperá el OK si es grande.
- Una feature = un branch. Sugerí el mensaje de commit (convencional) al terminar.
- Si una tarea encaja con un skill de `.claude/skills/`, usalo. El skill
  `seguridad` se corre SIEMPRE al cerrar una feature.
- Preguntá antes de instalar dependencias nuevas o tocar el esquema de la DB.
- Doble booking es un bug crítico: usar constraint de exclusión por rango horario
  en Postgres, además de validación en la app.
