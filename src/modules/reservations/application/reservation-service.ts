import { withTenant } from "@/modules/shared/infrastructure/db/with-tenant";
import { isExclusionViolation } from "@/modules/shared/infrastructure/db/pg-errors";
import { assertRole } from "@/modules/shared/application/authz";
import { ROLES, type SessionContext } from "@/modules/auth/domain/roles";
import type { DbTx } from "@/modules/shared/infrastructure/db/client";
import {
  findCourtById,
  listCourts,
} from "@/modules/courts/infrastructure/court.repository";
import { CourtNotFoundError, type Court } from "@/modules/courts/domain/court";
import { listAvailabilityByCourt } from "@/modules/availability/infrastructure/availability.repository";
import { generateDaySlots } from "@/modules/availability/domain/slots";
import type { Slot } from "@/modules/availability/domain/availability";
import {
  ReservationNotFoundError,
  InvalidSlotError,
  SlotUnavailableError,
  PastReservationError,
  type Reservation,
} from "@/modules/reservations/domain/reservation";
import {
  arDateTimeToUtc,
  arDayBounds,
} from "@/modules/reservations/domain/datetime";
import type {
  CreateReservationInput,
  RescheduleReservationInput,
} from "@/modules/reservations/domain/schemas";
import {
  listReservationsByRange,
  findReservationById,
  insertReservation,
  updateReservationSchedule,
  cancelReservation as cancelReservationRow,
} from "@/modules/reservations/infrastructure/reservation.repository";

/**
 * Use-cases de reservas. Reglas transversales:
 *  - authz por rol (owner|staff) ANTES de tocar la DB (fail-closed).
 *  - tenant SIEMPRE de la sesión; la cancha se valida contra el tenant
 *    (findCourtById por tenant+id) antes de operar (anti-IDOR).
 *  - el turno pedido debe ser UNO DE LOS SLOTS que genera la disponibilidad de
 *    esa cancha para esa fecha (no se aceptan horarios arbitrarios del cliente).
 *  - el anti doble-booking definitivo es el EXCLUDE constraint (23P01): acá se
 *    traduce a SlotUnavailableError. La app NO asume que su chequeo previo basta.
 *  - todo corre dentro de withTenant() → RLS activa como segunda capa.
 */

const MANAGE_ROLES = [ROLES.OWNER, ROLES.STAFF] as const;

/** Día de la semana (0=Dom) de una fecha calendario — independiente de tz. */
function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
}

/**
 * Resuelve el turno pedido contra la disponibilidad real de la cancha.
 * Lanza CourtNotFound (cancha ajena/inexistente) o InvalidSlot (horario que no
 * corresponde a ningún turno generado).
 */
async function resolveSlot(
  tx: DbTx,
  tenantId: string,
  courtId: string,
  dateStr: string,
  startTime: string,
): Promise<{ court: Court; startsAt: Date; endsAt: Date }> {
  const court = await findCourtById(tx, tenantId, courtId);
  if (!court) throw new CourtNotFoundError();

  const windows = await listAvailabilityByCourt(tx, tenantId, courtId);
  const forDay = windows.filter((w) => w.dayOfWeek === weekdayOf(dateStr));
  const slots = generateDaySlots(forDay, court.slotDurationMin);
  const slot = slots.find((s) => s.start === startTime);
  if (!slot) throw new InvalidSlotError();

  return {
    court,
    startsAt: arDateTimeToUtc(dateStr, slot.start),
    endsAt: arDateTimeToUtc(dateStr, slot.end),
  };
}

export async function createReservation(
  ctx: SessionContext,
  input: CreateReservationInput,
): Promise<Reservation> {
  assertRole(ctx, MANAGE_ROLES);
  return withTenant(ctx.tenantId, async (tx) => {
    const { startsAt, endsAt } = await resolveSlot(
      tx,
      ctx.tenantId,
      input.courtId,
      input.date,
      input.startTime,
    );
    if (startsAt.getTime() < Date.now()) throw new PastReservationError();

    try {
      return await insertReservation(tx, {
        tenantId: ctx.tenantId,
        courtId: input.courtId,
        startsAt,
        endsAt,
        customerName: input.customerName,
        customerPhone: input.customerPhone ?? null,
        notes: input.notes ?? null,
        // status: default 'confirmada' — lo decide el server, nunca el payload.
      });
    } catch (err) {
      if (isExclusionViolation(err)) throw new SlotUnavailableError();
      throw err;
    }
  });
}

export async function rescheduleReservation(
  ctx: SessionContext,
  id: string,
  input: RescheduleReservationInput,
): Promise<Reservation> {
  assertRole(ctx, MANAGE_ROLES);
  return withTenant(ctx.tenantId, async (tx) => {
    const { startsAt, endsAt } = await resolveSlot(
      tx,
      ctx.tenantId,
      input.courtId,
      input.date,
      input.startTime,
    );
    if (startsAt.getTime() < Date.now()) throw new PastReservationError();

    try {
      const updated = await updateReservationSchedule(tx, ctx.tenantId, id, {
        courtId: input.courtId,
        startsAt,
        endsAt,
      });
      if (!updated) throw new ReservationNotFoundError();
      return updated;
    } catch (err) {
      if (isExclusionViolation(err)) throw new SlotUnavailableError();
      throw err;
    }
  });
}

export async function cancelReservation(
  ctx: SessionContext,
  id: string,
): Promise<Reservation> {
  assertRole(ctx, MANAGE_ROLES);
  const cancelled = await withTenant(ctx.tenantId, (tx) =>
    cancelReservationRow(tx, ctx.tenantId, id),
  );
  if (!cancelled) throw new ReservationNotFoundError();
  return cancelled;
}

export async function getReservation(
  ctx: SessionContext,
  id: string,
): Promise<Reservation> {
  assertRole(ctx, MANAGE_ROLES);
  const found = await withTenant(ctx.tenantId, (tx) =>
    findReservationById(tx, ctx.tenantId, id),
  );
  if (!found) throw new ReservationNotFoundError();
  return found;
}

export interface DaySchedule {
  courts: Court[];
  reservations: Reservation[];
}

/** Agenda del día (fecha argentina): canchas + reservas cuyo inicio cae ese día. */
export async function getDaySchedule(
  ctx: SessionContext,
  dateStr: string,
): Promise<DaySchedule> {
  assertRole(ctx, MANAGE_ROLES);
  const { from, to } = arDayBounds(dateStr);
  return withTenant(ctx.tenantId, async (tx) => {
    const courts = await listCourts(tx, ctx.tenantId);
    const rows = await listReservationsByRange(tx, ctx.tenantId, from, to);
    return { courts, reservations: rows };
  });
}

/**
 * Turnos LIBRES de una cancha para una fecha: slots generados menos los que
 * pisan una reserva activa. Es ayuda de UX; la garantía real es el EXCLUDE.
 */
export async function getFreeSlots(
  ctx: SessionContext,
  courtId: string,
  dateStr: string,
): Promise<Slot[]> {
  assertRole(ctx, MANAGE_ROLES);
  const { from, to } = arDayBounds(dateStr);
  return withTenant(ctx.tenantId, async (tx) => {
    const court = await findCourtById(tx, ctx.tenantId, courtId);
    if (!court) throw new CourtNotFoundError();

    const windows = await listAvailabilityByCourt(tx, ctx.tenantId, courtId);
    const forDay = windows.filter((w) => w.dayOfWeek === weekdayOf(dateStr));
    const slots = generateDaySlots(forDay, court.slotDurationMin);

    const dayRows = await listReservationsByRange(tx, ctx.tenantId, from, to);
    const active = dayRows.filter(
      (r) => r.courtId === courtId && r.status !== "cancelada",
    );

    return slots.filter((s) => {
      const sFrom = arDateTimeToUtc(dateStr, s.start).getTime();
      const sTo = arDateTimeToUtc(dateStr, s.end).getTime();
      // Libre si no solapa con ninguna reserva activa: [sFrom, sTo) ∩ [r) = ∅.
      return !active.some(
        (r) => sFrom < r.endsAt.getTime() && r.startsAt.getTime() < sTo,
      );
    });
  });
}
