import { and, eq, asc } from "drizzle-orm";
import type { DbTx } from "@/modules/shared/infrastructure/db/client";
import {
  courtAvailability,
  type CourtAvailability,
  type NewCourtAvailability,
} from "@/modules/shared/infrastructure/db/schema";

/**
 * Acceso a court_availability. Toda query filtra explícitamente por `tenant_id`
 * (capa de app) ADEMÁS de la RLS. Las lecturas por cancha filtran también por
 * `court_id`. Todo es Drizzle parametrizado (sin SQL crudo con input).
 */

export async function listAvailabilityByCourt(
  tx: DbTx,
  tenantId: string,
  courtId: string,
): Promise<CourtAvailability[]> {
  return tx
    .select()
    .from(courtAvailability)
    .where(
      and(
        eq(courtAvailability.tenantId, tenantId),
        eq(courtAvailability.courtId, courtId),
      ),
    )
    .orderBy(asc(courtAvailability.dayOfWeek), asc(courtAvailability.openTime));
}

export async function insertAvailability(
  tx: DbTx,
  data: NewCourtAvailability,
): Promise<CourtAvailability> {
  const rows = await tx.insert(courtAvailability).values(data).returning();
  const row = rows[0];
  if (!row) throw new Error("No se pudo crear la franja horaria.");
  return row;
}

/** Borra una franja del tenant. Devuelve true si borró algo (anti-IDOR). */
export async function deleteAvailability(
  tx: DbTx,
  tenantId: string,
  id: string,
): Promise<boolean> {
  const rows = await tx
    .delete(courtAvailability)
    .where(
      and(
        eq(courtAvailability.tenantId, tenantId),
        eq(courtAvailability.id, id),
      ),
    )
    .returning({ id: courtAvailability.id });
  return rows.length > 0;
}
