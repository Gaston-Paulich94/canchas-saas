import { describe, it, expect } from "vitest";
import {
  computeAmountCents,
  computeFeeCents,
  mapMpStatus,
  formatArs,
  CourtPriceMissingError,
} from "@/modules/payments/domain/payment";

describe("Cálculo de importes (backend, nunca del cliente)", () => {
  it("una hora al precio de la cancha", () => {
    // $12.000/hora, 60 min => 1.200.000 centavos
    expect(computeAmountCents(12000, 60)).toBe(1_200_000);
  });

  it("turno de 90 minutos = 1,5 horas", () => {
    expect(computeAmountCents(12000, 90)).toBe(1_800_000);
  });

  it("turno de 30 minutos = media hora", () => {
    expect(computeAmountCents(12000, 30)).toBe(600_000);
  });

  it("redondea a centavos enteros (sin floats sueltos)", () => {
    const amount = computeAmountCents(9999, 45);
    expect(Number.isInteger(amount)).toBe(true);
    expect(amount).toBe(749_925);
  });

  it("rechaza precio ausente o inválido", () => {
    expect(() => computeAmountCents(0, 60)).toThrow(CourtPriceMissingError);
    expect(() => computeAmountCents(-100, 60)).toThrow(CourtPriceMissingError);
    expect(() => computeAmountCents(Number.NaN, 60)).toThrow(
      CourtPriceMissingError,
    );
  });

  it("rechaza duración inválida", () => {
    expect(() => computeAmountCents(12000, 0)).toThrow();
    expect(() => computeAmountCents(12000, -30)).toThrow();
  });
});

describe("Comisión del marketplace", () => {
  it("aplica el porcentaje configurado", () => {
    expect(computeFeeCents(1_000_000, 2.5)).toBe(25_000);
  });

  it("sin comisión configurada es 0", () => {
    expect(computeFeeCents(1_000_000, 0)).toBe(0);
    expect(computeFeeCents(1_000_000, Number.NaN)).toBe(0);
  });

  it("nunca supera el importe total", () => {
    expect(computeFeeCents(1_000_000, 150)).toBe(1_000_000);
  });

  it("nunca es negativa", () => {
    expect(computeFeeCents(1_000_000, -10)).toBe(0);
  });

  it("devuelve enteros", () => {
    expect(Number.isInteger(computeFeeCents(999_999, 3.33))).toBe(true);
  });
});

describe("Mapeo de estados de Mercado Pago", () => {
  it("mapea los estados conocidos", () => {
    expect(mapMpStatus("approved")).toBe("aprobado");
    expect(mapMpStatus("rejected")).toBe("rechazado");
    expect(mapMpStatus("refunded")).toBe("reembolsado");
    expect(mapMpStatus("charged_back")).toBe("reembolsado");
    expect(mapMpStatus("cancelled")).toBe("cancelado");
    expect(mapMpStatus("pending")).toBe("pendiente");
    expect(mapMpStatus("in_process")).toBe("pendiente");
  });

  it("un estado desconocido NUNCA se toma como aprobado (fail-closed)", () => {
    expect(mapMpStatus("estado_raro")).toBe("pendiente");
    expect(mapMpStatus("")).toBe("pendiente");
  });
});

describe("Formato de importes", () => {
  it("muestra centavos como pesos", () => {
    // El separador puede variar según ICU; verificamos los dígitos.
    expect(formatArs(1_200_000).replace(/\s/g, "")).toContain("12.000");
  });
});
