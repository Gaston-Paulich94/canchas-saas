import { describe, it, expect } from "vitest";
import {
  getCustomers,
  getCustomer,
  createCustomer,
  editCustomer,
  removeCustomer,
  getCustomerReservations,
} from "@/modules/customers/application/customer-service";
import { AuthorizationError } from "@/modules/shared/application/authz";
import type { SessionContext } from "@/modules/auth/domain/roles";

/** El guard de rol corre ANTES de tocar la DB: no hace falta Postgres. */
const clienteCtx: SessionContext = {
  userId: "user_cliente",
  tenantId: "00000000-0000-0000-0000-000000000000",
  role: "cliente",
  email: "cliente@x.test",
  name: "Cliente",
};

const customerId = "9b2f8a64-3c1d-4e5f-8a7b-2c9d0e1f3a45";
const input = { name: "Juan", phone: null, email: null, notes: null };

describe("Autorización de clientes (rol cliente denegado)", () => {
  it("getCustomers rechaza a un cliente", async () => {
    await expect(getCustomers(clienteCtx, null)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("getCustomer rechaza a un cliente", async () => {
    await expect(getCustomer(clienteCtx, customerId)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("createCustomer rechaza a un cliente", async () => {
    await expect(createCustomer(clienteCtx, input)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("editCustomer rechaza a un cliente", async () => {
    await expect(
      editCustomer(clienteCtx, customerId, input),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("removeCustomer rechaza a un cliente", async () => {
    await expect(
      removeCustomer(clienteCtx, customerId),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("getCustomerReservations rechaza a un cliente", async () => {
    await expect(
      getCustomerReservations(clienteCtx, customerId),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
