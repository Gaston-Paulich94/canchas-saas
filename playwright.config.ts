import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/**
 * Tests end-to-end en navegador real (Chromium).
 *
 * Corren contra la app levantada con `pnpm dev` y los datos de `pnpm db:seed`
 * (usuarios dueno/staff/vecino@demo.test, contraseña DEMO_PASSWORD de `.env`,
 * que se carga acá para los tests). Un solo worker: comparten la base
 * de demo y el rate-limit de login, así que en paralelo se pisarían.
 *
 * Los tests unitarios y de integración siguen en Vitest (`tests/`); estos
 * viven en `e2e/` para que cada runner tome solo lo suyo.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
