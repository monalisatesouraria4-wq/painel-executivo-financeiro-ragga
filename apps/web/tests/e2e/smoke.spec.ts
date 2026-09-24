import { test, expect } from "@playwright/test";

/**
 * Smoke test mínimo da fundação. Specs de paridade com o painel HTML
 * atual serão adicionados junto com as telas completas.
 */
test("a aplicação sobe e responde na home", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/.+/);
});
