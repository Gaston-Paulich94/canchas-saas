import { and, eq, asc } from "drizzle-orm";
import type { DbTx } from "@/modules/shared/infrastructure/db/client";
import {
  courts,
  type Court,
  type NewCourt,
} from "@/modules/shared/infrastructure/db/schema";

/**
 * Acceso a canchas. TODA query filtra explícitamente por `tenant_id` (capa de
 * app), ADEMÁS de la RLS de la DB (capa independiente). Ninguna asume la otra.
 *
 * Nunca se construye SQL por concatenación: todo es Drizzle parametrizado.
 */

export async function listCourts(
  tx: DbTx,
  tenantId: string,
): Promise<Court[]> {
  return tx
    .select()
    .from(courts)
    .where(eq(courts.tenantId, tenantId))
    .orderBy(asc(courts.name));
}

export async function findCourtById(
  tx: DbTx,
  tenantId: string,
  id: string,
): Promise<Court | null> {
  const rows = await tx
    .select()
    .from(courts)
    .where(and(eq(courts.tenantId, tenantId), eq(courts.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertCourt(
  tx: DbTx,
  data: NewCourt,
): Promise<Court> {
  const rows = await tx.insert(courts).values(data).returning();
  const row = rows[0];
  if (!row) throw new Error("No se pudo crear la cancha.");
  return row;
}

/**
 * Actualiza una cancha del tenant. El WHERE lleva tenant_id + id: si el id es de
 * otro tenant, no matchea ninguna fila y devuelve null (anti-IDOR).
 */
export async function updateCourt(
  tx: DbTx,
  tenantId: string,
  id: string,
  patch: Partial<Omit<NewCourt, "id" | "tenantId">>,
): Promise<Court | null> {
  const rows = await tx
    .update(courts)
    .set(patch)
    .where(and(eq(courts.tenantId, tenantId), eq(courts.id, id)))
    .returning();
  return rows[0] ?? null;
}

/** Borra una cancha del tenant. Devuelve true si borró algo. */
export async function deleteCourt(
  tx: DbTx,
  tenantId: string,
  id: string,
): Promise<boolean> {
  const rows = await tx
    .delete(courts)
    .where(and(eq(courts.tenantId, tenantId), eq(courts.id, id)))
    .returning({ id: courts.id });
  return rows.length > 0;
}
