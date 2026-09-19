import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb, type TestDb } from "./helpers/postgres";
import {
  getRevenueSummary,
  getCourtOccupancy,
  getPeakHours,
  getFrequentCustomers,
} from "@/modules/reporting/infrastructure/reporting.repository";
import {
  arDateTimeToUtc,
  arDayBounds,
} from "@/modules/reservations/domain/datetime";

/**
 * El reporting expone facturación y clientes: si una agregación se escapara del
 * scope, un complejo vería el negocio de otro. Estos tests verifican que cada
 * número es SOLO del tenant en contexto, y que las cuentas dan bien.
 */
describe("Reporting — aislamiento y correctitud de las métricas", () => {
  let db: TestDb;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = `user_${randomUUID()}`;
  const userB = `user_${randomUUID()}`;
  const courtA = randomUUID();
  const courtA2 = randomUUID();
  const courtB = randomUUID();
  const customerA = randomUUID();

  // Rango: una semana que arranca lunes (2027-06-07 es lunes).
  const DESDE = "2027-06-07";
  const HASTA = "2027-06-13";
  const from = arDayBounds(DESDE).from;
  const to = arDayBounds(HASTA).to;

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
      (id, tenant_id, name, sport, price_per_hour) values
      (${courtA}, ${tenantA}, 'Cancha A1', 'padel', 10000),
      (${courtA2}, ${tenantA}, 'Cancha A2', 'tenis', 8000),
      (${courtB}, ${tenantB}, 'Cancha B1', 'padel', 30000)`;

    // courtA abre lunes (dow=1) de 18 a 22 => 4 h. En la semana hay 1 lunes.
    await adminSql`insert into "court_availability"
      (tenant_id, court_id, day_of_week, open_time, close_time) values
      (${tenantA}, ${courtA}, 1, '18:00', '22:00')`;
    // courtA2 queda sin disponibilidad cargada a propósito.

    await adminSql`insert into "customers" (id, tenant_id, name, phone) values
      (${customerA}, ${tenantA}, 'Cliente Fiel', '+54 9 11 1111-1111')`;

    // Lunes 2027-06-07: 2 reservas de 1 h en courtA (18 y 19) del mismo cliente.
    const r1 = randomUUID();
    const r2 = randomUUID();
    const r3 = randomUUID();
    const rB = randomUUID();
    await adminSql`insert into "reservations"
      (id, tenant_id, court_id, customer_id, starts_at, ends_at, status, customer_name) values
      (${r1}, ${tenantA}, ${courtA}, ${customerA},
        ${arDateTimeToUtc("2027-06-07", "18:00")}, ${arDateTimeToUtc("2027-06-07", "19:00")}, 'confirmada', 'Cliente Fiel'),
      (${r2}, ${tenantA}, ${courtA}, ${customerA},
        ${arDateTimeToUtc("2027-06-07", "19:00")}, ${arDateTimeToUtc("2027-06-07", "20:00")}, 'confirmada', 'Cliente Fiel'),
      (${r3}, ${tenantA}, ${courtA}, null,
        ${arDateTimeToUtc("2027-06-08", "18:00")}, ${arDateTimeToUtc("2027-06-08", "19:00")}, 'cancelada', 'Cancelado'),
      (${rB}, ${tenantB}, ${courtB}, null,
        ${arDateTimeToUtc("2027-06-07", "18:00")}, ${arDateTimeToUtc("2027-06-07", "19:00")}, 'confirmada', 'Cliente B')`;

    // created_at explícito: los pagos pendientes (sin paid_at) se imputan al
    // período por su fecha de creación.
    await adminSql`insert into "payments"
      (tenant_id, reservation_id, amount_cents, fee_cents, status, paid_at, created_at) values
      (${tenantA}, ${r1}, 1000000, 0, 'aprobado',
        ${arDateTimeToUtc("2027-06-07", "18:05")}, ${arDateTimeToUtc("2027-06-07", "17:00")}),
      (${tenantA}, ${r2}, 1000000, 0, 'pendiente',
        null, ${arDateTimeToUtc("2027-06-07", "17:30")}),
      (${tenantB}, ${rB}, 3000000, 0, 'aprobado',
        ${arDateTimeToUtc("2027-06-07", "18:05")}, ${arDateTimeToUtc("2027-06-07", "17:00")})`;
  }, 180_000);

  afterAll(async () => {
    if (db) await db.stop();
  });

  it("la facturación es solo del tenant en contexto", async () => {
    const a = await asTenant(tenantA, (tx) =>
      getRevenueSummary(tx, tenantA, from, to),
    );
    // 2 reservas de 1 h a $10.000 => $20.000 => 2.000.000 centavos.
    expect(a.estimadoCents).toBe(2_000_000);
    expect(a.cobradoCents).toBe(1_000_000); // solo el pago aprobado
    expect(a.pendientesCents).toBe(1_000_000);
    expect(a.reservasConfirmadas).toBe(2);
    expect(a.reservasCanceladas).toBe(1);

    const b = await asTenant(tenantB, (tx) =>
      getRevenueSummary(tx, tenantB, from, to),
    );
    expect(b.estimadoCents).toBe(3_000_000);
    expect(b.cobradoCents).toBe(3_000_000);
    expect(b.reservasConfirmadas).toBe(1);
  });

  it("la ocupación cruza reservas contra la disponibilidad semanal", async () => {
    const filas = await asTenant(tenantA, (tx) =>
      getCourtOccupancy(tx, tenantA, DESDE, HASTA, from, to),
    );

    const a1 = filas.find((f) => f.courtId === courtA);
    // Ofrece 4 h (un lunes de 18 a 22) y vendió 2 h => 50 %.
    expect(a1?.horasDisponibles).toBeCloseTo(4, 5);
    expect(a1?.horasReservadas).toBeCloseTo(2, 5);
    expect(a1?.ocupacionPct).toBe(50);
    expect(a1?.ingresoEstimadoCents).toBe(2_000_000);

    // Sin disponibilidad cargada no se puede calcular un porcentaje.
    const a2 = filas.find((f) => f.courtId === courtA2);
    expect(a2?.ocupacionPct).toBeNull();

    // Nunca aparecen canchas de otro complejo.
    expect(filas.some((f) => f.courtId === courtB)).toBe(false);
  });

  it("los horarios pico se calculan en hora argentina", async () => {
    const picos = await asTenant(tenantA, (tx) =>
      getPeakHours(tx, tenantA, from, to),
    );
    // Las reservas confirmadas arrancan 18:00 y 19:00 hora AR.
    expect(picos).toEqual([
      { hora: 18, reservas: 1 },
      { hora: 19, reservas: 1 },
    ]);
  });

  it("los clientes frecuentes no incluyen clientes de otro complejo", async () => {
    const frecuentes = await asTenant(tenantA, (tx) =>
      getFrequentCustomers(tx, tenantA, from, to),
    );
    expect(frecuentes).toHaveLength(1);
    expect(frecuentes[0]?.nombre).toBe("Cliente Fiel");
    expect(frecuentes[0]?.reservas).toBe(2);
    expect(frecuentes[0]?.telefono).toBe("+54 9 11 1111-1111");
    expect(frecuentes.map((f) => f.nombre)).not.toContain("Cliente B");
  });

  it("sin contexto de tenant, todas las métricas vuelven vacías (fail-closed)", async () => {
    await db.appDb.transaction(async (tx) => {
      const revenue = await getRevenueSummary(tx, tenantA, from, to);
      expect(revenue.estimadoCents).toBe(0);
      expect(revenue.cobradoCents).toBe(0);

      const ocupacion = await getCourtOccupancy(
        tx,
        tenantA,
        DESDE,
        HASTA,
        from,
        to,
      );
      expect(ocupacion).toHaveLength(0);

      expect(await getPeakHours(tx, tenantA, from, to)).toHaveLength(0);
      expect(await getFrequentCustomers(tx, tenantA, from, to)).toHaveLength(0);
    });
  });

  it("un rango sin actividad devuelve ceros, no error", async () => {
    const vacio = arDayBounds("2027-01-01");
    const revenue = await asTenant(tenantA, (tx) =>
      getRevenueSummary(tx, tenantA, vacio.from, vacio.to),
    );
    expect(revenue.reservasConfirmadas).toBe(0);
    expect(revenue.estimadoCents).toBe(0);
  });
});
