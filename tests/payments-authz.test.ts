import { describe, it, expect } from "vitest";
import {
  createPaymentLink,
  cancelPayment,
  getReservationPayments,
} from "@/modules/payments/application/payment-service";
import {
  startMpConnection,
  disconnectMp,
} from "@/modules/payments/application/mp-connection";
import { AuthorizationError } from "@/modules/shared/application/authz";
import type { SessionContext } from "@/modules/auth/domain/roles";

/**
 * El guard de rol corre ANTES de tocar la DB o Mercado Pago.
 *
 * Además del `cliente` (que no gestiona cobros), acá importa el caso del
 * `staff`: puede cobrar, pero NO cambiar la cuenta de Mercado Pago que recibe
 * la plata — eso es exclusivo del owner.
 */
const clienteCtx: SessionContext = {
  userId: "user_cliente",
  tenantId: "00000000-0000-0000-0000-000000000000",
  role: "cliente",
  email: "cliente@x.test",
  name: "Cliente",
};

const reservationId = "9b2f8a64-3c1d-4e5f-8a7b-2c9d0e1f3a45";
const paymentId = "7c1e9d52-8b4a-4f6c-9d3e-1a2b3c4d5e6f";

describe("Autorización de cobros (rol cliente denegado)", () => {
  it("createPaymentLink rechaza a un cliente", async () => {
    await expect(
      createPaymentLink(clienteCtx, reservationId),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("cancelPayment rechaza a un cliente", async () => {
    await expect(
      cancelPayment(clienteCtx, paymentId),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("getReservationPayments rechaza a un cliente", async () => {
    await expect(
      getReservationPayments(clienteCtx, reservationId),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("Conexión de Mercado Pago (solo el dueño)", () => {
  const staffCtx: SessionContext = {
    userId: "user_staff",
    tenantId: "00000000-0000-0000-0000-000000000000",
    role: "staff",
    email: "staff@x.test",
    name: "Staff",
  };

  it("el staff NO puede conectar la cuenta que recibe la plata", async () => {
    await expect(startMpConnection(staffCtx)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("el staff NO puede desconectar la cuenta", async () => {
    await expect(disconnectMp(staffCtx)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("un cliente tampoco puede conectar la cuenta", async () => {
    await expect(startMpConnection(clienteCtx)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
