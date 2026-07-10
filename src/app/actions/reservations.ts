"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSessionContext } from "@/modules/auth/application/session-context";
import {
  UnauthenticatedError,
  AuthorizationError,
} from "@/modules/shared/application/authz";
import {
  createReservationSchema,
  rescheduleReservationSchema,
} from "@/modules/reservations/domain/schemas";
import {
  createReservation,
  rescheduleReservation,
  cancelReservation,
} from "@/modules/reservations/application/reservation-service";
import {
  ReservationNotFoundError,
  InvalidSlotError,
  SlotUnavailableError,
  PastReservationError,
} from "@/modules/reservations/domain/reservation";
import { CourtNotFoundError } from "@/modules/courts/domain/court";

export interface ActionState {
  error: string | null;
}

const RESERVAS_PATH = "/dashboard/reservas";

/** Traduce errores a mensajes seguros para el cliente (sin detalle interno). */
function toActionError(err: unknown): string {
  if (err instanceof SlotUnavailableError) return err.message;
  if (err instanceof InvalidSlotError) return err.message;
  if (err instanceof PastReservationError) return err.message;
  if (err instanceof ReservationNotFoundError) return err.message;
  if (err instanceof CourtNotFoundError) return err.message;
  if (err instanceof AuthorizationError) {
    return "No tenés permiso para gestionar reservas.";
  }
  if (err instanceof UnauthenticatedError) {
    return "Tu sesión expiró. Ingresá de nuevo.";
  }
  return "No pudimos guardar la reserva. Intentá nuevamente.";
}

function str(formData: FormData, key: string): string {
  return (formData.get(key) ?? "").toString();
}

export async function createReservationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const surfacePhone = str(formData, "customerPhone").trim();
  const surfaceNotes = str(formData, "notes").trim();
  const parsed = createReservationSchema.safeParse({
    courtId: str(formData, "courtId"),
    date: str(formData, "date"),
    startTime: str(formData, "startTime"),
    customerName: str(formData, "customerName"),
    customerPhone: surfacePhone === "" ? undefined : surfacePhone,
    notes: surfaceNotes === "" ? undefined : surfaceNotes,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  try {
    const ctx = await requireSessionContext();
    await createReservation(ctx, parsed.data);
  } catch (err) {
    return { error: toActionError(err) };
  }

  revalidatePath(RESERVAS_PATH);
  redirect(`${RESERVAS_PATH}?fecha=${parsed.data.date}`);
}

export async function rescheduleReservationAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = rescheduleReservationSchema.safeParse({
    courtId: str(formData, "courtId"),
    date: str(formData, "date"),
    startTime: str(formData, "startTime"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  try {
    const ctx = await requireSessionContext();
    await rescheduleReservation(ctx, id, parsed.data);
  } catch (err) {
    return { error: toActionError(err) };
  }

  revalidatePath(RESERVAS_PATH);
  redirect(`${RESERVAS_PATH}?fecha=${parsed.data.date}`);
}

export async function cancelReservationAction(
  id: string,
  returnDate: string | null,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireSessionContext();
    await cancelReservation(ctx, id);
  } catch (err) {
    return { error: toActionError(err) };
  }

  revalidatePath(RESERVAS_PATH);
  redirect(
    returnDate && /^\d{4}-\d{2}-\d{2}$/.test(returnDate)
      ? `${RESERVAS_PATH}?fecha=${returnDate}`
      : RESERVAS_PATH,
  );
}
