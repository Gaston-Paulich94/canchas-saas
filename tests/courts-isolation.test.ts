import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb, type TestDb } from "./helpers/postgres";
import {
  listCourts,
  findCourtById,
  insertCourt,
  updateCourt,
  deleteCourt,
} from "@/modules/courts/infrastructure/court.repository";

/**
 * Aislamiento de tenant + CRUD de canchas contra un Postgres real, usando el rol
 * `app_user` (respeta RLS, igual que el runtime). Cubre el threat principal de la
 * feature: un complejo jamás ve ni toca las canchas de otro.
 */
describe("Canchas — aislamiento de tenant y CRUD (RLS + filtro app)", () => {
  let db: TestDb;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = `user_${randomUUID()}`;
  const userB = `user_${randomUUID()}`;
  const courtB = randomUUID(); // cancha del tenant B (sembrada como admin)

  // Corre `fn` en una transacción del rol app_user con app.tenant_id fijado.
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
    // Cancha del tenant B.
    await adminSql`insert into "courts" (id, tenant_id, name, sport) values
      (${courtB}, ${tenantB}, 'Cancha B1', 'padel')`;
  }, 180_000);

  afterAll(async () => {
    if (db) await db.stop();
  });

  it("(a) parado en A, findCourtById de una cancha de B vuelve null", async () => {
    const found = await asTenant(tenantA, (tx) =>
      findCourtById(tx, tenantA, courtB),
    );
    expect(found).toBeNull();
  });

  it("(a) el listado de A no incluye canchas de B", async () => {
    const rows = await asTenant(tenantA, (tx) => listCourts(tx, tenantA));
    expect(rows.some((c) => c.id === courtB)).toBe(false);
  });

  it("(b) RLS bloquea el bypass directo: SELECT sin filtro solo ve lo propio", async () => {
    await db.appSql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantA}, true)`;
      const all = await tx`select tenant_id from courts`;
      const tenantIds = all.map((r) => r.tenant_id as string);
      expect(tenantIds).not.toContain(tenantB);
    });
  });

  it("sin contexto de tenant, no se ve ninguna cancha (fail-closed)", async () => {
    await db.appSql.begin(async (tx) => {
      const all = await tx`select * from courts`;
      expect(all).toHaveLength(0);
    });
  });

  it("WITH CHECK impide crear una cancha de OTRO tenant", async () => {
    await expect(
      asTenant(tenantA, (tx) =>
        insertCourt(tx, { tenantId: tenantB, name: "Colada", sport: "tenis" }),
      ),
    ).rejects.toThrow();
  });

  it("update de A NO puede tocar una cancha de B (devuelve null)", async () => {
    const updated = await asTenant(tenantA, (tx) =>
      updateCourt(tx, tenantA, courtB, { name: "Hackeada" }),
    );
    expect(updated).toBeNull();
    // La cancha de B sigue intacta (verificado como admin).
    const [row] = await db.adminSql`select name from courts where id = ${courtB}`;
    expect(row?.name).toBe("Cancha B1");
  });

  it("delete de A NO puede borrar una cancha de B", async () => {
    const deleted = await asTenant(tenantA, (tx) =>
      deleteCourt(tx, tenantA, courtB),
    );
    expect(deleted).toBe(false);
    const rows = await db.adminSql`select 1 from courts where id = ${courtB}`;
    expect(rows).toHaveLength(1);
  });

  it("CRUD completo dentro del propio tenant (A)", async () => {
    // Create
    const created = await asTenant(tenantA, (tx) =>
      insertCourt(tx, {
        tenantId: tenantA,
        name: "Cancha A1",
        sport: "futbol5",
        pricePerHour: 15000,
      }),
    );
    expect(created.tenantId).toBe(tenantA);

    // Read (list + byId)
    const list = await asTenant(tenantA, (tx) => listCourts(tx, tenantA));
    expect(list.some((c) => c.id === created.id)).toBe(true);
    const byId = await asTenant(tenantA, (tx) =>
      findCourtById(tx, tenantA, created.id),
    );
    expect(byId?.name).toBe("Cancha A1");

    // Update
    const updated = await asTenant(tenantA, (tx) =>
      updateCourt(tx, tenantA, created.id, { name: "Cancha A1 (techada)", indoor: true }),
    );
    expect(updated?.name).toBe("Cancha A1 (techada)");
    expect(updated?.indoor).toBe(true);

    // Delete
    const deleted = await asTenant(tenantA, (tx) =>
      deleteCourt(tx, tenantA, created.id),
    );
    expect(deleted).toBe(true);
  });

  it("no permite dos canchas con el mismo nombre en el mismo complejo", async () => {
    await asTenant(tenantA, (tx) =>
      insertCourt(tx, { tenantId: tenantA, name: "Duplicada", sport: "tenis" }),
    );
    await expect(
      asTenant(tenantA, (tx) =>
        insertCourt(tx, { tenantId: tenantA, name: "Duplicada", sport: "tenis" }),
      ),
    ).rejects.toThrow();
  });
});
