"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSessionContext } from "@/modules/auth/application/session-context";
import {
  UnauthenticatedError,
  AuthorizationError,
} from "@/modules/shared/application/authz";
import {
  createCourtSchema,
  updateCourtSchema,
} from "@/modules/courts/domain/schemas";
import {
  createCourt,
  editCourt,
  removeCourt,
} from "@/modules/courts/application/court-service";
import {
  CourtNotFoundError,
  CourtNameTakenError,
} from "@/modules/courts/domain/court";

export interface ActionState {
  error: string | null;
}

const COURTS_PATH = "/dashboard/canchas";

/**
 * Normaliza el FormData del form de canchas a la forma tipada que espera el
 * schema Zod. Los booleanos vienen de checkboxes (presencia = true); el precio,
 * como string (vacío → null). El schema `.strict()` valida el resto.
 */
function readCourtForm(formData: FormData): Record<string, unknown> {
  const priceRaw = (formData.get("pricePerHour") ?? "").toString().trim();
  const surfaceRaw = (formData.get("surface") ?? "").toString();
  return {
    name: (formData.get("name") ?? "").toString(),
    sport: (formData.get("sport") ?? "").toString(),
    surface: surfaceRaw === "" ? undefined : surfaceRaw,
    indoor: formData.get("indoor") != null,
    isActive: formData.get("isActive") != null,
    pricePerHour: priceRaw === "" ? null : Number(priceRaw),
  };
}

/** Traduce cualquier error a un mensaje seguro para el cliente (sin stack). */
function toActionError(err: unknown): string {
  if (err instanceof CourtNameTakenError) return err.message;
  if (err instanceof CourtNotFoundError) return err.message;
  if (err instanceof AuthorizationError) {
    return "No tenés permiso para administrar canchas.";
  }
  if (err instanceof UnauthenticatedError) {
    return "Tu sesión expiró. Ingresá de nuevo.";
  }
  return "No pudimos guardar la cancha. Intentá nuevamente.";
}

export async function createCourtAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createCourtSchema.safeParse(readCourtForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  try {
    const ctx = await requireSessionContext();
    await createCourt(ctx, parsed.data);
  } catch (err) {
    return { error: toActionError(err) };
  }

  // revalidate + redirect van fuera del try (redirect lanza NEXT_REDIRECT).
  revalidatePath(COURTS_PATH);
  redirect(COURTS_PATH);
}

export async function updateCourtAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = updateCourtSchema.safeParse(readCourtForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  try {
    const ctx = await requireSessionContext();
    await editCourt(ctx, id, parsed.data);
  } catch (err) {
    return { error: toActionError(err) };
  }

  revalidatePath(COURTS_PATH);
  redirect(COURTS_PATH);
}

export async function deleteCourtAction(
  id: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireSessionContext();
    await removeCourt(ctx, id);
  } catch (err) {
    return { error: toActionError(err) };
  }

  revalidatePath(COURTS_PATH);
  redirect(COURTS_PATH);
}
