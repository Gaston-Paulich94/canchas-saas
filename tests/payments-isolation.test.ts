import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb, type TestDb } from "./helpers/postgres";
import {
  insertPayment,
  findPaymentById,
  findActivePaymentByReservation,
  updatePayment,
  cancelPendingPaymentsForReservation,
} from "@/modules/payments/infrastructure/payment.repository";
import { arDateTimeToUtc } from "@/modules/reservations/domain/datetime";
import { isUniqueViolation } from "@/modules/shared/infrastructure/db/pg-errors";
import {
  decidePaymentUpdate,
  needsRefund,
} from "@/modules/payments/domain/payment";

/**
 * Pagos contra Postgres real con el rol app_user (respeta RLS):
 * aislamiento, IDOR, idempotencia del webhook, anti doble cobro y la función
 * acotada que usa el webhook para resolver el tenant.
 */
describe("Pagos — aislamiento, idempotencia y anti doble cobro", () => {
  let db: TestDb;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = `user_${randomUUID()}`;
  const userB = `user_${randomUUID()}`;
  const courtA = randomUUID();
  const courtB = randomUUID();
  const reservationA = randomUUID();
  const reservationA2 = randomUUID();
  const reservationB = randomUUID();
  const paymentB = randomUUID(); // pago del tenant B

  const D = "2027-05-10";

  async function asTenant<T>(
    tenantId: string,
    fn: (tx: Parameters<Parameters<typeof db.appDb.transaction>[0]>[0]) => Promise<T>,
  ): Promise<T> {
    return db.appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return fn(tx);
    });
  }

  beforeAll(async () => {
    db = await setupTestDb();
    const { adminSql } = db;
    await adminSql`insert into "user" (id, name, email) values
      (${userA}, 'Owner A', 'a@complejo.test'),
      (${userB}, 'Owner B', 'b@complejo.test')`;
    await adminSql`insert into "tenants" (id, name, slug) values
      (${tenantA}, 'Complejo A', 'complejo-a'),
      (${tenantB}, 'Complejo B', 'complejo-b')`;
    await adminSql`insert into "profiles" (user_id, tenant_id, role) values
      (${userA}, ${tenantA}, 'owner'),
      (${userB}, ${tenantB}, 'owner')`;
    await adminSql`insert into "courts" (id, tenant_id, name, sport, price_per_hour) values
      (${courtA}, ${tenantA}, 'Cancha A1', 'padel', 12000),
      (${courtB}, ${tenantB}, 'Cancha B1', 'padel', 15000)`;
    await adminSql`insert into "reservations"
      (id, tenant_id, court_id, starts_at, ends_at, customer_name) values
      (${reservationA}, ${tenantA}, ${courtA},
       ${arDateTimeToUtc(D, "18:00")}, ${arDateTimeToUtc(D, "19:00")}, 'Cliente A'),
      (${reservationA2}, ${tenantA}, ${courtA},
       ${arDateTimeToUtc(D, "20:00")}, ${arDateTimeToUtc(D, "21:00")}, 'Cliente A2'),
      (${reservationB}, ${tenantB}, ${courtB},
       ${arDateTimeToUtc(D, "18:00")}, ${arDateTimeToUtc(D, "19:00")}, 'Cliente B')`;
    await adminSql`insert into "payments"
      (id, tenant_id, reservation_id, amount_cents, fee_cents, status, mp_payment_id) values
      (${paymentB}, ${tenantB}, ${reservationB}, 1500000, 0, 'pendiente', 'mp-b-1')`;
  }, 180_000);

  afterAll(async () => {
    if (db) await db.stop();
  });

  // ── Aislamiento ────────────────────────────────────────────────────────────

  it("(a) parado en A, leer un pago de B por id vuelve null", async () => {
    const found = await asTenant(tenantA, (tx) =>
      findPaymentById(tx, tenantA, paymentB),
    );
    expect(found).toBeNull();
  });

  it("(b) RLS bloquea el bypass directo: SELECT sin filtro no ve pagos de B", async () => {
    await db.appSql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantA}, true)`;
      const all = await tx`select tenant_id from payments`;
      expect(all.map((r) => r.tenant_id as string)).not.toContain(tenantB);
    });
  });

  it("sin contexto de tenant no se ve ningún pago (fail-closed)", async () => {
    await db.appSql.begin(async (tx) => {
      const all = await tx`select * from payments`;
      expect(all).toHaveLength(0);
    });
  });

  it("IDOR: A no puede modificar un pago de B", async () => {
    const updated = await asTenant(tenantA, (tx) =>
      updatePayment(tx, tenantA, paymentB, { status: "aprobado" }),
    );
    expect(updated).toBeNull();

    const [row] = await db.adminSql`
      select status from payments where id = ${paymentB}`;
    expect(row?.status).toBe("pendiente");
  });

  it("WITH CHECK impide crear un pago de OTRO tenant", async () => {
    await expect(
      asTenant(tenantA, (tx) =>
        insertPayment(tx, {
          tenantId: tenantB,
          reservationId: reservationB,
          amountCents: 100000,
          feeCents: 0,
        }),
      ),
    ).rejects.toThrow();
  });

  // ── Anti doble cobro / idempotencia ────────────────────────────────────────

  it("una reserva no puede tener DOS pagos vivos a la vez", async () => {
    await asTenant(tenantA, (tx) =>
      insertPayment(tx, {
        tenantId: tenantA,
        reservationId: reservationA,
        amountCents: 1_200_000,
        feeCents: 0,
      }),
    );

    await expect(
      asTenant(tenantA, (tx) =>
        insertPayment(tx, {
          tenantId: tenantA,
          reservationId: reservationA,
          amountCents: 1_200_000,
          feeCents: 0,
        }),
      ),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("CARRERA: dos links simultáneos para la misma reserva → uno solo entra", async () => {
    const attempt = () =>
      asTenant(tenantA, (tx) =>
        insertPayment(tx, {
          tenantId: tenantA,
          reservationId: reservationA2,
          amountCents: 1_200_000,
          feeCents: 0,
        }),
      );

    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("anular un pago libera el cupo para generar uno nuevo", async () => {
    const active = await asTenant(tenantA, (tx) =>
      findActivePaymentByReservation(tx, tenantA, reservationA),
    );
    expect(active).not.toBeNull();

    await asTenant(tenantA, (tx) =>
      updatePayment(tx, tenantA, active!.id, { status: "cancelado" }),
    );

    const nuevo = await asTenant(tenantA, (tx) =>
      insertPayment(tx, {
        tenantId: tenantA,
        reservationId: reservationA,
        amountCents: 1_200_000,
        feeCents: 0,
      }),
    );
    expect(nuevo.status).toBe("pendiente");
  });

  it("IDEMPOTENCIA: el mismo mp_payment_id no se puede registrar dos veces en el tenant", async () => {
    const p1 = await asTenant(tenantA, (tx) =>
      insertPayment(tx, {
        tenantId: tenantA,
        reservationId: reservationA2,
        amountCents: 500_000,
        feeCents: 0,
        status: "cancelado",
        mpPaymentId: "mp-dup-1",
      }),
    );
    expect(p1.mpPaymentId).toBe("mp-dup-1");

    await expect(
      asTenant(tenantA, (tx) =>
        insertPayment(tx, {
          tenantId: tenantA,
          reservationId: reservationA2,
          amountCents: 500_000,
          feeCents: 0,
          status: "cancelado",
          mpPaymentId: "mp-dup-1",
        }),
      ),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("el mismo mp_payment_id en OTRO tenant sí es válido (unique por tenant)", async () => {
    const created = await asTenant(tenantB, (tx) =>
      insertPayment(tx, {
        tenantId: tenantB,
        reservationId: reservationB,
        amountCents: 500_000,
        feeCents: 0,
        status: "cancelado",
        mpPaymentId: "mp-dup-1",
      }),
    );
    expect(created.tenantId).toBe(tenantB);
  });

  it("pago tardío (regresión): reactivarlo chocaba con el índice; el patch decidido no", async () => {
    const r = randomUUID();
    await db.adminSql`insert into "reservations"
      (id, tenant_id, court_id, starts_at, ends_at, customer_name) values
      (${r}, ${tenantA}, ${courtA},
       ${arDateTimeToUtc(D, "22:00")}, ${arDateTimeToUtc(D, "23:00")}, 'Pago tardío')`;

    // El operador anuló el primer link y generó uno nuevo.
    const viejo = await asTenant(tenantA, (tx) =>
      insertPayment(tx, {
        tenantId: tenantA,
        reservationId: r,
        amountCents: 1_200_000,
        feeCents: 0,
        status: "cancelado",
      }),
    );
    await asTenant(tenantA, (tx) =>
      insertPayment(tx, { tenantId: tenantA, reservationId: r, amountCents: 1_200_000, feeCents: 0 }),
    );

    // Lo que hacía el webhook antes: pasar el link viejo a "aprobado" => 23505,
    // la ruta devolvía 500 y MP reintentaba para siempre.
    await expect(
      asTenant(tenantA, (tx) =>
        updatePayment(tx, tenantA, viejo.id, {
          status: "aprobado",
          mpPaymentId: "mp-tardio",
          paidAt: new Date(),
        }),
      ),
    ).rejects.toSatisfy(isUniqueViolation);

    // Lo que decide ahora: registrarlo como plata a devolver, sin reactivarlo.
    const decision = decidePaymentUpdate(
      viejo,
      { status: "aprobado", mpPaymentId: "mp-tardio", approvedAt: new Date() },
      { reservaCancelada: false, otroCobroActivo: true },
    );
    expect(decision.kind).toBe("actualizar");
    if (decision.kind !== "actualizar") return;

    const updated = await asTenant(tenantA, (tx) =>
      updatePayment(tx, tenantA, viejo.id, decision.patch),
    );
    expect(updated?.status).toBe("cancelado");
    expect(updated?.mpPaymentId).toBe("mp-tardio");
    expect(updated && needsRefund(updated)).toBe(true);
  });

  it("cancelar la reserva anula SOLO sus cobros pendientes y devuelve los links a vencer", async () => {
    const r1 = randomUUID();
    const r2 = randomUUID();
    await db.adminSql`insert into "reservations"
      (id, tenant_id, court_id, starts_at, ends_at, customer_name) values
      (${r1}, ${tenantA}, ${courtA}, ${arDateTimeToUtc(D, "08:00")}, ${arDateTimeToUtc(D, "09:00")}, 'A cancelar'),
      (${r2}, ${tenantA}, ${courtA}, ${arDateTimeToUtc(D, "09:00")}, ${arDateTimeToUtc(D, "10:00")}, 'Otra')`;

    const pendiente = await asTenant(tenantA, (tx) =>
      insertPayment(tx, { tenantId: tenantA, reservationId: r1, amountCents: 1_200_000, feeCents: 0, mpPreferenceId: "pref-r1" }),
    );
    const rechazado = await asTenant(tenantA, (tx) =>
      insertPayment(tx, { tenantId: tenantA, reservationId: r1, amountCents: 1_200_000, feeCents: 0, status: "rechazado" }),
    );
    const deOtraReserva = await asTenant(tenantA, (tx) =>
      insertPayment(tx, { tenantId: tenantA, reservationId: r2, amountCents: 1_200_000, feeCents: 0, mpPreferenceId: "pref-r2" }),
    );

    const ids = await asTenant(tenantA, (tx) =>
      cancelPendingPaymentsForReservation(tx, tenantA, r1),
    );
    expect(ids).toEqual(["pref-r1"]);

    const [p1] = await db.adminSql`select status from payments where id = ${pendiente.id}`;
    const [p2] = await db.adminSql`select status from payments where id = ${rechazado.id}`;
    const [p3] = await db.adminSql`select status from payments where id = ${deOtraReserva.id}`;
    expect(p1?.status).toBe("cancelado");
    expect(p2?.status).toBe("rechazado"); // no pendientes: intactos
    expect(p3?.status).toBe("pendiente"); // otra reserva: intacta
  });

  it("IDOR: A no puede anular los cobros de una reserva de B", async () => {
    const ids = await asTenant(tenantA, (tx) =>
      cancelPendingPaymentsForReservation(tx, tenantA, reservationB),
    );
    expect(ids).toEqual([]);
    const [row] = await db.adminSql`select status from payments where id = ${paymentB}`;
    expect(row?.status).toBe("pendiente");
  });

  // ── Función de resolución del webhook ──────────────────────────────────────

  it("resolve_payment_tenant devuelve el tenant correcto (camino del webhook)", async () => {
    const [row] = await db.appSql`
      select resolve_payment_tenant(${paymentB}::uuid) as tenant_id`;
    expect(row?.tenant_id).toBe(tenantB);
  });

  it("resolve_payment_tenant devuelve null para un id inexistente", async () => {
    const [row] = await db.appSql`
      select resolve_payment_tenant(${randomUUID()}::uuid) as tenant_id`;
    expect(row?.tenant_id).toBeNull();
  });

  it("la función NO es una puerta trasera: app_user sigue sin poder leer datos de otro tenant", async () => {
    // Aun conociendo el tenant de B (vía la función), leer sus pagos exige
    // estar parado en B; con el contexto de A, RLS lo impide.
    await db.appSql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantA}, true)`;
      const rows = await tx`select * from payments where id = ${paymentB}`;
      expect(rows).toHaveLength(0);
    });
  });

  it("el rol payment_resolver no puede loguearse ni bypassear RLS", async () => {
    const [role] = await db.adminSql`
      select rolcanlogin, rolbypassrls, rolsuper
      from pg_roles where rolname = 'payment_resolver'`;
    expect(role?.rolcanlogin).toBe(false);
    expect(role?.rolbypassrls).toBe(false);
    expect(role?.rolsuper).toBe(false);
  });

  // ── Integridad de importes ─────────────────────────────────────────────────

  it("la DB rechaza importes no positivos", async () => {
    await expect(
      asTenant(tenantA, (tx) =>
        insertPayment(tx, {
          tenantId: tenantA,
          reservationId: reservationA,
          amountCents: 0,
          feeCents: 0,
          status: "cancelado",
        }),
      ),
    ).rejects.toThrow();
  });

  it("la DB rechaza una comisión mayor al importe", async () => {
    await expect(
      asTenant(tenantA, (tx) =>
        insertPayment(tx, {
          tenantId: tenantA,
          reservationId: reservationA,
          amountCents: 1000,
          feeCents: 5000,
          status: "cancelado",
        }),
      ),
    ).rejects.toThrow();
  });
});
