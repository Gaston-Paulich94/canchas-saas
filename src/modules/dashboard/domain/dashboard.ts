import type { ReservationStatus } from "@/modules/reservations/domain/reservation";

/**
 * Tipos del panel del dueño. Son vistas de LECTURA (agregaciones de lo que ya
 * existe): el panel no tiene entidades propias ni migraciones.
 */

/** Turno próximo mostrado en la agenda del día. */
export interface UpcomingReservation {
  id: string;
  courtName: string;
  customerName: string;
  startsAt: Date;
  endsAt: Date;
  status: ReservationStatus;
}

/** Números del día (fecha argentina). */
export interface TodaySummary {
  reservasConfirmadas: number;
  reservasCanceladas: number;
  proximos: UpcomingReservation[];
  /** Acreditado hoy por Mercado Pago (centavos, pagos aprobados hoy). */
  cobradoHoyCents: number;
  /** Valor de las reservas confirmadas de hoy, cobre por donde cobre. */
  estimadoHoyCents: number;
  /** Cobros generados (cualquier día) que siguen esperando pago. */
  cobrosPendientes: number;
}

/**
 * Avisos accionables: cosas que frenan la operación y el dueño puede resolver.
 * Cada uno lleva el link a donde se arregla.
 */
export interface DashboardAlert {
  id: string;
  mensaje: string;
  href: string;
  cta: string;
}

export interface DashboardOverview {
  today: TodaySummary;
  alerts: DashboardAlert[];
  canchasActivas: number;
  canchasTotales: number;
}
