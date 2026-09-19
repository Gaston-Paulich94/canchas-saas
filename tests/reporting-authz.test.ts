import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { getReportingOverview } from "@/modules/reporting/application/reporting-service";
import { AuthorizationError } from "@/modules/shared/application/authz";
import type { SessionContext } from "@/modules/auth/domain/roles";

/**
 * Autorización y validación en la capa de aplicación (no solo en la página).
 * Todos estos rechazos ocurren ANTES de tocar la base: no hace falta Postgres.
 */
const base = {
  tenantId: "00000000-0000-0000-0000-000000000000",
  email: "x@demo.test",
  name: "X",
};
const ownerCtx: SessionContext = { ...base, userId: "u_owner", role: "owner" };
const staffCtx: SessionContext = { ...base, userId: "u_staff", role: "staff" };
const clienteCtx: SessionContext = { ...base, userId: "u_cli", role: "cliente" };

const MES = { desde: "2026-09-01", hasta: "2026-09-30" };

describe("Reportes — autorización y defensa en profundidad", () => {
  it("el staff no accede a los números del negocio", async () => {
    await expect(getReportingOverview(staffCtx, MES)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("un cliente tampoco", async () => {
    await expect(getReportingOverview(clienteCtx, MES)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("el service rechaza un rango sin tope aunque lo llame el dueño (anti DoS)", async () => {
    await expect(
      getReportingOverview(ownerCtx, { desde: "1000-01-01", hasta: "2026-09-18" }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("el service rechaza fechas imposibles antes de consultar", async () => {
    await expect(
      getReportingOverview(ownerCtx, { desde: "2026-02-31", hasta: "2026-03-10" }),
    ).rejects.toBeInstanceOf(ZodError);
  });
});
