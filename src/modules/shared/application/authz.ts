import type { ProfileRole, SessionContext } from "@/modules/auth/domain/roles";

/**
 * Errores de autorización tipados. Nunca filtran detalle al cliente: el route
 * handler / action los traduce a un mensaje genérico.
 */
export class UnauthenticatedError extends Error {
  constructor() {
    super("No autenticado.");
    this.name = "UnauthenticatedError";
  }
}

export class AuthorizationError extends Error {
  constructor() {
    super("No autorizado.");
    this.name = "AuthorizationError";
  }
}

/**
 * Guard de autorización por rol. Fail-closed: si el rol no está en la lista
 * permitida, deniega. Va en la capa de aplicación (service/use-case), no en el
 * route handler.
 */
export function assertRole(
  ctx: SessionContext,
  allowed: readonly ProfileRole[],
): void {
  if (!allowed.includes(ctx.role)) {
    throw new AuthorizationError();
  }
}
