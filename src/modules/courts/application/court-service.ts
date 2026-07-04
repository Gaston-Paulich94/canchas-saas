import { withTenant } from "@/modules/shared/infrastructure/db/with-tenant";
import { assertRole } from "@/modules/shared/application/authz";
import { ROLES, type SessionContext } from "@/modules/auth/domain/roles";
import {
  CourtNotFoundError,
  CourtNameTakenError,
  type Court,
} from "@/modules/courts/domain/court";
import type { CourtInput } from "@/modules/courts/domain/schemas";
import {
  listCourts,
  findCourtById,
  insertCourt,
  updateCourt,
  deleteCourt,
} from "@/modules/courts/infrastructure/court.repository";

/**
 * Use-cases de canchas. Reglas transversales de este service:
 *  - Autorización por rol acá (no en la UI). Gestionar canchas = owner o staff.
 *  - El tenant SIEMPRE sale de la sesión (ctx.tenantId), nunca del input.
 *  - Toda query corre dentro de withTenant() → RLS activa como segunda capa.
 *  - El objeto que va a la DB se ARMA campo por campo desde el input validado;
 *    nunca se spreadea el payload crudo (anti mass assignment).
 */

// Roles con permiso para administrar canchas.
const MANAGE_ROLES = [ROLES.OWNER, ROLES.STAFF] as const;

/** Postgres unique_violation. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

/** Traduce campos del input validado a valores de columna (sin tenantId/id). */
function toColumns(input: CourtInput) {
  return {
    name: input.name,
    sport: input.sport,
    surface: input.surface ?? null,
    indoor: input.indoor,
    isActive: input.isActive,
    pricePerHour: input.pricePerHour ?? null,
  };
}

export async function createCourt(
  ctx: SessionContext,
  input: CourtInput,
): Promise<Court> {
  assertRole(ctx, MANAGE_ROLES);
  try {
    return await withTenant(ctx.tenantId, (tx) =>
      insertCourt(tx, { tenantId: ctx.tenantId, ...toColumns(input) }),
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new CourtNameTakenError();
    throw err;
  }
}

export async function getCourts(ctx: SessionContext): Promise<Court[]> {
  assertRole(ctx, MANAGE_ROLES);
  return withTenant(ctx.tenantId, (tx) => listCourts(tx, ctx.tenantId));
}

export async function getCourt(
  ctx: SessionContext,
  id: string,
): Promise<Court> {
  assertRole(ctx, MANAGE_ROLES);
  const court = await withTenant(ctx.tenantId, (tx) =>
    findCourtById(tx, ctx.tenantId, id),
  );
  if (!court) throw new CourtNotFoundError();
  return court;
}

export async function editCourt(
  ctx: SessionContext,
  id: string,
  input: CourtInput,
): Promise<Court> {
  assertRole(ctx, MANAGE_ROLES);
  try {
    const updated = await withTenant(ctx.tenantId, (tx) =>
      updateCourt(tx, ctx.tenantId, id, toColumns(input)),
    );
    if (!updated) throw new CourtNotFoundError();
    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) throw new CourtNameTakenError();
    throw err;
  }
}

export async function removeCourt(
  ctx: SessionContext,
  id: string,
): Promise<void> {
  assertRole(ctx, MANAGE_ROLES);
  const deleted = await withTenant(ctx.tenantId, (tx) =>
    deleteCourt(tx, ctx.tenantId, id),
  );
  if (!deleted) throw new CourtNotFoundError();
}
