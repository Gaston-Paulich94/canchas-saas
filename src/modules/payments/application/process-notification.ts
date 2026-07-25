import { withTenant } from "@/modules/shared/infrastructure/db/with-tenant";
import {
  findPaymentById,
  updatePayment,
  resolvePaymentTenant,
} from "@/modules/payments/infrastructure/payment.repository";
import { getMpAccessToken } from "@/modules/payments/infrastructure/mp-credentials";
import { getPayment } from "@/modules/payments/infrastructure/mp-client";
import { PaymentNotFoundError } from "@/modules/payments/domain/payment";

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
 *  4. Se valida que el `external_reference` que devuelve MP coincida con
 *     nuestro pago (si no, la notificación no es de esta fila: se descarta).
 *  5. Idempotencia: si ya está registrado ese mp_payment_id con el mismo
 *     estado, no se hace nada.
 */

export interface NotificationResult {
  status: "actualizado" | "sin_cambios" | "ignorado";
}

export async function processPaymentNotification(
  paymentRef: string,
  mpPaymentId: string,
): Promise<NotificationResult> {
  const tenantId = await resolvePaymentTenant(paymentRef);
  // Referencia desconocida: no revelamos nada, simplemente se ignora.
  if (!tenantId) return { status: "ignorado" };

  // Token del complejo (descifrado en memoria) para consultar la API de MP.
  const accessToken = await withTenant(tenantId, (tx) =>
    getMpAccessToken(tx, tenantId),
  );

  // Fuente de verdad: el pago tal como lo ve Mercado Pago.
  const snapshot = await getPayment(accessToken, mpPaymentId);

  // La notificación tiene que corresponder a NUESTRO pago.
  if (
    snapshot.externalReference &&
    snapshot.externalReference !== paymentRef
  ) {
    return { status: "ignorado" };
  }

  return withTenant(tenantId, async (tx) => {
    const payment = await findPaymentById(tx, tenantId, paymentRef);
    if (!payment) throw new PaymentNotFoundError();

    // Idempotencia: misma notificación reenviada => no-op.
    if (
      payment.mpPaymentId === snapshot.mpPaymentId &&
      payment.status === snapshot.status
    ) {
      return { status: "sin_cambios" as const };
    }

    await updatePayment(tx, tenantId, payment.id, {
      mpPaymentId: snapshot.mpPaymentId,
      status: snapshot.status,
      paidAt: snapshot.status === "aprobado" ? (snapshot.approvedAt ?? new Date()) : null,
    });

    return { status: "actualizado" as const };
  });
}
