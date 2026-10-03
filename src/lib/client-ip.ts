/**
 * IP del cliente para el rate-limit, a partir de los headers del request.
 *
 * Orden de confianza:
 *  1. `x-real-ip`: Vercel lo fija con la IP real y pisa el que mande el cliente.
 *     Detrás de Caddy (prod en VPS) hay que configurarlo explícitamente:
 *       header_up X-Real-IP {remote_host}
 *  2. el ÚLTIMO valor de `x-forwarded-for`: lo agrega nuestro proxy; los
 *     anteriores los puede inventar el cliente, por eso no se toma el primero.
 *
 * Si la app quedara expuesta SIN proxy, el cliente podría falsear estos
 * headers y esquivar el límite por IP; el límite por cuenta sigue vigente.
 */
export function clientIpFrom(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last;
  }

  return "unknown";
}
