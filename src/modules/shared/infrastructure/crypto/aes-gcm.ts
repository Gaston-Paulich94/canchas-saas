import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { env } from "@/env";

/**
 * Cifrado autenticado AES-256-GCM para secretos at-rest (tokens OAuth de
 * Mercado Pago). La clave (32 bytes) viene de MP_TOKEN_ENC_KEY (base64).
 *
 * Formato del payload (todo en una cadena base64):
 *   [ IV (12 bytes) | authTag (16 bytes) | ciphertext (n bytes) ]
 *
 * Garantías:
 *  - Confidencialidad + integridad (GCM detecta manipulación → falla al
 *    descifrar, nunca devuelve texto corrupto).
 *  - IV aleatorio por operación (nunca se reusa nonce con la misma clave).
 *  - Nada de esto se loguea jamás.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // 96 bits, recomendado para GCM
const TAG_LEN = 16; // 128 bits

function key(): Buffer {
  // env ya validó que decodifica a 32 bytes exactos.
  return Buffer.from(env.MP_TOKEN_ENC_KEY, "base64");
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  if (raw.length < IV_LEN + TAG_LEN) {
    throw new Error("Payload cifrado inválido.");
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
