-- ─────────────────────────────────────────────────────────────────────────────
-- customers: RLS + dedup por teléfono
--
-- 1) RLS: mismo patrón que 0001/0003/0005/0007 (ENABLE + FORCE + policy para
--    app_user por app.tenant_id). El GRANT de DML lo cubre el ALTER DEFAULT
--    PRIVILEGES de 0001.
--
-- 2) Índice único PARCIAL: el teléfono es único por tenant CUANDO existe
--    (clientes sin teléfono no chocan entre sí). Es la clave de dedup del
--    find-or-create al reservar y del canal de WhatsApp a futuro.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "customers_isolation" ON "customers"
  AS PERMISSIVE
  FOR ALL
  TO "app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

CREATE UNIQUE INDEX "customers_tenant_phone_unique"
  ON "customers" ("tenant_id", "phone")
  WHERE "phone" IS NOT NULL;
