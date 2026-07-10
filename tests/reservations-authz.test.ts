import { describe, it, expect } from "vitest";
import {
  createReservation,
  rescheduleReservation,
  cancelReservation,
  getReservation,
  getDaySchedule,
  getFreeSlots,
} from "@/modules/reservations/application/reservation-service";
import { AuthorizationError } from "@/modules/shared/application/authz";
import type { SessionContext } from "@/modules/auth/domain/roles";

/**
 * El guard de rol corre ANTES de tocar la DB: un `cliente` es rechazado sin
 * necesidad de Postgres (fail-closed).
 */
const clienteCtx: SessionContext = {
  userId: "user_cliente",
  tenantId: "00000000-0000-0000-0000-000000000000",
  role: "cliente",
  email: "cliente@x.test",
  name: "Cliente",
};

const courtId = "11111111-1111-1111-1111-111111111111";
const reservationId = "22222222-2222-2222-2222-222222222222";

describe("Autorización de reservas (rol cliente denegado)", () => {
  it("createReservation rechaza a un cliente", async () => {
    await expect(
      createReservation(clienteCtx, {
        courtId,
        date: "2026-07-10",
        startTime: "18:00",
        customerName: "Juan",
        customerPhone: null,
        notes: null,
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rescheduleReservation rechaza a un cliente", async () => {
    await expect(
      rescheduleReservation(clienteCtx, reservationId, {
        courtId,
        date: "2026-07-10",
        startTime: "19:00",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("cancelReservation rechaza a un cliente", async () => {
    await expect(
      cancelReservation(clienteCtx, reservationId),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("getReservation rechaza a un cliente", async () => {
    await expect(
      getReservation(clienteCtx, reservationId),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("getDaySchedule rechaza a un cliente", async () => {
    await expect(
      getDaySchedule(clienteCtx, "2026-07-10"),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("getFreeSlots rechaza a un cliente", async () => {
    await expect(
      getFreeSlots(clienteCtx, courtId, "2026-07-10"),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
