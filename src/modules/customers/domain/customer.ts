import type {
  Customer,
  NewCustomer,
} from "@/modules/shared/infrastructure/db/schema";

export type { Customer, NewCustomer };

/**
 * Errores de dominio. "No existe" y "es de otro tenant" devuelven el mismo
 * error (anti-IDOR, no filtramos información).
 */
export class CustomerNotFoundError extends Error {
  constructor() {
    super("Cliente no encontrado.");
    this.name = "CustomerNotFoundError";
  }
}

/** Ya existe un cliente con ese teléfono en el complejo (unique parcial). */
export class PhoneTakenError extends Error {
  constructor() {
    super("Ya existe un cliente con ese teléfono.");
    this.name = "PhoneTakenError";
  }
}
