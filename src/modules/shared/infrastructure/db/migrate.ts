import { config } from "dotenv";
import { runMigrations } from "./migrations";

// CLI de migraciones (`pnpm db:migrate`). Corre con el rol ADMIN (DATABASE_URL)
// y crea/usa el rol de runtime derivado de APP_DATABASE_URL.
config({ path: ".env" });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}.`);
  return v;
}

async function main(): Promise<void> {
  const adminUrl = required("DATABASE_URL");
  const appDbUrl = new URL(required("APP_DATABASE_URL"));

  const appRole = decodeURIComponent(appDbUrl.username);
  const appPassword = decodeURIComponent(appDbUrl.password);
  if (!appRole || !appPassword) {
    throw new Error(
      "APP_DATABASE_URL debe incluir usuario y contraseña del rol app_user.",
    );
  }

  console.log(`Migrando como admin; rol de runtime: ${appRole} ...`);
  await runMigrations({ adminUrl, appRole, appPassword });
  console.log("Migraciones aplicadas ✔");
}

main().catch((err) => {
  console.error("Fallo la migración:", err);
  process.exit(1);
});
