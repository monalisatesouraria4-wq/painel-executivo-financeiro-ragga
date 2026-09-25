import type { TipoBase } from "@painel/shared";

/**
 * Chave lógica de deduplicação por tipo de base, conforme especificado
 * no planejamento aprovado (docs/regras-negocio.md). Bases sem dedup
 * (ver deduplicacao.ts) não possuem chave de unicidade — os campos
 * abaixo, quando presentes, servem apenas para auditoria/rastreio.
 */
export const CHAVES_POR_BASE: Record<TipoBase, readonly string[]> = {
  faturamento: ["unidade_id", "data"],
  brindes: ["unidade_id", "data", "motivo", "motivo2"],
  cancelamento_salao: ["unidade_id", "data", "motivo"],
  cancelamento_delivery: ["unidade_id", "data", "motivo"],
  compra_direta: ["unidade_id", "data", "motivo"],
  retirada_deposito: [], // não deduplicado — cada lançamento é um registro
  // validação/auditoria, não dedup (fechamento_caixa não deduplica).
  // "caixa" foi removido da chave (validado nas bases reais): filial+data+caixa
  // causava perda de registros legítimos. Chave de referência: filial+data+movimento.
  fechamento_caixa: ["unidade_id", "data", "movimento"],
  pdv_maquininha: ["unidade_id", "data", "forma_pagamento"],
  formas_pagamento: ["unidade_id", "data", "forma"],
  conferencia: ["unidade_id", "data", "tipo"],
  troco: [], // não deduplicado — registros repetidos são legítimos
  quebra_caixa: [], // não deduplicado — lançamentos repetidos são legítimos
};
