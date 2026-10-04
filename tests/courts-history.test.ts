import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb, type TestDb } from "./helpers/postgres";
import { deleteCourt } from "@/modules/courts/infrastructure/court.repository";
import { arDateTimeToUtc } from "@/modules/reservations/domain/datetime";
import { isForeignKeyViolation } from "@/modules/shared/infrastructure/db/pg-errors";

/**
 * Borrar una cancha no puede llevarse su historial. Antes, la FK en cascada
 * borraba todas sus reservas y, por arrastre, sus pagos.
 */
describe("Canchas — borrar no destruye el historial", () => {
  let db: TestDb;

  const tenantA = randomUUID();
  const userA = `user_${randomUUID()}`;
  const conHistorial = randomUUID();
  const sinHistorial = randomUUID();
  const reserva = randomUUID();
  const pago = randomUUID();
  const D = "2027-08-10";

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
    await adminSql`insert into "user" (id, name, email) values (${userA}, 'Owner A', 'a@complejo.test')`;
    await adminSql`insert into "tenants" (id, name, slug) values (${tenantA}, 'Complejo A', 'complejo-a')`;
    await adminSql`insert into "profiles" (user_id, tenant_id, role) values (${userA}, ${tenantA}, 'owner')`;
    await adminSql`insert into "courts" (id, tenant_id, name, sport, price_per_hour) values
      (${conHistorial}, ${tenantA}, 'Con historial', 'padel', 12000),
      (${sinHistorial}, ${tenantA}, 'Sin historial', 'tenis', 9000)`;
    await adminSql`insert into "court_availability"
      (tenant_id, court_id, day_of_week, open_time, close_time) values
      (${tenantA}, ${sinHistorial}, 2, '08:00', '22:00')`;
    await adminSql`insert into "reservations"
      (id, tenant_id, court_id, starts_at, ends_at, customer_name) values
      (${reserva}, ${tenantA}, ${conHistorial},
       ${arDateTimeToUtc(D, "18:00")}, ${arDateTimeToUtc(D, "19:00")}, 'Cliente')`;
    await adminSql`insert into "payments"
      (id, tenant_id, reservation_id, amount_cents, status, paid_at) values
      (${pago}, ${tenantA}, ${reserva}, 1200000, 'aprobado', now())`;
  }, 180_000);

  afterAll(async () => {
    if (db) await db.stop();
  });

  it("una cancha con reservas NO se puede borrar (antes se llevaba todo en cascada)", async () => {
    await expect(
      asTenant(tenantA, (tx) => deleteCourt(tx, tenantA, conHistorial)),
    ).rejects.toSatisfy(isForeignKeyViolation);

    // Reserva y pago siguen ahí.
    const [r] = await db.adminSql`select count(*)::int as n from reservations where id = ${reserva}`;
    const [p] = await db.adminSql`select count(*)::int as n from payments where id = ${pago}`;
    expect(r?.n).toBe(1);
    expect(p?.n).toBe(1);
  });

  it("una cancha sin reservas se borra, y su horario se va con ella", async () => {
    const deleted = await asTenant(tenantA, (tx) => deleteCourt(tx, tenantA, sinHistorial));
    expect(deleted).toBe(true);
    const [a] = await db.adminSql`select count(*)::int as n from court_availability where court_id = ${sinHistorial}`;
    expect(a?.n).toBe(0); // la disponibilidad es configuración, no historial
  });

  it("una reserva con pagos tampoco se puede borrar (el pago es historial financiero)", async () => {
    await expect(
      db.adminSql`delete from reservations where id = ${reserva}`,
    ).rejects.toSatisfy(isForeignKeyViolation);
  });

  it("la baja completa de un complejo sigue funcionando (por eso es NO ACTION y no RESTRICT)", async () => {
    await db.adminSql`delete from tenants where id = ${tenantA}`;
    const [t] = await db.adminSql`
      select (select count(*) from courts where tenant_id = ${tenantA})
           + (select count(*) from reservations where tenant_id = ${tenantA})
           + (select count(*) from payments where tenant_id = ${tenantA}) as restantes`;
    expect(Number(t?.restantes)).toBe(0);
  });
});
