import { describe, expect, it } from "vitest";
import { parsePdvMaquininha } from "@/lib/import/parsers/pdvMaquininha";

const cabecalho = ["Loja", "Data", "Forma de Pag.", "Venda (PDV - Cloud)", "Total Maq. ( Adquirente - Sicredi)", "Diferença"];

describe("parsePdvMaquininha — fonte oficial PDV X Adquirente - Consolidado.xlsx / Export", () => {
  it("lê PDV, Maquininha e Diferença sem recalcular", () => {
    const linhas = [["BG 01", "01/09/2026", "Crédito", 4190.79, 4190.79, 0]];
    const resultado = parsePdvMaquininha(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(1);
    const r = resultado.registros[0];
    expect(r.valor).toBe(4190.79); // valor = PDV
    expect(r.extras.valorMaquininha).toBe("4190.79");
    expect(r.extras.diferenca).toBe("0");
    expect(r.extras.forma).toBe("Crédito");
  });

  it("ignora a linha de totalizador 'TOTAL'", () => {
    const linhas = [
      ["BG 01", "01/09/2026", "Crédito", 100, 100, 0],
      ["TOTAL", null, null, 100, 100, 0],
    ];
    const resultado = parsePdvMaquininha(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(1);
    expect(resultado.rejeitados).toHaveLength(0);
  });

  it("gera um registro por filial+data+forma (mesma filial/data, formas diferentes)", () => {
    const linhas = [
      ["BG 01", "01/09/2026", "Crédito", 100, 100, 0],
      ["BG 01", "01/09/2026", "Débito", 50, 52, 2],
      ["BG 01", "01/09/2026", "Pix", 30, 30, 0],
    ];
    const resultado = parsePdvMaquininha(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(3);
    const formas = resultado.registros.map((r) => r.extras.forma).sort();
    expect(formas).toEqual(["Crédito", "Débito", "Pix"]);
  });

  it("rejeita unidade não reconhecida", () => {
    const linhas = [["LOJA X", "01/09/2026", "Crédito", 100, 100, 0]];
    const resultado = parsePdvMaquininha(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(0);
    expect(resultado.rejeitados).toHaveLength(1);
  });
});
