import { pgTable, uuid, text, boolean, timestamp, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * As 17 unidades válidas (planejamento aprovado — docs/regras-negocio.md).
 * BG 08 E 09 é uma única unidade. Não existem BG 09 separado nem BG 14-18.
 */
export const unidades = pgTable("unidades", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  codigo: text("codigo").notNull().unique(),
  nome: text("nome").notNull(),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Perfis de acesso previstos desde a fundação (planejamento, item 4).
 * Nesta etapa, todo usuário criado recebe 'financeiro_master'.
 */
export const PERFIS_VALIDOS = [
  "admin",
  "financeiro_master",
  "financeiro",
  "gestor_regional",
  "gestor_loja",
] as const;

/** Espelha auth.users do Supabase Auth. */
export const usuarios = pgTable(
  "usuarios",
  {
    id: uuid("id").primaryKey(), // = auth.users.id
    nome: text("nome").notNull(),
    email: text("email").notNull().unique(),
    perfil: text("perfil").notNull().default("financeiro_master"),
    ativo: boolean("ativo").notNull().default(true),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "usuarios_perfil_valido",
      sql`${table.perfil} in ('admin','financeiro_master','financeiro','gestor_regional','gestor_loja')`
    ),
  ]
);

/**
 * Restrição de unidades visíveis por usuário (uso futuro — Fase 2 de
 * permissões). Vazio nesta etapa: ausência de linhas aqui não restringe
 * nada até a policy de RLS específica ser habilitada.
 */
export const usuarioUnidade = pgTable(
  "usuario_unidade",
  {
    usuarioId: uuid("usuario_id")
      .notNull()
      .references(() => usuarios.id, { onDelete: "cascade" }),
    unidadeId: uuid("unidade_id")
      .notNull()
      .references(() => unidades.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.usuarioId, table.unidadeId] })]
);
