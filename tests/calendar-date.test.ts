import { describe, it, expect } from "vitest";
import { isCalendarDate, calendarDateSchema } from "@/lib/calendar-date";
import { createReservationSchema } from "@/modules/reservations/domain/schemas";
import { previewDateSchema } from "@/modules/availability/domain/schemas";

/**
 * Hallazgo #12: "2026-13-01" pasaba el regex y terminaba en un 500, y
 * "2026-02-31" se corría en silencio al 3 de marzo.
 */
describe("isCalendarDate", () => {
  it("acepta fechas que existen, incluido el 29/02 de un año bisiesto", () => {
    for (const ok of ["2026-01-01", "2026-12-31", "2028-02-29", "2026-04-30"]) {
      expect(isCalendarDate(ok)).toBe(true);
    }
  });

  it("rechaza meses y días imposibles", () => {
    for (const malo of ["2026-13-01", "2026-00-10", "2026-02-31", "2026-02-29", "2026-04-31", "2026-01-00", "2026-01-32"]) {
      expect(isCalendarDate(malo)).toBe(false);
    }
  });

  it("rechaza formatos que no son YYYY-MM-DD", () => {
    for (const malo of ["", "2026-1-01", "01/02/2026", "2026-01-01T00:00", " 2026-01-01", "hoy"]) {
      expect(isCalendarDate(malo)).toBe(false);
    }
  });

  it("calendarDateSchema devuelve un error de validación, no una excepción", () => {
    const r = calendarDateSchema.safeParse("2026-02-31");
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Fecha inválida.");
  });
});

describe("los esquemas que reciben fechas usan la validación de calendario", () => {
  it("crear reserva rechaza el 31/02", () => {
    const r = createReservationSchema.safeParse({
      courtId: "9b2f8a64-3c1d-4e5f-8a7b-2c9d0e1f3a45",
      date: "2026-02-31",
      startTime: "18:00",
      customerName: "Juan Pérez",
    });
    expect(r.success).toBe(false);
  });

  it("el preview de turnos rechaza un mes 13", () => {
    expect(previewDateSchema.safeParse("2026-13-01").success).toBe(false);
  });
});
