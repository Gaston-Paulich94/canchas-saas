import { describe, it, expect } from "vitest";
import {
  encryptSecret,
  decryptSecret,
} from "@/modules/shared/infrastructure/crypto/aes-gcm";

describe("Cifrado AES-256-GCM de secretos (tokens MP)", () => {
  it("round-trip: descifrar lo cifrado devuelve el original", () => {
    const token = "APP_USR-1234567890-mercadopago-access-token";
    const enc = encryptSecret(token);
    expect(enc).not.toContain(token);
    expect(decryptSecret(enc)).toBe(token);
  });

  it("usa IV aleatorio: dos cifrados del mismo texto difieren", () => {
    const a = encryptSecret("mismo-secreto");
    const b = encryptSecret("mismo-secreto");
    expect(a).not.toBe(b);
  });

  it("detecta manipulación: un payload alterado no descifra", () => {
    const enc = encryptSecret("dato-sensible");
    const raw = Buffer.from(enc, "base64");
    const last = raw.length - 1;
    raw[last] = (raw[last] ?? 0) ^ 0xff; // flip del último byte (ciphertext/tag)
    const tampered = raw.toString("base64");
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
