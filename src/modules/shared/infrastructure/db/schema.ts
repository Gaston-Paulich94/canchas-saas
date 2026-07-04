import {
  pgTable,
  pgEnum,
  text,
  uuid,
  timestamp,
  boolean,
  index,
  unique,
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

// Tipos inferidos para uso en la app.
export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type ProfileRole = (typeof profileRole.enumValues)[number];
