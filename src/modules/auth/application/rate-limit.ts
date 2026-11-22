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
 * Fail-closed: si el contador no se puede consultar (por ejemplo, la base no
 * responde), se deniega igual, pero con su propio resultado ("unavailable") y
 * su propio mensaje: decirle "demasiados intentos" a alguien que no hizo
 * ninguno confunde, y el corte queda registrado en el log del servidor.
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

/** Resultado del chequeo: solo "allowed" deja seguir. */
export type AttemptDecision = "allowed" | "limited" | "unavailable";

/** Mensaje para el usuario cuando el intento NO se permite. */
export const ATTEMPT_DENIED_MESSAGES: Record<
  Exclude<AttemptDecision, "allowed">,
  string
> = {
  limited: "Demasiados intentos. Esperá unos minutos y volvé a intentar.",
  unavailable:
    "No pudimos procesar el pedido en este momento. Intentá de nuevo en unos minutos.",
};

/** Registra el corte sin detalle: un error de conexión puede traer datos de la base. */
function logUnavailable(where: string, err: unknown): void {
  const kind = err instanceof Error ? err.name : "error";
  console.error(`[rate-limit] ${where}: contador no disponible (${kind}); se deniega.`);
}

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
export async function checkLoginAttempt(
  ip: string,
  email: string,
  exec: SqlExecutor = db,
): Promise<AttemptDecision> {
  try {
    const cuenta = email.trim().toLowerCase();
    // Se consumen ambos cupos siempre (no cortocircuitar): el conteo no debe
    // depender de cuál de los dos se agotó primero.
    const [porIp, porCuenta] = await Promise.all([
      withinLimit(exec, `login:ip:${ip}`, AUTH_LIMITS.loginPorIp),
      withinLimit(exec, `login:cuenta:${cuenta}`, AUTH_LIMITS.loginPorCuenta),
    ]);
    maybePrune(exec);
    return porIp && porCuenta ? "allowed" : "limited";
  } catch (err) {
    logUnavailable("login", err);
    return "unavailable";
  }
}

/** ¿Se permite este intento de registro? (cupo por IP) */
export async function checkRegisterAttempt(
  ip: string,
  exec: SqlExecutor = db,
): Promise<AttemptDecision> {
  try {
    const ok = await withinLimit(exec, `registro:ip:${ip}`, AUTH_LIMITS.registroPorIp);
    maybePrune(exec);
    return ok ? "allowed" : "limited";
  } catch (err) {
    logUnavailable("registro", err);
    return "unavailable";
  }
}
