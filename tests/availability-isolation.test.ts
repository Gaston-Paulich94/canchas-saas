import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb, type TestDb } from "./helpers/postgres";
import {
  listAvailabilityByCourt,
  insertAvailability,
  deleteAvailability,
} from "@/modules/availability/infrastructure/availability.repository";

/**
 * Aislamiento de tenant + anti-solapamiento (EXCLUDE constraint) de la
 * disponibilidad, contra Postgres real con el rol app_user (respeta RLS).
 */
describe("Disponibilidad — aislamiento y exclusion constraint", () => {
  let db: TestDb;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = `user_${randomUUID()}`;
  const userB = `user_${randomUUID()}`;
  const courtA = randomUUID();
  const courtB = randomUUID();
  const windowB = randomUUID(); // franja del tenant B

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
    await adminSql`insert into "courts" (id, tenant_id, name, sport) values
      (${courtA}, ${tenantA}, 'Cancha A1', 'padel'),
      (${courtB}, ${tenantB}, 'Cancha B1', 'padel')`;
    await adminSql`insert into "court_availability"
      (id, tenant_id, court_id, day_of_week, open_time, close_time) values
      (${windowB}, ${tenantB}, ${courtB}, 1, '08:00', '10:00')`;
  }, 180_000);

  afterAll(async () => {
    if (db) await db.stop();
  });

  it("(a) parado en A, listar la disponibilidad de una cancha de B vuelve vacío", async () => {
    const rows = await asTenant(tenantA, (tx) =>
      listAvailabilityByCourt(tx, tenantA, courtB),
    );
    expect(rows).toHaveLength(0);
  });

  it("(b) RLS bloquea el bypass directo: SELECT sin filtro no ve franjas de B", async () => {
    await db.appSql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantA}, true)`;
      const all = await tx`select tenant_id from court_availability`;
      expect(all.map((r) => r.tenant_id as string)).not.toContain(tenantB);
    });
  });

  it("sin contexto de tenant, no se ve ninguna franja (fail-closed)", async () => {
    await db.appSql.begin(async (tx) => {
      const all = await tx`select * from court_availability`;
      expect(all).toHaveLength(0);
    });
  });

  it("WITH CHECK impide crear una franja de OTRO tenant", async () => {
    await expect(
      asTenant(tenantA, (tx) =>
        insertAvailability(tx, {
          tenantId: tenantB,
          courtId: courtB,
          dayOfWeek: 2,
          openTime: "08:00",
          closeTime: "10:00",
        }),
      ),
    ).rejects.toThrow();
  });

  it("delete de A NO puede borrar una franja de B", async () => {
    const deleted = await asTenant(tenantA, (tx) =>
      deleteAvailability(tx, tenantA, windowB),
    );
    expect(deleted).toBe(false);
    const rows = await db.adminSql`select 1 from court_availability where id = ${windowB}`;
    expect(rows).toHaveLength(1);
  });

  it("EXCLUDE constraint: rechaza dos franjas solapadas en la misma cancha y día", async () => {
    await expect(
      asTenant(tenantA, async (tx) => {
        await insertAvailability(tx, {
          tenantId: tenantA,
          courtId: courtA,
          dayOfWeek: 5,
          openTime: "08:00",
          closeTime: "10:00",
        });
        await insertAvailability(tx, {
          tenantId: tenantA,
          courtId: courtA,
          dayOfWeek: 5,
          openTime: "09:00",
          closeTime: "11:00",
        });
      }),
    ).rejects.toThrow();
  });

  it("EXCLUDE permite franjas contiguas (08–10 y 10–12 no se solapan)", async () => {
    const rows = await asTenant(tenantA, async (tx) => {
      await insertAvailability(tx, {
        tenantId: tenantA,
        courtId: courtA,
        dayOfWeek: 2,
        openTime: "08:00",
        closeTime: "10:00",
      });
      await insertAvailability(tx, {
        tenantId: tenantA,
        courtId: courtA,
        dayOfWeek: 2,
        openTime: "10:00",
        closeTime: "12:00",
      });
      return listAvailabilityByCourt(tx, tenantA, courtA);
    });
    const day2 = rows.filter((r) => r.dayOfWeek === 2);
    expect(day2).toHaveLength(2);
  });

  it("CRUD dentro del propio tenant (A)", async () => {
    const created = await asTenant(tenantA, (tx) =>
      insertAvailability(tx, {
        tenantId: tenantA,
        courtId: courtA,
        dayOfWeek: 3,
        openTime: "18:00",
        closeTime: "20:00",
      }),
    );
    expect(created.tenantId).toBe(tenantA);

    const list = await asTenant(tenantA, (tx) =>
      listAvailabilityByCourt(tx, tenantA, courtA),
    );
    expect(list.some((w) => w.id === created.id)).toBe(true);

    const deleted = await asTenant(tenantA, (tx) =>
      deleteAvailability(tx, tenantA, created.id),
    );
    expect(deleted).toBe(true);
  });
});
