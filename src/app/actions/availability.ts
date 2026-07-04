"use server";

import { revalidatePath } from "next/cache";
import { requireSessionContext } from "@/modules/auth/application/session-context";
import {
  UnauthenticatedError,
  AuthorizationError,
} from "@/modules/shared/application/authz";
import {
  createAvailabilitySchema,
  slotDurationSchema,
} from "@/modules/availability/domain/schemas";
import {
  addAvailability,
  removeAvailability,
  setSlotDuration,
} from "@/modules/availability/application/availability-service";
import {
  AvailabilityNotFoundError,
  AvailabilityOverlapError,
} from "@/modules/availability/domain/availability";
import { CourtNotFoundError } from "@/modules/courts/domain/court";

export interface ActionState {
  error: string | null;
}

const ok: ActionState = { error: null };

function pathFor(courtId: string): string {
  return `/dashboard/canchas/${courtId}/disponibilidad`;
}

function toActionError(err: unknown): string {
  if (err instanceof AvailabilityOverlapError) return err.message;
  if (err instanceof AvailabilityNotFoundError) return err.message;
  if (err instanceof CourtNotFoundError) return err.message;
  if (err instanceof AuthorizationError) {
    return "No tenés permiso para editar la disponibilidad.";
  }
  if (err instanceof UnauthenticatedError) {
    return "Tu sesión expiró. Ingresá de nuevo.";
  }
  return "No pudimos guardar los cambios. Intentá nuevamente.";
}

export async function addAvailabilityAction(
  courtId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const dayRaw = (formData.get("dayOfWeek") ?? "").toString().trim();
  const parsed = createAvailabilitySchema.safeParse({
    dayOfWeek: dayRaw === "" ? NaN : Number(dayRaw),
    openTime: (formData.get("openTime") ?? "").toString(),
    closeTime: (formData.get("closeTime") ?? "").toString(),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  try {
    const ctx = await requireSessionContext();
    await addAvailability(ctx, courtId, parsed.data);
  } catch (err) {
    return { error: toActionError(err) };
  }

  revalidatePath(pathFor(courtId));
  return ok;
}

export async function removeAvailabilityAction(
  courtId: string,
  availabilityId: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireSessionContext();
    await removeAvailability(ctx, availabilityId);
  } catch (err) {
    return { error: toActionError(err) };
  }

  revalidatePath(pathFor(courtId));
  return ok;
}

export async function setSlotDurationAction(
  courtId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const raw = (formData.get("slotDurationMin") ?? "").toString().trim();
  const parsed = slotDurationSchema.safeParse({
    slotDurationMin: raw === "" ? NaN : Number(raw),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  try {
    const ctx = await requireSessionContext();
    await setSlotDuration(ctx, courtId, parsed.data);
  } catch (err) {
    return { error: toActionError(err) };
  }

  revalidatePath(pathFor(courtId));
  return ok;
}
