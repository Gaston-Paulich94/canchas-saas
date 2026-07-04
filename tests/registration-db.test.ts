import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { setupTestDb, type TestDb } from "./helpers/postgres";

/**
 * Cubre el camino de ESCRITURA del registro de owner y el bootstrap de sesión:
 *  - registerOwner crea tenant + profile con app.tenant_id + app.user_id seteados.
 *  - getSessionContext lee el propio profile con SOLO app.user_id (policy
 *    profiles_self), sin conocer aún el tenant.
 */
describe("Registro de owner y bootstrap self (RLS)", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    if (db) await db.stop();
  });

  it("crea tenant + profile owner scopeado y luego el owner se lee a sí mismo", async () => {
    const tenantId = randomUUID();
    const userId = `user_${randomUUID()}`;

    // El usuario lo crea better-auth en el registro real; acá lo sembramos.
    await db.adminSql`insert into "user" (id, name, email)
      values (${userId}, 'Dueño', ${`${userId}@complejo.test`})`;

    // Paso de escritura de registerOwner (withTenantAndSelf).
    await db.appSql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      await tx`select set_config('app.user_id', ${userId}, true)`;
      await tx`insert into tenants (id, name, slug)
               values (${tenantId}, 'Mi Complejo', ${`comp-${tenantId.slice(0, 8)}`})`;
      await tx`insert into profiles (user_id, tenant_id, role)
               values (${userId}, ${tenantId}, 'owner')`;
    });

    // Bootstrap (getSessionContext / withSelf): solo app.user_id.
    await db.appSql.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${userId}, true)`;
      const rows = await tx`select tenant_id, role from profiles where user_id = ${userId}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenant_id).toBe(tenantId);
      expect(rows[0]?.role).toBe("owner");
    });
  });

  it("un usuario NO puede leerse el profile de otro vía profiles_self", async () => {
    const tenantId = randomUUID();
    const ownerId = `user_${randomUUID()}`;
    const intruderId = `user_${randomUUID()}`;

    await db.adminSql`insert into "user" (id, name, email) values
      (${ownerId}, 'Dueño', ${`${ownerId}@x.test`}),
      (${intruderId}, 'Otro', ${`${intruderId}@x.test`})`;
    await db.adminSql`insert into tenants (id, name, slug)
      values (${tenantId}, 'Comp', ${`comp-${tenantId.slice(0, 8)}`})`;
    await db.adminSql`insert into profiles (user_id, tenant_id, role)
      values (${ownerId}, ${tenantId}, 'owner')`;

    // El intruso, con su propio app.user_id, no ve el profile del dueño.
    await db.appSql.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${intruderId}, true)`;
      const rows = await tx`select * from profiles where user_id = ${ownerId}`;
      expect(rows).toHaveLength(0);
    });
  });
});
