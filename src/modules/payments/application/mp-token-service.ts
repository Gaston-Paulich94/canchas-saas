import { withTenant } from "@/modules/shared/infrastructure/db/with-tenant";
import { encryptSecret } from "@/modules/shared/infrastructure/crypto/aes-gcm";
import {
  loadMpTokens,
  type StoredMpTokens,
} from "@/modules/payments/infrastructure/mp-credentials";
import { refreshAccessToken } from "@/modules/payments/infrastructure/mp-client";
import { replaceMpTokensIfUnchanged } from "@/modules/tenants/infrastructure/tenant.repository";
import { MpConnectionExpiredError } from "@/modules/payments/domain/payment";
import {
  tokenNeedsRefresh,
  tokenIsExpired,
  expiresAtFrom,
} from "@/modules/payments/domain/mp-token";
import type { MpTokenResponse } from "@/modules/payments/domain/schemas";

/**
 * Access token VÁLIDO de Mercado Pago para un complejo: único punto de entrada
 * para hablar con MP en nombre del complejo (cobrar, vencer links, consultar
 * pagos en el webhook).
 *
 * Si al token le queda menos que el margen, lo renueva con el refresh token y
 * guarda el par nuevo cifrado. Reglas:
 *  - La llamada HTTP de renovación va FUERA de cualquier transacción: leer
 *    (tx) → renovar (HTTP) → guardar (tx).
 *  - Carreras: dos pedidos pueden renovar a la vez. El guardado es un
 *    compare-and-swap sobre el refresh token: si otro ya renovó, no se pisa,
 *    se relee y se usa el suyo.
 *  - Si la renovación falla pero el token actual todavía no venció, se usa el
 *    actual (se reintenta en el próximo uso). Solo si ya venció se corta con
 *    MpConnectionExpiredError, que en la UI pide reconectar.
 */

export interface MpTokenDeps {
  load(tenantId: string): Promise<StoredMpTokens>;
  refresh(refreshToken: string): Promise<MpTokenResponse>;
  saveIfUnchanged(
    tenantId: string,
    expectedRefreshTokenEnc: string,
    tokens: { accessToken: string; refreshToken: string; expiresAt: Date | null },
  ): Promise<boolean>;
  now(): Date;
}

const defaultDeps: MpTokenDeps = {
  load: (tenantId) => withTenant(tenantId, (tx) => loadMpTokens(tx, tenantId)),
  refresh: (refreshToken) => refreshAccessToken(refreshToken),
  saveIfUnchanged: (tenantId, expected, tokens) =>
    withTenant(tenantId, (tx) =>
      replaceMpTokensIfUnchanged(tx, tenantId, expected, {
        mpAccessTokenEnc: encryptSecret(tokens.accessToken),
        mpRefreshTokenEnc: encryptSecret(tokens.refreshToken),
        mpTokenExpiresAt: tokens.expiresAt,
      }),
    ),
  now: () => new Date(),
};

export async function getValidMpAccessToken(
  tenantId: string,
  deps: MpTokenDeps = defaultDeps,
): Promise<string> {
  const stored = await deps.load(tenantId); // MpNotConnectedError si no hay cuenta
  const now = deps.now();

  if (!tokenNeedsRefresh(stored.expiresAt, now)) return stored.accessToken;

  // Sin refresh token no hay cómo renovar: sirve mientras no venza.
  if (!stored.refreshToken || !stored.refreshTokenEnc) {
    if (tokenIsExpired(stored.expiresAt, now)) throw new MpConnectionExpiredError();
    return stored.accessToken;
  }

  let renewed: MpTokenResponse;
  try {
    renewed = await deps.refresh(stored.refreshToken);
  } catch {
    // ¿Lo renovó otro pedido mientras tanto? (su refresh dejó viejo el nuestro)
    const again = await deps.load(tenantId);
    if (
      again.refreshTokenEnc !== stored.refreshTokenEnc &&
      !tokenIsExpired(again.expiresAt, now)
    ) {
      return again.accessToken;
    }
    if (!tokenIsExpired(stored.expiresAt, now)) return stored.accessToken;
    throw new MpConnectionExpiredError();
  }

  const saved = await deps.saveIfUnchanged(tenantId, stored.refreshTokenEnc, {
    accessToken: renewed.access_token,
    // Si MP no manda uno nuevo, el actual sigue vigente.
    refreshToken: renewed.refresh_token ?? stored.refreshToken,
    expiresAt: expiresAtFrom(renewed.expires_in, now),
  });
  if (saved) return renewed.access_token;

  // Perdimos la carrera: otro pedido guardó un par más nuevo. Ese es el vigente.
  const winner = await deps.load(tenantId);
  return winner.accessToken;
}
