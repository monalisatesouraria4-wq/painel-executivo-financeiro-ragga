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
    // "Resp. pela Conferência" — campo informativo/auditável da fonte
    // real (ex.: "MONALISA", "GERENTE"). Não entra na chave.
    respConferencia: text("resp_conferencia"),
    fontePeriodoId: uuid("fonte_periodo_id")
      .notNull()
      .references(() => fontesPorPeriodo.id),
  },
  (table) => [
    unique("conferencia_chave").on(table.unidadeId, table.data),
    check("conferencia_qtd_conferidos_nulo_se_em_atraso", sql`NOT (${table.emAtraso} AND ${table.qtdConferidos} IS NOT NULL)`),
  ]
);

/**
 * As 4 bases abaixo (Fechamento de Caixa, Troco, Retirada Depósito,
 * Quebra de Caixa) foram REALOCADAS para este arquivo (Etapa 6):
 * confirmado, lendo o código-fonte do painel HTML atual (fonte oficial
 * de regras operacionais), que elas usam UPSERT por uma chave composta
 * própria — não "delete do período + insert" como o planejamento
 * original descrevia. Ver docs/regras-negocio.md, seção "Estratégia de
 * Reimportação — Alinhamento com o Painel Atual (Etapa 6)".
 *
 * Chave de referência (auditoria, não dedup automático além da chave):
 * filial + data + caixa + movimento. Validado nas bases reais:
 * filial+data+caixa (sem movimento) gerava 16 duplicidades;
 * filial+data+caixa+movimento gerou zero — "caixa" é necessário: dois
 * caixas da mesma filial podem ter o mesmo movimento na mesma data.
 * Bate exatamente com `chaveFechamento` do painel HTML atual.
 *
 * SEM campo de valor monetário — confirmado que a fonte real
 * (FECHAMENTO DE CAIXA - ABERTOS_FECHADOS_CONCILIADOS.xlsx.xlsx) não tem
 * essa coluna. Campos abaixo preservam exatamente o que existe na fonte:
 * Abertura/Fechamento como texto (formatos observados variam, ex.
 * "10:26" e "01/09 14:08" — não reinterpretados), Situação, e as três
 * colunas de diferença (podem ser nulas, como na fonte).
 */
export const fechamentoCaixa = pgTable(
  "fechamento_caixa",
  {
    ...colunasComuns(),
    caixa: text("caixa").notNull(),
    movimento: text("movimento").notNull(),
    abertura: text("abertura"),
    fechamento: text("fechamento"),
    operador: text("operador"),
    situacao: text("situacao"),
    difFechamento: numeric("dif_fechamento", { precision: 14, scale: 2 }),
    difConciliacao: numeric("dif_conciliacao", { precision: 14, scale: 2 }),
    difTotal: numeric("dif_total", { precision: 14, scale: 2 }),
  },
  (table) => [
    unique("fechamento_caixa_chave").on(table.unidadeId, table.data, table.caixa, table.movimento),
  ]
);

/**
 * Troco. `data` armazena a data real do lançamento na semana (planejamento:
 * "utilizar as datas reais da semana", sem tolerância inventada).
 *
 * Preserva os DOIS valores da fonte — troco conferido pelo gerente e
 * troco informado pelo colaborador — mais a diferença entre eles
 * (recalculada como conferido - informado; a fonte real tem a fórmula
 * sem resultado cacheado na maioria das linhas — decisão do usuário:
 * recalcular, não rejeitar).
 *
 * `operador` e `plano_de_acao` preservados (existem na fonte real, sem
 * motivo para excluir). Chave bate exatamente com `chaveTroco` do
 * painel HTML atual: filial + data + caixa.
 */
export const troco = pgTable(
  "troco",
  {
    ...colunasComuns(),
    caixa: text("caixa").notNull(),
    trocoConferidoGerente: numeric("troco_conferido_gerente", { precision: 14, scale: 2 }).notNull(),
    trocoInformadoColaborador: numeric("troco_informado_colaborador", { precision: 14, scale: 2 }).notNull(),
    diferenca: numeric("diferenca", { precision: 14, scale: 2 }).notNull(),
    operador: text("operador"),
    planoDeAcao: text("plano_de_acao"),
  },
  (table) => [unique("troco_chave").on(table.unidadeId, table.data, table.caixa)]
);

/**
 * Retirada Depósito. Fonte oficial: `Retirada Depósito.xlsx`, somente
 * linhas com `motivo = "DEPOSITO"` (filtro mantido — confirmado). Chave
 * bate exatamente com `chaveRetirada` do painel HTML atual: filial +
 * data + caixa + motivo + motivo_descricao + usuario + usuario_autorizador
 * (valor deliberadamente fora da chave — uma correção de valor atualiza
 * o registro em vez de duplicar).
 */
export const retiradaDeposito = pgTable(
  "retirada_deposito",
  {
    ...colunasComuns(),
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
    caixa: text("caixa").notNull(),
    motivo: text("motivo").notNull(),
    motivoDescricao: text("motivo_descricao").notNull().default(""),
    usuario: text("usuario").notNull().default(""),
    usuarioAutorizador: text("usuario_autorizador").notNull().default(""),
  },
  (table) => [
    unique("retirada_deposito_chave").on(
      table.unidadeId,
      table.data,
      table.caixa,
      table.motivo,
      table.motivoDescricao,
      table.usuario,
      table.usuarioAutorizador
    ),
  ]
);

/**
 * Quebra de Caixa. `fontePeriodoId` aponta para a aba resolvida
 * (planejamento v2, item 2) — resolvedor independente do de Conferência,
 * mesmo quando os períodos coincidem. Chave bate exatamente com
 * `chaveQuebraConf` do painel HTML atual: filial + data + conferente +
 * operador + cpf + motivo — o VALOR da quebra nunca entra na chave (uma
 * correção de valor atualiza o registro, não duplica).
 */
export const quebraCaixa = pgTable(
  "quebra_caixa",
  {
    ...colunasComuns(),
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
    conferente: text("conferente").notNull().default(""),
    operador: text("operador").notNull().default(""),
    cpf: text("cpf").notNull().default(""),
    motivo: text("motivo").notNull().default(""),
    fontePeriodoId: uuid("fonte_periodo_id")
      .notNull()
      .references(() => fontesPorPeriodo.id),
  },
  (table) => [
    unique("quebra_caixa_chave").on(
      table.unidadeId,
      table.data,
      table.conferente,
      table.operador,
      table.cpf,
      table.motivo
    ),
  ]
);
