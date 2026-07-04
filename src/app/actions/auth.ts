"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  registerOwnerSchema,
  loginSchema,
} from "@/modules/auth/domain/schemas";
import { registerOwner } from "@/modules/auth/application/register-owner";

export interface ActionState {
  error: string | null;
}

/**
 * Las actions validan el input con Zod `.strict()` en el borde, delegan la
 * lógica a la capa de aplicación y devuelven SIEMPRE mensajes genéricos al
 * cliente (sin stack traces ni detalle interno).
 */

export async function registerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = registerOwnerSchema.safeParse({
    complejoName: formData.get("complejoName"),
    ownerName: formData.get("ownerName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  try {
    await registerOwner(parsed.data);
  } catch {
    // Incluye el caso de email ya registrado: mensaje genérico para no
    // revelar si la cuenta existe (anti enumeración).
    return {
      error:
        "No pudimos crear la cuenta. Verificá los datos e intentá nuevamente.",
    };
  }

  // redirect() lanza NEXT_REDIRECT: va FUERA del try para no ser capturado.
  redirect("/dashboard");
}

export async function loginAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: "Email o contraseña inválidos." };
  }

  try {
    await auth.api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
    });
  } catch {
    // Mensaje genérico: no revelar si el email existe.
    return { error: "Email o contraseña incorrectos." };
  }

  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
