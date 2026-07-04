import { describe, it, expect } from "vitest";
import {
  getCourtAvailability,
  addAvailability,
  removeAvailability,
  setSlotDuration,
  computeSlotsForDate,
} from "@/modules/availability/application/availability-service";
import { AuthorizationError } from "@/modules/shared/application/authz";
import type { SessionContext } from "@/modules/auth/domain/roles";

/**
 * El guard de rol corre ANTES de tocar la DB, así que un `cliente` es rechazado
 * sin necesidad de Postgres.
 */
const clienteCtx: SessionContext = {
  userId: "user_cliente",
  tenantId: "00000000-0000-0000-0000-000000000000",
  role: "cliente",
  email: "cliente@x.test",
  name: "Cliente",
};

const courtId = "11111111-1111-1111-1111-111111111111";

describe("Autorización de disponibilidad (rol cliente denegado)", () => {
  it("getCourtAvailability rechaza a un cliente", async () => {
    await expect(
      getCourtAvailability(clienteCtx, courtId),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("addAvailability rechaza a un cliente", async () => {
    await expect(
      addAvailability(clienteCtx, courtId, {
        dayOfWeek: 1,
        openTime: "08:00",
        closeTime: "10:00",
      }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("removeAvailability rechaza a un cliente", async () => {
    await expect(
      removeAvailability(clienteCtx, courtId),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("setSlotDuration rechaza a un cliente", async () => {
    await expect(
      setSlotDuration(clienteCtx, courtId, { slotDurationMin: 60 }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("computeSlotsForDate rechaza a un cliente", async () => {
    await expect(
      computeSlotsForDate(clienteCtx, courtId, "2026-07-06"),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
