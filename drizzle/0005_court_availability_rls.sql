-- ─────────────────────────────────────────────────────────────────────────────
-- court_availability: anti-solapamiento por rango horario + RLS
--
-- 1) EXCLUDE constraint: impide DOS ventanas que se pisen en la misma cancha y
--    día. Es la defensa a nivel DB que pide CLAUDE.md para entidades con rangos
--    horarios (introduce el patrón que la Fase 4/reservas necesita). Requiere:
--      - btree_gist: para poder usar `=` sobre court_id (uuid) y day_of_week
--        (smallint) dentro de un índice GiST.
--      - un tipo range sobre `time` (Postgres no trae `timerange` de fábrica).
--    El rango es '[)' (incluye apertura, excluye cierre): dos ventanas contiguas
--    como 08–10 y 10–12 NO se consideran solapadas.
--
-- 2) RLS: mismo patrón que 0001/0003 (ENABLE + FORCE + policy para app_user por
--    app.tenant_id). El GRANT de DML lo cubre el ALTER DEFAULT PRIVILEGES de 0001.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

CREATE TYPE "timerange" AS RANGE (subtype = time);--> statement-breakpoint

ALTER TABLE "court_availability"
  ADD CONSTRAINT "court_availability_no_overlap"
  EXCLUDE USING gist (
    "court_id" WITH =,
    "day_of_week" WITH =,
    timerange("open_time", "close_time", '[)') WITH &&
  );--> statement-breakpoint

ALTER TABLE "court_availability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "court_availability" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "court_availability_isolation" ON "court_availability"
  AS PERMISSIVE
  FOR ALL
  TO "app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
