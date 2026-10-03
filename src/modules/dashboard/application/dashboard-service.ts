import { withTenant } from "@/modules/shared/infrastructure/db/with-tenant";
import { assertRole } from "@/modules/shared/application/authz";
import { ROLES, type SessionContext } from "@/modules/auth/domain/roles";
import { arDayBounds } from "@/modules/reservations/domain/datetime";
import { getMpConnectionStatus } from "@/modules/payments/infrastructure/mp-credentials";
import { countPaymentsNeedingRefund } from "@/modules/payments/infrastructure/payment.repository";
import type {
  DashboardAlert,
  DashboardOverview,
} from "@/modules/dashboard/domain/dashboard";
import {
  getReservationDayCounts,
  listUpcomingReservations,
  getPaymentDayTotals,
  getCourtCounts,
  countCourtsWithoutAvailability,
} from "@/modules/dashboard/infrastructure/dashboard.repository";

/**
 * Panel del dueño: foto de la operación del día + avisos accionables.
 *
 * Todo se resuelve en UNA transacción scopeada por tenant (withTenant), así el
 * panel hace un solo viaje a la DB y las lecturas quedan consistentes entre sí.
 */

const VIEW_ROLES = [ROLES.OWNER, ROLES.STAFF] as const;

/** Arma los avisos a partir del estado real del complejo. (Puro: testeable.) */
export function buildAlerts(input: {
  canchasTotales: number;
  sinPrecio: number;
  sinDisponibilidad: number;
  mpConectado: boolean;
  esOwner: boolean;
  /** Pagos recibidos de cobros anulados que hay que devolver. */
  pagosADevolver: number;
}): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  // Plata de un cliente que hay que devolver: va primero. Solo al dueño, que es
  // quien puede reembolsar desde la cuenta de Mercado Pago.
  if (input.pagosADevolver > 0 && input.esOwner) {
    alerts.push({
      id: "pagos-a-devolver",
      mensaje:
        input.pagosADevolver === 1
          ? "Recibiste 1 pago de un cobro anulado o de una reserva cancelada: hay que devolverlo."
          : `Recibiste ${input.pagosADevolver} pagos de cobros anulados o reservas canceladas: hay que devolverlos.`,
      href: "/dashboard/pagos",
      cta: "Ver pagos",
    });
  }

  if (input.canchasTotales === 0) {
    alerts.push({
      id: "sin-canchas",
      mensaje: "Todavía no cargaste ninguna cancha.",
      href: "/dashboard/canchas/nueva",
      cta: "Cargar cancha",
    });
    // Sin canchas, el resto de los avisos sobra.
    return alerts;
  }

  if (input.sinDisponibilidad > 0) {
    alerts.push({
      id: "sin-disponibilidad",
      mensaje:
        input.sinDisponibilidad === 1
          ? "Hay 1 cancha activa sin horarios cargados: no genera turnos."
          : `Hay ${input.sinDisponibilidad} canchas activas sin horarios cargados: no generan turnos.`,
      href: "/dashboard/canchas",
      cta: "Cargar horarios",
    });
  }

  if (input.sinPrecio > 0) {
    alerts.push({
      id: "sin-precio",
      mensaje:
        input.sinPrecio === 1
          ? "Hay 1 cancha activa sin precio por hora: no se le puede generar link de pago."
          : `Hay ${input.sinPrecio} canchas activas sin precio por hora: no se les puede generar link de pago.`,
      href: "/dashboard/canchas",
      cta: "Cargar precio",
    });
  }

  // Conectar la cuenta que cobra es tarea del dueño; al staff no le sirve el aviso.
  if (!input.mpConectado && input.esOwner) {
    alerts.push({
      id: "mp-sin-conectar",
      mensaje:
        "Mercado Pago no está conectado: por ahora solo podés cobrar en efectivo.",
      href: "/dashboard/pagos",
      cta: "Conectar",
    });
  }

  return alerts;
}

export async function getDashboardOverview(
  ctx: SessionContext,
  dateStr: string,
): Promise<DashboardOverview> {
  assertRole(ctx, VIEW_ROLES);
  const { from, to } = arDayBounds(dateStr);
  const now = new Date();
  // Si el día consultado ya pasó o es futuro, "próximos" arranca al inicio del día.
  const since = now > from && now < to ? now : from;

  return withTenant(ctx.tenantId, async (tx) => {
    const [counts, proximos, pagos, canchas, sinDisponibilidad, mp, aDevolver] =
      await Promise.all([
        getReservationDayCounts(tx, ctx.tenantId, from, to),
        listUpcomingReservations(tx, ctx.tenantId, since, to),
        getPaymentDayTotals(tx, ctx.tenantId, from, to),
        getCourtCounts(tx, ctx.tenantId),
        countCourtsWithoutAvailability(tx, ctx.tenantId),
        getMpConnectionStatus(tx, ctx.tenantId),
        countPaymentsNeedingRefund(tx, ctx.tenantId),
      ]);

    return {
      today: {
        reservasConfirmadas: counts.confirmadas,
        reservasCanceladas: counts.canceladas,
        proximos,
        cobradoHoyCents: pagos.cobradoCents,
        estimadoHoyCents: counts.estimadoCents,
        cobrosPendientes: pagos.pendientes,
      },
      alerts: buildAlerts({
        canchasTotales: canchas.totales,
        sinPrecio: canchas.sinPrecio,
        sinDisponibilidad,
        mpConectado: mp.connected,
        esOwner: ctx.role === ROLES.OWNER,
        pagosADevolver: aDevolver,
      }),
      canchasActivas: canchas.activas,
      canchasTotales: canchas.totales,
    };
  });
}
