import { withTenant } from "@/modules/shared/infrastructure/db/with-tenant";
import {
  findPaymentById,
  findActivePaymentByReservation,
  updatePayment,
  resolvePaymentTenant,
} from "@/modules/payments/infrastructure/payment.repository";
import { getMpAccessToken } from "@/modules/payments/infrastructure/mp-credentials";
import { getPayment } from "@/modules/payments/infrastructure/mp-client";
import { findReservationById } from "@/modules/reservations/infrastructure/reservation.repository";
import {
  PaymentNotFoundError,
  checkPaymentMatches,
  decidePaymentUpdate,
  type PaymentMismatchReason,
} from "@/modules/payments/domain/payment";

/**
 * Procesamiento de una notificación de pago de Mercado Pago.
 *
 * PRE-CONDICIÓN: la firma HMAC ya fue verificada por el route handler. Esta
 * función no se invoca nunca con una notificación no verificada.
 *
 * El webhook llega SIN sesión, así que el flujo es:
 *  1. `paymentRef` (nuestro uuid, que nosotros mismos pusimos en la
 *     notification_url) → tenant, vía la función SECURITY DEFINER acotada.
 *  2. Con el tenant, todo el resto corre en withTenant() (RLS activa).
 *  3. Se consulta el pago REAL a la API de MP con el token del complejo: el
 *     cuerpo del webhook nunca define el estado.
 *  4. Se verifica que la notificación corresponda EXACTAMENTE a nuestro pago:
 *     misma referencia (obligatoria) Y mismo importe (y moneda, si viene). Si
 *     algo no coincide, NO se acredita: se descarta la notificación.
 *  5. `decidePaymentUpdate` define el impacto. Si el cobro ya no estaba
 *     vigente (anulado, reserva cancelada u otro link vivo), un pago que llega
 *     NO lo reactiva: se registra como plata a devolver. Idempotente: la misma
 *     notificación reenviada no cambia nada.
 */

export interface NotificationResult {
  status: "actualizado" | "sin_cambios" | "ignorado";
  /** Por qué se descartó, cuando `status` es "ignorado". */
  motivo?: PaymentMismatchReason | "referencia_desconocida";
  /** Se registró un pago tardío que hay que devolver. */
  requiereReembolso?: boolean;
}

export async function processPaymentNotification(
  paymentRef: string,
  mpPaymentId: string,
): Promise<NotificationResult> {
  const tenantId = await resolvePaymentTenant(paymentRef);
  // Referencia desconocida: no revelamos nada, simplemente se ignora.
  if (!tenantId) {
    return { status: "ignorado", motivo: "referencia_desconocida" };
  }

  // Token del complejo (descifrado en memoria) para consultar la API de MP.
  const accessToken = await withTenant(tenantId, (tx) =>
    getMpAccessToken(tx, tenantId),
  );

  // Fuente de verdad: el pago tal como lo ve Mercado Pago.
  const snapshot = await getPayment(accessToken, mpPaymentId);

  return withTenant(tenantId, async (tx) => {
    const payment = await findPaymentById(tx, tenantId, paymentRef);
    if (!payment) throw new PaymentNotFoundError();

    // La notificación tiene que corresponder EXACTAMENTE a este pago: misma
    // referencia y mismo importe. Si no, no se acredita nada.
    const mismatch = checkPaymentMatches(
      { id: payment.id, amountCents: payment.amountCents },
      snapshot,
    );
    if (mismatch) return { status: "ignorado" as const, motivo: mismatch };

    // ¿El cobro sigue vigente? Si no, un pago que llega es un pago tardío.
    const reservation = await findReservationById(
      tx,
      tenantId,
      payment.reservationId,
    );
    const activo = await findActivePaymentByReservation(
      tx,
      tenantId,
      payment.reservationId,
    );

    const decision = decidePaymentUpdate(payment, snapshot, {
      reservaCancelada: reservation?.status === "cancelada",
      otroCobroActivo: activo !== null && activo.id !== payment.id,
    });
    if (decision.kind === "sin_cambios") {
      return { status: "sin_cambios" as const };
    }

    await updatePayment(tx, tenantId, payment.id, decision.patch);
    return {
      status: "actualizado" as const,
      requiereReembolso: decision.requiereReembolso,
    };
  });
}
