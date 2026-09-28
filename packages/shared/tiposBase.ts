/**
 * Tipos de base (fontes de dados) previstos no planejamento aprovado.
 * Usado por lib/import, lib/rules e pela tabela `importacoes`.
 */
export const TIPOS_BASE = [
  "faturamento",
  "brindes",
  "cancelamento_salao",
  "cancelamento_delivery",
  "compra_direta",
  "retirada_deposito",
  "fechamento_caixa",
  "pdv_maquininha",
  "formas_pagamento",
  "conferencia",
  "troco",
  "quebra_caixa",
] as const;

export type TipoBase = (typeof TIPOS_BASE)[number];

/**
 * Tipos de base organizados por arquivo com abas por período
 * (planejamento v2, itens 1 e 2). Cada um possui resolvedor de aba
 * independente — nunca compartilham a mesma aba resolvida.
 */
export const TIPOS_BASE_COM_ABAS_POR_PERIODO: readonly TipoBase[] = [
  "conferencia",
  "quebra_caixa",
];

/**
 * Bases que NÃO devem ser deduplicadas (delete do período + insert).
 *
 * VAZIA a partir da Etapa 6: `fechamento_caixa`, `retirada_deposito`,
 * `troco` e `quebra_caixa` estavam aqui por causa do planejamento
 * original ("não deduplicar"), mas a leitura do código-fonte do painel
 * HTML atual (fonte de verdade operacional, por decisão do usuário)
 * confirmou que essas 4 bases usam UPSERT por uma chave composta
 * própria — não "delete período + insert". Ver
 * docs/regras-negocio.md, seção "Estratégia de Reimportação —
 * Alinhamento com o Painel Atual (Etapa 6)".
 *
 * Mantida como array vazio (em vez de removida) para não quebrar
 * `estrategiaGravacao()` e para documentar explicitamente que, hoje,
 * NENHUMA base usa mais essa estratégia — se uma futura base realmente
 * precisar dela, adicionar aqui com a justificativa correspondente.
 */
export const TIPOS_BASE_SEM_DEDUP: readonly TipoBase[] = [];
