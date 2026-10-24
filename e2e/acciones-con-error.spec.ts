import { test, expect, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * Hallazgo #15 (regresión): las Server Actions a las que un componente de
 * CLIENTE les pasaba el id con `.bind(null, id)` y que DEVOLVÍAN un error no
 * respondían nunca cuando el formulario se enviaba sin JavaScript (bug de
 * Next, reproducido con una página mínima en 16.3.8, 16.4.2 y 16.4.3). Ahora
 * el id viaja como campo oculto.
 *
 * Contra el código anterior, "borrar cancha" y "franja que se solapa" (bind en
 * componente de cliente) fallan sin JavaScript. "Renombrar" no fallaba (su
 * bind estaba en la página, del lado del servidor): queda como cobertura de
 * la conversión, igual que el caso de éxito con redirección.
 *
 * Cada caso corre con y sin JavaScript. Los de error no modifican datos.
 */

const RESPUESTA_MAX_MS = 5_000;

async function abrirPadel1(page: Page): Promise<void> {
  await page.goto("/dashboard/canchas");
  await page.getByRole("link", { name: /Pádel 1/ }).click();
  await expect(page.getByText("Editar cancha")).toBeVisible();
}

/** Espera el mensaje de error y verifica que llegó rápido. */
async function esperarError(page: Page, texto: string, inicio: number): Promise<void> {
  await expect(page.getByRole("alert").filter({ hasText: texto })).toBeVisible({
    timeout: 15_000,
  });
  expect(Date.now() - inicio).toBeLessThan(RESPUESTA_MAX_MS);
}

for (const conJs of [true, false]) {
  test.describe(conJs ? "con JavaScript" : "sin JavaScript", () => {
    test.use({ javaScriptEnabled: conJs });

    test.beforeEach(async ({ page }) => {
      await login(page, "dueno@demo.test");
    });

    test("borrar una cancha con historial muestra el error", async ({ page }) => {
      await abrirPadel1(page);
      // Con JavaScript, el botón pide confirmación (window.confirm).
      page.once("dialog", (d) => d.accept());
      const inicio = Date.now();
      await page.getByRole("button", { name: "Eliminar cancha" }).click();
      await esperarError(page, "tiene reservas registradas", inicio);
    });

    test("renombrar una cancha a un nombre en uso muestra el error", async ({ page }) => {
      await abrirPadel1(page);
      await page.getByLabel("Nombre").fill("Pádel 2");
      const inicio = Date.now();
      await page.getByRole("button", { name: "Guardar cambios" }).click();
      await esperarError(page, "Ya existe una cancha con ese nombre", inicio);
    });

    test("cargar una franja que se solapa muestra el error", async ({ page }) => {
      await abrirPadel1(page);
      await page.getByRole("link", { name: "Gestionar horarios y turnos" }).click();
      // Pádel 1 abre todos los días de 08 a 23: un lunes de 09 a 10 se solapa.
      await page.getByLabel("Día").selectOption({ label: "Lunes" });
      await page.getByLabel("Apertura").fill("09:00");
      await page.getByLabel("Cierre").fill("10:00");
      const inicio = Date.now();
      await page.getByRole("button", { name: "Agregar" }).click();
      await esperarError(page, "se solapa", inicio);
    });

    test("guardar una cancha sin cambios sigue redirigiendo al listado", async ({ page }) => {
      await abrirPadel1(page);
      await page.getByRole("button", { name: "Guardar cambios" }).click();
      await expect(page).toHaveURL(/\/dashboard\/canchas$/, { timeout: RESPUESTA_MAX_MS });
    });
  });
}
