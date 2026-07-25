-- ─────────────────────────────────────────────────────────────────────────────
-- payments: RLS + idempotencia + resolución de tenant para el webhook
--
-- 1) RLS: mismo patrón que las tablas anteriores (ENABLE + FORCE + policy para
--    app_user por app.tenant_id).
--
-- 2) Índices únicos PARCIALES:
--    - mp_payment_id único por tenant => IDEMPOTENCIA: la misma notificación de
--      Mercado Pago, reenviada N veces, no crea ni re-procesa un pago dos veces.
--    - un solo pago VIVO (pendiente/aprobado) por reserva => anti doble cobro.
--
-- 3) resolve_payment_tenant(): el webhook de MP llega SIN sesión, así que no
--    hay tenant de dónde derivar el scope. En vez de abrir un bypass de RLS,
--    creamos un camino de mínimo privilegio:
--      - rol `payment_resolver` NOLOGIN (nadie se conecta con él),
--      - que solo puede SELECT sobre payments (policy propia),
--      - dueño de una función SECURITY DEFINER que devuelve ÚNICAMENTE el
--        tenant_id de un pago (ni un dato de negocio más),
--      - ejecutable por app_user, y que la app solo invoca DESPUÉS de haber
--        verificado la firma HMAC de la notificación.
--    Con ese tenant_id, el resto del procesamiento corre en withTenant() como
--    cualquier otra query.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "payments_isolation" ON "payments"
  AS PERMISSIVE
  FOR ALL
  TO "app_user"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

CREATE UNIQUE INDEX "payments_tenant_mp_payment_id_unique"
  ON "payments" ("tenant_id", "mp_payment_id")
  WHERE "mp_payment_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "payments_reservation_active_unique"
  ON "payments" ("reservation_id")
  WHERE "status" IN ('pendiente', 'aprobado');--> statement-breakpoint

-- Rol técnico sin login: existe solo para ser dueño de la función de abajo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payment_resolver') THEN
    CREATE ROLE "payment_resolver" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA "public" TO "payment_resolver";--> statement-breakpoint
GRANT SELECT ON "payments" TO "payment_resolver";--> statement-breakpoint

CREATE POLICY "payments_resolver_read" ON "payments"
  AS PERMISSIVE
  FOR SELECT
  TO "payment_resolver"
  USING (true);--> statement-breakpoint

CREATE FUNCTION "resolve_payment_tenant"(p_payment_id uuid)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$ SELECT "tenant_id" FROM "payments" WHERE "id" = p_payment_id $$;--> statement-breakpoint

ALTER FUNCTION "resolve_payment_tenant"(uuid) OWNER TO "payment_resolver";--> statement-breakpoint
REVOKE ALL ON FUNCTION "resolve_payment_tenant"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "resolve_payment_tenant"(uuid) TO "app_user";
