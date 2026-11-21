import type {
  Reservation,
  NewReservation,
  ReservationStatus,
} from "@/modules/shared/infrastructure/db/schema";

export type { Reservation, NewReservation, ReservationStatus };

/** Etiquetas es-AR para la UI. */
export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  confirmada: "Confirmada",
  cancelada: "Cancelada",
};

/**
 * Errores de dominio. Igual que en courts: "no existe" y "es de otro tenant"
 * devuelven el mismo error (anti-IDOR, no filtramos información).
 */
export class ReservationNotFoundError extends Error {
  constructor() {
    super("Reserva no encontrada.");
    this.name = "ReservationNotFoundError";
  }
}

/** El horario pedido no es un turno válido de esa cancha para esa fecha. */
export class InvalidSlotError extends Error {
  constructor() {
    super("El horario elegido no es un turno válido para esa cancha y fecha.");
    this.name = "InvalidSlotError";
  }
}

/** El turno ya está tomado (lo detecta el EXCLUDE constraint, código 23P01). */
export class SlotUnavailableError extends Error {
  constructor() {
    super("Ese turno ya está reservado. Elegí otro horario.");
    this.name = "SlotUnavailableError";
  }
}

/** La cancha está desactivada: ya no se ofrece. */
export class CourtInactiveError extends Error {
  constructor() {
    super("Esa cancha está desactivada: no se pueden tomar turnos en ella.");
    this.name = "CourtInactiveError";
  }
}

/**
 * Una cancha desactivada no acepta reservas nuevas ni que se muevan turnos a
 * ella. La UI ya las oculta, pero eso no alcanza: la regla vive en el server.
 * Las reservas que ya tenía se conservan.
 */
export function assertCourtBookable(court: { isActive: boolean }): void {
  if (!court.isActive) throw new CourtInactiveError();
}

/** No se puede reservar en el pasado. */
export class PastReservationError extends Error {
  constructor() {
    super("No se puede reservar un turno en el pasado.");
    this.name = "PastReservationError";
  }
}
