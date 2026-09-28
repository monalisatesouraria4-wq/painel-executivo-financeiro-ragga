import type { TipoBase } from "@painel/shared";

/**
 * Chave lógica de deduplicação/upsert por tipo de base.
 *
 * A partir da Etapa 6, todas as chaves abaixo foram confirmadas
 * lendo o código-fonte do painel HTML atual (`Painel_Executivo_
 * Financeiro_-_Ragga_Gestão.html`), definido pelo usuário como fonte de
 * verdade operacional — não apenas o planejamento original. Ver
 * docs/regras-negocio.md, seção "Regras Confirmadas a partir do Painel
 * Atual" e "Estratégia de Reimportação — Alinhamento com o Painel Atual
 * (Etapa 6)".
 */
export const CHAVES_POR_BASE: Record<TipoBase, readonly string[]> = {
  faturamento: ["unidade_id", "data"], // chaveFaturamento
  brindes: ["unidade_id", "data", "motivo", "motivo2"], // chaveBrindes
  cancelamento_salao: ["unidade_id", "data", "motivo"], // chave do painel (CANCSAL)
  cancelamento_delivery: ["unidade_id", "data", "motivo"], // chave do painel (CANCDEL)
  compra_direta: ["unidade_id", "data", "motivo"], // chaveCompraDireta
  pdv_maquininha: ["unidade_id", "data", "forma_pagamento"], // chavePdv
  formas_pagamento: ["unidade_id", "data", "forma"],
  // Contagem diária agregada por filial (planejamento v4) — sem "tipo".
  conferencia: ["unidade_id", "data"],
  // As 4 chaves abaixo foram CORRIGIDAS na Etapa 6 para bater exatamente
  // com o painel HTML atual (upsert por chave composta, não mais "sem
  // dedup"/delete+insert — ver TIPOS_BASE_SEM_DEDUP em
  // packages/shared/tiposBase.ts, agora vazio).
  fechamento_caixa: ["unidade_id", "data", "caixa", "movimento"], // chaveFechamento
  troco: ["unidade_id", "data", "caixa"], // chaveTroco
  retirada_deposito: [
    "unidade_id",
    "data",
    "caixa",
    "motivo",
    "motivo_descricao",
    "usuario",
    "usuario_autorizador",
  ], // chaveRetirada — valor deliberadamente fora da chave
  quebra_caixa: ["unidade_id", "data", "conferente", "operador", "cpf", "motivo"], // chaveQuebraConf — valor (quebra) fora da chave
};
