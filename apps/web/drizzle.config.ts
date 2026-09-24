import { defineConfig } from "drizzle-kit";

/**
 * Configuração do Drizzle Kit (migrations).
 * O schema propriamente dito (tabelas) será criado na Etapa 2 —
 * este arquivo apenas prepara o ambiente de migrations.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema/*.ts",
  out: "../../supabase/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  verbose: true,
  strict: true,
});
