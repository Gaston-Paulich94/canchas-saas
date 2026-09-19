import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { DbTx } from "@/modules/shared/infrastructure/db/client";
import { reservations, courts } from "@/modules/shared/infrastructure/db/schema";
import type {
  RevenueSummary,
  CourtOccupancy,
  PeakHour,
  FrequentCustomer,
} from "@/modules/reporting/domain/reporting";

/**
 * Consultas del módulo de reporting.
 *
 * Todas agregan en SQL (SUM/COUNT/GROUP BY) y filtran explícitamente por
 * `tenant_id` (capa de app) ADEMÁS de la RLS. Los parámetros van ligados por
 * Drizzle: nunca se arma SQL concatenando strings.
 *
 * Zona horaria: las horas del negocio se leen en hora de Argentina
 * (`AT TIME ZONE`), para que "hora pico" signifique lo que el dueño espera.
 */

const AR_TZ = "America/Argentina/Buenos_Aires";

/** Helper: ejecuta SQL crudo parametrizado y devuelve las filas tipadas. */
async function rows<T>(tx: DbTx, query: Parameters<DbTx["execute"]>[0]): Promise<T[]> {
  const result = await tx.execute(query);
  return result as unknown as T[];
}

/**
 * En SQL crudo, postgres.js no serializa objetos `Date` como parámetro (sí lo
 * hace el query builder, que conoce el tipo de columna). Los mandamos como
 * ISO-8601 y casteamos del lado de Postgres: sigue siendo un parámetro ligado.
 */
function ts(date: Date): string {
  return date.toISOString();
}

export async function getRevenueSummary(
  tx: DbTx,
  tenantId: string,
  from: Date,
  to: Date,
): Promise<RevenueSummary> {
  // Reservas: conteos y valor estimado según el precio de cada cancha.
  const reservaRows = await tx
    .select({
      confirmadas: sql<number>`count(*) filter (where ${reservations.status} = 'confirmada')::int`,
      canceladas: sql<number>`count(*) filter (where ${reservations.status} = 'cancelada')::int`,
      estimadoCents: sql<number>`coalesce(sum(
        case when ${reservations.status} = 'confirmada'
          then round(
            coalesce(${courts.pricePerHour}, 0) * 100
            * (extract(epoch from (${reservations.endsAt} - ${reservations.startsAt})) / 3600.0)
          )
        else 0 end
      ), 0)::bigint`,
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

  // Pagos: lo cobrado se imputa a la fecha de acreditación.
  const pagoRows = await rows<{
    cobrado: string | number;
    pendiente: string | number;
  }>(
    tx,
    sql`
      select
        coalesce(sum(amount_cents) filter (where status = 'aprobado'), 0) as cobrado,
        coalesce(sum(amount_cents) filter (where status = 'pendiente'), 0) as pendiente
      from payments
      where tenant_id = ${tenantId}
        and coalesce(paid_at, created_at) >= ${ts(from)}::timestamptz
        and coalesce(paid_at, created_at) < ${ts(to)}::timestamptz
    `,
  );

  const r = reservaRows[0];
  const p = pagoRows[0];
  return {
    reservasConfirmadas: r?.confirmadas ?? 0,
    reservasCanceladas: r?.canceladas ?? 0,
    estimadoCents: Number(r?.estimadoCents ?? 0),
    cobradoCents: Number(p?.cobrado ?? 0),
    pendientesCents: Number(p?.pendiente ?? 0),
  };
}

/**
 * Ocupación por cancha.
 *
 * Horas OFRECIDAS: se expande el rango de fechas día por día
 * (`generate_series`) y se cruza con la disponibilidad semanal, así un lunes
 * que aparece 4 veces en el mes suma 4 veces su franja.
 * Horas RESERVADAS: duración real de las reservas confirmadas.
 */
export async function getCourtOccupancy(
  tx: DbTx,
  tenantId: string,
  desde: string,
  hasta: string,
  from: Date,
  to: Date,
): Promise<CourtOccupancy[]> {
  const result = await rows<{
    court_id: string;
    court_name: string;
    horas_reservadas: string | number;
    horas_disponibles: string | number;
    ingreso_estimado: string | number;
  }>(
    tx,
    sql`
      with dias as (
        select d::date as fecha, extract(dow from d)::int as dow
        from generate_series(${desde}::date, ${hasta}::date, interval '1 day') d
      ),
      ofrecidas as (
        select ca.court_id,
               sum(extract(epoch from (ca.close_time - ca.open_time)) / 3600.0) as horas
        from court_availability ca
        join dias on dias.dow = ca.day_of_week
        where ca.tenant_id = ${tenantId}
        group by ca.court_id
      ),
      reservadas as (
        select r.court_id,
               sum(extract(epoch from (r.ends_at - r.starts_at)) / 3600.0) as horas,
               sum(
                 round(
                   coalesce(c.price_per_hour, 0) * 100
                   * (extract(epoch from (r.ends_at - r.starts_at)) / 3600.0)
                 )
               ) as ingreso
        from reservations r
        join courts c on c.id = r.court_id
        where r.tenant_id = ${tenantId}
          and r.status = 'confirmada'
          and r.starts_at >= ${ts(from)}::timestamptz
          and r.starts_at < ${ts(to)}::timestamptz
        group by r.court_id
      )
      select c.id as court_id,
             c.name as court_name,
             coalesce(reservadas.horas, 0) as horas_reservadas,
             coalesce(ofrecidas.horas, 0) as horas_disponibles,
             coalesce(reservadas.ingreso, 0) as ingreso_estimado
      from courts c
      left join ofrecidas on ofrecidas.court_id = c.id
      left join reservadas on reservadas.court_id = c.id
      where c.tenant_id = ${tenantId}
      order by coalesce(reservadas.horas, 0) desc, c.name asc
    `,
  );

  return result.map((row) => {
    const reservadas = Number(row.horas_reservadas);
    const disponibles = Number(row.horas_disponibles);
    return {
      courtId: row.court_id,
      courtName: row.court_name,
      horasReservadas: reservadas,
      horasDisponibles: disponibles,
      ocupacionPct:
        disponibles > 0
          ? Math.min(100, Math.round((reservadas / disponibles) * 100))
          : null,
      ingresoEstimadoCents: Number(row.ingreso_estimado),
    };
  });
}

/** Reservas confirmadas agrupadas por hora de inicio (hora argentina). */
export async function getPeakHours(
  tx: DbTx,
  tenantId: string,
  from: Date,
  to: Date,
): Promise<PeakHour[]> {
  const result = await rows<{ hora: number; reservas: string | number }>(
    tx,
    sql`
      select extract(hour from (starts_at at time zone ${AR_TZ}))::int as hora,
             count(*) as reservas
      from reservations
      where tenant_id = ${tenantId}
        and status = 'confirmada'
        and starts_at >= ${ts(from)}::timestamptz
        and starts_at < ${ts(to)}::timestamptz
      group by 1
      order by 1
    `,
  );

  return result.map((r) => ({
    hora: Number(r.hora),
    reservas: Number(r.reservas),
  }));
}

/** Ranking de clientes por cantidad de reservas confirmadas en el período. */
export async function getFrequentCustomers(
  tx: DbTx,
  tenantId: string,
  from: Date,
  to: Date,
  limit = 10,
): Promise<FrequentCustomer[]> {
  const result = await rows<{
    customer_id: string | null;
    nombre: string;
    telefono: string | null;
    reservas: string | number;
    ultima: Date | string;
  }>(
    tx,
    sql`
      select r.customer_id,
             coalesce(max(c.name), max(r.customer_name)) as nombre,
             max(coalesce(c.phone, r.customer_phone)) as telefono,
             count(*) as reservas,
             max(r.starts_at) as ultima
      from reservations r
      left join customers c
        on c.id = r.customer_id and c.tenant_id = ${tenantId}
      where r.tenant_id = ${tenantId}
        and r.status = 'confirmada'
        and r.starts_at >= ${ts(from)}::timestamptz
        and r.starts_at < ${ts(to)}::timestamptz
      group by r.customer_id
      order by count(*) desc, max(r.starts_at) desc
      limit ${limit}
    `,
  );

  return result.map((r) => ({
    customerId: r.customer_id,
    nombre: r.nombre,
    telefono: r.telefono,
    reservas: Number(r.reservas),
    ultimaReserva: new Date(r.ultima),
  }));
}
