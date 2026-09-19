import { describe, it, expect } from "vitest";
import { getDashboardOverview } from "@/modules/dashboard/application/dashboard-service";
import { AuthorizationError } from "@/modules/shared/application/authz";
import type { SessionContext } from "@/modules/auth/domain/roles";

/**
 * Autorización del panel en la capa de aplicación (no solo en la página). El
 * rechazo ocurre ANTES de tocar la base: no hace falta Postgres.
 */
const clienteCtx: SessionContext = {
  userId: "u_cli",
  tenantId: "00000000-0000-0000-0000-000000000000",
  role: "cliente",
  email: "x@demo.test",
  name: "X",
};

describe("Panel del dueño — autorización", () => {
  it("un cliente no accede a la operación del complejo", async () => {
    await expect(
      getDashboardOverview(clienteCtx, "2026-09-18"),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
