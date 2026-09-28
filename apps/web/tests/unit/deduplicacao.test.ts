import { describe, expect, it } from "vitest";
import { estrategiaGravacao } from "@/lib/rules/deduplicacao";
import { CHAVES_POR_BASE } from "@/lib/rules/chaves";
import { TIPOS_BASE } from "@painel/shared";

// Etapa 6: todas as 12 bases usam upsert por chave — confirmado lendo o
// painel HTML atual. Nenhuma base usa mais "delete período + insert"
// (TIPOS_BASE_SEM_DEDUP está vazio, ver packages/shared/tiposBase.ts).
const BASES_COM_DEDUP = [
  "faturamento",
  "brindes",
  "cancelamento_salao",
  "cancelamento_delivery",
  "compra_direta",
  "pdv_maquininha",
  "formas_pagamento",
  "conferencia",
  "fechamento_caixa",
  "troco",
  "retirada_deposito",
  "quebra_caixa",
] as const;

describe("estrategiaGravacao", () => {
  it.each(BASES_COM_DEDUP)("%s usa upsert por chave", (tipoBase) => {
    expect(estrategiaGravacao(tipoBase)).toBe("upsert_por_chave");
    expect(CHAVES_POR_BASE[tipoBase].length).toBeGreaterThan(0);
  });

  it("cobre todos os tipos de base definidos em @painel/shared", () => {
    for (const tipoBase of TIPOS_BASE) {
      expect(CHAVES_POR_BASE[tipoBase]).toBeDefined();
    }
  });
});

describe("chaves de deduplicação (conforme especificado no planejamento)", () => {
  it("faturamento: filial + data", () => {
    expect(CHAVES_POR_BASE.faturamento).toEqual(["unidade_id", "data"]);
  });
  it("brindes: filial + data + motivo + motivo2", () => {
    expect(CHAVES_POR_BASE.brindes).toEqual(["unidade_id", "data", "motivo", "motivo2"]);
  });
  it("pdv_maquininha: filial + data + forma_pagamento", () => {
    expect(CHAVES_POR_BASE.pdv_maquininha).toEqual(["unidade_id", "data", "forma_pagamento"]);
  });
  it("fechamento_caixa: filial + data + caixa + movimento (validado nas bases reais — zero duplicidades)", () => {
    expect(CHAVES_POR_BASE.fechamento_caixa).toEqual([
      "unidade_id",
      "data",
      "caixa",
      "movimento",
    ]);
  });
  it("conferencia: filial + data (sem 'tipo' — contagem diária agregada por filial)", () => {
    expect(CHAVES_POR_BASE.conferencia).toEqual(["unidade_id", "data"]);
  });
  it("troco: filial + data + caixa (chaveTroco do painel)", () => {
    expect(CHAVES_POR_BASE.troco).toEqual(["unidade_id", "data", "caixa"]);
  });
  it("retirada_deposito: filial+data+caixa+motivo+motivo_descricao+usuario+usuario_autorizador (chaveRetirada do painel)", () => {
    expect(CHAVES_POR_BASE.retirada_deposito).toEqual([
      "unidade_id", "data", "caixa", "motivo", "motivo_descricao", "usuario", "usuario_autorizador",
    ]);
  });
  it("quebra_caixa: filial+data+conferente+operador+cpf+motivo (chaveQuebraConf do painel)", () => {
    expect(CHAVES_POR_BASE.quebra_caixa).toEqual([
      "unidade_id", "data", "conferente", "operador", "cpf", "motivo",
    ]);
  });
});
