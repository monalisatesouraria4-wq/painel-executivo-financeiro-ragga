import { describe, expect, it } from "vitest";
import { montarPeriodoCancelamento, type CancelamentoPainelData } from "@/lib/services/cancelamentoPainel";
import {
  baseCobreOsPeriodos,
  comparabilidadeCancelamento,
  compararMotivosCancelados,
  linhasLojasCancelamento,
  lojasDoMotivo,
  motivosCancelados,
  ordenarLojasCancelamento,
  percentualCancelamentoValido,
  situacaoPorPercentual,
} from "@/lib/services/cancelamentoAnalise";
import { diasDoIntervalo, montarPeriodoCompraDireta } from "@/lib/services/compraDiretaPainel";

const ATUAL = { inicio: "2026-09-28", fim: "2026-10-04" };
const ANT = { inicio: "2026-09-21", fim: "2026-09-27" };
const fat = (codigo: string, j: { inicio: string; fim: string }, v: number, pular: string[] = []) =>
  diasDoIntervalo(j.inicio, j.fim)
    .filter((d) => !pular.includes(d))
    .map((data) => ({ codigo, data, valor: v }));
const c = (codigo: string, data: string, motivo: string, valor: number) => ({ codigo, data, motivo, valor });

// BG 01: 10.000/dia; BG 02: 20.000/dia (atual) e 10.000/dia (anterior); MAPOLI: só 5 dias com faturamento
const fatAtual = [...fat("BG 01", ATUAL, 10000), ...fat("BG 02", ATUAL, 20000), ...fat("MAPOLI", ATUAL, 3000, ["2026-09-28", "2026-09-29"])];
const fatAnt = [...fat("BG 01", ANT, 10000), ...fat("BG 02", ANT, 10000), ...fat("MAPOLI", ANT, 3000, ["2026-09-21", "2026-09-22"])];

// SALÃO (motivos do salão, incluindo TESTE)
const salaoAtual = [
  c("BG 01", "2026-09-29", "MOT 03 - ERRO OPERACIONAL", 700),
  c("BG 01", "2026-09-30", "MOT 01 - DESISTENCIA", 200),
  c("BG 01", "2026-10-01", "MOT 05 - TESTE", 100),
  c("BG 02", "2026-09-30", "MOT 03 - ERRO OPERACIONAL", 1400),
  c("BG 02", "2026-10-02", "MOT 02 - TROCA DE PRODUTO", 600),
  c("MAPOLI", "2026-10-01", "MOT 01 - DESISTENCIA", 60),
];
const salaoAnt = [
  c("BG 01", "2026-09-22", "MOT 03 - ERRO OPERACIONAL", 350),
  c("BG 01", "2026-09-23", "MOT 01 - DESISTENCIA", 150),
  c("BG 02", "2026-09-24", "MOT 03 - ERRO OPERACIONAL", 1000),
];
// DELIVERY: outros motivos
const deliveryAtual = [c("BG 01", "2026-09-29", "MOT 02 - ATRASO", 500), c("BG 02", "2026-09-30", "MOT 01 - DESISTENCIA/CLIENTE NÃO LOCALIZADO", 800)];
const deliveryAnt = [c("BG 01", "2026-09-22", "MOT 02 - ATRASO", 300), c("BG 02", "2026-09-23", "MOT 01 - DESISTENCIA/CLIENTE NÃO LOCALIZADO", 400)];

const pSalaoA = montarPeriodoCancelamento(ATUAL.inicio, ATUAL.fim, fatAtual, salaoAtual);
const pSalaoC = montarPeriodoCancelamento(ANT.inicio, ANT.fim, fatAnt, salaoAnt);
const pDelA = montarPeriodoCancelamento(ATUAL.inicio, ATUAL.fim, fatAtual, deliveryAtual);
const pDelC = montarPeriodoCancelamento(ANT.inicio, ANT.fim, fatAnt, deliveryAnt);

const dados = (atual = pSalaoA, comparacao = pSalaoC, sobre: Partial<CancelamentoPainelData> = {}): CancelamentoPainelData => ({
  conectado: true,
  cobertura: { min: "2026-06-01", max: "2026-10-05" },
  atual,
  comparacao,
  ...sobre,
});

describe("motivos → lojas (reconciliação)", () => {
  const m = motivosCancelados(pSalaoA);

  it("motivos em ordem decrescente de valor, nomes exatamente como na base; soma = total do período", () => {
    expect(m.map((x) => x.motivo)).toEqual(["MOT 03 - ERRO OPERACIONAL", "MOT 02 - TROCA DE PRODUTO", "MOT 01 - DESISTENCIA", "MOT 05 - TESTE"]);
    expect(m.map((x) => x.valor)).toEqual([2100, 600, 260, 100]);
    expect(m.reduce((s, x) => s + x.valor, 0)).toBeCloseTo(pSalaoA.valor, 2);
    expect(pSalaoA.valor).toBe(3060);
  });

  it("participação dos motivos fecha em 100% (com arredondamento)", () => {
    expect(m.reduce((s, x) => s + x.percentualDoTotal, 0)).toBeCloseTo(100, 6);
    expect(m[0].percentualDoTotal).toBeCloseTo((2100 / 3060) * 100, 9);
  });

  it("lojas de cada motivo somam o motivo; lojas de todos os motivos somam o total e cada loja o seu total", () => {
    for (const x of m) {
      expect(x.lojas.reduce((s, l) => s + l.valor, 0)).toBeCloseTo(x.valor, 2);
      expect(x.lojas.reduce((s, l) => s + l.percentualDoMotivo, 0)).toBeCloseTo(100, 6);
    }
    for (const l of pSalaoA.porLoja) {
      const soma = m.flatMap((x) => x.lojas).filter((x) => x.unidade === l.unidade).reduce((s, x) => s + x.valor, 0);
      expect(soma).toBeCloseTo(l.valor, 2);
    }
  });

  it("o motivo TESTE permanece nos totais (sem exclusões)", () => {
    expect(m.find((x) => x.motivo === "MOT 05 - TESTE")?.valor).toBe(100);
    expect(pSalaoA.valor).toBe(salaoAtual.reduce((s, x) => s + x.valor, 0));
  });

  it("filtro de loja: motivos e total só da loja", () => {
    const so = motivosCancelados(pSalaoA, "BG 01");
    expect(so.reduce((s, x) => s + x.valor, 0)).toBeCloseTo(pSalaoA.porLoja.find((l) => l.unidade === "BG 01")!.valor, 2);
    expect(so.every((x) => x.lojas.length === 1 && x.lojas[0].unidade === "BG 01")).toBe(true);
  });

  it("Salão e Delivery são tratados separadamente (cada fonte, os seus motivos e totais)", () => {
    const md = motivosCancelados(pDelA);
    expect(md.map((x) => x.motivo)).toEqual(["MOT 01 - DESISTENCIA/CLIENTE NÃO LOCALIZADO", "MOT 02 - ATRASO"]);
    expect(md.reduce((s, x) => s + x.valor, 0)).toBe(1300);
    expect(md.some((x) => x.motivo.includes("TESTE"))).toBe(false);
    expect(m.some((x) => x.motivo.includes("ATRASO"))).toBe(false);
  });
});

describe("cobertura e comparabilidade", () => {
  it("base cobre os dois períodos e o faturamento da rede está completo → comparação válida", () => {
    expect(baseCobreOsPeriodos(dados())).toBe(true);
    expect(comparabilidadeCancelamento(dados()).valida).toBe(true);
  });

  it("base que não cobre o comparado → inválida (motivo explicado) e sem base nas variações", () => {
    const d = dados(pSalaoA, pSalaoC, { cobertura: { min: "2026-09-25", max: "2026-10-05" } });
    const r = comparabilidadeCancelamento(d);
    expect(r.valida).toBe(false);
    expect(r.motivo).toMatch(/não cobre/);
    expect(baseCobreOsPeriodos(d)).toBe(false);
    const linhas = compararMotivosCancelados(pSalaoA, pSalaoC, false);
    for (const x of linhas) {
      expect([x.comparado, x.variacaoReais, x.variacaoPercentual, x.percentualFaturamentoComparado, x.variacaoPp]).toEqual([null, null, null, null, null]);
      expect(x.situacao).toBe("sem-base");
      for (const l of x.lojas) expect([l.comparado, l.variacaoReais]).toEqual([null, null]);
    }
    expect(linhasLojasCancelamento(pSalaoA, pSalaoC, false).every((l) => l.comparado === null && l.situacao === "sem-base")).toBe(true);
  });

  it("período comparado sem registros → sem base; faturamento da rede faltando um dia → inválida", () => {
    const vazio = montarPeriodoCancelamento(ANT.inicio, ANT.fim, fatAnt, []);
    expect(comparabilidadeCancelamento(dados(pSalaoA, vazio)).valida).toBe(false);
    const semDia = montarPeriodoCancelamento(ANT.inicio, ANT.fim, [...fat("BG 01", ANT, 10000, ["2026-09-23"]), ...fat("BG 02", ANT, 10000, ["2026-09-23"])], salaoAnt);
    const r = comparabilidadeCancelamento(dados(pSalaoA, semDia));
    expect(r.valida).toBe(false);
    expect(r.motivo).toMatch(/Faturamento incompleto/);
    expect(percentualCancelamentoValido(semDia)).toBeNull();
  });

  it("escopo de loja usa o faturamento da loja (BG 01 completo vale mesmo se outra loja falha)", () => {
    const so = montarPeriodoCancelamento(ANT.inicio, ANT.fim, [...fat("BG 01", ANT, 10000), ...fat("BG 02", ANT, 10000, ["2026-09-23"])], salaoAnt);
    expect(comparabilidadeCancelamento(dados(pSalaoA, so), "BG 01").valida).toBe(true);
    expect(comparabilidadeCancelamento(dados(pSalaoA, so), "BG 02").valida).toBe(false);
    // a rede segue com faturamento em todos os dias (BG 01); a loja incompleta é tratada individualmente
    expect(comparabilidadeCancelamento(dados(pSalaoA, so)).valida).toBe(true);
  });
});

describe("situação pelo % sobre o faturamento (nunca só pelo valor)", () => {
  it("valor sobe mas % cai → melhorou; valor cai mas % sobe → piorou; igual → estável", () => {
    expect(situacaoPorPercentual({ valorAtual: 120, valorComparado: 100, percentualAtual: 0.8, percentualComparado: 1 })).toBe("melhorou");
    expect(situacaoPorPercentual({ valorAtual: 80, valorComparado: 100, percentualAtual: 1.2, percentualComparado: 1 })).toBe("piorou");
    expect(situacaoPorPercentual({ valorAtual: 10, valorComparado: 12, percentualAtual: 1.001, percentualComparado: 1.004 })).toBe("estavel");
  });
  it("sem % válido NÃO cai para o valor: sem base; zero nos dois = sem ocorrência", () => {
    expect(situacaoPorPercentual({ valorAtual: 90, valorComparado: 100, percentualAtual: null, percentualComparado: 1 })).toBe("sem-base");
    expect(situacaoPorPercentual({ valorAtual: 90, valorComparado: null, percentualAtual: 1, percentualComparado: null })).toBe("sem-base");
    expect(situacaoPorPercentual({ valorAtual: 0, valorComparado: 0, percentualAtual: 0, percentualComparado: 0 })).toBe("sem-ocorrencia");
  });
  it("na prática: valor dobra mas o % é igual → estável (não é piora); motivo pelo % da rede", () => {
    const l = linhasLojasCancelamento(pSalaoA, pSalaoC, true).find((x) => x.unidade === "BG 02")!;
    // BG 02: 2.000 ÷ 140.000 = 1,4286% × 1.000 ÷ 70.000 = 1,4286%
    expect(l.variacaoReais).toBe(1000);
    expect(l.situacao).toBe("estavel");
    const erro = compararMotivosCancelados(pSalaoA, pSalaoC, true).find((x) => x.motivo === "MOT 03 - ERRO OPERACIONAL")!;
    // rede (faturamento completo): atual 2.100 ÷ 225.000 × anterior 1.350 ÷ 155.000 → % sobe → piorou
    expect(erro.percentualFaturamento).toBeCloseTo((2100 / 225000) * 100, 9);
    expect(erro.percentualFaturamentoComparado).toBeCloseTo((1350 / 155000) * 100, 9);
    expect(erro.situacao).toBe("piorou");
    expect(erro.variacaoReais).toBe(750);
  });
});

describe("comparativo por loja", () => {
  const linhas = linhasLojasCancelamento(pSalaoA, pSalaoC, true);
  const por = (u: string) => linhas.find((l) => l.unidade === u)!;

  it("totais por loja fecham o total; % = valor ÷ faturamento da loja", () => {
    expect(linhas.reduce((s, l) => s + l.valor, 0)).toBeCloseTo(pSalaoA.valor, 2);
    expect(por("BG 01").percentual).toBeCloseTo((1000 / 70000) * 100, 9);
    expect(por("BG 01").comparado).toBe(500);
    expect(por("BG 01").variacaoReais).toBe(500);
  });

  it("loja com faturamento em menos dias: sem %, sem comparação, sem situação; valor em R$ preservado", () => {
    const m = por("MAPOLI");
    expect(m.coberturaParcial).toBe(true);
    expect([m.diasComFaturamento, m.diasDoPeriodo]).toEqual([5, 7]);
    expect([m.percentual, m.comparado, m.variacaoReais, m.variacaoPp]).toEqual([null, null, null, null]);
    expect(m.situacao).toBe("sem-base");
    expect(m.valor).toBe(60);
  });

  it("ordenação: valor, % e variação são independentes; sem % vai por último", () => {
    expect(ordenarLojasCancelamento(linhas, "valor").map((l) => l.unidade)).toEqual(["BG 02", "BG 01", "MAPOLI"]);
    expect(ordenarLojasCancelamento(linhas, "percentual").map((l) => l.unidade).at(-1)).toBe("MAPOLI");
    expect(ordenarLojasCancelamento(linhas, "variacao").map((l) => l.unidade).at(-1)).toBe("MAPOLI");
    expect(ordenarLojasCancelamento(linhas, "loja").map((l) => l.unidade)).toEqual(["BG 01", "BG 02", "MAPOLI"]);
    expect(ordenarLojasCancelamento(linhas, "criticidade").map((l) => l.unidade).at(-1)).toBe("MAPOLI");
  });

  it("filtro de loja", () => {
    expect(linhasLojasCancelamento(pSalaoA, pSalaoC, true, "BG 02").map((l) => l.unidade)).toEqual(["BG 02"]);
  });
});

describe("investigar por motivo", () => {
  it("lojas do motivo somam o valor do motivo na rede", () => {
    const lojas = lojasDoMotivo("MOT 03 - ERRO OPERACIONAL", pSalaoA, pSalaoC, true);
    expect(lojas.reduce((s, l) => s + l.valor, 0)).toBeCloseTo(2100, 2);
    expect(lojas.reduce((s, l) => s + l.percentualDoMotivo, 0)).toBeCloseTo(100, 6);
    expect(lojas.map((l) => l.unidade)).toEqual(["BG 02", "BG 01"]);
  });

  it("valor, faturamento, % e comparado por loja; cobertura parcial sem % nem comparação", () => {
    const lojas = lojasDoMotivo("MOT 01 - DESISTENCIA", pSalaoA, pSalaoC, true);
    const bg01 = lojas.find((l) => l.unidade === "BG 01")!;
    expect([bg01.valor, bg01.faturamento, bg01.comparado, bg01.variacaoReais]).toEqual([200, 70000, 150, 50]);
    expect(bg01.percentualFaturamento).toBeCloseTo((200 / 70000) * 100, 9);
    const mapoli = lojas.find((l) => l.unidade === "MAPOLI")!;
    expect(mapoli.coberturaParcial).toBe(true);
    expect([mapoli.faturamento, mapoli.percentualFaturamento, mapoli.comparado, mapoli.situacao]).toEqual([null, null, null, "sem-base"]);
    expect(mapoli.valor).toBe(60);
  });

  it("base inválida → sem comparado; motivo inexistente → vazio; TESTE pode ser investigado", () => {
    expect(lojasDoMotivo("MOT 03 - ERRO OPERACIONAL", pSalaoA, pSalaoC, false).every((l) => l.comparado === null)).toBe(true);
    expect(lojasDoMotivo("INEXISTENTE", pSalaoA, pSalaoC, true)).toEqual([]);
    expect(lojasDoMotivo("MOT 05 - TESTE", pSalaoA, pSalaoC, true).map((l) => l.valor)).toEqual([100]);
  });

  it("Delivery: motivos e lojas próprios, sem mistura com o Salão", () => {
    const lojas = lojasDoMotivo("MOT 02 - ATRASO", pDelA, pDelC, true);
    expect(lojas.map((l) => [l.unidade, l.valor, l.comparado])).toEqual([["BG 01", 500, 300]]);
    expect(lojasDoMotivo("MOT 02 - ATRASO", pSalaoA, pSalaoC, true)).toEqual([]);
  });
});

describe("comparação de motivos", () => {
  it("motivo só no comparado entra com atual 0; ausência no comparado = 0 real com base válida", () => {
    const m = compararMotivosCancelados(pSalaoA, pSalaoC, true);
    const teste = m.find((x) => x.motivo === "MOT 05 - TESTE")!;
    expect([teste.atual, teste.comparado, teste.variacaoPercentual]).toEqual([100, 0, null]);
    const noAnt = montarPeriodoCancelamento(ANT.inicio, ANT.fim, fatAnt, [...salaoAnt, c("BG 01", "2026-09-25", "MOT 04 - FALTA DE PRODUTO", 40)]);
    const n = compararMotivosCancelados(pSalaoA, noAnt, true).find((x) => x.motivo === "MOT 04 - FALTA DE PRODUTO")!;
    expect([n.atual, n.comparado]).toEqual([0, 40]);
  });
});

describe("regressão: a generalização de tipos (PeriodoAnalisavel) não altera o comportamento de Cancelamentos", () => {
  it("mesmas linhas → mesmos motivos, lojas, comparações e situação (pelo %) nas duas estruturas de período", () => {
    const cdA = montarPeriodoCompraDireta(ATUAL.inicio, ATUAL.fim, fatAtual, salaoAtual);
    const cdC = montarPeriodoCompraDireta(ANT.inicio, ANT.fim, fatAnt, salaoAnt);
    expect(motivosCancelados(cdA)).toEqual(motivosCancelados(pSalaoA));
    expect(compararMotivosCancelados(cdA, cdC, true)).toEqual(compararMotivosCancelados(pSalaoA, pSalaoC, true));
    expect(lojasDoMotivo("MOT 03 - ERRO OPERACIONAL", cdA, cdC, true)).toEqual(lojasDoMotivo("MOT 03 - ERRO OPERACIONAL", pSalaoA, pSalaoC, true));
    expect(percentualCancelamentoValido(cdA)).toBe(percentualCancelamentoValido(pSalaoA));
  });

  it("a situação de Cancelamentos continua pelo % sobre o faturamento (valor sobe e % cai → melhorou)", () => {
    expect(situacaoPorPercentual({ valorAtual: 120, valorComparado: 100, percentualAtual: 0.8, percentualComparado: 1 })).toBe("melhorou");
    // BG 02 (Salão): valor dobra (2.000 × 1.000) mas o % é o mesmo → estável, não "piorou"
    expect(linhasLojasCancelamento(pSalaoA, pSalaoC, true).find((l) => l.unidade === "BG 02")!.situacao).toBe("estavel");
  });
});
