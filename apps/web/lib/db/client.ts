import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

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
  // Pool contido para ambiente serverless: poucas conexões por instância, ociosas fecham logo (evita reutilizar
  // conexão já derrubada pelo pooler) e a conexão inicial não fica pendurada.
  const client = postgres(connectionString, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 });
  return drizzle(client, { schema });
}

let dbSingleton: ReturnType<typeof criarClienteDb> | null = null;

export function getDb() {
  if (!dbSingleton) {
    dbSingleton = criarClienteDb();
  }
  return dbSingleton;
}
