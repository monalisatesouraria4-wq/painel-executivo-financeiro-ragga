import { describe, expect, it } from "vitest";
import { agruparMotivos, diasDoIntervalo, ehAjusteSemSaidaDeCaixa, montarPeriodoCompraDireta, statusDoPercentual } from "@/lib/services/compraDiretaPainel";

describe("status de Compra Direta (thresholds existentes)", () => {
  it("até 5% controlado; 5–7% atenção; acima de 7% crítico", () => {
    expect(statusDoPercentual(5).status).toBe("controlado");
    expect(statusDoPercentual(5.01).status).toBe("atencao");
    expect(statusDoPercentual(7).status).toBe("atencao");
    expect(statusDoPercentual(7.01).status).toBe("critico");
  });
});

describe("agruparMotivos / Pareto", () => {
  it("ordena por valor, % sobre o total do escopo e acumulado termina em 100%", () => {
    const m = agruparMotivos([
      { motivo: "CMV", valor: 60 },
      { motivo: "CMO/FREE", valor: 30 },
      { motivo: "CMV", valor: 0 },
      { motivo: "DEVOLUÇÃO E REEMBOLSO", valor: 10 },
    ]);
    expect(m.map((x) => x.motivo)).toEqual(["CMV", "CMO/FREE", "DEVOLUÇÃO E REEMBOLSO"]);
    expect(m.map((x) => Math.round(x.percentualDoTotal))).toEqual([60, 30, 10]);
    expect(m[2].percentualAcumulado).toBeCloseTo(100, 6);
    expect(m.reduce((s, x) => s + x.percentualDoTotal, 0)).toBeCloseTo(100, 6);
  });
});

describe("montarPeriodoCompraDireta", () => {
  const fat = [
    { codigo: "BG 01", data: "2026-08-31", valor: 1000 },
    { codigo: "BG 01", data: "2026-09-01", valor: 1000 },
    { codigo: "BG 02", data: "2026-08-31", valor: 2000 },
  ];
  const cd = [
    { codigo: "BG 01", data: "2026-08-31", motivo: "CMV", valor: 80 }, // 4% de 2000
    { codigo: "BG 01", data: "2026-09-01", motivo: "CMO/FREE", valor: 40 },
    { codigo: "BG 02", data: "2026-08-31", motivo: "CMV", valor: 200 }, // 10% de 2000
  ];
  const p = montarPeriodoCompraDireta("2026-08-31", "2026-09-01", fat, cd);

  it("totais e % por loja sobre o faturamento da loja; status pelos thresholds", () => {
    expect(p.faturamento).toBe(4000);
    expect(p.valor).toBe(320);
    const bg01 = p.porLoja.find((l) => l.unidade === "BG 01")!;
    expect(bg01.percentual).toBeCloseTo(6, 6); // 120/2000
    expect(bg01.status).toBe("atencao");
    expect(p.porLoja.find((l) => l.unidade === "BG 02")!.status).toBe("critico");
    expect(p.contagemStatus).toEqual({ controlado: 0, atencao: 1, critico: 1 });
    expect(p.lojasForaDoLimite).toBe(2);
  });

  it("motivos da loja fecham com o total da loja e ~100% (sobre o total de Compra Direta, não do faturamento)", () => {
    const bg01 = p.porLoja.find((l) => l.unidade === "BG 01")!;
    expect(bg01.motivos.reduce((s, m) => s + m.valor, 0)).toBeCloseTo(bg01.valor, 2);
    expect(bg01.motivos.reduce((s, m) => s + m.percentualDoTotal, 0)).toBeCloseTo(100, 6);
    expect(bg01.motivos[0]).toMatchObject({ motivo: "CMV", valor: 80 });
    expect(bg01.motivos[0].percentualDoTotal).toBeCloseTo((80 / 120) * 100, 6);
  });

  it("evolução diária cobre todos os dias da janela, inclusive sem movimento", () => {
    expect(diasDoIntervalo("2026-08-31", "2026-09-02")).toEqual(["2026-08-31", "2026-09-01", "2026-09-02"]);
    expect(p.diario).toHaveLength(2);
    expect(p.diario[0]).toMatchObject({ data: "2026-08-31", valor: 280, faturamento: 3000 });
  });

  it("sem registro de Compra Direta → indisponível (não inventa zero)", () => {
    expect(montarPeriodoCompraDireta("2026-08-31", "2026-09-01", fat, []).disponivel).toBe(false);
  });
});

import { compararMotivos, situacaoCompraDireta } from "@/lib/services/compraDiretaPainel";

describe("comparativo por motivo (Melhorou/Piorou só para Compra Direta)", () => {
  it("valor menor = melhorou; maior = piorou; igual = sem alteração", () => {
    expect(situacaoCompraDireta(36130.8, 22500)).toBe("piorou");
    expect(situacaoCompraDireta(2874.5, 3500)).toBe("melhorou");
    expect(situacaoCompraDireta(247, 800)).toBe("melhorou");
    expect(situacaoCompraDireta(100, 100)).toBe("sem-alteracao");
  });
  it("une os motivos dos dois períodos (inclusive os que só existem em um deles)", () => {
    const atual = agruparMotivos([{ motivo: "CMO/FREE", valor: 90 }, { motivo: "OPEX", valor: 10 }]);
    const comp = agruparMotivos([{ motivo: "CMO/FREE", valor: 60 }, { motivo: "SEGURANÇA", valor: 40 }]);
    const linhas = compararMotivos(atual, comp);
    expect(linhas.map((l) => l.motivo)).toEqual(["CMO/FREE", "OPEX", "SEGURANÇA"]);
    expect(linhas[1].comparado).toBeUndefined(); // OPEX só no atual
    expect(linhas[2].atual).toBeUndefined(); // SEGURANÇA só no comparado
    expect(linhas[0].atual?.percentualDoTotal).toBeCloseTo(90, 6);
    expect(linhas[0].comparado?.percentualDoTotal).toBeCloseTo(60, 6);
  });
});

import { variacaoCompraDireta } from "@/lib/services/compraDiretaPainel";

describe("variação por motivo (% sobre o comparado)", () => {
  it("8.000 vs 7.000 → +1.000 (+14,29%) piorou; 6.000 vs 7.000 → -1.000 (-14,29%) melhorou", () => {
    const a = variacaoCompraDireta(8000, 7000);
    expect(a.delta).toBe(1000);
    expect(a.percentual).toBeCloseTo(14.2857, 3);
    expect(a.situacao).toBe("piorou");
    const b = variacaoCompraDireta(6000, 7000);
    expect(b.delta).toBe(-1000);
    expect(b.percentual).toBeCloseTo(-14.2857, 3);
    expect(b.situacao).toBe("melhorou");
  });
  it("comparado 0 → sem % (não divide por zero); igual → sem alteração", () => {
    expect(variacaoCompraDireta(100, 0).percentual).toBeNull();
    expect(variacaoCompraDireta(100, 100).situacao).toBe("sem-alteracao");
  });
});

describe("composição por motivo de cada dia (clique no gráfico)", () => {
  const fat = [
    { codigo: "BG 01", data: "2026-09-12", valor: 1000 },
    { codigo: "BG 02", data: "2026-09-12", valor: 1000 },
  ];
  const cd = [
    { codigo: "BG 01", data: "2026-09-12", motivo: "CMO/FREE", valor: 60 },
    { codigo: "BG 01", data: "2026-09-12", motivo: "OPEX", valor: 10 },
    { codigo: "BG 02", data: "2026-09-12", motivo: "CMO/FREE", valor: 25 },
    { codigo: "BG 02", data: "2026-09-12", motivo: "CMV", valor: 5 },
  ];
  const p = montarPeriodoCompraDireta("2026-09-12", "2026-09-12", fat, cd);
  it("rede: soma dos motivos do dia = total do dia", () => {
    const dia = p.diario[0];
    expect(dia.valor).toBe(100);
    expect(dia.motivos.map((m) => [m.motivo, m.valor])).toEqual([["CMO/FREE", 85], ["OPEX", 10], ["CMV", 5]]);
    expect(dia.motivos.reduce((s, m) => s + m.valor, 0)).toBe(dia.valor);
  });
  it("loja: só os motivos daquela loja no dia", () => {
    const bg02 = p.porLoja.find((l) => l.unidade === "BG 02")!.diario[0];
    expect(bg02.motivos).toEqual([{ motivo: "CMO/FREE", valor: 25 }, { motivo: "CMV", valor: 5 }]);
    expect(bg02.motivos.reduce((s, m) => s + m.valor, 0)).toBe(bg02.valor);
  });
});

describe("Nota Fiscal = ajuste sem saída de caixa (fora da retirada financeira)", () => {
  const fat = [
    { codigo: "BG 01", data: "2026-09-01", valor: 10000 },
    { codigo: "BG 02", data: "2026-09-01", valor: 10000 },
  ];
  const linhas = [
    { codigo: "BG 01", data: "2026-09-01", motivo: "CMV", valor: 400 },
    { codigo: "BG 01", data: "2026-09-01", motivo: "NOTA FISCAL", valor: 600 }, // não é retirada real
    { codigo: "BG 02", data: "2026-09-01", motivo: "CMO/FREE", valor: 200 },
    { codigo: "BG 02", data: "2026-09-01", motivo: "Nota Fiscal ", valor: 50 }, // variação de caixa/espaço
  ];
  const p = montarPeriodoCompraDireta("2026-09-01", "2026-09-01", fat, linhas);

  it("reconhece a classificação sem depender de caixa, espaços ou acento", () => {
    expect(ehAjusteSemSaidaDeCaixa("NOTA FISCAL")).toBe(true);
    expect(ehAjusteSemSaidaDeCaixa("  nota fiscal ")).toBe(true);
    expect(ehAjusteSemSaidaDeCaixa("CMV")).toBe(false);
    expect(ehAjusteSemSaidaDeCaixa("MATERIAL DE LIMPEZA")).toBe(false);
  });

  it("total de retiradas financeiras EXCLUI Nota Fiscal; ajustes têm indicador próprio; total lançado = soma das duas", () => {
    expect(p.valor).toBe(600); // 400 + 200
    expect(p.ajustesSemSaida).toBe(650); // 600 + 50
    expect(p.totalLancado).toBe(1250);
    expect(p.totalLancado).toBe(linhas.reduce((s, l) => s + l.valor, 0)); // nada some nem duplica
  });

  it("% sobre o faturamento, status e ranking usam só a retirada financeira", () => {
    expect(p.percentual).toBeCloseTo((600 / 20000) * 100, 6);
    const bg01 = p.porLoja.find((l) => l.unidade === "BG 01")!;
    expect(bg01.valor).toBe(400);
    expect(bg01.percentual).toBeCloseTo(4, 6); // sem NF seria 10% (crítico)
    expect(bg01.status).toBe("controlado");
    expect(bg01.ajustesSemSaida).toBe(600);
    // a loja com mais "valor lançado" (BG 01 = 1.000) NÃO passa a ser a de maior retirada financeira
    const maior = [...p.porLoja].sort((a, b) => b.valor - a.valor)[0];
    expect(maior.unidade).toBe("BG 01"); // 400 > 200 só pela retirada real
    expect(p.porLoja.find((l) => l.unidade === "BG 02")!.valor).toBe(200);
  });

  it("os motivos exibidos são só os que existem nos dados (retirada financeira); Nota Fiscal fica separada, sem inventar categorias", () => {
    expect(p.motivos.map((m) => m.motivo).sort()).toEqual(["CMO/FREE", "CMV"]);
    expect(p.motivos.reduce((s, m) => s + m.valor, 0)).toBe(p.valor);
    expect(p.motivos.some((m) => m.motivo.toUpperCase().includes("LIMPEZA"))).toBe(false);
    expect(p.diario[0].valor).toBe(600);
  });

  it("totais consistentes: rede = soma das lojas (financeiro e ajustes)", () => {
    expect(p.porLoja.reduce((s, l) => s + l.valor, 0)).toBe(p.valor);
    expect(p.porLoja.reduce((s, l) => s + l.ajustesSemSaida, 0)).toBe(p.ajustesSemSaida);
  });

  it("período só com Nota Fiscal: há dados, mas retirada financeira = 0 (nunca vira retirada real)", () => {
    const so = montarPeriodoCompraDireta("2026-09-01", "2026-09-01", [{ codigo: "BG 01", data: "2026-09-01", valor: 5000 }], [{ codigo: "BG 01", data: "2026-09-01", motivo: "NOTA FISCAL", valor: 300 }]);
    expect(so.disponivel).toBe(true);
    expect(so.valor).toBe(0);
    expect(so.ajustesSemSaida).toBe(300);
    expect(so.totalLancado).toBe(300);
    expect(so.percentual).toBe(0);
  });
});
