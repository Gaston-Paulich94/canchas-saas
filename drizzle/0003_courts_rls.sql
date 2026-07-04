-- ─────────────────────────────────────────────────────────────────────────────
-- RLS de `courts` — aislamiento multi-tenant (defensa en profundidad)
--
-- Mismo patrón que 0001_rls_policies.sql:
--  - ENABLE + FORCE ROW LEVEL SECURITY (FORCE => aplica también al owner).
--  - Policy para el rol de runtime `app_user`, filtrando por el setting de
--    sesión app.tenant_id que fija withTenant(). NULLIF(...,'')::uuid deja la
--    fila FUERA si el setting no está (fail-closed) y evita el error de casteo.
--
-- El GRANT de DML sobre `courts` para app_user lo cubre el ALTER DEFAULT
-- PRIVILEGES de 0001 (la tabla la crea el rol admin en 0002). Igual, la capa de
-- aplicación filtra por tenant_id en CADA query: las dos capas son independientes.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "courts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "courts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "courts_isolation" ON "courts"
  AS PERMISSIVE
  FOR ALL
  TO "app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
