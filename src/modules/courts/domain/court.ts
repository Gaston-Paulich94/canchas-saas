import {
  courtSport,
  type Court,
  type NewCourt,
  type CourtSport,
} from "@/modules/shared/infrastructure/db/schema";

export type { Court, NewCourt, CourtSport };

/** Deportes disponibles (mismo orden que el enum de la DB). */
export const COURT_SPORTS = courtSport.enumValues;

/** Etiquetas es-AR para la UI. Fuente única para labels de deporte. */
export const SPORT_LABELS: Record<CourtSport, string> = {
  padel: "Pádel",
  futbol5: "Fútbol 5",
  futbol11: "Fútbol 11",
  tenis: "Tenis",
};

/**
 * Error de dominio: recurso inexistente PARA ESTE TENANT. El service lo lanza
 * cuando un id no matchea ninguna fila del tenant en contexto (anti-IDOR): no
 * distinguimos "no existe" de "es de otro tenant" para no filtrar información.
 */
export class CourtNotFoundError extends Error {
  constructor() {
    super("Cancha no encontrada.");
    this.name = "CourtNotFoundError";
  }
}

/**
 * Error de dominio: ya existe una cancha con ese nombre en el complejo (viola el
 * unique (tenant_id, name)). Mensaje accionable para el usuario, sin filtrar SQL.
 */
export class CourtNameTakenError extends Error {
  constructor() {
    super("Ya existe una cancha con ese nombre en el complejo.");
    this.name = "CourtNameTakenError";
  }
}

/**
 * La cancha tiene reservas (historial y, quizás, pagos): no se puede borrar.
 * El mensaje propone la salida correcta, que es desactivarla.
 */
export class CourtHasHistoryError extends Error {
  constructor() {
    super(
      "Esta cancha tiene reservas registradas y no se puede eliminar sin perder el historial. Desactivala para que deje de ofrecerse.",
    );
    this.name = "CourtHasHistoryError";
  }
}
