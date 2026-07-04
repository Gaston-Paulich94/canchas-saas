-- ─────────────────────────────────────────────────────────────────────────────
-- RLS (Row Level Security) — defensa en profundidad del aislamiento multi-tenant
--
-- Pre-requisito: el rol `app_user` (no-owner, NOBYPASSRLS) ya existe. Lo crea
-- `pnpm db:migrate` (src/.../db/migrate.ts) ANTES de aplicar esta migración.
--
-- Capa de DB. La app igual filtra por tenant_id en cada query (capa de app).
-- Las dos capas son independientes: ninguna asume que la otra está bien.
-- ─────────────────────────────────────────────────────────────────────────────

-- Settings de sesión leídos por las policies (los fija withTenant/withSelf):
--   app.tenant_id  → uuid del tenant del usuario autenticado
--   app.user_id    → id del usuario (solo para el bootstrap de auth)
-- current_setting(..., true) => missing_ok. Tras un set_config LOCAL, al cerrar
-- la transacción el GUC custom vuelve a '' (cadena vacía), no a NULL. Por eso
-- envolvemos en NULLIF(..., ''): '' => NULL => la comparación deja la fila FUERA
-- (fail-closed) y además evita el error "invalid input syntax for type uuid".

-- ── tenants ──────────────────────────────────────────────────────────────────
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "tenants_isolation" ON "tenants"
  AS PERMISSIVE
  FOR ALL
  TO "app_user"
  USING ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- ── profiles ─────────────────────────────────────────────────────────────────
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Acceso normal: ver/operar profiles del propio tenant.
CREATE POLICY "profiles_by_tenant" ON "profiles"
  AS PERMISSIVE
  FOR ALL
  TO "app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- Bootstrap de auth: ver/crear el propio profile cuando todavía no hay tenant
-- en contexto (login recién hecho). Solo la fila propia (user_id = app.user_id).
CREATE POLICY "profiles_self" ON "profiles"
  AS PERMISSIVE
  FOR ALL
  TO "app_user"
  USING ("user_id" = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), ''));--> statement-breakpoint

-- ── Privilegios del rol de runtime (mínimo necesario) ────────────────────────
GRANT USAGE ON SCHEMA "public" TO "app_user";--> statement-breakpoint

-- Tablas de negocio (con RLS): DML completo, RLS hace el filtrado fino.
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenants" TO "app_user";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "profiles" TO "app_user";--> statement-breakpoint

-- Tablas de better-auth (sin RLS): el runtime necesita operarlas para login/signup.
GRANT SELECT, INSERT, UPDATE, DELETE ON "user" TO "app_user";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "session" TO "app_user";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "account" TO "app_user";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "verification" TO "app_user";--> statement-breakpoint

-- Tablas futuras creadas por el rol admin → grant automático a app_user.
ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "app_user";--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  GRANT USAGE, SELECT ON SEQUENCES TO "app_user";
