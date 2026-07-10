"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSessionContext } from "@/modules/auth/application/session-context";
import {
  UnauthenticatedError,
  AuthorizationError,
} from "@/modules/shared/application/authz";
import {
  createCustomerSchema,
  updateCustomerSchema,
} from "@/modules/customers/domain/schemas";
import {
  createCustomer,
  editCustomer,
  removeCustomer,
} from "@/modules/customers/application/customer-service";
import {
  CustomerNotFoundError,
  PhoneTakenError,
} from "@/modules/customers/domain/customer";

export interface ActionState {
  error: string | null;
}

const CLIENTES_PATH = "/dashboard/clientes";

function toActionError(err: unknown): string {
  if (err instanceof PhoneTakenError) return err.message;
  if (err instanceof CustomerNotFoundError) return err.message;
  if (err instanceof AuthorizationError) {
    return "No tenés permiso para gestionar clientes.";
  }
  if (err instanceof UnauthenticatedError) {
    return "Tu sesión expiró. Ingresá de nuevo.";
  }
  return "No pudimos guardar el cliente. Intentá nuevamente.";
}

/** FormData → forma que espera el schema ("" en opcionales → undefined). */
function readCustomerForm(formData: FormData): Record<string, unknown> {
  const opt = (key: string) => {
    const v = (formData.get(key) ?? "").toString().trim();
    return v === "" ? undefined : v;
  };
  return {
    name: (formData.get("name") ?? "").toString(),
    phone: opt("phone"),
    email: opt("email"),
    notes: opt("notes"),
  };
}

export async function createCustomerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createCustomerSchema.safeParse(readCustomerForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  try {
    const ctx = await requireSessionContext();
    await createCustomer(ctx, parsed.data);
  } catch (err) {
    return { error: toActionError(err) };
  }

  revalidatePath(CLIENTES_PATH);
  redirect(CLIENTES_PATH);
}

export async function updateCustomerAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = updateCustomerSchema.safeParse(readCustomerForm(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  try {
    const ctx = await requireSessionContext();
    await editCustomer(ctx, id, parsed.data);
  } catch (err) {
    return { error: toActionError(err) };
  }

  revalidatePath(CLIENTES_PATH);
  redirect(CLIENTES_PATH);
}

export async function deleteCustomerAction(
  id: string,
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  try {
    const ctx = await requireSessionContext();
    await removeCustomer(ctx, id);
  } catch (err) {
    return { error: toActionError(err) };
  }

  revalidatePath(CLIENTES_PATH);
  redirect(CLIENTES_PATH);
}
