import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const cfg = JSON.parse(readFileSync(".local/test-config.json", "utf8"));
test("creación de producto, movimiento, conteo móvil, revisión y reporte", async ({
  page,
  request,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Correo electrónico").fill(cfg.ADMIN_EMAIL);
  await page.getByLabel("Contraseña", { exact: true }).fill(cfg.ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Entrar a inventarios" }).click();
  await expect(page.getByRole("heading", { name: /Hola,/ })).toBeVisible();
  await page.screenshot({
    path: `.local/${info.project.name}-dashboard.png`,
    fullPage: true,
  });
  // La creación ocurre en la interfaz; cada proyecto usa datos aislados.
  await page.goto("/products");
  await page.getByRole("button", { name: "Agregar producto" }).click();
  const code = "E2E-" + randomUUID().slice(0, 8),
    name = "Refresco E2E " + code;
  await page.getByLabel("Código interno").fill(code);
  await page.getByLabel("Nombre", { exact: true }).fill(name);
  await page
    .getByRole("combobox", { name: "Categoría", exact: true })
    .selectOption({ label: "Bebidas" });
  await page
    .getByRole("combobox", { name: "Unidad base", exact: true })
    .selectOption({ label: "Pieza (pza)" });
  await page.getByLabel("Costo unitario MXN").fill("20.1234");
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.goto("/inventory");
  await page.getByRole("button", { name: "Registrar movimiento" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Sucursal", exact: true })
    .selectOption({ label: "Venecia" });
  await dialog
    .getByRole("combobox", { name: "Tipo", exact: true })
    .selectOption("INITIAL");
  await dialog
    .getByRole("combobox", { name: "Producto", exact: true })
    .selectOption({ label: name + " · pza" });
  await dialog.getByLabel("Cantidad", { exact: true }).fill("24");
  await dialog.getByLabel("Motivo").fill("Carga inicial E2E");
  await dialog.getByRole("button", { name: "Registrar movimiento" }).click();
  await expect(dialog).toBeHidden();
  await page.goto("/counts");
  await page.getByRole("button", { name: "Nuevo conteo" }).click();
  const form = page.getByRole("dialog");
  const countName = "Conteo E2E " + code;
  await form.getByLabel("Nombre", { exact: true }).fill(countName);
  await form
    .getByRole("combobox", { name: "Sucursal", exact: true })
    .selectOption({ label: "Venecia" });
  await form
    .getByRole("combobox", { name: "Responsable", exact: true })
    .selectOption({ label: "Administrador Fatboy" });
  await form.getByLabel(name, { exact: false }).check();
  await form.getByRole("button", { name: "Crear borrador" }).click();
  await expect(form).toBeHidden();
  await page
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { name: countName }) })
    .click();
  await page.getByRole("button", { name: "Iniciar conteo" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar" })
    .click();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: /^Todos/ }).click();
  await expect(
    page.getByLabel("Cantidad física", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Cantidad física", { exact: true }).fill("22");
  await page.getByRole("button", { name: "Guardar y siguiente" }).click();
  await expect(page.getByText("1 de 1 productos guardados")).toBeVisible();
  await page.screenshot({
    path: `.local/${info.project.name}-capture.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Revisar y enviar" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar" })
    .click();
  await expect(page.getByText("ENVIADO", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Aprobar ajustes" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar" })
    .click();
  await expect(page.getByText("APROBADO", { exact: true })).toBeVisible();
  await page.goto("/reports");
  await page
    .getByRole("combobox", { name: "Producto", exact: true })
    .selectOption({ label: name });
  await expect(
    page.getByRole("cell", { name: "22", exact: true }),
  ).toBeVisible();
  const xlsx = page.waitForEvent("download");
  await page.getByRole("button", { name: "Excel" }).click();
  expect((await xlsx).suggestedFilename()).toContain(".xlsx");
  const pdf = page.waitForEvent("download");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  expect((await pdf).suggestedFilename()).toContain(".pdf");
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});
test("API rechaza acceso sin sesión y valida origen de renovación", async ({
  request,
}) => {
  expect(
    (await request.get("http://127.0.0.1:3001/api/v1/inventory")).status(),
  ).toBe(401);
  expect(
    (
      await request.post("http://127.0.0.1:3001/api/v1/auth/refresh", {
        headers: { Origin: "https://otro.local" },
      })
    ).status(),
  ).toBe(403);
});
