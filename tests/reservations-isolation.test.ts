import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb, type TestDb } from "./helpers/postgres";
import {
  listReservationsByRange,
  findReservationById,
  insertReservation,
  updateReservationSchedule,
  cancelReservation,
} from "@/modules/reservations/infrastructure/reservation.repository";
import { arDateTimeToUtc, arDayBounds } from "@/modules/reservations/domain/datetime";
import { isExclusionViolation } from "@/modules/shared/infrastructure/db/pg-errors";

/**
 * Reservas contra Postgres real con el rol app_user (respeta RLS):
 *  - aislamiento de tenant (los threats (a) y (b) del proyecto),
 *  - anti doble-booking del EXCLUDE constraint, incluida una CARRERA real con
 *    dos transacciones concurrentes.
 */
describe("Reservas — aislamiento, doble booking y carrera", () => {
  let db: TestDb;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = `user_${randomUUID()}`;
  const userB = `user_${randomUUID()}`;
  const courtA = randomUUID();
  const courtB = randomUUID();
  const reservationB = randomUUID(); // reserva del tenant B (sembrada como admin)

  const D = "2027-03-10"; // fecha futura fija para los tests

  async function asTenant<T>(
    tenantId: string,
    fn: (tx: Parameters<Parameters<typeof db.appDb.transaction>[0]>[0]) => Promise<T>,
  ): Promise<T> {
    return db.appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return fn(tx);
    });
  }

  function reservaA(start: string, end: string, court = courtA) {
    return {
      tenantId: tenantA,
      courtId: court,
      startsAt: arDateTimeToUtc(D, start),
      endsAt: arDateTimeToUtc(D, end),
      customerName: "Cliente Test",
    };
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
    // Reserva existente del tenant B: 18–19 en su cancha.
    await adminSql`insert into "reservations"
      (id, tenant_id, court_id, starts_at, ends_at, customer_name) values
      (${reservationB}, ${tenantB}, ${courtB},
       ${arDateTimeToUtc(D, "18:00")}, ${arDateTimeToUtc(D, "19:00")}, 'Cliente B')`;
  }, 180_000);

  afterAll(async () => {
    if (db) await db.stop();
  });

  // ── Aislamiento ────────────────────────────────────────────────────────────

  it("(a) parado en A, leer una reserva de B por id vuelve null", async () => {
    const found = await asTenant(tenantA, (tx) =>
      findReservationById(tx, tenantA, reservationB),
    );
    expect(found).toBeNull();
  });

  it("(a) el listado por rango de A no incluye reservas de B", async () => {
    const { from, to } = arDayBounds(D);
    const rows = await asTenant(tenantA, (tx) =>
      listReservationsByRange(tx, tenantA, from, to),
    );
    expect(rows.some((r) => r.id === reservationB)).toBe(false);
  });

  it("(b) RLS bloquea el bypass directo: SELECT sin filtro no ve reservas de B", async () => {
    await db.appSql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantA}, true)`;
      const all = await tx`select tenant_id from reservations`;
      expect(all.map((r) => r.tenant_id as string)).not.toContain(tenantB);
    });
  });

  it("sin contexto de tenant no se ve ninguna reserva (fail-closed)", async () => {
    await db.appSql.begin(async (tx) => {
      const all = await tx`select * from reservations`;
      expect(all).toHaveLength(0);
    });
  });

  it("WITH CHECK impide crear una reserva de OTRO tenant", async () => {
    await expect(
      asTenant(tenantA, (tx) =>
        insertReservation(tx, {
          tenantId: tenantB,
          courtId: courtB,
          startsAt: arDateTimeToUtc(D, "20:00"),
          endsAt: arDateTimeToUtc(D, "21:00"),
          customerName: "Intruso",
        }),
      ),
    ).rejects.toThrow();
  });

  it("IDOR: A no puede cancelar ni mover una reserva de B", async () => {
    const cancelled = await asTenant(tenantA, (tx) =>
      cancelReservation(tx, tenantA, reservationB),
    );
    expect(cancelled).toBeNull();

    const moved = await asTenant(tenantA, (tx) =>
      updateReservationSchedule(tx, tenantA, reservationB, {
        courtId: courtB,
        startsAt: arDateTimeToUtc(D, "22:00"),
        endsAt: arDateTimeToUtc(D, "23:00"),
      }),
    );
    expect(moved).toBeNull();

    // La reserva de B sigue intacta (verificado como admin).
    const [row] = await db.adminSql`
      select status from reservations where id = ${reservationB}`;
    expect(row?.status).toBe("confirmada");
  });

  // ── Doble booking (EXCLUDE constraint) ─────────────────────────────────────

  it("rechaza dos reservas solapadas en la misma cancha (misma tx secuencial)", async () => {
    await expect(
      asTenant(tenantA, async (tx) => {
        await insertReservation(tx, reservaA("10:00", "11:00"));
        await insertReservation(tx, reservaA("10:30", "11:30"));
      }),
    ).rejects.toThrow();
  });

  it("permite turnos contiguos (11–12 y 12–13 no chocan)", async () => {
    await asTenant(tenantA, async (tx) => {
      await insertReservation(tx, reservaA("11:00", "12:00"));
      await insertReservation(tx, reservaA("12:00", "13:00"));
    });
    const { from, to } = arDayBounds(D);
    const rows = await asTenant(tenantA, (tx) =>
      listReservationsByRange(tx, tenantA, from, to),
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("cancelar libera el turno (constraint parcial WHERE status <> 'cancelada')", async () => {
    const first = await asTenant(tenantA, (tx) =>
      insertReservation(tx, reservaA("14:00", "15:00")),
    );
    // Mismo horario de nuevo → choca.
    await expect(
      asTenant(tenantA, (tx) => insertReservation(tx, reservaA("14:00", "15:00"))),
    ).rejects.toThrow();

    // Cancelo la primera → el horario queda libre.
    const cancelled = await asTenant(tenantA, (tx) =>
      cancelReservation(tx, tenantA, first.id),
    );
    expect(cancelled?.status).toBe("cancelada");

    const again = await asTenant(tenantA, (tx) =>
      insertReservation(tx, reservaA("14:00", "15:00")),
    );
    expect(again.status).toBe("confirmada");
  });

  it("mover una reserva re-chequea el EXCLUDE (no puede pisar otra)", async () => {
    const a = await asTenant(tenantA, (tx) =>
      insertReservation(tx, reservaA("16:00", "17:00")),
    );
    await asTenant(tenantA, (tx) =>
      insertReservation(tx, reservaA("17:00", "18:00")),
    );
    // Muevo la primera encima de la segunda → 23P01.
    await expect(
      asTenant(tenantA, (tx) =>
        updateReservationSchedule(tx, tenantA, a.id, {
          courtId: courtA,
          startsAt: arDateTimeToUtc(D, "17:00"),
          endsAt: arDateTimeToUtc(D, "18:00"),
        }),
      ),
    ).rejects.toThrow();
  });

  it("CARRERA: dos transacciones concurrentes por el mismo turno → exactamente una gana", async () => {
    const attempt = () =>
      asTenant(tenantA, (tx) => insertReservation(tx, reservaA("21:00", "22:00")));

    const results = await Promise.allSettled([attempt(), attempt()]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    // La perdedora falla por exclusion_violation (23P01). Drizzle la envuelve
    // en DrizzleQueryError: isExclusionViolation recorre la cadena de causes
    // (misma detección que usan los services para traducir a error de dominio).
    const reason = (failed[0] as PromiseRejectedResult).reason;
    expect(isExclusionViolation(reason)).toBe(true);

    // En la DB quedó UNA sola reserva activa en ese rango.
    const rows = await db.adminSql`
      select count(*)::int as n from reservations
      where court_id = ${courtA}
        and status <> 'cancelada'
        and starts_at = ${arDateTimeToUtc(D, "21:00")}`;
    expect(rows[0]?.n).toBe(1);
  });
});
