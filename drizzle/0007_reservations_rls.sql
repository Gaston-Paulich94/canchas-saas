-- ─────────────────────────────────────────────────────────────────────────────
-- reservations: bloqueo de doble booking a nivel DB + RLS
--
-- 1) EXCLUDE constraint PARCIAL (doble booking es un bug crítico — CLAUDE.md):
--    dos reservas NO canceladas de la misma cancha no pueden solapar su rango
--    [starts_at, ends_at). Postgres lo garantiza también ante requests
--    CONCURRENTES: la segunda transacción recibe exclusion_violation (23P01).
--      - tstzrange es nativo; btree_gist ya está instalado (migración 0005).
--      - rango '[)': turnos contiguos (18–19 / 19–20) no chocan.
--      - WHERE (status <> 'cancelada'): cancelar libera el horario sin borrar
--        la fila (queda para historial/reporting).
--
-- 2) RLS: mismo patrón que 0001/0003/0005 (ENABLE + FORCE + policy app_user por
--    app.tenant_id). El GRANT de DML lo cubre el ALTER DEFAULT PRIVILEGES de 0001.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_no_double_booking"
  EXCLUDE USING gist (
    "court_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("status" <> 'cancelada');--> statement-breakpoint

ALTER TABLE "reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "reservations_isolation" ON "reservations"
  AS PERMISSIVE
  FOR ALL
  TO "app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
