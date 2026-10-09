import { describe, expect, it } from "vitest";
import { normalizarPeriodo, janelaD1, janelaD2, resumirConferenciaSemana } from "@/lib/services/fechamentoSemanal";

// Porta fiel de computeSemanalReport (legado, linhas 4275-4338):
// normalização do período (troca ini/fim se invertido) e deslocamento
// D-1/D-2 aplicado às DUAS pontas do intervalo.
describe("normalizarPeriodo — porta fiel do legado (linhas 4276-4278)", () => {
  it("mantém a ordem quando ini <= fim", () => {
    const r = normalizarPeriodo("2026-09-01", "2026-09-07");
    expect(r.iniBase.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(r.fimBase.toISOString().slice(0, 10)).toBe("2026-09-07");
    expect(r.periodoLabel).toBe("01/09/2026 a 07/09/2026");
  });

  it("troca ini e fim quando o usuário inverte as datas", () => {
    const r = normalizarPeriodo("2026-09-07", "2026-09-01");
    expect(r.iniBase.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(r.fimBase.toISOString().slice(0, 10)).toBe("2026-09-07");
  });

  it("período de um único dia (ini === fim)", () => {
    const r = normalizarPeriodo("2026-09-01", "2026-09-01");
    expect(r.periodoLabel).toBe("01/09/2026 a 01/09/2026");
  });
});

describe("janelaD1/janelaD2 — deslocamento aplicado às duas pontas (legado, linhas 4281/4319)", () => {
  it("janelaD1 desloca início e fim em -1 dia, preservando a duração do período", () => {
    const { iniBase, fimBase } = normalizarPeriodo("2026-09-08", "2026-09-14"); // 7 dias
    const janela = janelaD1(iniBase, fimBase);
    expect(janela.inicio.toISOString().slice(0, 10)).toBe("2026-09-07");
    expect(janela.fim.toISOString().slice(0, 10)).toBe("2026-09-13");
    const duracaoOriginal = fimBase.getTime() - iniBase.getTime();
    const duracaoDeslocada = janela.fim.getTime() - janela.inicio.getTime();
    expect(duracaoDeslocada).toBe(duracaoOriginal);
  });

  it("janelaD2 desloca início e fim em -2 dias, preservando a duração do período", () => {
    const { iniBase, fimBase } = normalizarPeriodo("2026-09-08", "2026-09-14");
    const janela = janelaD2(iniBase, fimBase);
    expect(janela.inicio.toISOString().slice(0, 10)).toBe("2026-09-06");
    expect(janela.fim.toISOString().slice(0, 10)).toBe("2026-09-12");
  });

  it("janela de um único dia continua um único dia após o deslocamento", () => {
    const { iniBase, fimBase } = normalizarPeriodo("2026-09-08", "2026-09-08");
    const janela = janelaD1(iniBase, fimBase);
    expect(janela.inicio.toISOString().slice(0, 10)).toBe(janela.fim.toISOString().slice(0, 10));
  });
});

describe("resumirConferenciaSemana — mesma regra da aba Conferência (semana iniBase..fimBase)", () => {
  const reg = (codigo: string, data: string, cad: number, conf: number | null, emAtraso = false) => ({
    codigo,
    data: new Date(`${data}T00:00:00Z`),
    qtdCadastrados: cad,
    qtdConferidos: conf,
    emAtraso,
  });

  it("exemplo BG 07 (X 5 6 6 X X 3, 6 caixas): 20 conferidos, 18 em atraso, 38 previstos, 52,6%", () => {
    const r = resumirConferenciaSemana([
      reg("BG 07", "2026-09-28", 6, null, true),
      reg("BG 07", "2026-09-29", 6, 5),
      reg("BG 07", "2026-09-30", 6, 6),
      reg("BG 07", "2026-10-01", 6, 6),
      reg("BG 07", "2026-10-02", 6, null, true),
      reg("BG 07", "2026-10-03", 6, null, true),
      reg("BG 07", "2026-10-04", 6, 3),
    ]);
    expect(r.confConferidas).toBe(20);
    expect(r.confAtrasadas).toBe(18);
    expect(r.confPrevistas).toBe(38);
    expect(r.confPercentual?.toFixed(1)).toBe("52.6");
  });

  it("conferido acima do cadastro integral; diferença sem X não é atraso; % ponderado entre lojas", () => {
    const r = resumirConferenciaSemana([reg("BG 02", "2026-09-28", 5, 6), reg("BG 01", "2026-09-28", 100, 50), reg("BG 03", "2026-09-28", 4, null, true)]);
    expect(r.confConferidas).toBe(56);
    expect(r.confAtrasadas).toBe(4);
    expect(r.confPrevistas).toBe(60);
    expect(r.confPercentual).toBeCloseTo((56 / 60) * 100, 9);
  });

  it("MAPOLI em sábado e domingo fora (2026-10-03 sábado, 2026-10-04 domingo)", () => {
    const r = resumirConferenciaSemana([
      reg("MAPOLI", "2026-10-02", 1, 1),
      reg("MAPOLI", "2026-10-03", 1, null, true),
      reg("MAPOLI", "2026-10-04", 1, 0),
      reg("BG 05", "2026-10-02", 4, null, true),
    ]);
    expect(r.confConferidas).toBe(1);
    expect(r.confAtrasadas).toBe(4);
    expect(r.confPrevistas).toBe(5);
  });

  it("semana sem dados: zeros e percentual nulo (nunca 0% inventado)", () => {
    expect(resumirConferenciaSemana([])).toEqual({ confPrevistas: 0, confConferidas: 0, confAtrasadas: 0, confPercentual: null });
  });
});
