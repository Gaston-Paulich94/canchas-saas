import { eq } from "drizzle-orm";
import type { DbTx } from "@/modules/shared/infrastructure/db/client";
import {
  tenants,
  type Tenant,
  type NewTenant,
} from "@/modules/shared/infrastructure/db/schema";

/**
 * Acceso a tenants. Aun cuando el id del tenant ES el scope, filtramos
 * explícitamente por id (capa de app) ADEMÁS de la RLS (capa de DB).
 */

export async function findTenantById(
  tx: DbTx,
  tenantId: string,
): Promise<Tenant | null> {
  const rows = await tx
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertTenant(
  tx: DbTx,
  data: NewTenant,
): Promise<Tenant> {
  const rows = await tx.insert(tenants).values(data).returning();
  const row = rows[0];
  if (!row) throw new Error("No se pudo crear el tenant.");
  return row;
}
