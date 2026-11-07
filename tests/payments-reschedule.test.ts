import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb, type TestDb } from "./helpers/postgres";
import { pendingAmountStillValid } from "@/modules/payments/domain/payment";
import { cancelStalePendingPaymentTx } from "@/modules/payments/application/payment-service";
import { arDateTimeToUtc } from "@/modules/reservations/domain/datetime";

/**
 * Hallazgo #14: al reprogramar una reserva, el link de pago ya generado
 * conservaba el importe viejo y el webhook lo aprobaba igual (compara contra
 * el importe guardado). Ahora el cobro pendiente se anula si el turno nuevo
 * cuesta distinto.
 */

describe("pendingAmountStillValid", () => {
  // $12.000 la hora → 60 min = 1.200.000 centavos.
  it("mismo importe (otro horario, u otra cancha al mismo precio): sigue valiendo", () => {
    expect(pendingAmountStillValid(1_200_000, 12_000, 60)).toBe(true);
  });

  it("otra duración: deja de valer", () => {
    expect(pendingAmountStillValid(1_200_000, 12_000, 90)).toBe(false);
  });

  it("otra cancha con otro precio: deja de valer", () => {
    expect(pendingAmountStillValid(1_200_000, 15_000, 60)).toBe(false);
  });

  it("cancha sin precio o duración inválida: deja de valer (fail-closed)", () => {
    expect(pendingAmountStillValid(1_200_000, null, 60)).toBe(false);
    expect(pendingAmountStillValid(1_200_000, 0, 60)).toBe(false);
    expect(pendingAmountStillValid(1_200_000, 12_000, 0)).toBe(false);
    expect(pendingAmountStillValid(1_200_000, 12_000, Number.NaN)).toBe(false);
  });
});

describe("cancelStalePendingPaymentTx — contra Postgres real (rol app_user)", () => {
  let db: TestDb;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const courtA = randomUUID();
  const courtB = randomUUID();
  const D = "2027-06-14";

  async function asTenant<T>(
    tenantId: string,
    fn: (tx: Parameters<Parameters<typeof db.appDb.transaction>[0]>[0]) => Promise<T>,
  ): Promise<T> {
    return db.appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return fn(tx);
    });
  }

  /** Reserva de 60 min con un cobro en el estado pedido. */
  async function reservaConCobro(
    tenantId: string,
    courtId: string,
    hora: string,
    status: "pendiente" | "aprobado",
    preferenceId: string | null,
  ): Promise<{ reservation: { id: string; startsAt: Date; endsAt: Date }; paymentId: string }> {
    const id = randomUUID();
    const paymentId = randomUUID();
    const [h, m] = hora.split(":").map(Number);
    const fin = `${String((h ?? 0) + 1).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}`;
    const startsAt = arDateTimeToUtc(D, hora);
    const endsAt = arDateTimeToUtc(D, fin);
    await db.adminSql`insert into "reservations"
      (id, tenant_id, court_id, starts_at, ends_at, customer_name) values
      (${id}, ${tenantId}, ${courtId}, ${startsAt}, ${endsAt}, 'Cliente')`;
    await db.adminSql`insert into "payments"
      (id, tenant_id, reservation_id, amount_cents, fee_cents, status, mp_preference_id) values
      (${paymentId}, ${tenantId}, ${id}, 1200000, 0, ${status}, ${preferenceId})`;
    return { reservation: { id, startsAt, endsAt }, paymentId };
  }

  async function statusOf(paymentId: string): Promise<string | undefined> {
    const [row] = await db.adminSql`select status from payments where id = ${paymentId}`;
    return row?.status as string | undefined;
  }

  beforeAll(async () => {
    db = await setupTestDb();
    await db.adminSql`insert into "tenants" (id, name, slug) values
      (${tenantA}, 'Complejo A', 'complejo-a'),
      (${tenantB}, 'Complejo B', 'complejo-b')`;
    await db.adminSql`insert into "courts" (id, tenant_id, name, sport, price_per_hour) values
      (${courtA}, ${tenantA}, 'Cancha A1', 'padel', 12000),
      (${courtB}, ${tenantB}, 'Cancha B1', 'padel', 12000)`;
  }, 180_000);

  afterAll(async () => {
    if (db) await db.stop();
  });

  it("el turno nuevo cuesta distinto: anula el pendiente y devuelve su preferencia", async () => {
    const { reservation, paymentId } = await reservaConCobro(tenantA, courtA, "10:00", "pendiente", "pref-1");
    const ids = await asTenant(tenantA, (tx) =>
      cancelStalePendingPaymentTx(tx, tenantA, reservation, 15000),
    );
    expect(ids).toEqual(["pref-1"]);
    expect(await statusOf(paymentId)).toBe("cancelado");
  });

  it("mismo importe: el link sigue vivo", async () => {
    const { reservation, paymentId } = await reservaConCobro(tenantA, courtA, "12:00", "pendiente", "pref-2");
    const ids = await asTenant(tenantA, (tx) =>
      cancelStalePendingPaymentTx(tx, tenantA, reservation, 12000),
    );
    expect(ids).toEqual([]);
    expect(await statusOf(paymentId)).toBe("pendiente");
  });

  it("un cobro APROBADO no se toca aunque cambie el importe", async () => {
    const { reservation, paymentId } = await reservaConCobro(tenantA, courtA, "14:00", "aprobado", "pref-3");
    const ids = await asTenant(tenantA, (tx) =>
      cancelStalePendingPaymentTx(tx, tenantA, reservation, 15000),
    );
    expect(ids).toEqual([]);
    expect(await statusOf(paymentId)).toBe("aprobado");
  });

  it("pendiente sin preferencia todavía: se anula igual, sin nada que vencer en MP", async () => {
    const { reservation, paymentId } = await reservaConCobro(tenantA, courtA, "16:00", "pendiente", null);
    const ids = await asTenant(tenantA, (tx) =>
      cancelStalePendingPaymentTx(tx, tenantA, reservation, null),
    );
    expect(ids).toEqual([]);
    expect(await statusOf(paymentId)).toBe("cancelado");
  });

  it("aislamiento: parado en A no anula un cobro de B", async () => {
    const { reservation, paymentId } = await reservaConCobro(tenantB, courtB, "10:00", "pendiente", "pref-b");
    const ids = await asTenant(tenantA, (tx) =>
      cancelStalePendingPaymentTx(tx, tenantA, reservation, 15000),
    );
    expect(ids).toEqual([]);
    expect(await statusOf(paymentId)).toBe("pendiente");
  });
});
