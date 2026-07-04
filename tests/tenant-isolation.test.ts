import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb, type TestDb } from "./helpers/postgres";
import { findTenantById } from "@/modules/tenants/infrastructure/tenant.repository";

/**
 * Tests del THREAT principal: aislamiento de tenant.
 *
 * Se ejecutan contra un Postgres real con las migraciones aplicadas, usando el
 * rol `app_user` (no-owner, NOBYPASSRLS) — la misma postura que el runtime.
 */
describe("Aislamiento de tenant (RLS + filtro de app)", () => {
  let db: TestDb;

  // Dos tenants con su owner.
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = `user_${randomUUID()}`;
  const userB = `user_${randomUUID()}`;

  beforeAll(async () => {
    db = await setupTestDb();

    // Sembramos como ADMIN (superusuario bypassa RLS → insert libre).
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
  }, 180_000);

  afterAll(async () => {
    if (db) await db.stop();
  });

  it("el rol app_user NO es superusuario ni tiene BYPASSRLS", async () => {
    const [role] = await db.adminSql`
      select rolsuper, rolbypassrls from pg_roles where rolname = 'app_user'`;
    expect(role?.rolsuper).toBe(false);
    expect(role?.rolbypassrls).toBe(false);
  });

  it("(a) parado en el tenant A, leer una fila del tenant B vuelve vacío", async () => {
    await db.appSql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantA}, true)`;

      // Pido explícitamente la fila del tenant B por id.
      const tenantBRows = await tx`select * from tenants where id = ${tenantB}`;
      expect(tenantBRows).toHaveLength(0);

      // Y los profiles del tenant B.
      const profilesB = await tx`select * from profiles where tenant_id = ${tenantB}`;
      expect(profilesB).toHaveLength(0);

      // Control positivo: mi propio tenant SÍ es visible.
      const tenantARows = await tx`select * from tenants where id = ${tenantA}`;
      expect(tenantARows).toHaveLength(1);
    });
  });

  it("(b) RLS bloquea el bypass directo: SIN filtro de app, solo veo lo mío", async () => {
    await db.appSql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantA}, true)`;

      // SELECT sin ningún WHERE: si RLS no funcionara, vería A y B.
      const all = await tx`select id from tenants`;
      const ids = all.map((r) => r.id as string);
      expect(ids).toEqual([tenantA]);
      expect(ids).not.toContain(tenantB);
    });
  });

  it("sin contexto de tenant, no se ve NADA (fail-closed)", async () => {
    await db.appSql.begin(async (tx) => {
      // No seteamos app.tenant_id ni app.user_id.
      const all = await tx`select * from tenants`;
      expect(all).toHaveLength(0);
      const profs = await tx`select * from profiles`;
      expect(profs).toHaveLength(0);
    });
  });

  it("WITH CHECK impide crear filas de OTRO tenant (integridad de escritura)", async () => {
    await expect(
      db.appSql.begin(async (tx) => {
        await tx`select set_config('app.tenant_id', ${tenantA}, true)`;
        // Intento colar un profile del tenant B estando parado en A.
        await tx`insert into profiles (user_id, tenant_id, role)
                 values (${userA}, ${tenantB}, 'staff')`;
      }),
    ).rejects.toThrow();
  });

  it("el repository real (findTenantById) respeta el aislamiento", async () => {
    await db.appDb.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.tenant_id', ${tenantA}, true)`,
      );
      const mine = await findTenantById(tx, tenantA);
      expect(mine?.id).toBe(tenantA);

      // Pido el tenant B con el filtro de la app: combinación filtro + RLS.
      const other = await findTenantById(tx, tenantB);
      expect(other).toBeNull();
    });
  });
});
