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

/**
 * Contador de intentos para el rate-limit de login/registro (anti fuerza
 * bruta). Vive en la DB para que funcione con varias instancias (serverless).
 *
 * `key_hash` es un HMAC de la clave lógica (ej. "login:email:x@y.com"): no se
 * guardan emails ni IPs en claro. Sin tenant ni RLS, como las tablas de
 * better-auth: se consulta antes de que exista una sesión.
 */
export const authRateLimits = pgTable("auth_rate_limits", {
  keyHash: text("key_hash").primaryKey(),
  count: integer("count").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

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
    // Un usuario pertenece a UN solo complejo (la sesión deriva el tenant de su
    // único profile). A nivel DB impide que se agregue un segundo profile en
    // otro tenant — p. ej. para colarse como owner de un complejo ajeno.
    unique("profiles_user_unique").on(t.userId),
    index("profiles_tenant_id_idx").on(t.tenantId),
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
    // NO ACTION (no cascade): borrar una cancha NO puede llevarse su historial
    // de reservas ni, por arrastre, sus pagos. Para sacar de uso una cancha con
    // historial está la baja lógica (is_active). Es NO ACTION y no RESTRICT a
    // propósito: se verifica al final de la sentencia, así la baja completa de
    // un tenant (que borra canchas y reservas en cascada) sigue funcionando.
    courtId: uuid("court_id")
      .notNull()
      .references(() => courts.id, { onDelete: "no action" }),
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

// ── pagos (Mercado Pago) ─────────────────────────────────────────────────────

export const paymentStatus = pgEnum("payment_status", [
  "pendiente",
  "aprobado",
  "rechazado",
  "reembolsado",
  "cancelado",
]);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // NO ACTION: un pago es historial financiero y no se borra en cascada. Hoy
    // la app nunca borra reservas (cancelar es baja lógica); esto lo garantiza
    // la base aunque algún código futuro lo intente.
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "no action" }),

    // Importes en CENTAVOS (enteros): nunca float para dinero. El monto lo
    // calcula el backend desde el precio de la cancha, jamás el cliente.
    amountCents: integer("amount_cents").notNull(),
    feeCents: integer("fee_cents").notNull().default(0),

    // El status lo decide el servidor a partir del webhook FIRMADO + la
    // re-consulta a la API de MP. Nunca un input del cliente.
    status: paymentStatus("status").notNull().default("pendiente"),

    // Ids de Mercado Pago. mp_payment_id es único por tenant (idempotencia del
    // webhook: la misma notificación repetida no duplica ni re-procesa).
    mpPreferenceId: text("mp_preference_id"),
    mpPaymentId: text("mp_payment_id"),
    // Punto de enganche para reporting (Fase 9) y conciliación.
    paidAt: timestamp("paid_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("payments_amount_positive", sql`${t.amountCents} > 0`),
    check(
      "payments_fee_range",
      sql`${t.feeCents} >= 0 and ${t.feeCents} <= ${t.amountCents}`,
    ),
    index("payments_tenant_id_idx").on(t.tenantId),
    index("payments_reservation_id_idx").on(t.reservationId),
    // Idempotencia del webhook y anti doble-cobro por reserva se refuerzan con
    // índices únicos PARCIALES en la migración custom 0011.
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
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type PaymentStatus = (typeof paymentStatus.enumValues)[number];
