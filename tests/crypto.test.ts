import { describe, it, expect } from "vitest";
import {
  encryptSecret,
  decryptSecret,
} from "@/modules/shared/infrastructure/crypto/aes-gcm";
import {
  encryptMpToken,
  decryptMpToken,
} from "@/modules/payments/infrastructure/mp-token-crypto";

const AAD = "tenant:t1:mp_access_token";

describe("Cifrado AES-256-GCM de secretos (tokens MP)", () => {
  it("round-trip: descifrar lo cifrado devuelve el original", () => {
    const token = "APP_USR-1234567890-mercadopago-access-token";
    const enc = encryptSecret(token, AAD);
    expect(enc).not.toContain(token);
    expect(enc.startsWith("v2:")).toBe(true);
    expect(decryptSecret(enc, AAD)).toBe(token);
  });

  it("usa IV aleatorio: dos cifrados del mismo texto difieren", () => {
    const a = encryptSecret("mismo-secreto", AAD);
    const b = encryptSecret("mismo-secreto", AAD);
    expect(a).not.toBe(b);
  });

  it("detecta manipulación: un payload alterado no descifra", () => {
    const enc = encryptSecret("dato-sensible", AAD);
    const raw = Buffer.from(enc.slice(3), "base64");
    const last = raw.length - 1;
    raw[last] = (raw[last] ?? 0) ^ 0xff; // flip del último byte (ciphertext/tag)
    const tampered = "v2:" + raw.toString("base64");
    expect(() => decryptSecret(tampered, AAD)).toThrow();
  });

  it("con otro AAD no descifra (el valor queda atado a su contexto)", () => {
    const enc = encryptSecret("dato-sensible", AAD);
    expect(() => decryptSecret(enc, "tenant:t2:mp_access_token")).toThrow();
  });

  it("el AAD es obligatorio", () => {
    expect(() => encryptSecret("x", "")).toThrow();
    expect(() => decryptSecret(encryptSecret("x", AAD), "")).toThrow();
  });

  it("rechaza el formato viejo sin prefijo ni AAD", () => {
    // Mismo layout de antes (IV | tag | ciphertext) en base64, sin "v2:".
    const legacy = Buffer.alloc(40, 1).toString("base64");
    expect(() => decryptSecret(legacy, AAD)).toThrow();
  });
});

describe("Tokens de Mercado Pago: cada valor atado a su complejo y su columna", () => {
  const TENANT_A = "9b2f8a64-3c1d-4e5f-8a7b-2c9d0e1f3a45";
  const TENANT_B = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

  it("round-trip del access y del refresh token", () => {
    expect(decryptMpToken(TENANT_A, "access", encryptMpToken(TENANT_A, "access", "acc"))).toBe("acc");
    expect(decryptMpToken(TENANT_A, "refresh", encryptMpToken(TENANT_A, "refresh", "ref"))).toBe("ref");
  });

  it("el token de un complejo copiado a otro no descifra", () => {
    const enc = encryptMpToken(TENANT_A, "access", "APP_USR-del-complejo-A");
    expect(() => decryptMpToken(TENANT_B, "access", enc)).toThrow();
  });

  it("el access token puesto en la columna del refresh no descifra", () => {
    const enc = encryptMpToken(TENANT_A, "access", "APP_USR-access");
    expect(() => decryptMpToken(TENANT_A, "refresh", enc)).toThrow();
  });
});
