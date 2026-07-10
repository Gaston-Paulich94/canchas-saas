import { and, eq, ne, gte, lt, asc } from "drizzle-orm";
import type { DbTx } from "@/modules/shared/infrastructure/db/client";
import {
  reservations,
  type Reservation,
  type NewReservation,
} from "@/modules/shared/infrastructure/db/schema";

/**
 * Acceso a reservations. TODA query filtra explícitamente por `tenant_id`
 * (capa de app) ADEMÁS de la RLS (capa independiente). Drizzle parametrizado,
 * sin SQL crudo con input.
 */

/** Reservas del tenant cuyo inicio cae en [from, to), ordenadas por inicio. */
export async function listReservationsByRange(
  tx: DbTx,
  tenantId: string,
  from: Date,
  to: Date,
): Promise<Reservation[]> {
  return tx
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.tenantId, tenantId),
        gte(reservations.startsAt, from),
        lt(reservations.startsAt, to),
      ),
    )
    .orderBy(asc(reservations.startsAt));
}

export async function findReservationById(
  tx: DbTx,
  tenantId: string,
  id: string,
): Promise<Reservation | null> {
  const rows = await tx
    .select()
    .from(reservations)
    .where(and(eq(reservations.tenantId, tenantId), eq(reservations.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertReservation(
  tx: DbTx,
  data: NewReservation,
): Promise<Reservation> {
  const rows = await tx.insert(reservations).values(data).returning();
  const row = rows[0];
  if (!row) throw new Error("No se pudo crear la reserva.");
  return row;
}

/**
 * Mueve una reserva NO cancelada a otro turno/cancha. WHERE por tenant + id +
 * status: un id de otro tenant o una reserva cancelada no matchean → null
 * (anti-IDOR / no se "revive" una cancelada). El EXCLUDE re-chequea el rango.
 */
export async function updateReservationSchedule(
  tx: DbTx,
  tenantId: string,
  id: string,
  patch: { courtId: string; startsAt: Date; endsAt: Date },
): Promise<Reservation | null> {
  const rows = await tx
    .update(reservations)
    .set(patch)
    .where(
      and(
        eq(reservations.tenantId, tenantId),
        eq(reservations.id, id),
        ne(reservations.status, "cancelada"),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** Cancela una reserva no cancelada del tenant. Devuelve la fila o null. */
export async function cancelReservation(
  tx: DbTx,
  tenantId: string,
  id: string,
): Promise<Reservation | null> {
  const rows = await tx
    .update(reservations)
    .set({ status: "cancelada" })
    .where(
      and(
        eq(reservations.tenantId, tenantId),
        eq(reservations.id, id),
        ne(reservations.status, "cancelada"),
      ),
    )
    .returning();
  return rows[0] ?? null;
}
