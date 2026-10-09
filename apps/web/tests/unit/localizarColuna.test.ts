import { describe, expect, it } from "vitest";
import { localizarColuna, localizarColunaExata } from "@/lib/import/localizarColuna";
import { buscarBaseInfo, validarColunas } from "@/lib/services/atualizacaoBases";
import { parseTroco } from "@/lib/import/parsers/troco";

describe("localizarColuna — espaços repetidos, caixa e pontas do cabeçalho", () => {
  it("espaços repetidos valem como um só (e NBSP/tab); maiúsculas e pontas são ignoradas", () => {
    const cab = ["LOJA", "R$ TROCO  INFORMADO PELO COLABORADOR", "  r$ troco   conferido pelo gerente  "];
    expect(localizarColuna(cab, "TROCO INFORMADO")).toBe(1);
    expect(localizarColuna(cab, "troco  informado")).toBe(1);
    expect(localizarColuna(cab, "TROCO CONFERIDO")).toBe(2);
    expect(localizarColunaExata(["  Data  "], "DATA")).toBe(0);
    expect(localizarColunaExata(["DATA  HORA"], "DATA HORA")).toBe(0);
  });

  it("não cria ambiguidade: colunas distintas continuam distintas e a primeira ocorrência é a mesma", () => {
    const cab = ["LOJA", "DATA", "CAIXA ", "R$ TROCO CONFERIDO PELO GERENTE", "R$ TROCO  INFORMADO PELO COLABORADOR", "DIFERENÇA TROCO ", "OPERADOR ", "PLANO DE AÇÃO "];
    const idx = ["LOJA", "DATA", "CAIXA", "TROCO CONFERIDO", "TROCO INFORMADO"].map((t) => localizarColuna(cab, t));
    expect(idx).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(idx).size).toBe(idx.length);
    // cada busca encontra exatamente UMA coluna
    for (const t of ["LOJA", "DATA", "CAIXA", "TROCO CONFERIDO", "TROCO INFORMADO"]) {
      expect(cab.filter((_, i) => localizarColuna([cab[i]], t) === 0)).toHaveLength(1);
    }
  });
});

describe("Troco — validação de colunas obrigatórias e parser com o cabeçalho real (espaço duplo)", () => {
  const cab = ["LOJA", "DATA", "CAIXA ", "R$ TROCO CONFERIDO PELO GERENTE", "R$ TROCO  INFORMADO PELO COLABORADOR", "DIFERENÇA TROCO ", "OPERADOR ", "PLANO DE AÇÃO "];

  it("o cabeçalho com espaço duplo é aceito como 'Troco Informado'; sem a coluna continua recusado", () => {
    expect(validarColunas(cab, buscarBaseInfo("troco").colunasObrigatorias ?? [])).toEqual([]);
    const semInformado = cab.filter((c) => !String(c).includes("INFORMADO"));
    expect(validarColunas(semInformado, buscarBaseInfo("troco").colunasObrigatorias ?? [])).toEqual(["Troco Informado"]);
  });

  it("valores das células e regra do Troco inalterados", () => {
    const r = parseTroco(cab, [["BG 01", new Date("2026-10-01T00:00:00Z"), "CAIXA 1", 100, 90, null, "ANA", ""]]);
    expect(r.rejeitados).toHaveLength(0);
    expect(r.registros).toHaveLength(1);
    expect(r.registros[0].valor).toBe(100);
    expect(r.registros[0].extras).toMatchObject({ caixa: "CAIXA 1" });
  });
});
