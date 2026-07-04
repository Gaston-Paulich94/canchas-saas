import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/env";
import * as schema from "./schema";

/**
 * Cliente de DB del RUNTIME de la app.
 *
 * Se conecta con APP_DATABASE_URL → rol `app_user` (no-owner, sin BYPASSRLS),
 * de modo que RLS se aplica de verdad. Las migraciones usan otro rol (admin),
 * nunca este cliente.
 *
 * `prepare: false` es OBLIGATORIO: vamos a usar el pooler en transaction mode
 * (PgBouncer / Supabase pooler), donde los prepared statements rompen de forma
 * intermitente. Ver hardening #3.
 */
const client = postgres(env.APP_DATABASE_URL, {
  prepare: false,
  // Sin logging de queries en runtime (evita filtrar datos/PII a logs).
});

export const db = drizzle(client, { schema });

// Tipo de la transacción scopeada (lo usa withTenant y los repositories).
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Acceso al cliente crudo solo para cierre ordenado (tests, scripts).
export const sqlClient = client;
