import { sql } from "drizzle-orm";
import { db, type DbTx } from "./client";

/**
 * Ejecución scopeada por contexto de tenant/usuario.
 *
 * Abre una transacción y fija variables de sesión LOCAL (viven solo dentro de
 * la transacción) que las políticas RLS leen con current_setting(). Usamos
 * `set_config(name, value, is_local=true)` en lugar de `SET LOCAL ... = valor`
 * porque set_config acepta el valor como PARÁMETRO ligado: nada de interpolar
 * strings en SQL (sin riesgo de inyección por el valor).
 *
 * Reglas (hardening #3):
 *  - Toda query scopeada por tenant pasa por `withTenant()`.
 *  - Si una query se escapa de acá, corre SIN tenant seteado y RLS la deja en
 *    cero filas (fail-closed): es un bug, no un riesgo de fuga.
 */

type ScopedFn<T> = (tx: DbTx) => Promise<T>;

async function runScoped<T>(
  settings: Record<string, string>,
  fn: ScopedFn<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    for (const [name, value] of Object.entries(settings)) {
      // name y value van como parámetros ligados, no interpolados.
      await tx.execute(sql`select set_config(${name}, ${value}, true)`);
    }
    return fn(tx);
  });
}

/**
 * Contexto de tenant: setea app.tenant_id. Es el camino por defecto para TODA
 * query de negocio.
 */
export function withTenant<T>(tenantId: string, fn: ScopedFn<T>): Promise<T> {
  return runScoped({ "app.tenant_id": tenantId }, fn);
}

/**
 * Contexto de "sí mismo": setea app.user_id. Uso ACOTADO al bootstrap de auth,
 * donde todavía no conocemos el tenant (ej. leer el propio profile recién
 * logueado). La policy `profiles_self` permite ver únicamente la fila propia.
 */
export function withSelf<T>(userId: string, fn: ScopedFn<T>): Promise<T> {
  return runScoped({ "app.user_id": userId }, fn);
}

/**
 * Contexto combinado para el alta inicial (registro de owner): crea el tenant y
 * su primer profile en una sola transacción, con ambos settings fijados para
 * que el WITH CHECK de RLS pase.
 */
export function withTenantAndSelf<T>(
  tenantId: string,
  userId: string,
  fn: ScopedFn<T>,
): Promise<T> {
  return runScoped(
    { "app.tenant_id": tenantId, "app.user_id": userId },
    fn,
  );
}
