import type {
  Payment,
  NewPayment,
  PaymentStatus,
} from "@/modules/shared/infrastructure/db/schema";

export type { Payment, NewPayment, PaymentStatus };

/** Etiquetas es-AR para la UI. */
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pendiente: "Pendiente",
  aprobado: "Aprobado",
  rechazado: "Rechazado",
  reembolsado: "Reembolsado",
  cancelado: "Cancelado",
};

/** Estados que ocupan el "cupo" de pago vivo de una reserva. */
export const ACTIVE_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "pendiente",
  "aprobado",
];

/**
 * Mapea el status de un pago de Mercado Pago al nuestro.
 * Fail-closed: cualquier estado desconocido cae en "pendiente" — nunca se
 * asume "aprobado" por defecto.
 */
export function mapMpStatus(mpStatus: string): PaymentStatus {
  switch (mpStatus) {
    case "approved":
      return "aprobado";
    case "rejected":
      return "rechazado";
    case "refunded":
    case "charged_back":
      return "reembolsado";
    case "cancelled":
      return "cancelado";
    case "pending":
    case "in_process":
    case "in_mediation":
    case "authorized":
      return "pendiente";
    default:
      return "pendiente";
  }
}

/**
 * Monto a cobrar por una reserva, en CENTAVOS.
 *
 * Se calcula SIEMPRE en el backend a partir del precio por hora de la cancha y
 * la duración real del turno: el importe nunca viene del cliente.
 * `pricePerHour` está en pesos enteros (ARS).
 */
export function computeAmountCents(
  pricePerHour: number,
  durationMinutes: number,
): number {
  if (!Number.isFinite(pricePerHour) || pricePerHour <= 0) {
    throw new CourtPriceMissingError();
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error("Duración de turno inválida.");
  }
  return Math.round((pricePerHour * 100 * durationMinutes) / 60);
}

/** Comisión del marketplace, en centavos. Nunca supera el total. */
export function computeFeeCents(
  amountCents: number,
  feePercent: number,
): number {
  if (!Number.isFinite(feePercent) || feePercent <= 0) return 0;
  const fee = Math.round((amountCents * feePercent) / 100);
  return Math.min(Math.max(fee, 0), amountCents);
}

/** Centavos → string para mostrar (es-AR). */
export function formatArs(cents: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

// ── Errores de dominio ───────────────────────────────────────────────────────

/** El complejo todavía no conectó su cuenta de Mercado Pago. */
export class MpNotConnectedError extends Error {
  constructor() {
    super("El complejo todavía no conectó su cuenta de Mercado Pago.");
    this.name = "MpNotConnectedError";
  }
}

/** La cancha no tiene precio por hora cargado: no se puede cobrar. */
export class CourtPriceMissingError extends Error {
  constructor() {
    super("La cancha no tiene precio por hora cargado.");
    this.name = "CourtPriceMissingError";
  }
}

/** La reserva no admite cobro (por ejemplo, está cancelada). */
export class ReservationNotPayableError extends Error {
  constructor() {
    super("La reserva no admite un cobro en este estado.");
    this.name = "ReservationNotPayableError";
  }
}

/** Ya existe un pago vivo (pendiente o aprobado) para esa reserva. */
export class PaymentAlreadyExistsError extends Error {
  constructor() {
    super("Esa reserva ya tiene un pago pendiente o aprobado.");
    this.name = "PaymentAlreadyExistsError";
  }
}

export class PaymentNotFoundError extends Error {
  constructor() {
    super("Pago no encontrado.");
    this.name = "PaymentNotFoundError";
  }
}

/** Falla al hablar con la API de Mercado Pago. Nunca acredita nada. */
export class MpApiError extends Error {
  constructor(message = "Error comunicándose con Mercado Pago.") {
    super(message);
    this.name = "MpApiError";
  }
}

/** Firma del webhook inválida, ausente o fuera de la ventana temporal. */
export class InvalidWebhookSignatureError extends Error {
  constructor() {
    super("Firma de webhook inválida.");
    this.name = "InvalidWebhookSignatureError";
  }
}
