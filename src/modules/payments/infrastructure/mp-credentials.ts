import type { DbTx } from "@/modules/shared/infrastructure/db/client";
import { findTenantById } from "@/modules/tenants/infrastructure/tenant.repository";
import { decryptSecret } from "@/modules/shared/infrastructure/crypto/aes-gcm";
import { MpNotConnectedError } from "@/modules/payments/domain/payment";

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
}

export async function getMpConnectionStatus(
  tx: DbTx,
  tenantId: string,
): Promise<MpConnectionStatus> {
  const tenant = await findTenantById(tx, tenantId);
  return {
    connected: Boolean(tenant?.mpAccessTokenEnc),
    mpUserId: tenant?.mpUserId ?? null,
    expiresAt: tenant?.mpTokenExpiresAt ?? null,
  };
}

/**
 * Access token en claro del complejo. Lanza MpNotConnectedError si todavía no
 * conectó su cuenta. El valor devuelto es sensible: usarlo y descartarlo.
 */
export async function getMpAccessToken(
  tx: DbTx,
  tenantId: string,
): Promise<string> {
  const tenant = await findTenantById(tx, tenantId);
  if (!tenant?.mpAccessTokenEnc) throw new MpNotConnectedError();
  return decryptSecret(tenant.mpAccessTokenEnc);
}
