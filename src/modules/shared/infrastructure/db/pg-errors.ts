/**
 * Detección de errores de Postgres por código SQLSTATE.
 *
 * Drizzle envuelve el error del driver en DrizzleQueryError y deja el original
 * en `cause`; postgres.js expone `code` en el error crudo. Por eso NO alcanza
 * con mirar `err.code`: hay que recorrer la cadena de `cause`.
 */

export const PG_UNIQUE_VIOLATION = "23505";
export const PG_EXCLUSION_VIOLATION = "23P01";

export function hasPgErrorCode(err: unknown, code: string): boolean {
  let current: unknown = err;
  // Cadena de causes acotada (evita ciclos raros).
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === code
    ) {
      return true;
    }
    current =
      typeof current === "object" && "cause" in current
        ? (current as { cause?: unknown }).cause
        : null;
  }
  return false;
}

export function isUniqueViolation(err: unknown): boolean {
  return hasPgErrorCode(err, PG_UNIQUE_VIOLATION);
}

export function isExclusionViolation(err: unknown): boolean {
  return hasPgErrorCode(err, PG_EXCLUSION_VIOLATION);
}
