import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  uuid,
  timestamp,
  boolean,
  integer,
  smallint,
  time,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";

/**
 * Esquema único de Drizzle = fuente de verdad de la DB.
 *
 * Contiene:
 *  - Tablas internas de better-auth (user, session, account, verification).
 *    Sus nombres de propiedad (camelCase) son los que better-auth espera; los
 *    nombres de columna SQL van en snake_case. NO llevan RLS: en el momento del
 *    login todavía no hay contexto de tenant.
 *  - Tablas de negocio (tenants, profiles) que SÍ llevan RLS (ver migración RLS).
 *
 * Convención del proyecto: toda tabla lleva created_at y updated_at.
 */

// ─────────────────────────────────────────────────────────────────────────────
// better-auth (núcleo de autenticación)
// ─────────────────────────────────────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ─────────────────────────────────────────────────────────────────────────────
// Negocio (multi-tenant, con RLS)
// ─────────────────────────────────────────────────────────────────────────────

export const profileRole = pgEnum("profile_role", [
  "owner",
  "staff",
  "cliente",
]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),

  // Mercado Pago (modelo marketplace/OAuth). Se completan en la fase de pagos.
  // Los tokens se guardan CIFRADOS (AES-256-GCM) — los campos *_enc nunca
  // contienen texto plano y nunca se serializan al cliente.
  mpUserId: text("mp_user_id"),
  mpAccessTokenEnc: text("mp_access_token_enc"),
  mpRefreshTokenEnc: text("mp_refresh_token_enc"),
  mpTokenExpiresAt: timestamp("mp_token_expires_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // FK al usuario de better-auth (id es text en better-auth).
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: profileRole("role").notNull().default("cliente"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Un usuario tiene un único profile por tenant.
    unique("profiles_user_tenant_unique").on(t.userId, t.tenantId),
    index("profiles_tenant_id_idx").on(t.tenantId),
    index("profiles_user_id_idx").on(t.userId),
  ],
);

// ── canchas (courts) ─────────────────────────────────────────────────────────

export const courtSport = pgEnum("court_sport", [
  "padel",
  "futbol5",
  "futbol11",
  "tenis",
]);

export const courts = pgTable(
  "courts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sport: courtSport("sport").notNull(),
    // Superficie: cemento, sintético, polvo de ladrillo, etc. Opcional.
    surface: text("surface"),
    // Techada.
    indoor: boolean("indoor").notNull().default(false),
    // Baja lógica: una cancha inactiva no se ofrece, sin romper datos históricos.
    isActive: boolean("is_active").notNull().default(true),
    // Precio de referencia por hora, en pesos ARS (enteros). El cobro real se
    // define en la fase de pagos (Mercado Pago); acá es solo informativo.
    pricePerHour: integer("price_per_hour"),
    // Duración de cada turno reservable, en minutos. Base para generar los slots.
    slotDurationMin: integer("slot_duration_min").notNull().default(60),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // No dos canchas con el mismo nombre dentro de un mismo complejo.
    unique("courts_tenant_name_unique").on(t.tenantId, t.name),
    index("courts_tenant_id_idx").on(t.tenantId),
  ],
);

// ── disponibilidad (horario semanal por cancha) ──────────────────────────────

export const courtAvailability = pgTable(
  "court_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    courtId: uuid("court_id")
      .notNull()
      .references(() => courts.id, { onDelete: "cascade" }),
    // 0 = Domingo … 6 = Sábado (convención de JS Date.getDay).
    dayOfWeek: smallint("day_of_week").notNull(),
    openTime: time("open_time").notNull(),
    closeTime: time("close_time").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("court_availability_day_range", sql`${t.dayOfWeek} between 0 and 6`),
    check("court_availability_time_order", sql`${t.closeTime} > ${t.openTime}`),
    index("court_availability_court_id_idx").on(t.courtId),
    index("court_availability_tenant_id_idx").on(t.tenantId),
    // El anti-solapamiento de ventanas se hace con un EXCLUDE constraint sobre un
    // rango de tiempo (btree_gist + tipo timerange) en la migración custom 0005.
  ],
);

// ── clientes ─────────────────────────────────────────────────────────────────

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Teléfono: clave de dedup (único por tenant cuando existe — índice único
    // PARCIAL en la migración custom 0009) y canal de WhatsApp a futuro.
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("customers_tenant_id_idx").on(t.tenantId),
    index("customers_tenant_name_idx").on(t.tenantId, t.name),
  ],
);

// ── reservas ─────────────────────────────────────────────────────────────────

export const reservationStatus = pgEnum("reservation_status", [
  "confirmada",
  "cancelada",
]);

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    courtId: uuid("court_id")
      .notNull()
      .references(() => courts.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // El status lo decide SIEMPRE el servidor (nunca viene del payload).
    status: reservationStatus("status").notNull().default("confirmada"),
    // Cliente vinculado (find-or-create al reservar). SET NULL al borrarlo: la
    // reserva conserva el snapshot inline de nombre/teléfono como historial.
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("reservations_time_order", sql`${t.endsAt} > ${t.startsAt}`),
    index("reservations_tenant_id_idx").on(t.tenantId),
    index("reservations_court_id_idx").on(t.courtId),
    // Agenda del día: se consulta por tenant + rango de fecha.
    index("reservations_tenant_starts_at_idx").on(t.tenantId, t.startsAt),
    // Historial de reservas de un cliente.
    index("reservations_customer_id_idx").on(t.customerId),
    // El anti doble-booking es un EXCLUDE parcial (WHERE status <> 'cancelada')
    // sobre tstzrange(starts_at, ends_at) en la migración custom 0007.
  ],
);

// Tipos inferidos para uso en la app.
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type ProfileRole = (typeof profileRole.enumValues)[number];
export type Court = typeof courts.$inferSelect;
export type NewCourt = typeof courts.$inferInsert;
export type CourtSport = (typeof courtSport.enumValues)[number];
export type CourtAvailability = typeof courtAvailability.$inferSelect;
export type NewCourtAvailability = typeof courtAvailability.$inferInsert;
export type Reservation = typeof reservations.$inferSelect;
export type NewReservation = typeof reservations.$inferInsert;
export type ReservationStatus = (typeof reservationStatus.enumValues)[number];
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
