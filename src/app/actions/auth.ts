"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  registerOwnerSchema,
  loginSchema,
} from "@/modules/auth/domain/schemas";
import { registerOwner } from "@/modules/auth/application/register-owner";
import {
  isLoginAllowed,
  isRegisterAllowed,
  TOO_MANY_ATTEMPTS_MESSAGE,
} from "@/modules/auth/application/rate-limit";
import { clientIpFrom } from "@/lib/client-ip";

export interface ActionState {
  error: string | null;
}

/**
 * Las actions validan el input con Zod `.strict()` en el borde, delegan la
 * lógica a la capa de aplicación y devuelven SIEMPRE mensajes genéricos al
 * cliente (sin stack traces ni detalle interno).
 *
 * Login y registro pasan SIEMPRE por el rate-limit propio (ver
 * modules/auth/application/rate-limit.ts): `auth.api.*` llamado desde el
 * servidor no pasa por el limitador de better-auth.
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

  const ip = clientIpFrom(await headers());
  if (!(await isRegisterAllowed(ip))) {
    return { error: TOO_MANY_ATTEMPTS_MESSAGE };
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

  // El cupo se consume ANTES de verificar la contraseña: cada intento cuenta,
  // sea correcto o no.
  const ip = clientIpFrom(await headers());
  if (!(await isLoginAllowed(ip, parsed.data.email))) {
    return { error: TOO_MANY_ATTEMPTS_MESSAGE };
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
