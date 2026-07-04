import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Cargamos .env solo para las tareas de CLI de Drizzle (generate/migrate).
config({ path: ".env" });

// Las MIGRACIONES corren con el rol administrador/owner de la DB (DDL, creación
// de roles, RLS). El runtime de la app usa APP_DATABASE_URL (rol app_user,
// no-owner, sin BYPASSRLS). Ver README.
const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) {
  throw new Error("DATABASE_URL es requerida para drizzle-kit (rol admin).");
}

export default defineConfig({
  schema: "./src/modules/shared/infrastructure/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: adminUrl },
  strict: true,
  verbose: true,
});
