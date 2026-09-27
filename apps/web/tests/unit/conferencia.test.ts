import { describe, expect, it } from "vitest";
import { parseConferencia } from "@/lib/import/parsers/conferencia";

function d(iso: string): Date {
  return new Date(iso + "T00:00:00.000Z");
}

// Linha 6 real: Resp. | Filial | Qtd. caixas | <data1> | <data2> | <data3>
const linhaCompleta = [
  "Resp. pela Conferência", "Filial", "Qtd. caixas",
  d("2026-08-16"), d("2026-08-17"), d("2026-08-18"),
];

describe("parseConferencia — preserva o terceiro estado (X = em atraso), sem converter para 0", () => {
  it("célula numérica -> qtdConferidos = número, emAtraso = false", () => {
    const linhas = [["MONALISA", "BG 01", 5, 3, 5, 4]];
    const r = parseConferencia(linhaCompleta, linhas, "aba-1");
    expect(r.registros).toHaveLength(3);
    expect(r.registros[0].extras.qtdCadastrados).toBe("5");
    expect(r.registros[0].extras.qtdConferidos).toBe("3");
    expect(r.registros[0].extras.emAtraso).toBe("false");
  });

  it('célula "X" -> qtdConferidos vazio (NULL), emAtraso = true — NUNCA vira 0', () => {
    const linhas = [["GERENTE", "BG 05", 5, "X", "x", 4]];
    const r = parseConferencia(linhaCompleta, linhas, "aba-1");
    const diaX1 = r.registros.find((reg) => reg.data.toISOString().slice(0, 10) === "2026-08-16");
    const diaX2 = r.registros.find((reg) => reg.data.toISOString().slice(0, 10) === "2026-08-17");
    expect(diaX1?.extras.qtdConferidos).toBe("");
    expect(diaX1?.extras.emAtraso).toBe("true");
    expect(diaX2?.extras.emAtraso).toBe("true"); // "x" minúsculo também conta
  });

  it("célula vazia -> NÃO gera registro, mas é contada em celulasVazias", () => {
    const linhas = [["MONALISA", "BG 01", 5, 5, null, 4]];
    const r = parseConferencia(linhaCompleta, linhas, "aba-1");
    expect(r.registros).toHaveLength(2); // só as 2 células com dado
    expect(r.celulasVazias).toBe(1);
  });

  it("linha inteira em X (caso real confirmado: BG 05 no arquivo)", () => {
    const linhas = [["GERENTE/MONALISA", "BG 05", 5, "X", "X", "X"]];
    const r = parseConferencia(linhaCompleta, linhas, "aba-1");
    expect(r.registros).toHaveLength(3);
    expect(r.registros.every((reg) => reg.extras.emAtraso === "true")).toBe(true);
    expect(r.registros.every((reg) => reg.extras.qtdConferidos === "")).toBe(true);
  });

  it("rejeita unidade não reconhecida (linha inteira)", () => {
    const linhas = [["MONALISA", "LOJA FANTASMA", 5, 3, 5, 4]];
    const r = parseConferencia(linhaCompleta, linhas, "aba-1");
    expect(r.registros).toHaveLength(0);
    expect(r.rejeitados).toHaveLength(1);
    expect(r.rejeitados[0].motivo).toMatch(/Unidade não reconhecida/);
  });

  it("rejeita 'Qtd. caixas' inválida", () => {
    const linhas = [["MONALISA", "BG 01", "abc", 3, 5, 4]];
    const r = parseConferencia(linhaCompleta, linhas, "aba-1");
    expect(r.registros).toHaveLength(0);
    expect(r.rejeitados[0].motivo).toMatch(/Qtd\. caixas/);
  });

  it("rejeita apenas a célula de um dia com valor inesperado, preservando os demais dias da linha", () => {
    const linhas = [["MONALISA", "BG 01", 5, "???", 5, 4]];
    const r = parseConferencia(linhaCompleta, linhas, "aba-1");
    expect(r.registros).toHaveLength(2); // dias 2 e 3 continuam válidos
    expect(r.rejeitados).toHaveLength(1);
    expect(r.rejeitados[0].motivo).toMatch(/não é número nem "X"/);
  });

  it("preserva o fontePeriodoId em todos os registros (auditoria da aba de origem)", () => {
    const linhas = [["MONALISA", "BG 01", 5, 3, 5, 4]];
    const r = parseConferencia(linhaCompleta, linhas, "aba-16.08-a-15.09");
    expect(r.registros.every((reg) => reg.extras.fontePeriodoId === "aba-16.08-a-15.09")).toBe(true);
  });

  it("ignora colunas sem data real na linha 6 (defensivo)", () => {
    const linhaComColunaSemData = [
      "Resp.", "Filial", "Qtd. caixas", d("2026-08-16"), null, d("2026-08-18"),
    ];
    const linhas = [["MONALISA", "BG 01", 5, 3, 999, 4]];
    const r = parseConferencia(linhaComColunaSemData, linhas, "aba-1");
    expect(r.registros).toHaveLength(2); // coluna do meio (sem data) é ignorada
  });
});
