import { pgTable, uuid, date, text, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { unidades } from "./dimensoes";
import { importacoes, fontesPorPeriodo } from "./importacao";

/**
 * Bases SEM deduplicação (planejamento + regras confirmadas nas bases
 * reais): fechamento_caixa, retirada_deposito, troco, quebra_caixa.
 * Nenhuma constraint UNIQUE de negócio aqui — duplicidades são legítimas.
 * Reimportação de um período: DELETE do período + INSERT (ver
 * apps/web/lib/rules/deduplicacao.ts). O `importacao_id` rastreia qual
 * importação gravou cada lote, mesmo sem dedup.
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
  };
}

/**
 * Chave de referência (auditoria, não dedup): filial + data + movimento.
 * "caixa" foi removido da chave de referência — validado nas bases reais
 * que filial+data+caixa causava perda de registros legítimos.
 */
export const fechamentoCaixa = pgTable(
  "fechamento_caixa",
  {
    ...colunasComuns(),
    caixa: text("caixa").notNull(),
    movimento: text("movimento").notNull(),
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [index("fechamento_caixa_unidade_data_idx").on(table.unidadeId, table.data)]
);

/** Cada lançamento é um registro — sem chave de unicidade. */
export const retiradaDeposito = pgTable(
  "retirada_deposito",
  {
    ...colunasComuns(),
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [index("retirada_deposito_unidade_data_idx").on(table.unidadeId, table.data)]
);

/**
 * Troco. `data` armazena a data real do lançamento na semana (planejamento:
 * "utilizar as datas reais da semana", sem tolerância inventada).
 */
export const troco = pgTable(
  "troco",
  {
    ...colunasComuns(),
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [index("troco_unidade_data_idx").on(table.unidadeId, table.data)]
);

/**
 * Quebra de Caixa. `fontePeriodoId` aponta para a aba resolvida
 * (planejamento v2, item 2) — resolvedor independente do de Conferência,
 * mesmo quando os períodos coincidem.
 */
export const quebraCaixa = pgTable(
  "quebra_caixa",
  {
    ...colunasComuns(),
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
    fontePeriodoId: uuid("fonte_periodo_id")
      .notNull()
      .references(() => fontesPorPeriodo.id),
  },
  (table) => [index("quebra_caixa_unidade_data_idx").on(table.unidadeId, table.data)]
);
