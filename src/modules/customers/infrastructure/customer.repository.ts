import { and, eq, or, ilike, asc } from "drizzle-orm";
import type { DbTx } from "@/modules/shared/infrastructure/db/client";
import {
  customers,
  type Customer,
  type NewCustomer,
} from "@/modules/shared/infrastructure/db/schema";

/**
 * Acceso a customers. TODA query filtra explícitamente por `tenant_id` (capa de
 * app) ADEMÁS de la RLS. Drizzle parametrizado; la búsqueda escapa los
 * comodines de LIKE del input (%, _) para que no actúen como patrón.
 */

function likePattern(search: string): string {
  const escaped = search.replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
}

export async function listCustomers(
  tx: DbTx,
  tenantId: string,
  search: string | null,
): Promise<Customer[]> {
  const base = eq(customers.tenantId, tenantId);
  const where = search
    ? and(
        base,
        or(
          ilike(customers.name, likePattern(search)),
          ilike(customers.phone, likePattern(search)),
        ),
      )
    : base;

  return tx.select().from(customers).where(where).orderBy(asc(customers.name));
}

export async function findCustomerById(
  tx: DbTx,
  tenantId: string,
  id: string,
): Promise<Customer | null> {
  const rows = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findCustomerByPhone(
  tx: DbTx,
  tenantId: string,
  phone: string,
): Promise<Customer | null> {
  const rows = await tx
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.phone, phone)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertCustomer(
  tx: DbTx,
  data: NewCustomer,
): Promise<Customer> {
  const rows = await tx.insert(customers).values(data).returning();
  const row = rows[0];
  if (!row) throw new Error("No se pudo crear el cliente.");
  return row;
}

/**
 * Insert tolerante a duplicados (ON CONFLICT DO NOTHING): si el teléfono ya
 * existe devuelve null SIN abortar la transacción (dentro de una tx, un 23505
 * la dejaría inutilizable). Lo usa el find-or-create del alta de reservas.
 */
export async function insertCustomerIfAbsent(
  tx: DbTx,
  data: NewCustomer,
): Promise<Customer | null> {
  const rows = await tx
    .insert(customers)
    .values(data)
    .onConflictDoNothing()
    .returning();
  return rows[0] ?? null;
}

export async function updateCustomer(
  tx: DbTx,
  tenantId: string,
  id: string,
  patch: Partial<Omit<NewCustomer, "id" | "tenantId">>,
): Promise<Customer | null> {
  const rows = await tx
    .update(customers)
    .set(patch)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, id)))
    .returning();
  return rows[0] ?? null;
}

/** Borra un cliente del tenant (las reservas quedan con customer_id NULL). */
export async function deleteCustomer(
  tx: DbTx,
  tenantId: string,
  id: string,
): Promise<boolean> {
  const rows = await tx
    .delete(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, id)))
    .returning({ id: customers.id });
  return rows.length > 0;
}
