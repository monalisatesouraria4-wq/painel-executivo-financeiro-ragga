import { pgTable, uuid, date, text, numeric, integer, boolean, timestamp, unique, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { unidades } from "./dimensoes";
import { importacoes } from "./importacao";
import { fontesPorPeriodo } from "./importacao";

/**
 * Bases com chave de deduplicação validada (planejamento + regras
 * confirmadas nas bases reais). Reimportação faz upsert por chave
 * (ver apps/web/lib/rules/deduplicacao.ts e chaves.ts).
 */

function colunasComuns() {
  return {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    unidadeId: uuid("unidade_id")
      .notNull()
      .references(() => unidades.id),
    data: date("data", { mode: "date" }).notNull(),
    importacaoId: uuid("importacao_id").references(() => importacoes.id),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
  };
}

/** Chave: filial + data. */
export const faturamento = pgTable(
  "faturamento",
  {
    ...colunasComuns(),
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [unique("faturamento_chave").on(table.unidadeId, table.data)]
);

/**
 * Chave: filial + data + motivo + motivo2.
 * motivo2 é NOT NULL DEFAULT '' para a unicidade funcionar de forma
 * confiável no Postgres (NULL não é igual a NULL em constraints UNIQUE).
 */
export const brindes = pgTable(
  "brindes",
  {
    ...colunasComuns(),
    motivo: text("motivo").notNull(),
    motivo2: text("motivo2").notNull().default(""),
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
    quantidade: numeric("quantidade", { precision: 12, scale: 2 }),
  },
  (table) => [
    unique("brindes_chave").on(table.unidadeId, table.data, table.motivo, table.motivo2),
  ]
);

/** Chave: filial + data + motivo. */
export const cancelamentoSalao = pgTable(
  "cancelamento_salao",
  {
    ...colunasComuns(),
    motivo: text("motivo").notNull(),
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [unique("cancelamento_salao_chave").on(table.unidadeId, table.data, table.motivo)]
);

/** Chave: filial + data + motivo. */
export const cancelamentoDelivery = pgTable(
  "cancelamento_delivery",
  {
    ...colunasComuns(),
    motivo: text("motivo").notNull(),
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [unique("cancelamento_delivery_chave").on(table.unidadeId, table.data, table.motivo)]
);

/** Chave: filial + data + motivo. */
export const compraDireta = pgTable(
  "compra_direta",
  {
    ...colunasComuns(),
    motivo: text("motivo").notNull(),
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [unique("compra_direta_chave").on(table.unidadeId, table.data, table.motivo)]
);

/** Chave: filial + data + forma_pagamento. */
export const pdvMaquininha = pgTable(
  "pdv_maquininha",
  {
    ...colunasComuns(),
    formaPagamento: text("forma_pagamento").notNull(),
    valorPdv: numeric("valor_pdv", { precision: 14, scale: 2 }).notNull(),
    valorMaquininha: numeric("valor_maquininha", { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [
    unique("pdv_maquininha_chave").on(table.unidadeId, table.data, table.formaPagamento),
  ]
);

/** Chave: filial + data + forma. */
export const formasPagamento = pgTable(
  "formas_pagamento",
  {
    ...colunasComuns(),
    forma: text("forma").notNull(),
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [unique("formas_pagamento_chave").on(table.unidadeId, table.data, table.forma)]
);

/**
 * Chave: filial + data (granularidade real confirmada — contagem diária
 * agregada por filial, sem "tipo"/marcação por caixa individual).
 *
 * Estrutura real (planejamento v4 — ver docs/regras-negocio.md, seção
 * "Divergência: Conferência"): cada aba de período tem uma linha por
 * filial e uma coluna por dia. A célula do dia é OU um número (qtd. de
 * caixas conferidos naquele dia) OU o texto "X"/"x" (marcado como em
 * atraso) OU vazia (sem lançamento ainda). As três informações são
 * preservadas sem conversão:
 * - qtdCadastrados: vem da coluna "Qtd. caixas" da linha 6 (constante
 *   para a filial no período).
 * - qtdConferidos: número da célula do dia — NULL quando a célula é
 *   "X"/"x" OU vazia (nunca convertido para 0).
 * - emAtraso: true somente quando a célula do dia é "X"/"x"; false para
 *   número ou célula vazia.
 *
 * fontePeriodoId aponta para a aba resolvida (planejamento v2) — nunca
 * compartilhada com quebra_caixa; preserva a rastreabilidade do
 * período/aba de origem para auditoria.
 */
export const conferencia = pgTable(
  "conferencia",
  {
    ...colunasComuns(),
    qtdCadastrados: integer("qtd_cadastrados").notNull(),
    qtdConferidos: integer("qtd_conferidos"), // NULL quando em atraso ou célula vazia
    emAtraso: boolean("em_atraso").notNull().default(false),
    fontePeriodoId: uuid("fonte_periodo_id")
      .notNull()
      .references(() => fontesPorPeriodo.id),
  },
  (table) => [
    unique("conferencia_chave").on(table.unidadeId, table.data),
    check("conferencia_qtd_conferidos_nulo_se_em_atraso", sql`NOT (${table.emAtraso} AND ${table.qtdConferidos} IS NOT NULL)`),
  ]
);
