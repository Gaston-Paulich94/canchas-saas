import { and, eq } from "drizzle-orm";
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

/**
 * Guarda las credenciales de Mercado Pago del complejo. Los tokens llegan YA
 * CIFRADOS (AES-256-GCM): este repo nunca ve ni escribe texto plano.
 */
export async function updateTenantMpCredentials(
  tx: DbTx,
  tenantId: string,
  data: {
    mpUserId: string | null;
    mpAccessTokenEnc: string | null;
    mpRefreshTokenEnc: string | null;
    mpTokenExpiresAt: Date | null;
  },
): Promise<Tenant | null> {
  const rows = await tx
    .update(tenants)
    .set(data)
    .where(eq(tenants.id, tenantId))
    .returning();
  return rows[0] ?? null;
}

/**
 * Guarda tokens renovados SOLO si el refresh token guardado sigue siendo el que
 * se usó para renovar (compare-and-swap). Si otro pedido renovó en paralelo, no
 * se pisa su resultado: devuelve false y el llamador relee.
 *
 * El "valor esperado" es el texto cifrado: con IV aleatorio por cifrado, cada
 * guardado produce un valor distinto, así que funciona como número de versión.
 */
export async function replaceMpTokensIfUnchanged(
  tx: DbTx,
  tenantId: string,
  expectedRefreshTokenEnc: string,
  data: {
    mpAccessTokenEnc: string;
    mpRefreshTokenEnc: string;
    mpTokenExpiresAt: Date | null;
  },
): Promise<boolean> {
  const rows = await tx
    .update(tenants)
    .set(data)
    .where(
      and(
        eq(tenants.id, tenantId),
        eq(tenants.mpRefreshTokenEnc, expectedRefreshTokenEnc),
      ),
    )
    .returning({ id: tenants.id });
  return rows.length > 0;
}
