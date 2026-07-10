import { describe, it, expect } from "vitest";
import {
  arDateTimeToUtc,
  utcToArTime,
  utcToArDate,
  arDayBounds,
} from "@/modules/reservations/domain/datetime";

describe("Fecha/hora AR (lógica pura, offset fijo -03:00)", () => {
  it("convierte hora argentina a instante UTC", () => {
    const d = arDateTimeToUtc("2026-07-10", "18:00");
    expect(d.toISOString()).toBe("2026-07-10T21:00:00.000Z");
  });

  it("ida y vuelta: UTC → hora y fecha argentinas", () => {
    const d = arDateTimeToUtc("2026-07-10", "18:00");
    expect(utcToArTime(d)).toBe("18:00");
    expect(utcToArDate(d)).toBe("2026-07-10");
  });

  it("cruza medianoche correctamente (02:00Z es 23:00 del día anterior en AR)", () => {
    const d = new Date("2026-07-10T02:00:00.000Z");
    expect(utcToArTime(d)).toBe("23:00");
    expect(utcToArDate(d)).toBe("2026-07-09");
  });

  it("los límites del día argentino son [03:00Z, 03:00Z del día siguiente)", () => {
    const { from, to } = arDayBounds("2026-07-10");
    expect(from.toISOString()).toBe("2026-07-10T03:00:00.000Z");
    expect(to.toISOString()).toBe("2026-07-11T03:00:00.000Z");
  });

  it("rechaza fecha/hora inválida", () => {
    expect(() => arDateTimeToUtc("2026-13-40", "18:00")).toThrow();
  });
});
