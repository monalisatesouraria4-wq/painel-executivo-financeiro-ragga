import { describe, expect, it } from "vitest";
import { montarPdvGerencial, sentidoDe } from "@/lib/services/pdvGerencial";
import { periodoAnteriorMesmaDuracao } from "@/lib/services/retiradaDepositoGerencial";
import type { PdvMaquininhaLinha } from "@/lib/services/controlesCaixa";

const linha = (unidade: string, totalPdv: number, totalMaquininha: number): PdvMaquininhaLinha => ({
  unidade: unidade as never,
  totalPdv,
  totalMaquininha,
  diferenca: Math.round((totalMaquininha - totalPdv) * 100) / 100,
});

describe("PDV × Maquininha — camada gerencial", () => {
  const atual = [
    linha("BG 01", 10000, 9800), // −200  (−2%)
    linha("BG 02", 20000, 20300), // +300  (+1,5%)
    linha("BG 03", 5000, 5000), // 0
    linha("BG 04", 8000, 7500), // −500  (−6,25%)
    linha("BG 05", 0, 0), // sem movimentação
  ];
  const g = montarPdvGerencial(atual, null);

  it("total da rede = soma das lojas (PDV, Maquininha e diferença)", () => {
    expect(g.rede.totalPdv).toBe(43000);
    expect(g.rede.totalMaquininha).toBe(42600);
    expect(g.rede.diferenca).toBe(-400); // −200 + 300 + 0 − 500
    expect(g.lojas.reduce((s, l) => s + l.totalPdv, 0)).toBe(g.rede.totalPdv);
    expect(g.lojas.reduce((s, l) => s + l.totalMaquininha, 0)).toBe(g.rede.totalMaquininha);
    expect(g.lojas.reduce((s, l) => s + l.diferenca, 0)).toBe(g.rede.diferenca);
  });

  it("% de divergência = diferença ÷ total PDV × 100, com o sinal da diferença", () => {
    const por = (u: string) => g.lojas.find((l) => l.unidade === u)!;
    expect(por("BG 01").percentual).toBeCloseTo(-2, 9);
    expect(por("BG 02").percentual).toBeCloseTo(1.5, 9);
    expect(por("BG 04").percentual).toBeCloseTo(-6.25, 9);
    expect(g.rede.percentual).toBeCloseTo((-400 / 43000) * 100, 9);
  });

  it("ranking pela gravidade (|diferença|), mantendo o sinal; sentido negativo/positivo claro", () => {
    expect(g.lojas.map((l) => [l.unidade, l.diferenca, l.sentido])).toEqual([
      ["BG 04", -500, "falta"],
      ["BG 02", 300, "sobra"],
      ["BG 01", -200, "falta"],
      ["BG 03", 0, "sem-diferenca"],
    ]);
  });

  it("loja sem movimentação (PDV = 0 e Maquininha = 0) não entra no ranking nem é problema", () => {
    expect(g.lojas.map((l) => l.unidade)).not.toContain("BG 05");
    expect(g.pontosDeAtencao.map((l) => l.unidade)).not.toContain("BG 05");
  });

  it("pontos de atenção: maiores |diferença| primeiro, só com divergência (BG 03 sem diferença fica de fora)", () => {
    expect(g.pontosDeAtencao.map((l) => l.unidade)).toEqual(["BG 04", "BG 02", "BG 01"]);
    const muitas = montarPdvGerencial(
      ["BG 01", "BG 02", "BG 03", "BG 04", "BG 05", "BG 06", "BG 07"].map((u, i) => linha(u, 1000, 1000 - (i + 1) * 10)),
      null
    );
    expect(muitas.pontosDeAtencao).toHaveLength(5);
    expect(muitas.pontosDeAtencao[0].unidade).toBe("BG 07"); // −70
  });

  it("empate em |diferença|: maior % em módulo primeiro; persistindo, ordem oficial das lojas", () => {
    const e = montarPdvGerencial([linha("BG 03", 1000, 900), linha("BG 02", 5000, 4900), linha("BG 01", 5000, 5100)], null);
    // todas |100|; % em módulo: BG 03 = 10%, BG 02 = 2%, BG 01 = 2% → BG 03, depois BG 01 e BG 02 pela ordem oficial
    expect(e.lojas.map((l) => l.unidade)).toEqual(["BG 03", "BG 01", "BG 02"]);
  });

  it("sentido e tolerância (R$ 0,005 já usada na aba)", () => {
    expect(sentidoDe(0.004)).toBe("sem-diferenca");
    expect(sentidoDe(-0.01)).toBe("falta");
    expect(sentidoDe(0.01)).toBe("sobra");
  });

  it("Total PDV zero com movimento na maquininha: sem % (nunca divide por zero)", () => {
    const z = montarPdvGerencial([linha("BG 01", 0, 120)], null);
    expect(z.lojas[0].percentual).toBeNull();
    expect(z.rede.percentual).toBeNull();
    expect(z.lojas[0].sentido).toBe("sobra");
  });
});

describe("PDV × Maquininha — período anterior e variação da divergência da rede", () => {
  it("período anterior = mesma duração, terminando na véspera do início", () => {
    const p = periodoAnteriorMesmaDuracao(new Date("2026-09-16T00:00:00Z"), new Date("2026-09-30T00:00:00Z")); // 15 dias
    expect([p.inicio.toISOString().slice(0, 10), p.fim.toISOString().slice(0, 10), p.dias]).toEqual(["2026-09-01", "2026-09-15", 15]);
  });

  const atual = [linha("BG 01", 10000, 9000), linha("BG 02", 10000, 10000)]; // −1.000 (−5%)
  it("variação em R$ e % sobre a divergência anterior (em módulo): aumento = positivo", () => {
    const anterior = [linha("BG 01", 10000, 9500), linha("BG 02", 10000, 10000)]; // −500 (−2,5%)
    const c = montarPdvGerencial(atual, anterior).comparacao;
    expect(c.temBase).toBe(true);
    expect(c.anterior?.diferenca).toBe(-500);
    expect(c.variacaoReais).toBe(500); // |−1000| − |−500|
    expect(c.variacaoPercentual).toBeCloseTo(100, 9);
    expect(c.variacaoPp).toBeCloseTo(2.5, 9);
  });

  it("divergência que diminuiu → variação negativa", () => {
    const anterior = [linha("BG 01", 10000, 8000), linha("BG 02", 10000, 10000)]; // −2.000
    const c = montarPdvGerencial(atual, anterior).comparacao;
    expect(c.variacaoReais).toBe(-1000);
    expect(c.variacaoPercentual).toBeCloseTo(-50, 9);
  });

  it("divergência anterior zero (há base): variação em R$ existe, % não é calculado", () => {
    const anterior = [linha("BG 01", 10000, 10000), linha("BG 02", 10000, 10000)];
    const c = montarPdvGerencial(atual, anterior).comparacao;
    expect(c.temBase).toBe(true);
    expect(c.variacaoReais).toBe(1000);
    expect(c.variacaoPercentual).toBeNull();
  });

  it("ausência de base anterior (sem linhas ou só lojas sem movimentação): tudo nulo, sem percentual artificial", () => {
    for (const ant of [[], null, [linha("BG 01", 0, 0)]]) {
      const c = montarPdvGerencial(atual, ant).comparacao;
      expect(c.temBase).toBe(false);
      expect([c.anterior, c.variacaoReais, c.variacaoPercentual, c.variacaoPp]).toEqual([null, null, null, null]);
    }
  });

  it("filtro de loja: ranking, rede e comparação calculados só sobre as linhas da loja", () => {
    const so = montarPdvGerencial(atual.filter((l) => l.unidade === "BG 01"), [linha("BG 01", 10000, 9500)]);
    expect(so.lojas).toHaveLength(1);
    expect(so.rede.diferenca).toBe(-1000);
    expect(so.comparacao.variacaoReais).toBe(500);
  });
});
