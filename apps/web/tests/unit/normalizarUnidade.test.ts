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

  it("rejeita BG 09 isolado (não existe — é parte de BG 08 E 09)", () => {
    const r = normalizarUnidade("BG 09");
    expect(r.ok).toBe(false);
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
