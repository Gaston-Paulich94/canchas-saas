import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  verifyMpWebhookSignature,
  SIGNATURE_MAX_AGE_MS,
} from "@/modules/payments/infrastructure/mp-signature";

/**
 * La verificación de firma es la ÚNICA barrera entre un POST cualquiera y
 * marcar una reserva como pagada. Estos tests cubren el camino feliz y, sobre
 * todo, todos los intentos de burlarla.
 */

const SECRET = "clave-secreta-del-webhook";
const DATA_ID = "1234567890";
const REQUEST_ID = "req-abc-123";
const NOW = 1_800_000_000_000; // instante fijo para los tests

/** Firma legítima, como la generaría Mercado Pago. */
function sign(
  secret: string,
  dataId: string,
  requestId: string,
  tsSeconds: number,
): string {
  const manifest = `id:${dataId};request-id:${requestId};ts:${tsSeconds};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${tsSeconds},v1=${v1}`;
}

const validTs = Math.floor(NOW / 1000);

function verify(overrides: Partial<Parameters<typeof verifyMpWebhookSignature>[0]> = {}) {
  return verifyMpWebhookSignature({
    signatureHeader: sign(SECRET, DATA_ID, REQUEST_ID, validTs),
    requestId: REQUEST_ID,
    dataId: DATA_ID,
    secret: SECRET,
    now: NOW,
    ...overrides,
  });
}

describe("Firma del webhook de Mercado Pago", () => {
  it("acepta una notificación legítima", () => {
    expect(verify()).toBe(true);
  });

  it("rechaza si falta el header de firma", () => {
    expect(verify({ signatureHeader: null })).toBe(false);
    expect(verify({ signatureHeader: "" })).toBe(false);
  });

  it("rechaza un header malformado", () => {
    expect(verify({ signatureHeader: "no-tiene-formato" })).toBe(false);
    expect(verify({ signatureHeader: "ts=123" })).toBe(false); // sin v1
    expect(verify({ signatureHeader: `v1=${"a".repeat(64)}` })).toBe(false); // sin ts
  });

  it("rechaza una firma hecha con OTRO secreto (atacante sin la clave)", () => {
    expect(
      verify({
        signatureHeader: sign("secreto-equivocado", DATA_ID, REQUEST_ID, validTs),
      }),
    ).toBe(false);
  });

  it("rechaza si el data.id no es el firmado (no se puede reusar una firma)", () => {
    expect(verify({ dataId: "9999999999" })).toBe(false);
  });

  it("rechaza si el request-id no coincide", () => {
    expect(verify({ requestId: "otro-request-id" })).toBe(false);
  });

  it("rechaza un REPLAY: notificación válida pero vieja", () => {
    const oldTs = Math.floor((NOW - SIGNATURE_MAX_AGE_MS - 1000) / 1000);
    expect(
      verify({
        signatureHeader: sign(SECRET, DATA_ID, REQUEST_ID, oldTs),
      }),
    ).toBe(false);
  });

  it("rechaza un timestamp del futuro", () => {
    const futureTs = Math.floor((NOW + SIGNATURE_MAX_AGE_MS + 1000) / 1000);
    expect(
      verify({
        signatureHeader: sign(SECRET, DATA_ID, REQUEST_ID, futureTs),
      }),
    ).toBe(false);
  });

  it("acepta dentro de la ventana temporal (borde)", () => {
    const edgeTs = Math.floor((NOW - SIGNATURE_MAX_AGE_MS + 2000) / 1000);
    expect(
      verify({
        signatureHeader: sign(SECRET, DATA_ID, REQUEST_ID, edgeTs),
      }),
    ).toBe(true);
  });

  it("rechaza un ts no numérico", () => {
    const v1 = createHmac("sha256", SECRET).update("x").digest("hex");
    expect(verify({ signatureHeader: `ts=no-es-numero,v1=${v1}` })).toBe(false);
  });

  it("rechaza una v1 de largo incorrecto o no hexadecimal", () => {
    expect(verify({ signatureHeader: `ts=${validTs},v1=abc` })).toBe(false);
    expect(
      verify({ signatureHeader: `ts=${validTs},v1=${"z".repeat(64)}` }),
    ).toBe(false);
  });

  it("rechaza si no hay secreto configurado (fail-closed)", () => {
    expect(verify({ secret: "" })).toBe(false);
  });

  it("es insensible a mayúsculas en la firma hex", () => {
    const header = sign(SECRET, DATA_ID, REQUEST_ID, validTs).toUpperCase();
    // El "ts=" y "v1=" en mayúsculas rompen las claves, así que solo pasamos
    // el valor de v1 en mayúsculas.
    const v1 = header.split("V1=")[1] ?? "";
    expect(verify({ signatureHeader: `ts=${validTs},v1=${v1}` })).toBe(true);
  });
});
