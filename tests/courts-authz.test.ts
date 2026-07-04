import { describe, it, expect } from "vitest";
import {
  createCourt,
  editCourt,
  removeCourt,
  getCourts,
  getCourt,
} from "@/modules/courts/application/court-service";
import { AuthorizationError } from "@/modules/shared/application/authz";
import type { SessionContext } from "@/modules/auth/domain/roles";
import type { CourtInput } from "@/modules/courts/domain/schemas";

/**
 * Autorización por rol en el SERVICE (no en la UI). El guard corre ANTES de
 * cualquier acceso a la DB, así que estos tests no necesitan Postgres: un
 * `cliente` es rechazado sin llegar a tocar la base.
 */
const clienteCtx: SessionContext = {
  userId: "user_cliente",
  tenantId: "00000000-0000-0000-0000-000000000000",
  role: "cliente",
  email: "cliente@x.test",
  name: "Cliente",
};

const input: CourtInput = {
  name: "Cancha 1",
  sport: "padel",
  surface: null,
  indoor: false,
  isActive: true,
  pricePerHour: null,
};

describe("Autorización de canchas (rol cliente denegado)", () => {
  it("createCourt rechaza a un cliente", async () => {
    await expect(createCourt(clienteCtx, input)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("editCourt rechaza a un cliente", async () => {
    await expect(
      editCourt(clienteCtx, "11111111-1111-1111-1111-111111111111", input),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("removeCourt rechaza a un cliente", async () => {
    await expect(
      removeCourt(clienteCtx, "11111111-1111-1111-1111-111111111111"),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("getCourts rechaza a un cliente", async () => {
    await expect(getCourts(clienteCtx)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("getCourt rechaza a un cliente", async () => {
    await expect(
      getCourt(clienteCtx, "11111111-1111-1111-1111-111111111111"),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
