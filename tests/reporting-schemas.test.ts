import { describe, it, expect } from "vitest";
import {
  reportRangeSchema,
  MAX_REPORT_DAYS,
} from "@/modules/reporting/domain/reporting";

/**
 * El rango del reporte llega por query string: es input de usuario. Además de
 * validar la forma, el tope de días protege la base compartida (DoS).
 */
describe("Rango de reportes (validación en el borde)", () => {
  it("acepta un mes normal", () => {
    expect(
      reportRangeSchema.safeParse({ desde: "2026-09-01", hasta: "2026-09-30" })
        .success,
    ).toBe(true);
  });

  it("acepta un solo día", () => {
    expect(
      reportRangeSchema.safeParse({ desde: "2026-09-18", hasta: "2026-09-18" })
        .success,
    ).toBe(true);
  });

  it("rechaza fechas que no existen en el calendario", () => {
    for (const fecha of ["2026-02-31", "2026-13-01", "2026-00-10", "2026-04-31"]) {
      expect(
        reportRangeSchema.safeParse({ desde: fecha, hasta: "2026-12-31" })
          .success,
      ).toBe(false);
    }
  });

  it("acepta el 29 de febrero solo en años bisiestos", () => {
    expect(
      reportRangeSchema.safeParse({ desde: "2028-02-29", hasta: "2028-03-01" })
        .success,
    ).toBe(true);
    expect(
      reportRangeSchema.safeParse({ desde: "2026-02-29", hasta: "2026-03-01" })
        .success,
    ).toBe(false);
  });

  it("rechaza formatos que no son YYYY-MM-DD", () => {
    expect(
      reportRangeSchema.safeParse({ desde: "18/09/2026", hasta: "2026-09-30" })
        .success,
    ).toBe(false);
  });

  it("rechaza desde posterior a hasta", () => {
    expect(
      reportRangeSchema.safeParse({ desde: "2026-09-30", hasta: "2026-09-01" })
        .success,
    ).toBe(false);
  });

  it(`permite hasta ${MAX_REPORT_DAYS} días (un año bisiesto completo)`, () => {
    expect(
      reportRangeSchema.safeParse({ desde: "2028-01-01", hasta: "2028-12-31" })
        .success,
    ).toBe(true);
  });

  it(`rechaza períodos de más de ${MAX_REPORT_DAYS} días (anti DoS)`, () => {
    const res = reportRangeSchema.safeParse({
      desde: "2028-01-01",
      hasta: "2029-01-01",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toContain(String(MAX_REPORT_DAYS));
    }
  });

  it("rechaza un rango de siglos (el vector de DoS original)", () => {
    expect(
      reportRangeSchema.safeParse({ desde: "1000-01-01", hasta: "2026-09-18" })
        .success,
    ).toBe(false);
  });

  it("rechaza campos extra", () => {
    expect(
      reportRangeSchema.safeParse({
        desde: "2026-09-01",
        hasta: "2026-09-30",
        tenantId: "00000000-0000-0000-0000-000000000000",
      }).success,
    ).toBe(false);
  });
});
