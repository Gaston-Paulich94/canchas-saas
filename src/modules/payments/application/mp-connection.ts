import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/env";
import { withTenant } from "@/modules/shared/infrastructure/db/with-tenant";
import { assertRole } from "@/modules/shared/application/authz";
import { ROLES, type SessionContext } from "@/modules/auth/domain/roles";
import { encryptSecret } from "@/modules/shared/infrastructure/crypto/aes-gcm";
import { updateTenantMpCredentials } from "@/modules/tenants/infrastructure/tenant.repository";
import {
  getMpConnectionStatus,
  type MpConnectionStatus,
} from "@/modules/payments/infrastructure/mp-credentials";
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
} from "@/modules/payments/infrastructure/mp-client";
import { MpApiError } from "@/modules/payments/domain/payment";

/**
 * Conexión de la cuenta de Mercado Pago de un complejo (OAuth marketplace).
 *
 * Conectar/desconectar la cuenta que COBRA es una decisión del dueño: se exige
 * rol owner (el staff puede cobrar, pero no cambiar la cuenta de destino).
 *
 * Anti-CSRF: el `state` es aleatorio, de un solo uso, y viaja en una cookie
 * HttpOnly + SameSite=Lax. Al volver, se compara en tiempo constante. Además,
 * el tenant NUNCA sale del state: siempre de la sesión del servidor.
 */

const STATE_COOKIE = "mp_oauth_state";
const STATE_TTL_SECONDS = 10 * 60;

/** URI de retorno registrada en el panel de MP. Constante, jamás del cliente. */
export function mpRedirectUri(): string {
  return new URL("/api/mp/oauth/callback", env.APP_PUBLIC_URL).toString();
}

export async function getConnectionStatus(
  ctx: SessionContext,
): Promise<MpConnectionStatus> {
  assertRole(ctx, [ROLES.OWNER, ROLES.STAFF]);
  return withTenant(ctx.tenantId, (tx) =>
    getMpConnectionStatus(tx, ctx.tenantId),
  );
}

/**
 * Inicia el flujo: genera el state, lo deja en una cookie HttpOnly y devuelve
 * la URL de autorización de Mercado Pago.
 */
export async function startMpConnection(ctx: SessionContext): Promise<string> {
  assertRole(ctx, [ROLES.OWNER]);

  const state = randomBytes(32).toString("base64url");
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  });

  return buildAuthorizationUrl(state, mpRedirectUri());
}

/** Comparación en tiempo constante de dos states. */
function statesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Cierra el flujo: valida el state, canjea el `code` por tokens y los guarda
 * CIFRADOS contra el tenant de la SESIÓN (no el que venga en la URL).
 */
export async function completeMpConnection(
  ctx: SessionContext,
  code: string,
  state: string,
): Promise<void> {
  assertRole(ctx, [ROLES.OWNER]);

  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  // El state es de un solo uso: se borra pase lo que pase.
  jar.delete(STATE_COOKIE);
  if (!expected || !statesMatch(expected, state)) {
    throw new MpApiError("Solicitud de conexión inválida o vencida.");
  }

  const tokens = await exchangeCodeForTokens(code, mpRedirectUri());

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null;

  await withTenant(ctx.tenantId, (tx) =>
    updateTenantMpCredentials(tx, ctx.tenantId, {
      mpUserId: tokens.user_id,
      mpAccessTokenEnc: encryptSecret(tokens.access_token),
      mpRefreshTokenEnc: tokens.refresh_token
        ? encryptSecret(tokens.refresh_token)
        : null,
      mpTokenExpiresAt: expiresAt,
    }),
  );
}

/** Desconecta la cuenta: borra las credenciales guardadas. */
export async function disconnectMp(ctx: SessionContext): Promise<void> {
  assertRole(ctx, [ROLES.OWNER]);
  await withTenant(ctx.tenantId, (tx) =>
    updateTenantMpCredentials(tx, ctx.tenantId, {
      mpUserId: null,
      mpAccessTokenEnc: null,
      mpRefreshTokenEnc: null,
      mpTokenExpiresAt: null,
    }),
  );
}
