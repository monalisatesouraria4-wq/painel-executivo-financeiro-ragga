import { pgTable, uuid, text, date, integer, timestamp, jsonb, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usuarios } from "./dimensoes";

/**
 * Tipos de base (mesma lista de packages/shared/tiposBase.ts).
 * Repetida aqui como constraint de banco porque o schema SQL não pode
 * importar diretamente um array TS em tempo de definição da constraint;
 * qualquer mudança na lista de tipos de base deve ser replicada nos dois
 * lugares (ver nota em lib/rules/index.ts).
 */
const TIPOS_BASE_SQL = sql`(
  'faturamento','brindes','cancelamento_salao','cancelamento_delivery',
  'compra_direta','retirada_deposito','fechamento_caixa','pdv_maquininha',
  'formas_pagamento','conferencia','troco','quebra_caixa'
)`;

/**
 * Resolução de aba por período (planejamento v2, itens 1 e 2).
 * Conferência e Quebra de Caixa possuem abas cadastradas de forma
 * independente — nunca compartilham a mesma linha aqui.
 */
export const fontesPorPeriodo = pgTable(
  "fontes_por_periodo",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tipoBase: text("tipo_base").notNull(), // apenas 'conferencia' | 'quebra_caixa' nesta tabela
    arquivoNome: text("arquivo_nome").notNull(),
    nomeAba: text("nome_aba").notNull(),
    periodoInicio: date("periodo_inicio", { mode: "date" }).notNull(),
    periodoFim: date("periodo_fim", { mode: "date" }).notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("fontes_por_periodo_tipo_base_valido", sql`${table.tipoBase} in ('conferencia','quebra_caixa')`),
    check("fontes_por_periodo_periodo_valido", sql`${table.periodoFim} >= ${table.periodoInicio}`),
    unique("fontes_por_periodo_arquivo_aba_unica").on(table.tipoBase, table.arquivoNome, table.nomeAba),
  ]
);

/**
 * Auditoria de toda importação (arquivo -> aba -> dados). Ver
 * docs/regras-negocio.md, seção "Modelo de Importação".
 */
export const importacoes = pgTable(
  "importacoes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tipoBase: text("tipo_base").notNull(),
    arquivoNome: text("arquivo_nome").notNull(),
    // Preenchidos apenas para tipo_base com abas por período (conferência, quebra de caixa).
    abaUtilizada: text("aba_utilizada"),
    periodoAbaInicio: date("periodo_aba_inicio", { mode: "date" }),
    periodoAbaFim: date("periodo_aba_fim", { mode: "date" }),
    periodoDadosInicio: date("periodo_dados_inicio", { mode: "date" }).notNull(),
    periodoDadosFim: date("periodo_dados_fim", { mode: "date" }).notNull(),
    usuarioId: uuid("usuario_id").references(() => usuarios.id),
    dataHoraImportacao: timestamp("data_hora_importacao", { withTimezone: true }).notNull().defaultNow(),
    linhasProcessadas: integer("linhas_processadas").notNull().default(0),
    linhasErro: integer("linhas_erro").notNull().default(0),
    avisos: jsonb("avisos").notNull().default([]),
    status: text("status").notNull(),
  },
  (table) => [
    check("importacoes_tipo_base_valido", sql`${table.tipoBase} in ${TIPOS_BASE_SQL}`),
    check("importacoes_status_valido", sql`${table.status} in ('sucesso','sucesso_com_avisos','falha')`),
  ]
);
