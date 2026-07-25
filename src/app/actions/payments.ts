"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSessionContext } from "@/modules/auth/application/session-context";
import {
  UnauthenticatedError,
  AuthorizationError,
} from "@/modules/shared/application/authz";
import {
  startMpConnection,
  disconnectMp,
} from "@/modules/payments/application/mp-connection";
import {
  createPaymentLink,
  cancelPayment,
} from "@/modules/payments/application/payment-service";
import {
  MpNotConnectedError,
  CourtPriceMissingError,
  PaymentAlreadyExistsError,
  ReservationNotPayableError,
  PaymentNotFoundError,
  MpApiError,
} from "@/modules/payments/domain/payment";
import { ReservationNotFoundError } from "@/modules/reservations/domain/reservation";
import { CourtNotFoundError } from "@/modules/courts/domain/court";

export interface ActionState {
  error: string | null;
}

const PAGOS_PATH = "/dashboard/pagos";

function toActionError(err: unknown): string {
  if (err instanceof MpNotConnectedError) return err.message;
  if (err instanceof CourtPriceMissingError) return err.message;
  if (err instanceof PaymentAlreadyExistsError) return err.message;
  if (err instanceof ReservationNotPayableError) return err.message;
  if (err instanceof PaymentNotFoundError) return err.message;
  if (err instanceof ReservationNotFoundError) return err.message;
  if (err instanceof CourtNotFoundError) return err.message;
  if (err instanceof MpApiError) {
    return "No pudimos conectarnos con Mercado Pago. Probá de nuevo en un momento.";
  }
  if (err instanceof AuthorizationError) {
    return "No tenés permiso para gestionar los cobros.";
  }
  if (err instanceof UnauthenticatedError) {
    return "Tu sesión expiró. Ingresá de nuevo.";
  }
  return "No pudimos completar la operación. Intentá nuevamente.";
}

/** Inicia el OAuth: deja el state en cookie y manda a Mercado Pago. */
export async function connectMpAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  let authUrl: string;
  try {
    const ctx = await requireSessionContext();
    authUrl = await startMpConnection(ctx);
  } catch (err) {
    return { error: toActionError(err) };
  }
  redirect(authUrl);
}

export async function disconnectMpAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireSessionContext();
    await disconnectMp(ctx);
  } catch (err) {
    return { error: toActionError(err) };
  }
  revalidatePath(PAGOS_PATH);
  redirect(PAGOS_PATH);
}

/** Genera el link de pago de una reserva (importe calculado en el backend). */
export async function createPaymentLinkAction(
  reservationId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireSessionContext();
    await createPaymentLink(ctx, reservationId);
  } catch (err) {
    return { error: toActionError(err) };
  }
  revalidatePath(`/dashboard/reservas/${reservationId}`);
  return { error: null };
}

export async function cancelPaymentAction(
  reservationId: string,
  paymentId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireSessionContext();
    await cancelPayment(ctx, paymentId);
  } catch (err) {
    return { error: toActionError(err) };
  }
  revalidatePath(`/dashboard/reservas/${reservationId}`);
  return { error: null };
}
