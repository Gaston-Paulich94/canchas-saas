import { expect, type Page } from "@playwright/test";

/** Contraseña de los usuarios del seed de demo (solo local). */
export const DEMO_PASSWORD = "Demo-Canchas-2026";

/** Inicia sesión por el formulario real, como lo haría una persona. */
export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
