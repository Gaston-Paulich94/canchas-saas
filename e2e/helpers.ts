import { expect, type Page } from "@playwright/test";

/**
 * Contraseña de los usuarios del seed de demo: la misma DEMO_PASSWORD de `.env`
 * que usó `pnpm db:seed`. No va en el código (la marcan los escáneres de
 * secretos).
 */
function demoPassword(): string {
  const value = process.env.DEMO_PASSWORD;
  if (!value) {
    throw new Error("Falta DEMO_PASSWORD en .env (la misma que usó `pnpm db:seed`).");
  }
  return value;
}

/** Inicia sesión por el formulario real, como lo haría una persona. */
export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(demoPassword());
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
