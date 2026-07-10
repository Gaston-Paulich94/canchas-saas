import { withTenant } from "@/modules/shared/infrastructure/db/with-tenant";
import { isExclusionViolation } from "@/modules/shared/infrastructure/db/pg-errors";
import { assertRole } from "@/modules/shared/application/authz";
import { ROLES, type SessionContext } from "@/modules/auth/domain/roles";
import {
  findCourtById,
  updateCourt,
} from "@/modules/courts/infrastructure/court.repository";
import { CourtNotFoundError, type Court } from "@/modules/courts/domain/court";
import {
  AvailabilityNotFoundError,
  AvailabilityOverlapError,
  type CourtAvailability,
  type Slot,
} from "@/modules/availability/domain/availability";
import { generateDaySlots } from "@/modules/availability/domain/slots";
import type {
  CreateAvailabilityInput,
  SlotDurationInput,
} from "@/modules/availability/domain/schemas";
import {
  listAvailabilityByCourt,
  insertAvailability,
  deleteAvailability,
} from "@/modules/availability/infrastructure/availability.repository";

/**
 * Use-cases de disponibilidad. Reglas transversales:
 *  - authz por rol (owner|staff) antes de tocar la DB (fail-closed).
 *  - tenant SIEMPRE de la sesión; court_id se VALIDA contra el tenant (findCourt
 *    por tenant+id) antes de escribir → un id de otro complejo da NotFound (IDOR).
 *  - todo corre en withTenant() → RLS activa como segunda capa.
 */

const MANAGE_ROLES = [ROLES.OWNER, ROLES.STAFF] as const;

export interface CourtAvailabilityView {
  court: Court;
  windows: CourtAvailability[];
}

export async function getCourtAvailability(
  ctx: SessionContext,
  courtId: string,
): Promise<CourtAvailabilityView> {
  assertRole(ctx, MANAGE_ROLES);
  return withTenant(ctx.tenantId, async (tx) => {
    const court = await findCourtById(tx, ctx.tenantId, courtId);
    if (!court) throw new CourtNotFoundError();
    const windows = await listAvailabilityByCourt(tx, ctx.tenantId, courtId);
    return { court, windows };
  });
}

export async function addAvailability(
  ctx: SessionContext,
  courtId: string,
  input: CreateAvailabilityInput,
): Promise<CourtAvailability> {
  assertRole(ctx, MANAGE_ROLES);
  return withTenant(ctx.tenantId, async (tx) => {
    const court = await findCourtById(tx, ctx.tenantId, courtId);
    if (!court) throw new CourtNotFoundError();
    try {
      return await insertAvailability(tx, {
        tenantId: ctx.tenantId,
        courtId,
        dayOfWeek: input.dayOfWeek,
        openTime: input.openTime,
        closeTime: input.closeTime,
      });
    } catch (err) {
      if (isExclusionViolation(err)) throw new AvailabilityOverlapError();
      throw err;
    }
  });
}

export async function removeAvailability(
  ctx: SessionContext,
  id: string,
): Promise<void> {
  assertRole(ctx, MANAGE_ROLES);
  const deleted = await withTenant(ctx.tenantId, (tx) =>
    deleteAvailability(tx, ctx.tenantId, id),
  );
  if (!deleted) throw new AvailabilityNotFoundError();
}

export async function setSlotDuration(
  ctx: SessionContext,
  courtId: string,
  input: SlotDurationInput,
): Promise<Court> {
  assertRole(ctx, MANAGE_ROLES);
  const updated = await withTenant(ctx.tenantId, (tx) =>
    updateCourt(tx, ctx.tenantId, courtId, {
      slotDurationMin: input.slotDurationMin,
    }),
  );
  if (!updated) throw new CourtNotFoundError();
  return updated;
}

/**
 * Slots calculados de una cancha para una fecha concreta ("YYYY-MM-DD").
 * Deriva el día de la semana de la fecha en hora local (sin sorpresas de UTC) y
 * genera los turnos a partir de las ventanas de ese día + slot_duration_min.
 */
export async function computeSlotsForDate(
  ctx: SessionContext,
  courtId: string,
  dateStr: string,
): Promise<Slot[]> {
  assertRole(ctx, MANAGE_ROLES);
  const [y, m, d] = dateStr.split("-").map(Number);
  const dayOfWeek = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getDay();

  return withTenant(ctx.tenantId, async (tx) => {
    const court = await findCourtById(tx, ctx.tenantId, courtId);
    if (!court) throw new CourtNotFoundError();
    const windows = await listAvailabilityByCourt(tx, ctx.tenantId, courtId);
    const forDay = windows.filter((w) => w.dayOfWeek === dayOfWeek);
    return generateDaySlots(forDay, court.slotDurationMin);
  });
}
