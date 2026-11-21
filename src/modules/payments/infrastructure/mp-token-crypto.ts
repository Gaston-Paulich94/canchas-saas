import {
  encryptSecret,
  decryptSecret,
} from "@/modules/shared/infrastructure/crypto/aes-gcm";

/**
 * Cifrado de los tokens de Mercado Pago de un complejo. El AAD ata cada valor
 * a su complejo y a su columna: un token copiado a otro complejo, o el access
 * token puesto en lugar del refresh, no descifra.
 */

export type MpTokenKind = "access" | "refresh";

function aadFor(tenantId: string, kind: MpTokenKind): string {
  return `tenant:${tenantId}:mp_${kind}_token`;
}

export function encryptMpToken(
  tenantId: string,
  kind: MpTokenKind,
  token: string,
): string {
  return encryptSecret(token, aadFor(tenantId, kind));
}

export function decryptMpToken(
  tenantId: string,
  kind: MpTokenKind,
  encrypted: string,
): string {
  return decryptSecret(encrypted, aadFor(tenantId, kind));
}
