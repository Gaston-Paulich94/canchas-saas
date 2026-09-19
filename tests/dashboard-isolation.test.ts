import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb, type TestDb } from "./helpers/postgres";
import {
  getReservationDayCounts,
  listUpcomingReservations,
  getPaymentDayTotals,
  getCourtCounts,
  countCourtsWithoutAvailability,
} from "@/modules/dashboard/infrastructure/dashboard.repository";
import {
  arDateTimeToUtc,
  arDayBounds,
} from "@/modules/reservations/domain/datetime";

/**
 * Las métricas del panel son agregaciones (COUNT/SUM): si una se escapara del
 * scope, un complejo vería la facturación de otro. Estos tests verifican que
 * los números son SOLO del tenant en contexto.
 */
describe("Panel — aislamiento de las métricas agregadas", () => {
  let db: TestDb;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = `user_${randomUUID()}`;
  const userB = `user_${randomUUID()}`;
  const courtA = randomUUID(); // con precio y disponibilidad
  const courtA2 = randomUUID(); // activa, sin precio ni disponibilidad
  const courtAInactiva = randomUUID();
  const courtB = randomUUID();

  const D = "2027-06-15";
  const { from, to } = arDayBounds(D);

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

    await adminSql`insert into "courts"
      (id, tenant_id, name, sport, price_per_hour, is_active) values
      (${courtA}, ${tenantA}, 'Cancha A1', 'padel', 12000, true),
      (${courtA2}, ${tenantA}, 'Cancha A2', 'tenis', null, true),
      (${courtAInactiva}, ${tenantA}, 'Cancha A3', 'padel', 9000, false),
      (${courtB}, ${tenantB}, 'Cancha B1', 'padel', 20000, true)`;

    // Solo courtA tiene horarios cargados.
    await adminSql`insert into "court_availability"
      (tenant_id, court_id, day_of_week, open_time, close_time) values
      (${tenantA}, ${courtA}, 2, '08:00', '22:00')`;

    // Reservas del día D: 2 confirmadas de 1h en A (12.000 c/u) + 1 cancelada.
    const rA1 = randomUUID();
    const rA2 = randomUUID();
    const rA3 = randomUUID();
    const rB1 = randomUUID();
    await adminSql`insert into "reservations"
      (id, tenant_id, court_id, starts_at, ends_at, status, customer_name) values
      (${rA1}, ${tenantA}, ${courtA}, ${arDateTimeToUtc(D, "18:00")}, ${arDateTimeToUtc(D, "19:00")}, 'confirmada', 'Cliente A1'),
      (${rA2}, ${tenantA}, ${courtA}, ${arDateTimeToUtc(D, "20:00")}, ${arDateTimeToUtc(D, "21:00")}, 'confirmada', 'Cliente A2'),
      (${rA3}, ${tenantA}, ${courtA}, ${arDateTimeToUtc(D, "09:00")}, ${arDateTimeToUtc(D, "10:00")}, 'cancelada', 'Cliente A3'),
      (${rB1}, ${tenantB}, ${courtB}, ${arDateTimeToUtc(D, "18:00")}, ${arDateTimeToUtc(D, "19:00")}, 'confirmada', 'Cliente B1')`;

    // Reservas de días anteriores, solo para colgarles pagos viejos.
    const rA4 = randomUUID(); // D-1
    const rA5 = randomUUID(); // D-3
    const rA6 = randomUUID(); // D-2
    await adminSql`insert into "reservations"
      (id, tenant_id, court_id, starts_at, ends_at, status, customer_name) values
      (${rA4}, ${tenantA}, ${courtA}, ${arDateTimeToUtc("2027-06-14", "18:00")}, ${arDateTimeToUtc("2027-06-14", "19:00")}, 'confirmada', 'Cliente A4'),
      (${rA5}, ${tenantA}, ${courtA}, ${arDateTimeToUtc("2027-06-12", "18:00")}, ${arDateTimeToUtc("2027-06-12", "19:00")}, 'confirmada', 'Cliente A5'),
      (${rA6}, ${tenantA}, ${courtA}, ${arDateTimeToUtc("2027-06-13", "18:00")}, ${arDateTimeToUtc("2027-06-13", "19:00")}, 'confirmada', 'Cliente A6')`;

    // Pagos. "Cobrado hoy" se imputa por fecha de ACREDITACIÓN; los pendientes
    // cuentan cualquiera sea el día en que se generó el link.
    await adminSql`insert into "payments"
      (tenant_id, reservation_id, amount_cents, fee_cents, status, created_at, paid_at) values
      (${tenantA}, ${rA1}, 1200000, 0, 'aprobado', ${from}, null),
      (${tenantA}, ${rA2}, 1200000, 0, 'pendiente', ${from}, null),
      (${tenantA}, ${rA4}, 1800000, 0, 'aprobado',
        ${arDateTimeToUtc("2027-06-14", "17:00")}, ${arDateTimeToUtc(D, "10:00")}),
      (${tenantA}, ${rA5}, 900000, 0, 'pendiente',
        ${arDateTimeToUtc("2027-06-12", "17:00")}, null),
      (${tenantA}, ${rA6}, 700000, 0, 'aprobado',
        ${arDateTimeToUtc("2027-06-13", "17:00")}, ${arDateTimeToUtc("2027-06-14", "12:00")}),
      (${tenantB}, ${rB1}, 2000000, 0, 'aprobado', ${from}, null)`;
  }, 180_000);

  afterAll(async () => {
    if (db) await db.stop();
  });

  it("los conteos de reservas son solo del tenant en contexto", async () => {
    const a = await asTenant(tenantA, (tx) =>
      getReservationDayCounts(tx, tenantA, from, to),
    );
    expect(a.confirmadas).toBe(2);
    expect(a.canceladas).toBe(1);

    const b = await asTenant(tenantB, (tx) =>
      getReservationDayCounts(tx, tenantB, from, to),
    );
    expect(b.confirmadas).toBe(1);
    expect(b.canceladas).toBe(0);
  });

  it("el valor estimado usa el precio de cada cancha y excluye canceladas", async () => {
    const a = await asTenant(tenantA, (tx) =>
      getReservationDayCounts(tx, tenantA, from, to),
    );
    // 2 turnos de 1h a $12.000 => 24.000 => 2.400.000 centavos.
    expect(a.estimadoCents).toBe(2_400_000);

    // El de B es distinto: no hay contaminación cruzada.
    const b = await asTenant(tenantB, (tx) =>
      getReservationDayCounts(tx, tenantB, from, to),
    );
    expect(b.estimadoCents).toBe(2_000_000);
  });

  it("los próximos turnos no incluyen los de otro complejo ni los cancelados", async () => {
    const proximos = await asTenant(tenantA, (tx) =>
      listUpcomingReservations(tx, tenantA, from, to),
    );
    expect(proximos).toHaveLength(2);
    expect(proximos.every((r) => r.status !== "cancelada")).toBe(true);
    expect(proximos.map((r) => r.customerName)).not.toContain("Cliente B1");
    // Vienen ordenados por hora y traen el nombre de la cancha.
    expect(proximos[0]?.courtName).toBe("Cancha A1");
    expect(proximos[0]!.startsAt.getTime()).toBeLessThan(
      proximos[1]!.startsAt.getTime(),
    );
  });

  it("los cobros del día se imputan por acreditación y no mezclan tenants", async () => {
    const a = await asTenant(tenantA, (tx) =>
      getPaymentDayTotals(tx, tenantA, from, to),
    );
    // rA1 (acreditado hoy) + rA4 (link de ayer, pagado hoy) = 3.000.000.
    // rA6 se acreditó ayer: no es plata de hoy.
    expect(a.cobradoCents).toBe(3_000_000);
    // rA2 (de hoy) + rA5 (link de hace 3 días que sigue sin pagarse).
    expect(a.pendientes).toBe(2);

    const b = await asTenant(tenantB, (tx) =>
      getPaymentDayTotals(tx, tenantB, from, to),
    );
    expect(b.cobradoCents).toBe(2_000_000);
    expect(b.pendientes).toBe(0);
  });

  it("cuenta canchas activas/totales y detecta las que no tienen precio", async () => {
    const a = await asTenant(tenantA, (tx) => getCourtCounts(tx, tenantA));
    expect(a.totales).toBe(3);
    expect(a.activas).toBe(2);
    expect(a.sinPrecio).toBe(1); // courtA2

    const b = await asTenant(tenantB, (tx) => getCourtCounts(tx, tenantB));
    expect(b.totales).toBe(1);
  });

  it("detecta canchas activas sin horarios cargados", async () => {
    const a = await asTenant(tenantA, (tx) =>
      countCourtsWithoutAvailability(tx, tenantA),
    );
    // courtA tiene franja; courtA2 no; la inactiva no cuenta.
    expect(a).toBe(1);

    const b = await asTenant(tenantB, (tx) =>
      countCourtsWithoutAvailability(tx, tenantB),
    );
    expect(b).toBe(1);
  });

  it("sin contexto de tenant las métricas vuelven en cero (fail-closed)", async () => {
    await db.appDb.transaction(async (tx) => {
      const counts = await getReservationDayCounts(tx, tenantA, from, to);
      expect(counts.confirmadas).toBe(0);
      expect(counts.estimadoCents).toBe(0);

      const pagos = await getPaymentDayTotals(tx, tenantA, from, to);
      expect(pagos.cobradoCents).toBe(0);

      const canchas = await getCourtCounts(tx, tenantA);
      expect(canchas.totales).toBe(0);
    });
  });
});
