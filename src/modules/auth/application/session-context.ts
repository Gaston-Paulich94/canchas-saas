import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { withSelf } from "@/modules/shared/infrastructure/db/with-tenant";
import { UnauthenticatedError } from "@/modules/shared/application/authz";
import { findProfileByUserId } from "@/modules/auth/infrastructure/profile.repository";
import type { SessionContext } from "@/modules/auth/domain/roles";

/**
 * Deriva el contexto del usuario autenticado EN EL SERVIDOR:
 *  - userId / email / name vienen de la sesión de better-auth (cookie firmada).
 *  - tenantId y role vienen de profiles, leídos en la DB con withSelf()
 *    (RLS policy `profiles_self`). Nunca de un claim ni input del cliente.
 *
 * Devuelve null si no hay sesión válida o el usuario no tiene profile.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const res = await auth.api.getSession({ headers: await headers() });
  if (!res?.user) return null;

  const userId = res.user.id;
  const profile = await withSelf(userId, (tx) =>
    findProfileByUserId(tx, userId),
  );
  if (!profile) return null;

  return {
    userId,
    tenantId: profile.tenantId,
    role: profile.role,
    email: res.user.email,
    name: res.user.name,
  };
}

/**
 * Igual que getSessionContext pero fail-closed: lanza si no hay sesión.
 */
export async function requireSessionContext(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) throw new UnauthenticatedError();
  return ctx;
}
