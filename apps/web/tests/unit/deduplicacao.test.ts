import { describe, expect, it } from "vitest";
import { estrategiaGravacao } from "@/lib/rules/deduplicacao";
import { CHAVES_POR_BASE } from "@/lib/rules/chaves";
import { TIPOS_BASE } from "@painel/shared";

const BASES_COM_DEDUP = [
  "faturamento",
  "brindes",
  "cancelamento_salao",
  "cancelamento_delivery",
  "compra_direta",
  "pdv_maquininha",
  "formas_pagamento",
  "conferencia",
] as const;

const BASES_SEM_DEDUP = ["fechamento_caixa", "retirada_deposito", "troco", "quebra_caixa"] as const;

describe("estrategiaGravacao", () => {
  it.each(BASES_COM_DEDUP)("%s usa upsert por chave", (tipoBase) => {
    expect(estrategiaGravacao(tipoBase)).toBe("upsert_por_chave");
    expect(CHAVES_POR_BASE[tipoBase].length).toBeGreaterThan(0);
  });

  it.each(BASES_SEM_DEDUP)("%s usa delete do período + insert (sem dedup)", (tipoBase) => {
    expect(estrategiaGravacao(tipoBase)).toBe("delete_periodo_insert");
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
  it("pdv_maquininha: filial + data + forma_pag", () => {
    expect(CHAVES_POR_BASE.pdv_maquininha).toEqual(["unidade_id", "data", "forma_pag"]);
  });
  it("conferencia: filial + data + tipo", () => {
    expect(CHAVES_POR_BASE.conferencia).toEqual(["unidade_id", "data", "tipo"]);
  });
});
