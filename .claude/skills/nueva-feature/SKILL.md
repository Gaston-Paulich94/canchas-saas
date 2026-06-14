---
name: nueva-feature
description: Playbook para agregar una feature completa al SaaS de canchas (migración de DB con RLS + Server Action validada con Zod + componente de UI con shadcn + entrada en el panel admin). Usá este skill SIEMPRE que el usuario pida agregar, crear o construir una nueva funcionalidad, entidad, módulo, sección o pantalla del sistema, aunque no diga la palabra "feature".
---

# Nueva feature — Canchas SaaS

Este skill define el orden y los estándares para agregar cualquier feature nueva,
de forma que todas queden consistentes entre sí. Seguí estos pasos en este orden.

## 1. Planificación y threat-modeling (antes de codear)

- Describí brevemente qué hace la feature y qué entidades de DB involucra.
- Mini threat-modeling: ¿qué podría salir mal en auth, autorización o aislamiento
  de tenant? Describilo y proponé cómo lo prevenís.
- Esperá confirmación antes de avanzar al código.

## 2. Capa de datos (DB primero)

- Creá una migración nueva en `supabase/migrations/` o con `pnpm db:generate`.
  Nunca edites el esquema directamente.
- Toda tabla de negocio lleva: `id` (uuid, default gen_random_uuid()),
  `tenant_id` (uuid, FK a `tenants`, NOT NULL), `created_at`, `updated_at`.
- Escribí las **policies RLS** en la misma migración. Toda policy filtra por
  el `tenant_id` del usuario autenticado derivado del JWT, nunca del cliente.
- Si la entidad tiene rangos horarios (reservas, slots), usá constraints de
  exclusión de Postgres para impedir solapamientos a nivel DB.

## 3. Tipos y validación

- Definí los tipos en `types/<feature>.ts`.
- Creá los esquemas **Zod** en `lib/<feature>/schemas.ts`. Reutilizalos tanto
  en el form como en la Server Action — una sola fuente de verdad.

## 4. Lógica de dominio (service layer)

- La lógica va en `lib/<feature>/service.ts`. Sin SQL ni detalles de HTTP acá.
- Las mutaciones se hacen con **Server Actions** en `app/actions/<feature>.ts`
  o Route Handlers, nunca con la service key desde el cliente.
- Cada operación que escribe en DB valida con Zod en el borde.
- Autorizá por rol (owner / staff / cliente) en el service, no solo en la UI.
- El `tenant_id` se deriva del usuario autenticado, nunca del cliente.

## 5. Infraestructura (repository)

- El acceso a la DB va en `lib/<feature>/repository.ts` usando el cliente
  de Drizzle scopeado por tenant.
- Nunca construyas SQL por concatenación de strings.

## 6. UI

- Server Component por defecto; `"use client"` solo para interactividad real.
- Usá componentes de **shadcn/ui**. Textos de UI en español (es-AR).
- Contemplá siempre: estado de carga, estado de error, estado vacío.
- Formularios con validación client-side (mismos schemas Zod via react-hook-form).

## 7. Panel de administración

- Toda feature de gestión tiene su entrada en el panel admin (`/dashboard`).
- Si genera datos cuantificables (reservas, ingresos, ocupación), dejá previsto
  el punto de enganche para el módulo de reporting (aunque no lo implementes aún).

## 8. Definition of Done

Antes de cerrar la feature:
- `pnpm typecheck` y `pnpm lint` sin errores.
- Tests en los caminos críticos: autorización, aislamiento de tenant, y la
  lógica principal de la feature.
- Corré el skill `seguridad` y pasá su checklist. Si hay hallazgos críticos
  o altos, corregilos antes de cerrar.
- Sugerí el mensaje de commit en formato convencional:
  `feat(<módulo>): <descripción corta>`

## Ejemplo de uso

Input: "Agregá la gestión de canchas"
Output esperado: migración `courts` con RLS → tipos + schemas Zod →
service CRUD → Server Actions → UI listado/alta/edición con shadcn →
entrada en dashboard → typecheck/lint → reporte de seguridad → commit sugerido.
