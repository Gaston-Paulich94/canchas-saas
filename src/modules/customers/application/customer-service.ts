import { withTenant } from "@/modules/shared/infrastructure/db/with-tenant";
import { isUniqueViolation } from "@/modules/shared/infrastructure/db/pg-errors";
import { assertRole } from "@/modules/shared/application/authz";
import { ROLES, type SessionContext } from "@/modules/auth/domain/roles";
import type { DbTx } from "@/modules/shared/infrastructure/db/client";
import {
  CustomerNotFoundError,
  PhoneTakenError,
  type Customer,
} from "@/modules/customers/domain/customer";
import type { CustomerInput } from "@/modules/customers/domain/schemas";
import {
  listCustomers,
  findCustomerById,
  findCustomerByPhone,
  insertCustomer,
  insertCustomerIfAbsent,
  updateCustomer,
  deleteCustomer,
} from "@/modules/customers/infrastructure/customer.repository";
import type { Reservation } from "@/modules/reservations/domain/reservation";
import { listReservationsByCustomer } from "@/modules/reservations/infrastructure/reservation.repository";

/**
 * Use-cases de clientes. Mismas reglas transversales que el resto:
 *  - authz (owner|staff) antes de tocar la DB (fail-closed);
 *  - tenant SIEMPRE de la sesión; cliente resuelto por tenant+id (anti-IDOR);
 *  - todo dentro de withTenant() → RLS activa como segunda capa;
 *  - PII (nombre/teléfono/email): nunca se loguea ni viaja en errores.
 */

const MANAGE_ROLES = [ROLES.OWNER, ROLES.STAFF] as const;

function toColumns(input: CustomerInput) {
  return {
    name: input.name,
    phone: input.phone ?? null,
    email: input.email ?? null,
    notes: input.notes ?? null,
  };
}

export async function getCustomers(
  ctx: SessionContext,
  search: string | null,
): Promise<Customer[]> {
  assertRole(ctx, MANAGE_ROLES);
  return withTenant(ctx.tenantId, (tx) =>
    listCustomers(tx, ctx.tenantId, search),
  );
}

export async function getCustomer(
  ctx: SessionContext,
  id: string,
): Promise<Customer> {
  assertRole(ctx, MANAGE_ROLES);
  const found = await withTenant(ctx.tenantId, (tx) =>
    findCustomerById(tx, ctx.tenantId, id),
  );
  if (!found) throw new CustomerNotFoundError();
  return found;
}

export async function createCustomer(
  ctx: SessionContext,
  input: CustomerInput,
): Promise<Customer> {
  assertRole(ctx, MANAGE_ROLES);
  try {
    return await withTenant(ctx.tenantId, (tx) =>
      insertCustomer(tx, { tenantId: ctx.tenantId, ...toColumns(input) }),
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new PhoneTakenError();
    throw err;
  }
}

export async function editCustomer(
  ctx: SessionContext,
  id: string,
  input: CustomerInput,
): Promise<Customer> {
  assertRole(ctx, MANAGE_ROLES);
  try {
    const updated = await withTenant(ctx.tenantId, (tx) =>
      updateCustomer(tx, ctx.tenantId, id, toColumns(input)),
    );
    if (!updated) throw new CustomerNotFoundError();
    return updated;
  } catch (err) {
    if (isUniqueViolation(err)) throw new PhoneTakenError();
    throw err;
  }
}

export async function removeCustomer(
  ctx: SessionContext,
  id: string,
): Promise<void> {
  assertRole(ctx, MANAGE_ROLES);
  const deleted = await withTenant(ctx.tenantId, (tx) =>
    deleteCustomer(tx, ctx.tenantId, id),
  );
  if (!deleted) throw new CustomerNotFoundError();
}

/** Historial de reservas de un cliente del tenant (más recientes primero). */
export async function getCustomerReservations(
  ctx: SessionContext,
  customerId: string,
): Promise<Reservation[]> {
  assertRole(ctx, MANAGE_ROLES);
  return withTenant(ctx.tenantId, async (tx) => {
    const customer = await findCustomerById(tx, ctx.tenantId, customerId);
    if (!customer) throw new CustomerNotFoundError();
    return listReservationsByCustomer(tx, ctx.tenantId, customerId);
  });
}

/**
 * Find-or-create DENTRO de una transacción ya scopeada (lo usa el service de
 * reservas al crear una reserva):
 *  - con teléfono: busca por (tenant, phone); si no existe intenta crear con
 *    ON CONFLICT DO NOTHING (un 23505 crudo abortaría la tx). Si otra tx lo
 *    creó en el medio, re-busca y usa ese — la reserva no falla por la carrera.
 *  - sin teléfono: crea siempre (no hay clave de dedup confiable).
 */
export async function findOrCreateCustomerTx(
  tx: DbTx,
  tenantId: string,
  data: { name: string; phone: string | null },
): Promise<Customer> {
  if (!data.phone) {
    return insertCustomer(tx, { tenantId, name: data.name, phone: null });
  }

  const existing = await findCustomerByPhone(tx, tenantId, data.phone);
  if (existing) return existing;

  const created = await insertCustomerIfAbsent(tx, {
    tenantId,
    name: data.name,
    phone: data.phone,
  });
  if (created) return created;

  // Perdimos la carrera: otra tx creó el cliente con ese teléfono.
  const winner = await findCustomerByPhone(tx, tenantId, data.phone);
  if (!winner) throw new Error("No se pudo vincular el cliente.");
  return winner;
}
