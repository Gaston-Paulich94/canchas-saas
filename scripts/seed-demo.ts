/**
 * Seed de DEMO para revisar la app de punta a punta en LOCAL.
 *
 *   pnpm db:seed            crea los usuarios y datos de demo (si no existen)
 *   pnpm db:seed --reset    borra la demo anterior y la vuelve a crear
 *
 * Crea:
 *  - "Complejo Demo" con su dueño y un usuario staff, 3 canchas con horarios,
 *    clientes y reservas del mes (para el panel y los reportes).
 *  - "Complejo Vecino", con otro dueño, para verificar el aislamiento: ninguno
 *    de los dos complejos tiene que ver datos del otro.
 *
 * Todo pasa por el mismo camino que la app: la contraseña la hashea
 * better-auth y los datos se escriben con los repositorios dentro de
 * withTenant() (rol app_user, bajo RLS).
 *
 * Por seguridad se niega a correr en producción o contra una base remota:
 * estos usuarios tienen una contraseña conocida.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { env } from "@/env";
import {
  db,
  sqlClient,
  type DbTx,
} from "@/modules/shared/infrastructure/db/client";
import {
  user,
  session,
  account,
  verification,
  tenants,
  type Court,
  type Customer,
  type ReservationStatus,
} from "@/modules/shared/infrastructure/db/schema";
import {
  withSelf,
  withTenant,
  withTenantAndSelf,
} from "@/modules/shared/infrastructure/db/with-tenant";
import { insertTenant } from "@/modules/tenants/infrastructure/tenant.repository";
import {
  insertProfile,
  findProfileByUserId,
} from "@/modules/auth/infrastructure/profile.repository";
import type { ProfileRole } from "@/modules/auth/domain/roles";
import { insertCourt } from "@/modules/courts/infrastructure/court.repository";
import { insertAvailability } from "@/modules/availability/infrastructure/availability.repository";
import { insertCustomer } from "@/modules/customers/infrastructure/customer.repository";
import { insertReservation } from "@/modules/reservations/infrastructure/reservation.repository";
import {
  arDateTimeToUtc,
  todayArDate,
} from "@/modules/reservations/domain/datetime";

// ── Credenciales de demo (SOLO local) ────────────────────────────────────────

const DEMO_PASSWORD = "Demo-Canchas-2026";

const DEMO_USERS = {
  owner: { name: "Dueño Demo", email: "dueno@demo.test" },
  staff: { name: "Staff Demo", email: "staff@demo.test" },
  otroOwner: { name: "Dueño Vecino", email: "vecino@demo.test" },
} as const;

// ── Guardas ──────────────────────────────────────────────────────────────────

function assertLocalDatabase(): void {
  if (env.NODE_ENV === "production") {
    throw new Error("El seed de demo no corre en producción.");
  }
  const host = new URL(env.APP_DATABASE_URL).hostname;
  if (!["localhost", "127.0.0.1", "::1", "db"].includes(host)) {
    throw new Error(
      `El seed de demo solo corre contra una base local (host actual: ${host}).`,
    );
  }
}

// ── Usuarios (better-auth) ───────────────────────────────────────────────────

// Instancia mínima de better-auth: misma base y misma política de contraseña
// que la app, pero sin el plugin de cookies de Next (acá no hay request).
const seedAuth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },
});

async function createUser(name: string, email: string): Promise<string> {
  const res = await seedAuth.api.signUpEmail({
    body: { name, email, password: DEMO_PASSWORD },
  });
  return res.user.id;
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function createComplejo(ownerId: string, nombre: string): Promise<string> {
  const tenantId = randomUUID();
  await withTenantAndSelf(tenantId, ownerId, async (tx) => {
    await insertTenant(tx, {
      id: tenantId,
      name: nombre,
      slug: `demo-${tenantId.slice(0, 8)}`,
    });
    await insertProfile(tx, { userId: ownerId, tenantId, role: "owner" });
  });
  return tenantId;
}

async function addMember(
  tenantId: string,
  userId: string,
  role: ProfileRole,
): Promise<void> {
  await withTenantAndSelf(tenantId, userId, (tx) =>
    insertProfile(tx, { userId, tenantId, role }),
  );
}

// ── Reset ────────────────────────────────────────────────────────────────────

/** Borra los complejos y usuarios de demo (el cascade limpia el resto). */
async function resetDemo(): Promise<void> {
  for (const u of Object.values(DEMO_USERS)) {
    const userId = await findUserIdByEmail(u.email);
    if (!userId) continue;

    const profile = await withSelf(userId, (tx) =>
      findProfileByUserId(tx, userId),
    );
    // Solo el dueño arrastra el complejo; el staff cuelga del mismo tenant.
    if (profile && profile.role === "owner") {
      await withTenant(profile.tenantId, (tx) =>
        tx.delete(tenants).where(eq(tenants.id, profile.tenantId)),
      );
    }
    await db.delete(user).where(eq(user.id, userId));
  }
}

// ── Fechas ───────────────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

/** Días pasados a sembrar: desde el 1° del mes (mínimo 10 días atrás). */
function pastDays(today: string): string[] {
  const dayOfMonth = Number(today.slice(8, 10));
  const back = Math.max(dayOfMonth - 1, 10);
  return Array.from({ length: back }, (_, i) => addDays(today, i - back));
}

// ── Datos del complejo ───────────────────────────────────────────────────────

interface ReservaSeed {
  court: Court;
  cliente: Customer;
  fecha: string;
  hora: string;
  status?: ReservationStatus;
}

async function reservar(
  tx: DbTx,
  tenantId: string,
  r: ReservaSeed,
): Promise<void> {
  const startsAt = arDateTimeToUtc(r.fecha, r.hora);
  const endsAt = new Date(startsAt.getTime() + r.court.slotDurationMin * 60_000);
  await insertReservation(tx, {
    tenantId,
    courtId: r.court.id,
    customerId: r.cliente.id,
    startsAt,
    endsAt,
    status: r.status ?? "confirmada",
    customerName: r.cliente.name,
    customerPhone: r.cliente.phone,
  });
}

async function seedComplejoDemo(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const padel1 = await insertCourt(tx, {
      tenantId,
      name: "Pádel 1",
      sport: "padel",
      surface: "Sintético",
      indoor: true,
      pricePerHour: 18000,
      slotDurationMin: 60,
    });
    const padel2 = await insertCourt(tx, {
      tenantId,
      name: "Pádel 2",
      sport: "padel",
      surface: "Cemento",
      indoor: false,
      pricePerHour: 16000,
      slotDurationMin: 90,
    });
    // Sin precio a propósito: dispara el aviso del panel "no se puede cobrar".
    const futbol5 = await insertCourt(tx, {
      tenantId,
      name: "Fútbol 5",
      sport: "futbol5",
      surface: "Sintético",
      indoor: false,
      pricePerHour: null,
      slotDurationMin: 60,
    });

    for (let dow = 0; dow <= 6; dow++) {
      await insertAvailability(tx, {
        tenantId,
        courtId: padel1.id,
        dayOfWeek: dow,
        openTime: "08:00",
        closeTime: "23:00",
      });
      // Turnos de 90': 16:00, 17:30, 19:00, 20:30 y 22:00.
      await insertAvailability(tx, {
        tenantId,
        courtId: padel2.id,
        dayOfWeek: dow,
        openTime: "16:00",
        closeTime: "23:30",
      });
      await insertAvailability(tx, {
        tenantId,
        courtId: futbol5.id,
        dayOfWeek: dow,
        openTime: "10:00",
        closeTime: "23:00",
      });
    }

    const clientes: Customer[] = [];
    for (const c of [
      { name: "Juan Pérez", phone: "+54 9 11 5555-0101" },
      { name: "María Gómez", phone: "+54 9 11 5555-0102" },
      { name: "Lucas Fernández", phone: "+54 9 11 5555-0103" },
      { name: "Sofía Martínez", phone: "+54 9 11 5555-0104" },
      { name: "Diego Rodríguez", phone: null },
    ]) {
      clientes.push(await insertCustomer(tx, { tenantId, ...c }));
    }

    // Juan (0) es el cliente más frecuente, para que se note en los reportes.
    const ROTACION = [0, 1, 0, 2, 3, 0, 4, 1];
    const cliente = (i: number): Customer => {
      const c = clientes[ROTACION[i % ROTACION.length] ?? 0];
      if (!c) throw new Error("Cliente de demo inexistente.");
      return c;
    };

    const reservas: ReservaSeed[] = [];
    const today = todayArDate();

    // Días pasados del mes: patrón variable, con pico a la noche.
    pastDays(today).forEach((fecha, i) => {
      const nocturnos = 2 + (i % 3);
      for (let h = 0; h < nocturnos; h++) {
        reservas.push({ court: padel1, cliente: cliente(i + h), fecha, hora: `${18 + h}:00` });
      }
      if (i % 4 === 1) reservas.push({ court: padel1, cliente: cliente(i + 5), fecha, hora: "10:00" });
      if (i % 2 === 0) reservas.push({ court: padel2, cliente: cliente(i + 1), fecha, hora: "19:00" });
      if (i % 3 === 0) reservas.push({ court: padel2, cliente: cliente(i + 2), fecha, hora: "20:30" });
      if (i % 2 === 1) reservas.push({ court: futbol5, cliente: cliente(i + 3), fecha, hora: "20:00" });
      if (i % 5 === 0) {
        reservas.push({ court: padel1, cliente: cliente(i + 4), fecha, hora: "12:00", status: "cancelada" });
      }
    });

    // Hoy y los próximos días (agenda y "próximos turnos").
    const manana = addDays(today, 1);
    const pasado = addDays(today, 2);
    reservas.push(
      { court: padel1, cliente: cliente(0), fecha: today, hora: "10:00" },
      { court: padel1, cliente: cliente(1), fecha: today, hora: "20:00" },
      { court: padel1, cliente: cliente(2), fecha: today, hora: "21:00" },
      { court: padel2, cliente: cliente(3), fecha: today, hora: "22:00" },
      { court: futbol5, cliente: cliente(6), fecha: today, hora: "21:00" },
      { court: padel1, cliente: cliente(0), fecha: manana, hora: "18:00" },
      { court: padel1, cliente: cliente(4), fecha: manana, hora: "19:00" },
      { court: padel2, cliente: cliente(1), fecha: manana, hora: "19:00" },
      { court: futbol5, cliente: cliente(2), fecha: manana, hora: "20:00" },
      { court: padel1, cliente: cliente(3), fecha: pasado, hora: "19:00" },
      { court: padel1, cliente: cliente(0), fecha: pasado, hora: "20:00" },
    );

    for (const r of reservas) await reservar(tx, tenantId, r);
    return reservas.length;
  });
}

/** Complejo vecino: pocos datos, solo para comprobar el aislamiento. */
async function seedComplejoVecino(tenantId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const cancha = await insertCourt(tx, {
      tenantId,
      name: "Cancha Vecina",
      sport: "padel",
      surface: "Sintético",
      indoor: false,
      pricePerHour: 20000,
      slotDurationMin: 60,
    });
    for (let dow = 0; dow <= 6; dow++) {
      await insertAvailability(tx, {
        tenantId,
        courtId: cancha.id,
        dayOfWeek: dow,
        openTime: "09:00",
        closeTime: "22:00",
      });
    }
    const cliente = await insertCustomer(tx, {
      tenantId,
      name: "Cliente Vecino",
      phone: "+54 9 11 5555-0999",
    });
    const today = todayArDate();
    for (const [fecha, hora] of [
      [today, "19:00"],
      [today, "20:00"],
      [addDays(today, 1), "19:00"],
    ] as const) {
      await reservar(tx, tenantId, { court: cancha, cliente, fecha, hora });
    }
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

function printCredentials(): void {
  console.log("\nUsuarios de demo (contraseña para todos: " + DEMO_PASSWORD + ")");
  console.log("  Dueño   " + DEMO_USERS.owner.email + "   → Complejo Demo (acceso completo)");
  console.log("  Staff   " + DEMO_USERS.staff.email + "   → Complejo Demo (sin reportes ni conexión de MP)");
  console.log("  Vecino  " + DEMO_USERS.otroOwner.email + "  → Complejo Vecino (para probar aislamiento)");
  console.log("\nEntrá en " + env.BETTER_AUTH_URL + "/login\n");
}

async function main(): Promise<void> {
  assertLocalDatabase();

  if (process.argv.includes("--reset")) {
    console.log("Borrando la demo anterior…");
    await resetDemo();
  } else if (await findUserIdByEmail(DEMO_USERS.owner.email)) {
    console.log("La demo ya existe (usá `pnpm db:seed --reset` para regenerarla).");
    printCredentials();
    return;
  }

  const ownerId = await createUser(DEMO_USERS.owner.name, DEMO_USERS.owner.email);
  const tenantId = await createComplejo(ownerId, "Complejo Demo");
  const staffId = await createUser(DEMO_USERS.staff.name, DEMO_USERS.staff.email);
  await addMember(tenantId, staffId, "staff");
  const reservas = await seedComplejoDemo(tenantId);

  const vecinoId = await createUser(
    DEMO_USERS.otroOwner.name,
    DEMO_USERS.otroOwner.email,
  );
  const vecinoTenantId = await createComplejo(vecinoId, "Complejo Vecino");
  await seedComplejoVecino(vecinoTenantId);

  console.log(`Demo creada: 3 canchas, 5 clientes y ${reservas} reservas en "Complejo Demo".`);
  printCredentials();
}

main()
  .catch((err: unknown) => {
    console.error("Falló el seed de demo:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => sqlClient.end({ timeout: 5 }));
