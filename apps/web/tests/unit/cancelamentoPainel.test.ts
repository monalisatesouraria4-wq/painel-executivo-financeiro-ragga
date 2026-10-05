import { describe, expect, it } from "vitest";
import {
  LIMITE_ATENCAO_CANCELAMENTO,
  LIMITE_BOM_CANCELAMENTO,
  LIMITE_EXCELENTE_CANCELAMENTO,
  montarPeriodoCancelamento,
  statusCancelamento,
} from "@/lib/services/cancelamentoPainel";
import { compararMotivos, variacaoCompraDireta } from "@/lib/services/compraDiretaPainel";

describe("status de Cancelamento (thresholds existentes FAIXAS_CANCELAMENTO)", () => {
  it("até 0,50% excelente; até 1,00% bom; até 2,00% atenção; acima crítico", () => {
    expect([LIMITE_EXCELENTE_CANCELAMENTO, LIMITE_BOM_CANCELAMENTO, LIMITE_ATENCAO_CANCELAMENTO]).toEqual([0.5, 1, 2]);
    expect(statusCancelamento(0.5).status).toBe("excelente");
    expect(statusCancelamento(0.51).status).toBe("bom");
    expect(statusCancelamento(1).status).toBe("bom");
    expect(statusCancelamento(1.01).status).toBe("atencao");
    expect(statusCancelamento(2).status).toBe("atencao");
    expect(statusCancelamento(2.01).status).toBe("critico");
  });
});

describe("montarPeriodoCancelamento", () => {
  const fat = [
    { codigo: "BG 01", data: "2026-09-12", valor: 10000 },
    { codigo: "BG 01", data: "2026-09-13", valor: 10000 },
    { codigo: "BG 02", data: "2026-09-12", valor: 10000 },
  ];
  const can = [
    { codigo: "BG 01", data: "2026-09-12", motivo: "MOT 03 - ERRO OPERACIONAL", valor: 60 },
    { codigo: "BG 01", data: "2026-09-12", motivo: "MOT 01 - DESISTENCIA", valor: 40 },
    { codigo: "BG 01", data: "2026-09-13", motivo: "MOT 03 - ERRO OPERACIONAL", valor: 100 },
    { codigo: "BG 02", data: "2026-09-12", motivo: "MOT 02 - TROCA DE PRODUTO", valor: 250 }, // 2,5% → crítico
  ];
  const p = montarPeriodoCancelamento("2026-09-12", "2026-09-14", fat, can);
  const bg01 = p.porLoja.find((l) => l.unidade === "BG 01")!;
  const bg02 = p.porLoja.find((l) => l.unidade === "BG 02")!;

  it("totais, % sobre faturamento e status por loja (thresholds de cancelamento)", () => {
    expect(p.faturamento).toBe(30000);
    expect(p.valor).toBe(450);
    expect(bg01.valor).toBe(200);
    expect(bg01.percentual).toBeCloseTo(1, 6); // 200 / 20.000 → bom (até 1,00%)
    expect(bg01.status).toBe("bom");
    expect(bg02.percentual).toBeCloseTo(2.5, 6);
    expect(bg02.status).toBe("critico");
    expect(p.contagemStatus).toEqual({ excelente: 0, bom: 1, atencao: 0, critico: 1 });
    expect(p.lojasForaDoLimite).toBe(1);
  });

  it("motivos preservados como na base; composição do dia fecha em 100% e no total do dia", () => {
    const dia = bg01.diario[0];
    expect(dia.motivos.map((m) => m.motivo)).toEqual(["MOT 03 - ERRO OPERACIONAL", "MOT 01 - DESISTENCIA"]);
    expect(dia.motivos.reduce((s, m) => s + m.valor, 0)).toBe(dia.valor);
    expect(dia.motivos.reduce((s, m) => s + (m.valor / dia.valor) * 100, 0)).toBeCloseTo(100, 6);
    expect(p.diario[0].valor).toBe(350); // rede no dia 12/09
  });

  it("dia sem registro continua sem dado (lacuna), não vira zero inventado no gráfico", () => {
    const dia14 = bg01.diario[2];
    expect(dia14.faturamento).toBe(0);
    expect(dia14.valor).toBe(0);
    expect(dia14.motivos).toEqual([]);
  });

  it("sem registros de cancelamento → indisponível", () => {
    expect(montarPeriodoCancelamento("2026-09-12", "2026-09-13", fat, []).disponivel).toBe(false);
  });
});

describe("comparação (menor cancelamento = melhorou)", () => {
  it("redução melhora, aumento piora, igual sem alteração; % sobre o comparado", () => {
    expect(variacaoCompraDireta(900, 1000).situacao).toBe("melhorou");
    expect(variacaoCompraDireta(900, 1000).percentual).toBeCloseTo(-10, 6);
    expect(variacaoCompraDireta(1100, 1000).situacao).toBe("piorou");
    expect(variacaoCompraDireta(1000, 1000).situacao).toBe("sem-alteracao");
  });
  it("une motivos dos dois períodos", () => {
    const a = [{ motivo: "MOT 01 - DESISTENCIA", valor: 10 }];
    const c = [{ motivo: "MOT 01 - DESISTENCIA", valor: 8 }, { motivo: "MOT 05 - TESTE", valor: 2 }];
    expect(compararMotivos(a, c).map((l) => l.motivo)).toEqual(["MOT 01 - DESISTENCIA", "MOT 05 - TESTE"]);
  });
});

describe("Melhorou/Piorou do Cancelamento (indicador geral) é pelo % sobre o faturamento, não pelo valor em R$", () => {
  // atual: cancelamento 900 sobre faturamento 100.000 = 0,90%; comparado: 1.000 sobre 250.000 = 0,40%
  // → o valor em R$ CAIU (900 < 1.000), mas o percentual AUMENTOU (0,90% > 0,40%).
  const atual = montarPeriodoCancelamento("2026-09-12", "2026-09-12", [{ codigo: "BG 01", data: "2026-09-12", valor: 100000 }], [
    { codigo: "BG 01", data: "2026-09-12", motivo: "MOT 03 - ERRO OPERACIONAL", valor: 900 },
  ]);
  const comp = montarPeriodoCancelamento("2026-08-12", "2026-08-12", [{ codigo: "BG 01", data: "2026-08-12", valor: 250000 }], [
    { codigo: "BG 01", data: "2026-08-12", motivo: "MOT 03 - ERRO OPERACIONAL", valor: 1000 },
  ]);
  it("valor em R$ cai e % sobe → 🔴 Piorou (a regra antiga por R$ diria melhorou)", () => {
    expect(atual.valor).toBeLessThan(comp.valor);
    expect(atual.percentual).toBeGreaterThan(comp.percentual);
    expect(variacaoCompraDireta(atual.valor, comp.valor).situacao).toBe("melhorou"); // regra ANTIGA (R$) — não é mais usada
    expect(variacaoCompraDireta(atual.percentual, comp.percentual).situacao).toBe("piorou"); // regra atual (%)
  });
  it("% menor → melhorou; % igual → sem alteração", () => {
    expect(variacaoCompraDireta(0.3, 0.45).situacao).toBe("melhorou");
    expect(variacaoCompraDireta(0.45, 0.45).situacao).toBe("sem-alteracao");
  });
  it("o status das lojas segue os thresholds existentes (0,90% = bom; 0,40% = excelente)", () => {
    expect(atual.status).toBe("bom");
    expect(comp.status).toBe("excelente");
  });
});
