import { describe, it, expect } from "vitest";
import {
  parseTimeToMinutes,
  minutesToTime,
  generateWindowSlots,
  generateDaySlots,
} from "@/modules/availability/domain/slots";

describe("Generación de slots (lógica pura)", () => {
  it("parsea HH:MM y HH:MM:SS", () => {
    expect(parseTimeToMinutes("08:00")).toBe(480);
    expect(parseTimeToMinutes("08:00:00")).toBe(480);
    expect(parseTimeToMinutes("23:30")).toBe(1410);
  });

  it("formatea minutos a HH:MM", () => {
    expect(minutesToTime(480)).toBe("08:00");
    expect(minutesToTime(1410)).toBe("23:30");
  });

  it("genera turnos que entran completos en la ventana", () => {
    const slots = generateWindowSlots("08:00", "10:00", 60);
    expect(slots).toEqual([
      { start: "08:00", end: "09:00" },
      { start: "09:00", end: "10:00" },
    ]);
  });

  it("no genera turnos parciales (descarta el resto que no entra)", () => {
    const slots = generateWindowSlots("08:00", "09:30", 60);
    expect(slots).toEqual([{ start: "08:00", end: "09:00" }]);
  });

  it("turnos de 90 minutos", () => {
    const slots = generateWindowSlots("08:00", "11:00", 90);
    expect(slots).toEqual([
      { start: "08:00", end: "09:30" },
      { start: "09:30", end: "11:00" },
    ]);
  });

  it("duración inválida (<=0) devuelve vacío", () => {
    expect(generateWindowSlots("08:00", "10:00", 0)).toEqual([]);
    expect(generateWindowSlots("08:00", "10:00", -30)).toEqual([]);
  });

  it("combina varias ventanas de un día y ordena por inicio", () => {
    const slots = generateDaySlots(
      [
        { openTime: "18:00", closeTime: "20:00" },
        { openTime: "08:00", closeTime: "10:00" },
      ],
      60,
    );
    expect(slots.map((s) => s.start)).toEqual(["08:00", "09:00", "18:00", "19:00"]);
  });

  it("rechaza una hora inválida", () => {
    expect(() => parseTimeToMinutes("25:00")).toThrow();
  });
});
