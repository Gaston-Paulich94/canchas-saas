import { env } from "@/env";
import { withTenant } from "@/modules/shared/infrastructure/db/with-tenant";
import { assertRole } from "@/modules/shared/application/authz";
import { ROLES, type SessionContext } from "@/modules/auth/domain/roles";
import { isUniqueViolation } from "@/modules/shared/infrastructure/db/pg-errors";
import { findCourtById } from "@/modules/courts/infrastructure/court.repository";
import { CourtNotFoundError } from "@/modules/courts/domain/court";
import { findReservationById } from "@/modules/reservations/infrastructure/reservation.repository";
import { ReservationNotFoundError } from "@/modules/reservations/domain/reservation";
import {
  computeAmountCents,
  computeFeeCents,
  CourtPriceMissingError,
  MpApiError,
  PaymentAlreadyExistsError,
  PaymentNotFoundError,
  ReservationNotPayableError,
  type Payment,
} from "@/modules/payments/domain/payment";
import {
  insertPayment,
  findPaymentById,
  findActivePaymentByReservation,
  listPaymentsByReservation,
  updatePayment,
} from "@/modules/payments/infrastructure/payment.repository";
import { getMpAccessToken } from "@/modules/payments/infrastructure/mp-credentials";
import { createPreference } from "@/modules/payments/infrastructure/mp-client";

/**
 * Cobro de una reserva vía Checkout Pro (la plata cae en la cuenta del complejo,
 * menos la comisión del marketplace).
 *
 * Reglas de esta capa:
 *  - authz owner|staff antes de tocar nada;
 *  - la reserva se valida contra el tenant de la sesión (anti-IDOR);
 *  - el IMPORTE lo calcula el backend desde el precio de la cancha y la
 *    duración real del turno: jamás llega del cliente;
 *  - nunca se hace una llamada HTTP dentro de una transacción de DB;
 *  - si Mercado Pago falla, el pago queda CANCELADO (fail-closed): no se
 *    bloquea la reserva ni se acredita nada.
 */

const MANAGE_ROLES = [ROLES.OWNER, ROLES.STAFF] as const;

export interface PaymentLink {
  payment: Payment;
  initPoint: string;
}

/** URL de notificación: lleva NUESTRO id de pago como puntero (`payment_ref`). */
function notificationUrlFor(paymentId: string): string {
  const url = new URL("/api/mp/webhooks/payment", env.APP_PUBLIC_URL);
  url.searchParams.set("payment_ref", paymentId);
  return url.toString();
}

export async function getReservationPayments(
  ctx: SessionContext,
  reservationId: string,
): Promise<Payment[]> {
  assertRole(ctx, MANAGE_ROLES);
  return withTenant(ctx.tenantId, (tx) =>
    listPaymentsByReservation(tx, ctx.tenantId, reservationId),
  );
}

/**
 * Genera el link de pago de una reserva.
 *
 * Paso 1 (tx): valida reserva/cancha del tenant, calcula el importe y crea la
 *              fila `payments` en estado pendiente (su uuid es el
 *              external_reference que ata la notificación).
 * Paso 2 (sin tx): crea la preferencia en Mercado Pago.
 * Paso 3 (tx): guarda el preference id; si el paso 2 falló, cancela el pago.
 */
export async function createPaymentLink(
  ctx: SessionContext,
  reservationId: string,
): Promise<PaymentLink> {
  assertRole(ctx, MANAGE_ROLES);

  const { payment, title, accessToken } = await withTenant(
    ctx.tenantId,
    async (tx) => {
      const reservation = await findReservationById(
        tx,
        ctx.tenantId,
        reservationId,
      );
      if (!reservation) throw new ReservationNotFoundError();
      if (reservation.status === "cancelada") {
        throw new ReservationNotPayableError();
      }

      const existing = await findActivePaymentByReservation(
        tx,
        ctx.tenantId,
        reservationId,
      );
      if (existing) throw new PaymentAlreadyExistsError();

      const court = await findCourtById(tx, ctx.tenantId, reservation.courtId);
      if (!court) throw new CourtNotFoundError();
      if (court.pricePerHour == null) throw new CourtPriceMissingError();

      const durationMinutes = Math.round(
        (reservation.endsAt.getTime() - reservation.startsAt.getTime()) / 60000,
      );
      const amountCents = computeAmountCents(
        court.pricePerHour,
        durationMinutes,
      );
      const feeCents = computeFeeCents(
        amountCents,
        env.MP_MARKETPLACE_FEE_PERCENT,
      );

      // Se descifra acá y se usa fuera de la tx; nunca se persiste ni loguea.
      const token = await getMpAccessToken(tx, ctx.tenantId);

      let created: Payment;
      try {
        created = await insertPayment(tx, {
          tenantId: ctx.tenantId,
          reservationId,
          amountCents,
          feeCents,
        });
      } catch (err) {
        // Carrera: otro operador generó un link para la misma reserva.
        if (isUniqueViolation(err)) throw new PaymentAlreadyExistsError();
        throw err;
      }

      return {
        payment: created,
        title: `${court.name} · ${reservation.customerName}`,
        accessToken: token,
      };
    },
  );

  // Llamada externa FUERA de la transacción (no bloquea la DB).
  let preference: { id: string; initPoint: string };
  try {
    preference = await createPreference({
      accessToken,
      externalReference: payment.id,
      title,
      amountCents: payment.amountCents,
      feeCents: payment.feeCents,
      notificationUrl: notificationUrlFor(payment.id),
      successUrl: new URL(
        `/dashboard/reservas/${reservationId}`,
        env.APP_PUBLIC_URL,
      ).toString(),
    });
  } catch (err) {
    // Fail-closed: liberamos el cupo de pago vivo de la reserva.
    await withTenant(ctx.tenantId, (tx) =>
      updatePayment(tx, ctx.tenantId, payment.id, { status: "cancelado" }),
    );
    throw err instanceof MpApiError ? err : new MpApiError();
  }

  const updated = await withTenant(ctx.tenantId, (tx) =>
    updatePayment(tx, ctx.tenantId, payment.id, {
      mpPreferenceId: preference.id,
    }),
  );
  if (!updated) throw new PaymentNotFoundError();

  return { payment: updated, initPoint: preference.initPoint };
}

/** Cancela un pago pendiente (por ejemplo, si se cobró en efectivo). */
export async function cancelPayment(
  ctx: SessionContext,
  paymentId: string,
): Promise<Payment> {
  assertRole(ctx, MANAGE_ROLES);
  return withTenant(ctx.tenantId, async (tx) => {
    const payment = await findPaymentById(tx, ctx.tenantId, paymentId);
    if (!payment) throw new PaymentNotFoundError();
    if (payment.status !== "pendiente") {
      throw new ReservationNotPayableError();
    }
    const updated = await updatePayment(tx, ctx.tenantId, paymentId, {
      status: "cancelado",
    });
    if (!updated) throw new PaymentNotFoundError();
    return updated;
  });
}
