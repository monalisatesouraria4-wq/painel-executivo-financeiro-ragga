import { describe, expect, it } from "vitest";
import { normalizarUnidade } from "@/lib/import/normalizarUnidade";

describe("normalizarUnidade", () => {
  it("BG 08 E 09 é reconhecida como uma única unidade", () => {
    const r = normalizarUnidade("BG 08 E 09");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.codigo).toBe("BG 08 E 09");
  });

  it("aceita código canônico com espaços extras (trim)", () => {
    const r = normalizarUnidade("MAPOLI ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.codigo).toBe("MAPOLI");
  });

  it("mapeia nomenclatura alternativa 'BIGGS NN - Nome' (retirada_deposito) para o código BG", () => {
    const r = normalizarUnidade("BIGGS 13 - ARTHUR THOMAS");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.codigo).toBe("BG 13");
  });

  it("mapeia 'CASARIA' para MAPOLI (confirmado pelo usuário)", () => {
    const r = normalizarUnidade("CASARIA");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.codigo).toBe("MAPOLI");
  });

  it("'BG 09' isolado é reconhecido como parte de BG 08 E 09, não rejeitado " +
    "(corrigido na Etapa 4: o painel HTML oficial dobra 'BG 09' em BG 08 E 09 " +
    "em vez de rejeitar — mesma regra de negócio 'BG 09 não existe separado', " +
    "só que aplicada como fusão de nomenclatura, não como rejeição de dado)", () => {
    const r = normalizarUnidade("BG 09");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.codigo).toBe("BG 08 E 09");
  });

  it("'BG 08' isolado também é reconhecido como BG 08 E 09 (mesma regra)", () => {
    const r = normalizarUnidade("BG 08");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.codigo).toBe("BG 08 E 09");
  });

  it("'ISAIAS NN - Nome' (confirmado em FECHAMENTO DE CAIXA) mapeia para IS NN", () => {
    const r = normalizarUnidade("ISAIAS 01 - MARINGA");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.codigo).toBe("IS 01");
  });

  it("rejeita BG 14 a BG 18 (não existem nos dados reais)", () => {
    for (const codigo of ["BG 14", "BG 15", "BG 16", "BG 17", "BG 18"]) {
      const r = normalizarUnidade(codigo);
      expect(r.ok).toBe(false);
    }
  });

  it("rejeita texto vazio ou desconhecido sem adivinhar", () => {
    expect(normalizarUnidade("").ok).toBe(false);
    expect(normalizarUnidade("LOJA DESCONHECIDA").ok).toBe(false);
    expect(normalizarUnidade(null).ok).toBe(false);
  });
});
