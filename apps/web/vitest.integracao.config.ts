import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Testes de INTEGRAÇÃO com PostgreSQL real, porém LOCAL e DESCARTÁVEL (variável PG_TESTE_URL apontando para 127.0.0.1).
 * Não fazem parte de `npm run test` (que roda só `tests/unit`). Sem PG_TESTE_URL os testes são ignorados.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "@painel/shared": fileURLToPath(new URL("../../packages/shared/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
