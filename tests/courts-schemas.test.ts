import { describe, it, expect } from "vitest";
import { courtInputSchema } from "@/modules/courts/domain/schemas";

const valid = {
  name: "Cancha 1",
  sport: "padel",
  surface: "Sintético",
  indoor: true,
  isActive: true,
  pricePerHour: 12000,
};

describe("Esquema de canchas (validación en el borde)", () => {
  it("acepta un input válido", () => {
    const res = courtInputSchema.safeParse(valid);
    expect(res.success).toBe(true);
  });

  it("rechaza campos extra (anti mass assignment: tenantId/id)", () => {
    const res = courtInputSchema.safeParse({
      ...valid,
      tenantId: "00000000-0000-0000-0000-000000000000",
      id: "11111111-1111-1111-1111-111111111111",
    });
    expect(res.success).toBe(false);
  });

  it("rechaza un deporte fuera del enum", () => {
    const res = courtInputSchema.safeParse({ ...valid, sport: "basquet" });
    expect(res.success).toBe(false);
  });

  it("normaliza surface vacío a null", () => {
    const res = courtInputSchema.safeParse({ ...valid, surface: "" });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.surface).toBeNull();
  });

  it("acepta precio ausente (null)", () => {
    const res = courtInputSchema.safeParse({ ...valid, pricePerHour: null });
    expect(res.success).toBe(true);
  });

  it("rechaza precio negativo", () => {
    const res = courtInputSchema.safeParse({ ...valid, pricePerHour: -1 });
    expect(res.success).toBe(false);
  });

  it("rechaza precio no entero", () => {
    const res = courtInputSchema.safeParse({ ...valid, pricePerHour: 100.5 });
    expect(res.success).toBe(false);
  });

  it("rechaza nombre muy corto", () => {
    const res = courtInputSchema.safeParse({ ...valid, name: "A" });
    expect(res.success).toBe(false);
  });
});
