import { and, eq, gte, lt, asc, ne, isNull, sql } from "drizzle-orm";
import type { DbTx } from "@/modules/shared/infrastructure/db/client";
import {
  reservations,
  courts,
  payments,
  courtAvailability,
} from "@/modules/shared/infrastructure/db/schema";
import type { UpcomingReservation } from "@/modules/dashboard/domain/dashboard";

/**
 * Consultas de lectura del panel. Todas filtran explícitamente por `tenant_id`
 * (capa de app) ADEMÁS de la RLS, igual que el resto de los repos.
 *
 * Las agregaciones se hacen en SQL (COUNT/SUM/GROUP BY), no trayendo filas a
 * JS: el panel tiene que seguir siendo barato cuando el complejo crezca.
 */

export interface ReservationDayCounts {
  confirmadas: number;
  canceladas: number;
  /** Valor de las reservas confirmadas, según el precio de cada cancha. */
  estimadoCents: number;
}

/** Conteos y valor estimado de las reservas cuyo inicio cae en [from, to). */
export async function getReservationDayCounts(
  tx: DbTx,
  tenantId: string,
  from: Date,
  to: Date,
): Promise<ReservationDayCounts> {
  const rows = await tx
    .select({
      confirmadas: sql<number>`count(*) filter (where ${reservations.status} = 'confirmada')::int`,
      canceladas: sql<number>`count(*) filter (where ${reservations.status} = 'cancelada')::int`,
      // precio/hora (pesos) → centavos, prorrateado por la duración real.
      estimadoCents: sql<number>`coalesce(sum(
        case when ${reservations.status} = 'confirmada'
          then round(
            coalesce(${courts.pricePerHour}, 0) * 100
            * (extract(epoch from (${reservations.endsAt} - ${reservations.startsAt})) / 3600.0)
          )
        else 0 end
      ), 0)::int`,
    })
    .from(reservations)
    .innerJoin(courts, eq(courts.id, reservations.courtId))
    .where(
      and(
        eq(reservations.tenantId, tenantId),
        gte(reservations.startsAt, from),
        lt(reservations.startsAt, to),
      ),
    );

  const row = rows[0];
  return {
    confirmadas: row?.confirmadas ?? 0,
    canceladas: row?.canceladas ?? 0,
    estimadoCents: row?.estimadoCents ?? 0,
  };
}

/** Próximos turnos no cancelados desde `since` (con el nombre de la cancha). */
export async function listUpcomingReservations(
  tx: DbTx,
  tenantId: string,
  since: Date,
  until: Date,
  limit = 6,
): Promise<UpcomingReservation[]> {
  const rows = await tx
    .select({
      id: reservations.id,
      courtName: courts.name,
      customerName: reservations.customerName,
      startsAt: reservations.startsAt,
      endsAt: reservations.endsAt,
      status: reservations.status,
    })
    .from(reservations)
    .innerJoin(courts, eq(courts.id, reservations.courtId))
    .where(
      and(
        eq(reservations.tenantId, tenantId),
        ne(reservations.status, "cancelada"),
        gte(reservations.startsAt, since),
        lt(reservations.startsAt, until),
      ),
    )
    .orderBy(asc(reservations.startsAt))
    .limit(limit);

  return rows;
}

export interface PaymentDayTotals {
  cobradoCents: number;
  pendientes: number;
}

/**
 * Cobros del día:
 *  - cobrado: pagos APROBADOS acreditados en [from, to). Se imputan por la
 *    fecha de acreditación (paid_at), igual que en los reportes: un link
 *    generado ayer y pagado hoy es plata de hoy.
 *  - pendientes: TODOS los cobros abiertos, generados cualquier día — es lo
 *    que el operador tiene que perseguir.
 */
export async function getPaymentDayTotals(
  tx: DbTx,
  tenantId: string,
  from: Date,
  to: Date,
): Promise<PaymentDayTotals> {
  // En fragmentos `sql` postgres.js no serializa Date: ISO + cast (sigue
  // siendo un parámetro ligado).
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const rows = await tx
    .select({
      cobradoCents: sql<string>`coalesce(sum(${payments.amountCents}) filter (
        where ${payments.status} = 'aprobado'
          and coalesce(${payments.paidAt}, ${payments.createdAt}) >= ${fromIso}::timestamptz
          and coalesce(${payments.paidAt}, ${payments.createdAt}) < ${toIso}::timestamptz
      ), 0)::bigint`,
      pendientes: sql<number>`count(*) filter (where ${payments.status} = 'pendiente')::int`,
    })
    .from(payments)
    .where(eq(payments.tenantId, tenantId));

  const row = rows[0];
  return {
    cobradoCents: Number(row?.cobradoCents ?? 0),
    pendientes: row?.pendientes ?? 0,
  };
}

export interface CourtCounts {
  activas: number;
  totales: number;
  /** Canchas activas sin precio: no se les puede generar link de pago. */
  sinPrecio: number;
}

export async function getCourtCounts(
  tx: DbTx,
  tenantId: string,
): Promise<CourtCounts> {
  const rows = await tx
    .select({
      activas: sql<number>`count(*) filter (where ${courts.isActive})::int`,
      totales: sql<number>`count(*)::int`,
      sinPrecio: sql<number>`count(*) filter (where ${courts.isActive} and ${courts.pricePerHour} is null)::int`,
    })
    .from(courts)
    .where(eq(courts.tenantId, tenantId));

  const row = rows[0];
  return {
    activas: row?.activas ?? 0,
    totales: row?.totales ?? 0,
    sinPrecio: row?.sinPrecio ?? 0,
  };
}

/**
 * Canchas activas sin NINGUNA franja horaria cargada: no generan turnos, así
 * que no se pueden reservar. Es el bloqueo operativo más común al arrancar.
 */
export async function countCourtsWithoutAvailability(
  tx: DbTx,
  tenantId: string,
): Promise<number> {
  const rows = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(courts)
    .leftJoin(
      courtAvailability,
      and(
        eq(courtAvailability.courtId, courts.id),
        eq(courtAvailability.tenantId, tenantId),
      ),
    )
    .where(
      and(
        eq(courts.tenantId, tenantId),
        eq(courts.isActive, true),
        isNull(courtAvailability.id),
      ),
    );

  return rows[0]?.total ?? 0;
}
