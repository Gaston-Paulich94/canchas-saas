import { createHmac } from "node:crypto";
import { env } from "@/env";
import { db } from "@/modules/shared/infrastructure/db/client";
import {
  consumeRateLimit,
  pruneRateLimits,
  type SqlExecutor,
} from "@/modules/auth/infrastructure/rate-limit.repository";

/**
 * Rate-limit de login y registro (anti fuerza bruta, OWASP A07 / ASVS V2.2).
 *
 * Por qué es propio y no el de better-auth: el limitador de better-auth solo
 * actúa en su router HTTP (`/api/auth/*`), y nuestros formularios llaman a
 * `auth.api.*` desde Server Actions, que NO pasan por ahí. Para no dejar dos
 * caminos, los endpoints HTTP de sign-in/sign-up están deshabilitados en
 * `lib/auth.ts` y este limitador es el único punto de entrada.
 *
 * Dos claves por intento de login:
 *  - por IP: frena a un atacante probando muchas cuentas;
 *  - por cuenta: frena la fuerza bruta distribuida (muchas IPs, una cuenta).
 *    Contrapartida conocida: un atacante puede bloquear temporalmente una
 *    cuenta; es una ventana corta y es el trade-off estándar (ASVS V2.2.1).
 *
 * Fail-closed: si el contador no se puede consultar, se deniega.
 */

interface Limit {
  max: number;
  windowSeconds: number;
}

export const AUTH_LIMITS = {
  loginPorIp: { max: 20, windowSeconds: 10 * 60 },
  loginPorCuenta: { max: 10, windowSeconds: 15 * 60 },
  registroPorIp: { max: 5, windowSeconds: 60 * 60 },
} as const satisfies Record<string, Limit>;

export const TOO_MANY_ATTEMPTS_MESSAGE =
  "Demasiados intentos. Esperá unos minutos y volvé a intentar.";

/**
 * HMAC de la clave lógica: la tabla nunca guarda emails ni IPs en claro, y
 * sin el secreto del servidor no se pueden recalcular (ni por diccionario).
 */
export function rateLimitKeyHash(key: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`rate-limit:${key}`)
    .digest("hex");
}

async function withinLimit(
  exec: SqlExecutor,
  key: string,
  limit: Limit,
): Promise<boolean> {
  const count = await consumeRateLimit(
    exec,
    rateLimitKeyHash(key),
    limit.windowSeconds,
  );
  return count <= limit.max;
}

/** Limpieza oportunista de contadores viejos (sin bloquear el request). */
function maybePrune(exec: SqlExecutor): void {
  if (Math.random() < 0.02) {
    pruneRateLimits(exec).catch(() => {
      /* la limpieza es best-effort */
    });
  }
}

/** ¿Se permite este intento de login? Consume el cupo de IP y de cuenta. */
export async function isLoginAllowed(
  ip: string,
  email: string,
  exec: SqlExecutor = db,
): Promise<boolean> {
  try {
    const cuenta = email.trim().toLowerCase();
    // Se consumen ambos cupos siempre (no cortocircuitar): el conteo no debe
    // depender de cuál de los dos se agotó primero.
    const [porIp, porCuenta] = await Promise.all([
      withinLimit(exec, `login:ip:${ip}`, AUTH_LIMITS.loginPorIp),
      withinLimit(exec, `login:cuenta:${cuenta}`, AUTH_LIMITS.loginPorCuenta),
    ]);
    maybePrune(exec);
    return porIp && porCuenta;
  } catch {
    return false;
  }
}

/** ¿Se permite este intento de registro? (cupo por IP) */
export async function isRegisterAllowed(
  ip: string,
  exec: SqlExecutor = db,
): Promise<boolean> {
  try {
    const ok = await withinLimit(exec, `registro:ip:${ip}`, AUTH_LIMITS.registroPorIp);
    maybePrune(exec);
    return ok;
  } catch {
    return false;
  }
}
