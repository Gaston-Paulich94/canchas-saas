import { sql } from "drizzle-orm";
import type { db } from "@/modules/shared/infrastructure/db/client";

/**
 * Contador de rate-limit en Postgres (ventana fija por clave).
 *
 * Una sola sentencia INSERT … ON CONFLICT DO UPDATE: atómica aun con requests
 * concurrentes, así N intentos en paralelo cuentan N (no se "pierden" en una
 * carrera de lectura-escritura). Parámetros ligados, sin SQL concatenado.
 */

/** Cualquier cliente Drizzle capaz de ejecutar SQL (inyectable en tests). */
export type SqlExecutor = Pick<typeof db, "execute">;

/**
 * Registra un intento para `keyHash` y devuelve cuántos lleva en la ventana
 * vigente. Si la ventana venció, el contador arranca de nuevo en 1.
 */
export async function consumeRateLimit(
  exec: SqlExecutor,
  keyHash: string,
  windowSeconds: number,
): Promise<number> {
  const result = await exec.execute(sql`
    insert into auth_rate_limits (key_hash, count, window_start)
    values (${keyHash}, 1, now())
    on conflict (key_hash) do update set
      count = case
        when auth_rate_limits.window_start
             <= now() - make_interval(secs => ${windowSeconds}::double precision)
        then 1
        else auth_rate_limits.count + 1
      end,
      window_start = case
        when auth_rate_limits.window_start
             <= now() - make_interval(secs => ${windowSeconds}::double precision)
        then now()
        else auth_rate_limits.window_start
      end,
      updated_at = now()
    returning count
  `);
  const rows = result as unknown as Array<{ count: number | string }>;
  const count = rows[0]?.count;
  // Sin fila devuelta no hay forma de saber cuántos van: se trata como excedido.
  return count === undefined ? Number.MAX_SAFE_INTEGER : Number(count);
}

/** Borra contadores viejos (la tabla no crece sin límite). */
export async function pruneRateLimits(exec: SqlExecutor): Promise<void> {
  await exec.execute(
    sql`delete from auth_rate_limits where window_start < now() - interval '1 day'`,
  );
}
