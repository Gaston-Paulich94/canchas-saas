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

// ── Correspondencia entre la notificación de MP y nuestro pago ───────────────

/** Por qué una notificación NO corresponde al pago que dice referenciar. */
export type PaymentMismatchReason = "referencia" | "importe" | "moneda";

/** Lo que esperamos cobrar (fila nuestra). */
export interface ExpectedPayment {
  id: string;
  amountCents: number;
}

/** Lo que Mercado Pago dice que se pagó (consultado a su API). */
export interface NotifiedPayment {
  externalReference: string | null;
  amountCents: number | null;
  currencyId: string | null;
}

/**
 * Verifica que una notificación corresponda EXACTAMENTE a nuestro pago, antes
 * de darlo por aprobado. Devuelve el motivo del rechazo, o null si coincide.
 *
 * Es el control que evita acreditar una reserva con un pago que no es el suyo:
 *  - `referencia`: exige que el external_reference sea nuestro id. Se rechaza
 *    también si viene vacío (fail-closed): un pago hecho por fuera del sistema,
 *    en la misma cuenta del complejo, no tiene referencia nuestra y no debe
 *    acreditar nada.
 *  - `importe`: el monto informado por MP tiene que ser el que calculamos. Lo
 *    recalcula el backend, así que una diferencia es señal de manipulación o de
 *    un cambio de precio a mitad de camino.
 *  - `moneda`: si MP informa moneda, tiene que ser ARS. Si no la informa no se
 *    rechaza por eso: la referencia y el importe ya acotan el riesgo, y
 *    bloquear por un campo ausente dejaría pagos reales sin acreditar.
 */
export function checkPaymentMatches(
  expected: ExpectedPayment,
  notified: NotifiedPayment,
): PaymentMismatchReason | null {
  if (!notified.externalReference || notified.externalReference !== expected.id) {
    return "referencia";
  }
  if (
    notified.amountCents === null ||
    notified.amountCents !== expected.amountCents
  ) {
    return "importe";
  }
  if (notified.currencyId !== null && notified.currencyId !== "ARS") {
    return "moneda";
  }
  return null;
}

// ── Qué hacer con una notificación (ya verificada y correspondida) ───────────

/** Estado local del pago, tal como está en nuestra base. */
export interface LocalPaymentState {
  status: PaymentStatus;
  mpPaymentId: string | null;
  paidAt: Date | null;
}

/** Estado actual del pago según la API de Mercado Pago. */
export interface RemotePaymentState {
  status: PaymentStatus;
  mpPaymentId: string;
  approvedAt: Date | null;
}

export interface NotificationContext {
  /** La reserva del pago está cancelada. */
  reservaCancelada: boolean;
  /** Existe OTRO pago vivo (pendiente/aprobado) para la misma reserva. */
  otroCobroActivo: boolean;
}

export type PaymentPatch = {
  status: PaymentStatus;
  mpPaymentId: string;
  paidAt: Date | null;
};

export type NotificationDecision =
  | { kind: "sin_cambios" }
  | { kind: "actualizar"; patch: PaymentPatch; requiereReembolso: boolean };

/**
 * Decide cómo impacta una notificación de MP en nuestro pago.
 *
 * El caso delicado es el PAGO TARDÍO: el link se paga cuando el cobro ya no
 * correspondía (el operador lo anuló, la reserva se canceló, o ya hay otro
 * link vivo para la misma reserva). Antes, el webhook igual lo pasaba a
 * "aprobado", lo que (a) aprobaba en silencio un cobro anulado y (b) si había
 * otro link vivo chocaba con el índice único de "un pago vivo por reserva":
 * 500, MP reintentando para siempre y el pago NUNCA registrado.
 *
 * Ahora un pago tardío no se reactiva nunca: queda "cancelado" con su
 * `mpPaymentId` y `paidAt`, que es la marca de "plata recibida que hay que
 * devolver" (ver `needsRefund`). No se reembolsa automáticamente: devolver
 * plata es decisión del complejo. Si después MP informa el reembolso, el pago
 * pasa a "reembolsado" y la marca se resuelve sola.
 */
export function decidePaymentUpdate(
  local: LocalPaymentState,
  remote: RemotePaymentState,
  ctx: NotificationContext,
  now: Date = new Date(),
): NotificationDecision {
  const remoteActivo = ACTIVE_PAYMENT_STATUSES.includes(remote.status);
  // "Anulado" es una decisión NUESTRA. "rechazado" no: lo pone MP cuando falla
  // un intento, y el cliente puede reintentar con el mismo link.
  const anulado = local.status === "cancelado" || local.status === "reembolsado";
  // MP reenvía varias notificaciones por el mismo pago. Si ya lo teníamos
  // aprobado, sigue siéndolo aunque la reserva se haya cancelado después:
  // qué hacer con esa plata es política del complejo, no del webhook.
  const yaAprobado =
    local.status === "aprobado" && local.mpPaymentId === remote.mpPaymentId;
  const puedeActivarse =
    yaAprobado || (!anulado && !ctx.reservaCancelada && !ctx.otroCobroActivo);

  let patch: PaymentPatch;
  let requiereReembolso = false;

  if (remoteActivo && !puedeActivarse) {
    // Pendiente en MP no movió plata: no hay nada que registrar.
    if (remote.status !== "aprobado") return { kind: "sin_cambios" };
    patch = {
      status: "cancelado",
      mpPaymentId: remote.mpPaymentId,
      paidAt: remote.approvedAt ?? now,
    };
    requiereReembolso = true;
  } else if (local.status === "cancelado" && remote.status !== "reembolsado") {
    // Anulado y MP dice rechazado/cancelado: no entró plata, nada que hacer.
    return { kind: "sin_cambios" };
  } else {
    patch = {
      status: remote.status,
      mpPaymentId: remote.mpPaymentId,
      paidAt:
        remote.status === "aprobado"
          ? (remote.approvedAt ?? now)
          : remote.status === "reembolsado"
            ? local.paidAt // se conserva cuándo se había cobrado
            : null,
    };
  }

  // Idempotencia: la misma notificación reenviada no cambia nada.
  if (local.status === patch.status && local.mpPaymentId === patch.mpPaymentId) {
    return { kind: "sin_cambios" };
  }
  return { kind: "actualizar", patch, requiereReembolso };
}

/**
 * Plata recibida que hay que devolver: un cobro anulado (o de una reserva
 * cancelada) que igual se pagó. Solo `decidePaymentUpdate` produce esta
 * combinación: un anulado normal nunca tiene `paidAt`.
 */
export function needsRefund(payment: {
  status: PaymentStatus;
  paidAt: Date | null;
}): boolean {
  return payment.status === "cancelado" && payment.paidAt !== null;
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
