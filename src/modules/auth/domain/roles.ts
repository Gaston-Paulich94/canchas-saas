import type { ProfileRole } from "@/modules/shared/infrastructure/db/schema";

export type { ProfileRole };

export const ROLES = {
  OWNER: "owner",
  STAFF: "staff",
  CLIENTE: "cliente",
} as const satisfies Record<string, ProfileRole>;

/**
 * Contexto del usuario autenticado, derivado SIEMPRE en el servidor desde la
 * sesión de better-auth y la tabla profiles. Nunca se arma con input del cliente.
 */
export interface SessionContext {
  userId: string;
  tenantId: string;
  role: ProfileRole;
  email: string;
  name: string;
}
