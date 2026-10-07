import { describe, expect, it } from "vitest";
import { montarPeriodoBrindes, normalizarSubmotivo, type BrindesPainelData } from "@/lib/services/brindesPainel";
import {
  ROTULO_SEM_SUBMOTIVO,
  baseCobreOsPeriodos,
  compararMotivosDetalhados,
  comparabilidadeBrindes,
  linhasLojasBrindes,
  lojasDaModalidade,
  motivosDetalhados,
  ordenarLojasBrindes,
} from "@/lib/services/brindesAnalise";
import { diasDoIntervalo } from "@/lib/services/compraDiretaPainel";

const ATUAL = { inicio: "2026-09-28", fim: "2026-10-04" };
const ANT = { inicio: "2026-09-21", fim: "2026-09-27" };
const fat = (codigo: string, j: { inicio: string; fim: string }, v: number, pular: string[] = []) =>
  diasDoIntervalo(j.inicio, j.fim)
    .filter((d) => !pular.includes(d))
    .map((data) => ({ codigo, data, valor: v }));

// BG 01 e BG 02 faturam 7 dias; MAPOLI só 5 (cobertura parcial)
const fatAtual = [...fat("BG 01", ATUAL, 10000), ...fat("BG 02", ATUAL, 20000), ...fat("MAPOLI", ATUAL, 3000, ["2026-09-28", "2026-09-29"])];
const fatAnt = [...fat("BG 01", ANT, 10000), ...fat("BG 02", ANT, 20000), ...fat("MAPOLI", ANT, 3000, ["2026-09-21", "2026-09-22"])];
const b = (codigo: string, data: string, motivo: string, motivo2: string, valor: number) => ({ codigo, data, motivo, motivo2, valor });

const brAtual = [
  b("BG 01", "2026-09-29", "BRINDE PRESENTE", "ERRO DE PRODUÇÃO", 300),
  b("BG 01", "2026-09-30", "BRINDE PRESENTE", "erro de produção", 100), // mesma grafia em caixa diferente
  b("BG 01", "2026-09-30", "BRINDE PRESENTE", "BRINDE GERENCIA", 200),
  b("BG 01", "2026-10-01", "BRINDE TAXA EXTRA", "", 50),
  b("BG 01", "2026-10-02", "BRINDE PRESENTE", "DESCONTO EMPRESAS", 400), // Presente + Desconto Empresas = Empresas Parceiras (não controlável)
  b("BG 02", "2026-09-29", "BRINDE CONSUMO FUNCIONARIOS", "REFEIÇÃO COLABORADOR", 1000),
  b("BG 02", "2026-10-03", "BRINDE PRESENTE", "ERRO DE ATENDIMENTO", 500),
  b("MAPOLI", "2026-10-01", "BRINDE PRESENTE", "ERRO DE PRODUÇÃO", 60),
];
const brAnt = [
  b("BG 01", "2026-09-22", "BRINDE PRESENTE", "ERRO DE PRODUÇÃO", 250),
  b("BG 02", "2026-09-23", "BRINDE CONSUMO FUNCIONARIOS", "REFEIÇÃO COLABORADOR", 800),
  b("BG 02", "2026-09-24", "BRINDE PRESENTE", "ERRO DE ATENDIMENTO", 700),
];

const pA = montarPeriodoBrindes(ATUAL.inicio, ATUAL.fim, fatAtual, brAtual);
const pC = montarPeriodoBrindes(ANT.inicio, ANT.fim, fatAnt, brAnt);
const dados = (sobre: Partial<BrindesPainelData> = {}): BrindesPainelData => ({
  conectado: true,
  cobertura: { min: "2026-06-01", max: "2026-10-04" },
  atual: pA,
  comparacao: pC,
  ...sobre,
});

describe("matriz e motivos → submotivos", () => {
  it("normaliza o submotivo só em caixa/espaços (sem inventar categorias)", () => {
    expect(normalizarSubmotivo("  erro   de produção ")).toBe("ERRO DE PRODUÇÃO");
    expect(normalizarSubmotivo("")).toBe("");
  });

  it("a matriz reconcilia com o total do período e por loja", () => {
    expect(pA.matriz.reduce((s, m) => s + m.valor, 0)).toBeCloseTo(pA.total, 2);
    for (const l of pA.porLoja) {
      expect(pA.matriz.filter((m) => m.unidade === l.unidade).reduce((s, m) => s + m.valor, 0)).toBeCloseTo(l.total, 2);
    }
  });

  it("modalidades por valor decrescente; soma = total; submotivos somam a modalidade", () => {
    const m = motivosDetalhados(pA.matriz);
    expect(m.map((x) => x.valor)).toEqual([...m.map((x) => x.valor)].sort((a, b2) => b2 - a));
    expect(m.reduce((s, x) => s + x.valor, 0)).toBeCloseTo(pA.total, 2);
    expect(m.reduce((s, x) => s + x.percentualDoTotal, 0)).toBeCloseTo(100, 6);
    for (const x of m) expect(x.submotivos.reduce((s, y) => s + y.valor, 0)).toBeCloseTo(x.valor, 2);
    // mesma modalidade da classificação existente que o painel já usa
    expect(m.map((x) => x.motivo).sort()).toEqual(pA.motivos.map((x) => x.motivo).sort());
  });

  it("Presente: submotivos reais (grafias de caixa unificadas); Desconto Empresas fica em Empresas Parceiras", () => {
    const m = motivosDetalhados(pA.matriz);
    const presente = m.find((x) => x.motivo === "Presente")!;
    expect(presente.controlavel).toBe(true);
    expect(presente.submotivos.map((s) => [s.submotivo, s.valor])).toEqual([
      ["ERRO DE ATENDIMENTO", 500],
      ["ERRO DE PRODUÇÃO", 460], // 300 + 100 + 60 (BG 01 + MAPOLI)
      ["BRINDE GERENCIA", 200],
    ]);
    const emp = m.find((x) => x.motivo === "Empresas Parceiras")!;
    expect(emp.controlavel).toBe(false);
    expect(emp.valor).toBe(400);
    expect(m.find((x) => x.motivo === "Taxa Extra")!.submotivos[0].submotivo).toBe(ROTULO_SEM_SUBMOTIVO);
  });

  it("filtro de loja: motivos e total só da loja (reconcilia com o escopo)", () => {
    const m = motivosDetalhados(pA.matriz, "BG 01");
    expect(m.reduce((s, x) => s + x.valor, 0)).toBeCloseTo(pA.porLoja.find((l) => l.unidade === "BG 01")!.total, 2);
  });
});

describe("comparação de motivos", () => {
  it("variação em R$ e % sobre o comparado; modalidade só no comparado entra com atual 0", () => {
    const c = compararMotivosDetalhados(motivosDetalhados(pA.matriz), motivosDetalhados(pC.matriz), true);
    const consumo = c.find((x) => x.motivo === "Consumo Funcionários")!;
    expect([consumo.atual, consumo.comparado, consumo.variacaoReais]).toEqual([1000, 800, 200]);
    expect(consumo.variacaoPercentual).toBeCloseTo(25, 9);
    const taxa = c.find((x) => x.motivo === "Taxa Extra")!; // não existia no comparado → 0 real (base válida)
    expect([taxa.comparado, taxa.variacaoPercentual]).toEqual([0, null]);
    const sub = c.find((x) => x.motivo === "Presente")!.submotivos.find((s) => s.submotivo === "ERRO DE ATENDIMENTO")!;
    expect([sub.atual, sub.comparado, sub.variacaoReais]).toEqual([500, 700, -200]);
  });

  it("sem base válida: comparado e variações são null (nunca zero)", () => {
    const c = compararMotivosDetalhados(motivosDetalhados(pA.matriz), motivosDetalhados(pC.matriz), false);
    for (const m of c) {
      expect([m.comparado, m.variacaoReais, m.variacaoPercentual]).toEqual([null, null, null]);
      for (const s of m.submotivos) expect([s.comparado, s.variacaoReais]).toEqual([null, null]);
    }
  });
});

describe("comparabilidade e cobertura", () => {
  it("rede: precisa de base cobrindo os dois períodos e faturamento em todos os dias (MAPOLI parcial não invalida a rede, mas BG falhando invalidaria)", () => {
    expect(baseCobreOsPeriodos(dados())).toBe(true);
    // a rede tem faturamento todos os dias (BG 01/BG 02), então a comparação da rede é válida
    expect(comparabilidadeBrindes(dados()).valida).toBe(true);
  });
  it("base que não cobre o comparado → inválida com motivo", () => {
    const r = comparabilidadeBrindes(dados({ cobertura: { min: "2026-09-25", max: "2026-10-04" } }));
    expect(r.valida).toBe(false);
    expect(r.motivo).toMatch(/não cobre/);
    expect(baseCobreOsPeriodos(dados({ cobertura: { min: null, max: null } }))).toBe(false);
  });
  it("faturamento da rede faltando um dia → inválida; escopo de loja com faturamento completo continua válido", () => {
    const sem = montarPeriodoBrindes(ANT.inicio, ANT.fim, [...fat("BG 01", ANT, 10000, ["2026-09-23"]), ...fat("BG 02", ANT, 20000, ["2026-09-23"])], brAnt);
    expect(comparabilidadeBrindes(dados({ comparacao: sem })).valida).toBe(false);
    expect(comparabilidadeBrindes(dados({ comparacao: sem })).motivo).toMatch(/Faturamento incompleto/);
    const soUm = montarPeriodoBrindes(ANT.inicio, ANT.fim, [...fat("BG 01", ANT, 10000), ...fat("BG 02", ANT, 20000, ["2026-09-23"])], brAnt);
    expect(comparabilidadeBrindes(dados({ comparacao: soUm }), "BG 01").valida).toBe(true);
    expect(comparabilidadeBrindes(dados({ comparacao: soUm }), "BG 02").valida).toBe(false);
  });
  it("sem registros de brindes em um período → inválida", () => {
    const vazio = montarPeriodoBrindes(ANT.inicio, ANT.fim, fatAnt, []);
    expect(comparabilidadeBrindes(dados({ comparacao: vazio })).valida).toBe(false);
  });
});

describe("comparativo por loja", () => {
  const linhas = linhasLojasBrindes(pA, pC, true);
  const por = (u: string) => linhas.find((l) => l.unidade === u)!;

  it("totais por loja reconciliam com a rede", () => {
    expect(linhas.reduce((s, l) => s + l.total, 0)).toBeCloseTo(pA.total, 2);
    expect(linhas.reduce((s, l) => s + l.controlaveis, 0)).toBeCloseTo(pA.controlaveis, 2);
  });

  it("% de controláveis = controláveis ÷ faturamento (nunca o do total); total à parte", () => {
    const l = por("BG 01"); // fat 70.000; controláveis 300+100+200+50 = 650; total 1.050
    expect(l.controlaveis).toBe(650);
    expect(l.percentualControlaveis).toBeCloseTo((650 / 70000) * 100, 9);
    expect(l.percentualTotal).toBeCloseTo((1050 / 70000) * 100, 9);
    expect(l.percentualControlaveis).not.toBe(l.percentualTotal);
  });

  it("loja com faturamento em menos dias: sem %, sem comparação, mantém valores em R$", () => {
    const m = por("MAPOLI");
    expect(m.coberturaParcial).toBe(true);
    expect([m.diasComFaturamento, m.diasDoPeriodo]).toEqual([5, 7]);
    expect(m.percentualControlaveis).toBeNull();
    expect(m.percentualTotal).toBeNull();
    expect(m.variacaoReais).toBeNull();
    expect(m.total).toBe(60);
  });

  it("variação do total só com comparação válida; base inválida → null", () => {
    expect(por("BG 02").variacaoReais).toBe(1500 - 1500);
    expect(por("BG 01").variacaoReais).toBe(1050 - 250);
    const inv = linhasLojasBrindes(pA, pC, false);
    expect(inv.every((l) => l.variacaoReais === null && l.variacaoPp === null)).toBe(true);
  });

  it("ordenação: por valor (maior absoluto) e por % são independentes; sem % vai por último", () => {
    expect(ordenarLojasBrindes(linhas, "valor").map((l) => l.unidade)).toEqual(["BG 02", "BG 01", "MAPOLI"]); // 1.500 > 1.050 > 60
    expect(ordenarLojasBrindes(linhas, "percentual").map((l) => l.unidade)).toEqual(["BG 01", "BG 02", "MAPOLI"]); // 0,93% > 0,12% > sem %
    expect(ordenarLojasBrindes(linhas, "variacao").map((l) => l.unidade)[0]).toBe("BG 01");
    expect(ordenarLojasBrindes(linhas, "variacao").map((l) => l.unidade).at(-1)).toBe("MAPOLI");
    expect(ordenarLojasBrindes(linhas, "loja").map((l) => l.unidade)).toEqual(["BG 01", "BG 02", "MAPOLI"]);
  });

  it("filtro de loja", () => {
    expect(linhasLojasBrindes(pA, pC, true, "BG 02").map((l) => l.unidade)).toEqual(["BG 02"]);
  });
});

describe("investigar por modalidade", () => {
  it("lojas de uma modalidade somam o total da modalidade na rede", () => {
    const lojas = lojasDaModalidade("Presente", pA, pC, true);
    const total = motivosDetalhados(pA.matriz).find((m) => m.motivo === "Presente")!.valor;
    expect(lojas.reduce((s, l) => s + l.valor, 0)).toBeCloseTo(total, 2);
    expect(lojas.reduce((s, l) => s + l.percentualDaModalidade, 0)).toBeCloseTo(100, 6);
    expect(lojas.map((l) => l.valor)).toEqual([...lojas.map((l) => l.valor)].sort((a, b2) => b2 - a));
  });

  it("valor, faturamento e % s/ faturamento por loja; comparado/variação só com cobertura da loja", () => {
    const lojas = lojasDaModalidade("Presente", pA, pC, true);
    const bg02 = lojas.find((l) => l.unidade === "BG 02")!;
    expect([bg02.valor, bg02.faturamento, bg02.comparado, bg02.variacaoReais]).toEqual([500, 140000, 700, -200]);
    expect(bg02.percentualFaturamento).toBeCloseTo((500 / 140000) * 100, 9);
    const mapoli = lojas.find((l) => l.unidade === "MAPOLI")!;
    expect(mapoli.coberturaParcial).toBe(true);
    expect([mapoli.faturamento, mapoli.percentualFaturamento, mapoli.comparado, mapoli.variacaoReais]).toEqual([null, null, null, null]);
    expect(mapoli.valor).toBe(60); // valor absoluto preservado
  });

  it("base inválida: sem comparado; modalidade inexistente → vazio; filtro de loja", () => {
    expect(lojasDaModalidade("Presente", pA, pC, false).every((l) => l.comparado === null)).toBe(true);
    expect(lojasDaModalidade("Inexistente", pA, pC, true)).toEqual([]);
    expect(lojasDaModalidade("Presente", pA, pC, true, "BG 01").map((l) => l.unidade)).toEqual(["BG 01"]);
  });
});
