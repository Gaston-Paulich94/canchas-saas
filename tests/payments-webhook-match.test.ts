import { describe, it, expect } from "vitest";
import { checkPaymentMatches } from "@/modules/payments/domain/payment";

/**
 * Última barrera antes de dar una reserva por pagada: la notificación tiene
 * que corresponder EXACTAMENTE al pago que dice referenciar.
 */

const PAGO = { id: "9b2f8a64-3c1d-4e5f-8a7b-2c9d0e1f3a45", amountCents: 1_200_000 };
const OK = {
  externalReference: PAGO.id,
  amountCents: PAGO.amountCents,
  currencyId: "ARS",
};

describe("Correspondencia de la notificación de pago", () => {
  it("acepta la notificación del pago correcto", () => {
    expect(checkPaymentMatches(PAGO, OK)).toBeNull();
  });

  it("rechaza una referencia de OTRO pago", () => {
    expect(
      checkPaymentMatches(PAGO, {
        ...OK,
        externalReference: "7c1e9d52-8b4a-4f6c-9d3e-1a2b3c4d5e6f",
      }),
    ).toBe("referencia");
  });

  it("rechaza si NO trae referencia (pago hecho por fuera del sistema)", () => {
    // Antes esto pasaba: con referencia nula se acreditaba igual.
    expect(
      checkPaymentMatches(PAGO, { ...OK, externalReference: null }),
    ).toBe("referencia");
  });

  it("rechaza si el importe no es el que calculamos", () => {
    expect(checkPaymentMatches(PAGO, { ...OK, amountCents: 1_000_000 })).toBe(
      "importe",
    );
  });

  it("rechaza una diferencia de un solo centavo", () => {
    expect(checkPaymentMatches(PAGO, { ...OK, amountCents: 1_199_999 })).toBe(
      "importe",
    );
  });

  it("rechaza si MP no informa importe", () => {
    expect(checkPaymentMatches(PAGO, { ...OK, amountCents: null })).toBe(
      "importe",
    );
  });

  it("rechaza otra moneda", () => {
    expect(checkPaymentMatches(PAGO, { ...OK, currencyId: "USD" })).toBe(
      "moneda",
    );
  });

  it("acepta cuando MP no informa moneda (referencia e importe ya coinciden)", () => {
    expect(checkPaymentMatches(PAGO, { ...OK, currencyId: null })).toBeNull();
  });

  it("verifica la referencia antes que el importe", () => {
    // Con los dos mal, el motivo es el más específico del vínculo.
    expect(
      checkPaymentMatches(PAGO, {
        externalReference: null,
        amountCents: 1,
        currencyId: "USD",
      }),
    ).toBe("referencia");
  });
});
