import type { DbTx } from "@/modules/shared/infrastructure/db/client";
import { findTenantById } from "@/modules/tenants/infrastructure/tenant.repository";
import { decryptSecret } from "@/modules/shared/infrastructure/crypto/aes-gcm";
import { MpNotConnectedError } from "@/modules/payments/domain/payment";
import { tokenIsExpired } from "@/modules/payments/domain/mp-token";

/**
 * Acceso a las credenciales de Mercado Pago de un complejo.
 *
 * Los tokens viven CIFRADOS en la DB (columnas *_enc) y se descifran solo en
 * memoria, justo antes de llamar a la API de MP. Nunca se loguean, nunca se
 * serializan al cliente y nunca salen de la capa de servidor.
 */

/** Estado de conexión, apto para mostrar en la UI (sin secretos). */
export interface MpConnectionStatus {
  connected: boolean;
  mpUserId: string | null;
  expiresAt: Date | null;
  /** Conectada pero con el token vencido (no se pudo renovar): hay que reconectar. */
  expired: boolean;
}

export async function getMpConnectionStatus(
  tx: DbTx,
  tenantId: string,
  now: Date = new Date(),
): Promise<MpConnectionStatus> {
  const tenant = await findTenantById(tx, tenantId);
  const connected = Boolean(tenant?.mpAccessTokenEnc);
  const expiresAt = tenant?.mpTokenExpiresAt ?? null;
  return {
    connected,
    mpUserId: tenant?.mpUserId ?? null,
    expiresAt,
    expired: connected && tokenIsExpired(expiresAt, now),
  };
}

/** Tokens guardados de un complejo, descifrados. Sensibles: usar y descartar. */
export interface StoredMpTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  /** Valor cifrado actual del refresh token: versión para el compare-and-swap. */
  refreshTokenEnc: string | null;
}

/**
 * Lee los tokens del complejo. NO renueva: para usarlos contra MP, siempre
 * `getValidMpAccessToken` (application/mp-token-service), que renueva si hace
 * falta. Lanza MpNotConnectedError si la cuenta no está conectada.
 */
export async function loadMpTokens(
  tx: DbTx,
  tenantId: string,
): Promise<StoredMpTokens> {
  const tenant = await findTenantById(tx, tenantId);
  if (!tenant?.mpAccessTokenEnc) throw new MpNotConnectedError();
  return {
    accessToken: decryptSecret(tenant.mpAccessTokenEnc),
    refreshToken: tenant.mpRefreshTokenEnc
      ? decryptSecret(tenant.mpRefreshTokenEnc)
      : null,
    expiresAt: tenant.mpTokenExpiresAt,
    refreshTokenEnc: tenant.mpRefreshTokenEnc,
  };
}
