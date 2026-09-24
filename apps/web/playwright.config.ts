import { defineConfig, devices } from "@playwright/test";

/**
 * Configuração inicial do Playwright (Etapa 1 — fundação).
 * Ainda sem specs de E2E reais: eles serão adicionados junto com as
 * telas completas (etapas seguintes), validando paridade com o
 * painel HTML atual conforme o planejamento aprovado.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
