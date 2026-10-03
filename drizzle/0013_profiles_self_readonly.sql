-- ─────────────────────────────────────────────────────────────────────────────
-- profiles_self pasa a SOLO LECTURA (fix de escalada de privilegios)
--
-- Antes: `FOR ALL` con WITH CHECK solo sobre user_id. Con el contexto "self"
-- (app.user_id, sin tenant) el rol de runtime podía:
--   - INSERTAR un profile propio en un tenant AJENO, con rol owner;
--   - hacer UPDATE de su propio rol (staff → owner).
-- La capa de app no lo hacía, pero la capa de DB no sostenía sola: justo lo
-- que el aislamiento en dos capas independientes tiene que evitar.
--
-- Ahora: el contexto "self" solo sirve para LEER el propio profile (bootstrap
-- de sesión). Toda escritura exige app.tenant_id y pasa por profiles_by_tenant.
-- El registro de owner ya fija ambos settings (withTenantAndSelf).
-- Complementa al UNIQUE(user_id) de la migración 0012.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY "profiles_self" ON "profiles";--> statement-breakpoint

CREATE POLICY "profiles_self_read" ON "profiles"
  AS PERMISSIVE
  FOR SELECT
  TO "app_user"
  USING ("user_id" = NULLIF(current_setting('app.user_id', true), ''));
