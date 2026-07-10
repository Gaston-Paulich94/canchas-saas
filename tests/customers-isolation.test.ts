import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb, type TestDb } from "./helpers/postgres";
import {
  listCustomers,
  findCustomerById,
  insertCustomer,
  updateCustomer,
  deleteCustomer,
} from "@/modules/customers/infrastructure/customer.repository";
import { findOrCreateCustomerTx } from "@/modules/customers/application/customer-service";
import { listReservationsByCustomer } from "@/modules/reservations/infrastructure/reservation.repository";
import { arDateTimeToUtc } from "@/modules/reservations/domain/datetime";
import { isUniqueViolation } from "@/modules/shared/infrastructure/db/pg-errors";

/**
 * Clientes contra Postgres real con el rol app_user (respeta RLS): aislamiento,
 * IDOR, unique parcial de teléfono, find-or-create (incluida la carrera) y el
 * SET NULL del borrado sobre las reservas.
 */
describe("Clientes — aislamiento, dedup por teléfono y find-or-create", () => {
  let db: TestDb;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = `user_${randomUUID()}`;
  const userB = `user_${randomUUID()}`;
  const customerB = randomUUID(); // cliente del tenant B
  const SHARED_PHONE = "+54 9 11 4444-4444"; // mismo teléfono en A y B (permitido)

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
    await adminSql`insert into "customers" (id, tenant_id, name, phone) values
      (${customerB}, ${tenantB}, 'Cliente B', ${SHARED_PHONE})`;
  }, 180_000);

  afterAll(async () => {
    if (db) await db.stop();
  });

  // ── Aislamiento ────────────────────────────────────────────────────────────

  it("(a) parado en A, leer un cliente de B por id vuelve null", async () => {
    const found = await asTenant(tenantA, (tx) =>
      findCustomerById(tx, tenantA, customerB),
    );
    expect(found).toBeNull();
  });

  it("(b) RLS bloquea el bypass directo: SELECT sin filtro no ve clientes de B", async () => {
    await db.appSql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantA}, true)`;
      const all = await tx`select tenant_id from customers`;
      expect(all.map((r) => r.tenant_id as string)).not.toContain(tenantB);
    });
  });

  it("sin contexto de tenant no se ve ningún cliente (fail-closed)", async () => {
    await db.appSql.begin(async (tx) => {
      const all = await tx`select * from customers`;
      expect(all).toHaveLength(0);
    });
  });

  it("IDOR: A no puede editar ni borrar un cliente de B", async () => {
    const updated = await asTenant(tenantA, (tx) =>
      updateCustomer(tx, tenantA, customerB, { name: "Hackeado" }),
    );
    expect(updated).toBeNull();

    const deleted = await asTenant(tenantA, (tx) =>
      deleteCustomer(tx, tenantA, customerB),
    );
    expect(deleted).toBe(false);

    const [row] = await db.adminSql`
      select name from customers where id = ${customerB}`;
    expect(row?.name).toBe("Cliente B");
  });

  // ── Dedup por teléfono (unique parcial) ────────────────────────────────────

  it("mismo teléfono en OTRO tenant está permitido (unique es por tenant)", async () => {
    const created = await asTenant(tenantA, (tx) =>
      insertCustomer(tx, {
        tenantId: tenantA,
        name: "Cliente A",
        phone: SHARED_PHONE,
      }),
    );
    expect(created.tenantId).toBe(tenantA);
  });

  it("mismo teléfono en el MISMO tenant viola el unique parcial (23505)", async () => {
    await expect(
      asTenant(tenantA, (tx) =>
        insertCustomer(tx, {
          tenantId: tenantA,
          name: "Duplicado",
          phone: SHARED_PHONE,
        }),
      ),
    ).rejects.toSatisfy(isUniqueViolation);
  });

  it("varios clientes SIN teléfono no chocan entre sí (parcial)", async () => {
    await asTenant(tenantA, async (tx) => {
      await insertCustomer(tx, { tenantId: tenantA, name: "Sin Tel 1" });
      await insertCustomer(tx, { tenantId: tenantA, name: "Sin Tel 2" });
    });
    const rows = await asTenant(tenantA, (tx) =>
      listCustomers(tx, tenantA, "Sin Tel"),
    );
    expect(rows).toHaveLength(2);
  });

  it("la búsqueda escapa comodines de LIKE (% no matchea todo)", async () => {
    const rows = await asTenant(tenantA, (tx) =>
      listCustomers(tx, tenantA, "%"),
    );
    expect(rows).toHaveLength(0);
  });

  // ── find-or-create ─────────────────────────────────────────────────────────

  it("find-or-create reusa el cliente existente por teléfono", async () => {
    const phone = "+54 9 11 7777-7777";
    const first = await asTenant(tenantA, (tx) =>
      findOrCreateCustomerTx(tx, tenantA, { name: "Primero", phone }),
    );
    const second = await asTenant(tenantA, (tx) =>
      findOrCreateCustomerTx(tx, tenantA, { name: "Segundo", phone }),
    );
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Primero"); // no pisa el nombre original
  });

  it("find-or-create sin teléfono crea siempre un cliente nuevo", async () => {
    const a = await asTenant(tenantA, (tx) =>
      findOrCreateCustomerTx(tx, tenantA, { name: "Anónimo", phone: null }),
    );
    const b = await asTenant(tenantA, (tx) =>
      findOrCreateCustomerTx(tx, tenantA, { name: "Anónimo", phone: null }),
    );
    expect(a.id).not.toBe(b.id);
  });

  it("CARRERA find-or-create: dos tx con el mismo teléfono nuevo → ambas obtienen el MISMO cliente", async () => {
    const phone = "+54 9 11 8888-8888";
    const attempt = () =>
      asTenant(tenantA, (tx) =>
        findOrCreateCustomerTx(tx, tenantA, { name: "Racer", phone }),
      );

    const results = await Promise.allSettled([attempt(), attempt()]);
    const winners = results.flatMap((r) =>
      r.status === "fulfilled" ? [r.value] : [],
    );
    expect(winners).toHaveLength(2);
    expect(winners[0]?.id).toBe(winners[1]?.id);

    const rows = await db.adminSql`
      select count(*)::int as n from customers
      where tenant_id = ${tenantA} and phone = ${phone}`;
    expect(rows[0]?.n).toBe(1);
  });

  // ── Borrado: SET NULL en reservas ──────────────────────────────────────────

  it("borrar un cliente deja sus reservas con customer_id NULL y snapshot intacto", async () => {
    const courtId = randomUUID();
    await db.adminSql`insert into "courts" (id, tenant_id, name, sport) values
      (${courtId}, ${tenantA}, 'Cancha A1', 'padel')`;

    const customer = await asTenant(tenantA, (tx) =>
      insertCustomer(tx, {
        tenantId: tenantA,
        name: "Por Borrar",
        phone: "+54 9 11 9999-9999",
      }),
    );

    const reservationId = randomUUID();
    await db.adminSql`insert into "reservations"
      (id, tenant_id, court_id, customer_id, starts_at, ends_at, customer_name) values
      (${reservationId}, ${tenantA}, ${courtId}, ${customer.id},
       ${arDateTimeToUtc("2027-03-11", "18:00")}, ${arDateTimeToUtc("2027-03-11", "19:00")},
       'Por Borrar')`;

    // El historial lo encuentra antes del borrado.
    const before = await asTenant(tenantA, (tx) =>
      listReservationsByCustomer(tx, tenantA, customer.id),
    );
    expect(before).toHaveLength(1);

    const deleted = await asTenant(tenantA, (tx) =>
      deleteCustomer(tx, tenantA, customer.id),
    );
    expect(deleted).toBe(true);

    const [row] = await db.adminSql`
      select customer_id, customer_name, status from reservations
      where id = ${reservationId}`;
    expect(row?.customer_id).toBeNull();
    expect(row?.customer_name).toBe("Por Borrar");
  });
});
