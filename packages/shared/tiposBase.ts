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
 * Bases que NÃO devem ser deduplicadas (planejamento, regras importantes).
 * Reimportação de um período substitui apenas aquele período (delete + insert).
 */
export const TIPOS_BASE_SEM_DEDUP: readonly TipoBase[] = [
  "fechamento_caixa",
  "retirada_deposito",
  "troco",
  "quebra_caixa",
];
