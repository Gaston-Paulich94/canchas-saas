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
 * Formato del payload:
 *   "v2:" + base64( IV (12 bytes) | authTag (16 bytes) | ciphertext (n bytes) )
 *
 * Garantías:
 *  - Confidencialidad + integridad (GCM detecta manipulación → falla al
 *    descifrar, nunca devuelve texto corrupto).
 *  - IV aleatorio por operación (nunca se reusa nonce con la misma clave).
 *  - AAD obligatorio: ata cada valor cifrado a su contexto (por ejemplo,
 *    complejo + tipo de token). Sin eso, alguien con escritura en la base
 *    podía copiar el token cifrado de un complejo a otro, o cambiar el access
 *    token por el refresh, y se descifraba igual. Con AAD distinto, falla.
 *  - Nada de esto se loguea jamás.
 *
 * El formato anterior (sin prefijo ni AAD) se rechaza a propósito: aceptarlo
 * dejaría abierto justo el intercambio que el AAD evita. No había valores
 * guardados en ese formato fuera de entornos locales; quien tuviera uno
 * reconecta la cuenta de Mercado Pago.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // 96 bits, recomendado para GCM
const TAG_LEN = 16; // 128 bits
const VERSION_PREFIX = "v2:";

function key(): Buffer {
  // env ya validó que decodifica a 32 bytes exactos.
  return Buffer.from(env.MP_TOKEN_ENC_KEY, "base64");
}

function assertAad(aad: string): void {
  if (!aad) throw new Error("El contexto (AAD) del cifrado es obligatorio.");
}

export function encryptSecret(plaintext: string, aad: string): string {
  assertAad(aad);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return VERSION_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecret(payload: string, aad: string): string {
  assertAad(aad);
  if (!payload.startsWith(VERSION_PREFIX)) {
    throw new Error("Payload cifrado inválido.");
  }
  const raw = Buffer.from(payload.slice(VERSION_PREFIX.length), "base64");
  if (raw.length < IV_LEN + TAG_LEN) {
    throw new Error("Payload cifrado inválido.");
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
