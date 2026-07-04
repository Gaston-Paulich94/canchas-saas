import type {
  CourtAvailability,
  NewCourtAvailability,
} from "@/modules/shared/infrastructure/db/schema";

export type { CourtAvailability, NewCourtAvailability };

/** Un turno reservable calculado (no persistido en Fase 3). */
export interface Slot {
  /** "HH:MM" inclusivo. */
  start: string;
  /** "HH:MM" exclusivo. */
  end: string;
}

/**
 * Días de la semana. Índice = valor guardado en day_of_week (0 = Domingo, según
 * Date.getDay). El orden de presentación (lunes primero) se resuelve en la UI.
 */
export const DAY_LABELS: readonly string[] = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];

/** Orden es-AR para mostrar la semana (lunes → domingo). */
export const WEEK_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

/** Error de dominio: la ventana de disponibilidad no existe para este tenant. */
export class AvailabilityNotFoundError extends Error {
  constructor() {
    super("Franja horaria no encontrada.");
    this.name = "AvailabilityNotFoundError";
  }
}

/** Error de dominio: la ventana se solapa con otra existente (EXCLUDE constraint). */
export class AvailabilityOverlapError extends Error {
  constructor() {
    super("La franja se solapa con otra ya cargada para ese día.");
    this.name = "AvailabilityOverlapError";
  }
}
