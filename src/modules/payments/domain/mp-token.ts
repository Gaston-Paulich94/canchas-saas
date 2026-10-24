/**
 * Vigencia del access token de Mercado Pago de un complejo — lógica PURA.
 *
 * MP entrega un access token con vencimiento (expires_in) y un refresh token
 * para renovarlo. Se renueva "a demanda": al usarlo, si le queda menos que el
 * margen. Así un complejo que cobra seguido nunca llega al vencimiento, y uno
 * que estuvo inactivo lo renueva en su próximo uso.
 */

/** Se renueva cuando le quedan menos de 7 días. */
export const TOKEN_REFRESH_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ¿Hay que renovarlo? Sin vencimiento conocido (MP no informó expires_in) no se
 * intenta: no hay dato para decidir y renovar de más gasta el refresh token.
 */
export function tokenNeedsRefresh(
  expiresAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - now.getTime() < TOKEN_REFRESH_MARGIN_MS;
}

/** ¿Ya venció? Un token vencido no sirve aunque no se haya podido renovar. */
export function tokenIsExpired(
  expiresAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() <= now.getTime();
}

/** Fecha de vencimiento a partir del `expires_in` (segundos) que da MP. */
export function expiresAtFrom(
  expiresInSeconds: number | undefined,
  now: Date = new Date(),
): Date | null {
  if (!expiresInSeconds || expiresInSeconds <= 0) return null;
  return new Date(now.getTime() + expiresInSeconds * 1000);
}
