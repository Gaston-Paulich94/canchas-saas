import { describe, it, expect } from "vitest";
import {
  createAvailabilitySchema,
  slotDurationSchema,
} from "@/modules/availability/domain/schemas";

const validWindow = { dayOfWeek: 1, openTime: "08:00", closeTime: "10:00" };

describe("Esquema de disponibilidad (validación en el borde)", () => {
  it("acepta una franja válida", () => {
    expect(createAvailabilitySchema.safeParse(validWindow).success).toBe(true);
  });

  it("rechaza campos extra (anti mass assignment: tenantId/courtId)", () => {
    const res = createAvailabilitySchema.safeParse({
      ...validWindow,
      tenantId: "00000000-0000-0000-0000-000000000000",
      courtId: "11111111-1111-1111-1111-111111111111",
    });
    expect(res.success).toBe(false);
  });

  it("rechaza cierre <= apertura", () => {
    expect(
      createAvailabilitySchema.safeParse({
        ...validWindow,
        openTime: "10:00",
        closeTime: "08:00",
      }).success,
    ).toBe(false);
    expect(
      createAvailabilitySchema.safeParse({
        ...validWindow,
        openTime: "10:00",
        closeTime: "10:00",
      }).success,
    ).toBe(false);
  });

  it("rechaza formato de hora inválido", () => {
    expect(
      createAvailabilitySchema.safeParse({ ...validWindow, openTime: "8:00" })
        .success,
    ).toBe(false);
    expect(
      createAvailabilitySchema.safeParse({ ...validWindow, closeTime: "24:00" })
        .success,
    ).toBe(false);
  });

  it("rechaza día fuera de 0..6", () => {
    expect(
      createAvailabilitySchema.safeParse({ ...validWindow, dayOfWeek: 7 })
        .success,
    ).toBe(false);
    expect(
      createAvailabilitySchema.safeParse({ ...validWindow, dayOfWeek: -1 })
        .success,
    ).toBe(false);
  });

  it("slotDuration respeta límites [15, 1440] y enteros", () => {
    expect(slotDurationSchema.safeParse({ slotDurationMin: 60 }).success).toBe(
      true,
    );
    expect(slotDurationSchema.safeParse({ slotDurationMin: 10 }).success).toBe(
      false,
    );
    expect(
      slotDurationSchema.safeParse({ slotDurationMin: 1500 }).success,
    ).toBe(false);
    expect(
      slotDurationSchema.safeParse({ slotDurationMin: 30.5 }).success,
    ).toBe(false);
  });
});
