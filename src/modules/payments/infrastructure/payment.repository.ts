import { and, eq, inArray, desc, isNotNull, sql } from "drizzle-orm";
import type { DbTx } from "@/modules/shared/infrastructure/db/client";
import { db } from "@/modules/shared/infrastructure/db/client";
import {
  payments,
  reservations,
  courts,
  type Payment,
  type NewPayment,
} from "@/modules/shared/infrastructure/db/schema";
import { ACTIVE_PAYMENT_STATUSES } from "@/modules/payments/domain/payment";

/**
 * Acceso a payments. TODA query filtra explícitamente por `tenant_id` (capa de
 * app) ADEMÁS de la RLS. Drizzle parametrizado.
 */

export async function insertPayment(
  tx: DbTx,
  data: NewPayment,
): Promise<Payment> {
  const rows = await tx.insert(payments).values(data).returning();
  const row = rows[0];
  if (!row) throw new Error("No se pudo crear el pago.");
  return row;
}

export async function findPaymentById(
  tx: DbTx,
  tenantId: string,
  id: string,
): Promise<Payment | null> {
  const rows = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/** Pago vivo (pendiente/aprobado) de una reserva, si existe. */
export async function findActivePaymentByReservation(
  tx: DbTx,
  tenantId: string,
  reservationId: string,
): Promise<Payment | null> {
  const rows = await tx
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.tenantId, tenantId),
        eq(payments.reservationId, reservationId),
        inArray(payments.status, [...ACTIVE_PAYMENT_STATUSES]),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listPaymentsByReservation(
  tx: DbTx,
  tenantId: string,
  reservationId: string,
): Promise<Payment[]> {
  return tx
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.tenantId, tenantId),
        eq(payments.reservationId, reservationId),
      ),
    )
    .orderBy(desc(payments.createdAt));
}

export async function updatePayment(
  tx: DbTx,
  tenantId: string,
  id: string,
  patch: Partial<Omit<NewPayment, "id" | "tenantId" | "reservationId">>,
): Promise<Payment | null> {
  const rows = await tx
    .update(payments)
    .set(patch)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.id, id)))
    .returning();
  return rows[0] ?? null;
}

/**
 * Anula los cobros PENDIENTES de una reserva (al cancelarla). Los aprobados no
 * se tocan: qué hacer con esa plata es política del complejo. Devuelve los ids
 * de preferencia de MP de los anulados, para vencer sus links.
 */
export async function cancelPendingPaymentsForReservation(
  tx: DbTx,
  tenantId: string,
  reservationId: string,
): Promise<string[]> {
  const rows = await tx
    .update(payments)
    .set({ status: "cancelado" })
    .where(
      and(
        eq(payments.tenantId, tenantId),
        eq(payments.reservationId, reservationId),
        eq(payments.status, "pendiente"),
      ),
    )
    .returning({ mpPreferenceId: payments.mpPreferenceId });
  return rows
    .map((r) => r.mpPreferenceId)
    .filter((id): id is string => id !== null);
}

/** Pago recibido que hay que devolver, con el contexto para identificarlo. */
export interface RefundablePayment {
  id: string;
  reservationId: string;
  amountCents: number;
  paidAt: Date;
  mpPaymentId: string | null;
  customerName: string;
  courtName: string;
  startsAt: Date;
}

/**
 * Pagos a devolver: cobros anulados (o de reservas canceladas) que igual se
 * pagaron. Misma condición que `needsRefund` del dominio:
 * status = 'cancelado' Y paid_at no nulo.
 */
export async function listPaymentsNeedingRefund(
  tx: DbTx,
  tenantId: string,
): Promise<RefundablePayment[]> {
  const rows = await tx
    .select({
      id: payments.id,
      reservationId: payments.reservationId,
      amountCents: payments.amountCents,
      paidAt: payments.paidAt,
      mpPaymentId: payments.mpPaymentId,
      customerName: reservations.customerName,
      courtName: courts.name,
      startsAt: reservations.startsAt,
    })
    .from(payments)
    .innerJoin(reservations, eq(reservations.id, payments.reservationId))
    .innerJoin(courts, eq(courts.id, reservations.courtId))
    .where(
      and(
        eq(payments.tenantId, tenantId),
        eq(payments.status, "cancelado"),
        isNotNull(payments.paidAt),
      ),
    )
    .orderBy(desc(payments.paidAt));

  // paid_at no es nulo por el WHERE; el tipo de Drizzle no lo sabe.
  return rows.map((r) => ({ ...r, paidAt: r.paidAt as Date }));
}

/** Cuántos pagos hay que devolver (para el aviso del panel). */
export async function countPaymentsNeedingRefund(
  tx: DbTx,
  tenantId: string,
): Promise<number> {
  const rows = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(payments)
    .where(
      and(
        eq(payments.tenantId, tenantId),
        eq(payments.status, "cancelado"),
        isNotNull(payments.paidAt),
      ),
    );
  return rows[0]?.total ?? 0;
}

/**
 * Resuelve a qué tenant pertenece un pago, para el webhook de MP (que llega sin
 * sesión). Usa la función SECURITY DEFINER `resolve_payment_tenant`, que
 * devuelve SOLO el tenant_id y nada más (ver migración 0011).
 *
 * Se invoca únicamente DESPUÉS de verificar la firma de la notificación.
 */
export async function resolvePaymentTenant(
  paymentId: string,
): Promise<string | null> {
  const result = await db.execute<{ tenant_id: string | null }>(
    sql`select resolve_payment_tenant(${paymentId}::uuid) as tenant_id`,
  );
  const rows = result as unknown as Array<{ tenant_id: string | null }>;
  return rows[0]?.tenant_id ?? null;
}
