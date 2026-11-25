import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { runMigrations } from "@/modules/shared/infrastructure/db/migrations";
import * as schema from "@/modules/shared/infrastructure/db/schema";

/**
 * Levanta un Postgres real (testcontainers), corre las migraciones (tablas +
 * RLS + rol app_user) y expone dos conexiones:
 *  - admin: superusuario `postgres` (para sembrar datos; bypassa RLS).
 *  - app:   rol `app_user` (no-owner, NOBYPASSRLS) → respeta RLS, igual que el
 *           runtime de la app.
 */
export interface TestDb {
  container: StartedPostgreSqlContainer;
  adminSql: postgres.Sql;
  appSql: postgres.Sql;
  appDb: PostgresJsDatabase<typeof schema>;
  stop: () => Promise<void>;
}

const APP_ROLE = "app_user";

/** Password efímero por corrida (hex: URL-safe). El contenedor muere al final. */
function ephemeralPassword(): string {
  return randomBytes(16).toString("hex");
}

export async function setupTestDb(): Promise<TestDb> {
  const appPassword = ephemeralPassword();
  const container = await new PostgreSqlContainer("postgres:17.2-alpine")
    .withDatabase("canchas")
    .withUsername("postgres")
    .withPassword(ephemeralPassword())
    .start();

  const adminUrl = container.getConnectionUri();
  const u = new URL(adminUrl);
  const appUrl = `postgres://${APP_ROLE}:${appPassword}@${u.hostname}:${u.port}${u.pathname}`;

  await runMigrations({
    adminUrl,
    appRole: APP_ROLE,
    appPassword,
    migrationsFolder: path.resolve(process.cwd(), "drizzle"),
  });

  const adminSql = postgres(adminUrl, { prepare: false });
  const appSql = postgres(appUrl, { prepare: false });
  const appDb = drizzle(appSql, { schema });

  const stop = async (): Promise<void> => {
    await adminSql.end({ timeout: 5 });
    await appSql.end({ timeout: 5 });
    await container.stop();
  };

  return { container, adminSql, appSql, appDb, stop };
}
