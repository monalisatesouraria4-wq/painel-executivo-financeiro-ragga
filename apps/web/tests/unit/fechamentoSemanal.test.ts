import { describe, expect, it } from "vitest";
import { normalizarPeriodo, janelaD1, janelaD2 } from "@/lib/services/fechamentoSemanal";

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
