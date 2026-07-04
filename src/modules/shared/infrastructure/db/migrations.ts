import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/**
 * Migrador reutilizable (sin dependencia de `env`, así lo pueden invocar tanto
 * el CLI `pnpm db:migrate` como los tests con su contenedor efímero).
 *
 * Pasos:
 *  1. Garantiza el rol de runtime `appRole`: LOGIN, NOBYPASSRLS, NOSUPERUSER,
 *     NOCREATEDB, NOCREATEROLE. Es el rol con el que la app respeta RLS.
 *  2. Aplica las migraciones de ./drizzle (tablas + RLS) con el migrador de
 *     Drizzle, usando el rol ADMIN (owner).
 *
 * `adminUrl` debe apuntar al rol administrador/owner (no a appRole).
 */
export interface RunMigrationsOptions {
  adminUrl: string;
  appRole: string;
  appPassword: string;
  migrationsFolder?: string;
}

function assertSafeRoleName(role: string): void {
  // Identificador SQL seguro: el nombre del rol viene de config del operador,
  // pero igual lo validamos para no construir DDL con algo inesperado.
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
    throw new Error(`Nombre de rol inválido: ${role}`);
  }
}

async function ensureAppRole(
  admin: postgres.Sql,
  role: string,
  password: string,
): Promise<void> {
  assertSafeRoleName(role);
  // Escapamos la password como literal SQL (duplicando comillas simples).
  const escPw = password.replace(/'/g, "''");
  await admin.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE "${role}" LOGIN PASSWORD '${escPw}'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      ELSE
        ALTER ROLE "${role}" LOGIN PASSWORD '${escPw}'
          NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
    END
    $$;
  `);
}

export async function runMigrations(
  opts: RunMigrationsOptions,
): Promise<void> {
  const folder =
    opts.migrationsFolder ?? path.join(process.cwd(), "drizzle");

  const admin = postgres(opts.adminUrl, { max: 1, prepare: false });
  try {
    await ensureAppRole(admin, opts.appRole, opts.appPassword);
    await migrate(drizzle(admin), { migrationsFolder: folder });
  } finally {
    await admin.end({ timeout: 5 });
  }
}
