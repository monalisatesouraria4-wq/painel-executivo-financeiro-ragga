import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

/**
 * Cliente de banco (Drizzle + postgres-js) para uso em server-side
 * (API routes, server actions). Não é chamado em nenhum lugar ainda
 * nesta etapa — apenas prepara a conexão para a Etapa 2 em diante.
 *
 * DATABASE_URL vem do projeto Supabase (connection string do Postgres).
 */
function criarClienteDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL não configurada. Defina em apps/web/.env.local (ver .env.example)."
    );
  }
  const client = postgres(connectionString, { prepare: false });
  return drizzle(client);
}

let dbSingleton: ReturnType<typeof criarClienteDb> | null = null;

export function getDb() {
  if (!dbSingleton) {
    dbSingleton = criarClienteDb();
  }
  return dbSingleton;
}
