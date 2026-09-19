import { z } from "zod";

/**
 * Reporting: ocupación, ingresos, horarios pico y clientes frecuentes.
 * Todo son vistas de LECTURA agregadas en SQL; no hay entidades nuevas.
 */

/**
 * Tope del período de un reporte. Las consultas expanden el rango día por día
 * (`generate_series`) sobre una base compartida por todos los complejos: sin
 * tope, un rango de siglos sería una denegación de servicio para el resto.
 */
export const MAX_REPORT_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Días del calendario desde el epoch; null si la fecha no existe (ej. 31/02). */
function calendarDay(value: string): number | null {
  const [y, m, d] = value.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return null;
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  // Date.UTC "corre" las fechas imposibles (31/02 → 03/03): se detecta acá.
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== m - 1 ||
    back.getUTCDate() !== d
  ) {
    return null;
  }
  return Math.round(ms / DAY_MS);
}

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.")
  .refine((v) => calendarDay(v) !== null, "Fecha inválida.");

/** Rango de fechas argentinas (inclusive `desde`, inclusive `hasta`). */
export const reportRangeSchema = z
  .object({
    desde: calendarDate,
    hasta: calendarDate,
  })
  .strict()
  .refine((v) => v.desde <= v.hasta, {
    message: "La fecha de inicio debe ser anterior a la de fin.",
    path: ["hasta"],
  })
  .refine(
    (v) => {
      const from = calendarDay(v.desde);
      const to = calendarDay(v.hasta);
      return from !== null && to !== null && to - from + 1 <= MAX_REPORT_DAYS;
    },
    {
      message: `El período no puede superar los ${MAX_REPORT_DAYS} días.`,
      path: ["hasta"],
    },
  );

export type ReportRange = z.infer<typeof reportRangeSchema>;

export interface RevenueSummary {
  /** Plata efectivamente cobrada por Mercado Pago (pagos aprobados). */
  cobradoCents: number;
  /** Valor de las reservas confirmadas, se haya cobrado por donde se haya cobrado. */
  estimadoCents: number;
  /** Cobros generados que siguen pendientes de pago. */
  pendientesCents: number;
  reservasConfirmadas: number;
  reservasCanceladas: number;
}

/** Ocupación de una cancha: turnos vendidos sobre turnos ofrecidos. */
export interface CourtOccupancy {
  courtId: string;
  courtName: string;
  /** Horas reservadas (confirmadas) en el período. */
  horasReservadas: number;
  /** Horas ofrecidas según la disponibilidad semanal cargada. */
  horasDisponibles: number;
  /** 0–100. Null si la cancha no tiene disponibilidad cargada. */
  ocupacionPct: number | null;
  ingresoEstimadoCents: number;
}

/** Reservas por hora de inicio (0–23), para detectar los horarios pico. */
export interface PeakHour {
  hora: number;
  reservas: number;
}

export interface FrequentCustomer {
  customerId: string | null;
  nombre: string;
  telefono: string | null;
  reservas: number;
  ultimaReserva: Date;
}

export interface ReportingOverview {
  range: ReportRange;
  revenue: RevenueSummary;
  ocupacion: CourtOccupancy[];
  picos: PeakHour[];
  frecuentes: FrequentCustomer[];
}

/** Primer día del mes actual (fecha argentina) en formato YYYY-MM-DD. */
export function firstDayOfMonth(today: string): string {
  return `${today.slice(0, 7)}-01`;
}
