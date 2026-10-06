import { describe, expect, it } from "vitest";
import { montarDepositoGerencial, periodoAnteriorMesmaDuracao, totaisPorLoja } from "@/lib/services/retiradaDepositoGerencial";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const l = (unidade: string, retiradaCiclo: number) => ({ unidade, retiradaCiclo });

describe("período anterior de mesma duração", () => {
  it("imediatamente antes, com o mesmo número de dias", () => {
    const p = periodoAnteriorMesmaDuracao(d("2026-09-28"), d("2026-10-04")); // 7 dias
    expect([iso(p.inicio), iso(p.fim), p.dias]).toEqual(["2026-09-21", "2026-09-27", 7]);
  });
  it("dia único → o dia anterior; período de 31 dias → 31 dias antes, sem sobreposição", () => {
    const um = periodoAnteriorMesmaDuracao(d("2026-10-06"), d("2026-10-06"));
    expect([iso(um.inicio), iso(um.fim), um.dias]).toEqual(["2026-10-05", "2026-10-05", 1]);
    const longo = periodoAnteriorMesmaDuracao(d("2026-09-06"), d("2026-10-06"));
    expect(longo.dias).toBe(31);
    expect(iso(longo.fim)).toBe("2026-09-05"); // termina na véspera do início → não se sobrepõe ao atual
    expect(iso(longo.inicio)).toBe("2026-08-06");
  });
});

describe("montarDepositoGerencial", () => {
  // cada linha = um ciclo da loja dentro do período; a loja pode ter mais de um ciclo
  const atual = [l("BG 01", 1000), l("BG 01", 500), l("BG 02", 800), l("BG 03", 300), l("BG 04", 100)];
  const anterior = [l("BG 01", 1000), l("BG 02", 400), l("BG 03", 600), l("BG 05", 250)];
  const g = montarDepositoGerencial(atual, anterior);

  it("total = soma das lojas; soma por loja soma os ciclos sem duplicar", () => {
    expect(totaisPorLoja(atual).get("BG 01")).toBe(1500);
    expect(g.totalAtual).toBe(2700);
    expect(g.lojas.reduce((s, x) => s + x.atual, 0)).toBe(g.totalAtual);
    expect(g.totalAnterior).toBe(2250);
    expect(g.lojas.reduce((s, x) => s + x.anterior, 0)).toBe(g.totalAnterior);
  });

  it("lojas com retirada (atual) e média por loja", () => {
    expect(g.lojasComRetirada).toBe(4); // BG 05 só tinha retirada no anterior → fora da contagem
    expect(g.mediaPorLoja).toBe(675);
  });

  it("variação % do total contra o período anterior", () => {
    expect(g.variacaoTotalPercentual).toBeCloseTo(((2700 - 2250) / 2250) * 100, 9); // +20%
  });

  it("ranking: maior retirada atual primeiro; loja que só tinha retirada no anterior aparece por último (reduziu 100%)", () => {
    expect(g.lojas.map((x) => x.unidade)).toEqual(["BG 01", "BG 02", "BG 03", "BG 04", "BG 05"]);
    const bg05 = g.lojas.find((x) => x.unidade === "BG 05")!;
    expect([bg05.atual, bg05.anterior, bg05.diferenca, bg05.situacao]).toEqual([0, 250, -250, "reduziu"]);
    expect(bg05.variacaoPercentual).toBe(-100);
  });

  it("empate na retirada atual: maior diferença em R$ primeiro", () => {
    const e = montarDepositoGerencial([l("BG 01", 500), l("BG 02", 500)], [l("BG 01", 500), l("BG 02", 100)]);
    expect(e.lojas.map((x) => x.unidade)).toEqual(["BG 02", "BG 01"]); // +400 antes de 0
  });

  it("variação por loja e situação", () => {
    const bg02 = g.lojas.find((x) => x.unidade === "BG 02")!;
    expect([bg02.diferenca, bg02.variacaoPercentual, bg02.situacao]).toEqual([400, 100, "aumentou"]);
    expect(g.lojas.find((x) => x.unidade === "BG 01")!.situacao).toBe("aumentou"); // 1500 × 1000 → +50%
    expect(g.lojas.find((x) => x.unidade === "BG 03")!.situacao).toBe("reduziu");
  });

  it("sem base anterior: nunca calcula percentual (nem infinito) e fica fora do ranking de aumentos", () => {
    const bg04 = g.lojas.find((x) => x.unidade === "BG 04")!;
    expect(bg04.variacaoPercentual).toBeNull();
    expect(bg04.situacao).toBe("sem-base-anterior");
    expect(g.semBaseAnterior.map((x) => x.unidade)).toEqual(["BG 04"]);
    expect(g.pontosDeAtencao.map((x) => x.unidade)).not.toContain("BG 04");
  });

  it("pontos de atenção: até 5 maiores aumentos percentuais, em ordem", () => {
    expect(g.pontosDeAtencao.map((x) => [x.unidade, Math.round(x.variacaoPercentual ?? 0)])).toEqual([["BG 02", 100], ["BG 01", 50]]);
    const muitos = montarDepositoGerencial(
      ["BG 01", "BG 02", "BG 03", "BG 04", "BG 05", "BG 06", "BG 07"].map((u, i) => l(u, 100 + (i + 1) * 10)),
      ["BG 01", "BG 02", "BG 03", "BG 04", "BG 05", "BG 06", "BG 07"].map((u) => l(u, 100))
    );
    expect(muitos.pontosDeAtencao).toHaveLength(5);
    expect(muitos.pontosDeAtencao[0].unidade).toBe("BG 07");
  });

  it("período anterior sem nenhum dado: total anterior 0 → variação do total = sem base (null)", () => {
    const so = montarDepositoGerencial([l("BG 01", 300)], []);
    expect(so.totalAnterior).toBe(0);
    expect(so.variacaoTotalPercentual).toBeNull();
    expect(so.lojas[0].variacaoPercentual).toBeNull();
    expect(so.pontosDeAtencao).toEqual([]);
  });

  it("sem retirada em nenhum dos períodos → vazio, média 0 (sem divisão por zero)", () => {
    const v = montarDepositoGerencial([], []);
    expect(v.lojas).toEqual([]);
    expect([v.totalAtual, v.lojasComRetirada, v.mediaPorLoja, v.variacaoTotalPercentual]).toEqual([0, 0, 0, null]);
  });

  it("filtro de loja: um único conjunto de linhas gera tudo só dessa loja", () => {
    const so = montarDepositoGerencial(atual.filter((x) => x.unidade === "BG 01"), anterior.filter((x) => x.unidade === "BG 01"));
    expect(so.lojas).toHaveLength(1);
    expect([so.totalAtual, so.totalAnterior, so.lojasComRetirada, so.mediaPorLoja]).toEqual([1500, 1000, 1, 1500]);
  });
});
