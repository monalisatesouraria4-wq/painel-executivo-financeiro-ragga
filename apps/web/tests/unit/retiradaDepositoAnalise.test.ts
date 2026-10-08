import { describe, expect, it } from "vitest";
import { diasDoIntervalo } from "@/lib/services/compraDiretaPainel";
import {
  MOTIVO_DEPOSITO,
  cicloDoDia,
  comparabilidadeDeposito,
  intervaloInicialDeposito,
  lacunasDaBase,
  montarPainelDeposito,
  valorRegistrado,
  type CoberturaDeposito,
  type LancamentoDeposito,
} from "@/lib/services/retiradaDepositoAnalise";
import { montarDepositoGerencial, periodoAnteriorMesmaDuracao } from "@/lib/services/retiradaDepositoGerencial";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const l = (unidade: string, data: string, valor: number, caixa = "PDV 01", motivo = MOTIVO_DEPOSITO): LancamentoDeposito => ({ unidade, data, valor, caixa, motivo });

// Base real parecida com a atual: 14/09 a 04/10, SEM nenhuma linha em 23/09; 22/09 só tem lançamentos de OUTRA classe (ERRO)
const diasBase = diasDoIntervalo("2026-09-14", "2026-10-04").filter((x) => x !== "2026-09-23");
const cobertura: CoberturaDeposito = {
  conectado: true,
  minBase: "2026-09-14",
  maxBase: "2026-10-04",
  minDeposito: "2026-09-15",
  maxDeposito: "2026-10-04",
  diasComRegistro: diasBase,
  lojasComDeposito: ["BG 02", "BG 03", "BG 10", "BG 11", "BG 13", "MAPOLI"],
};

const DEPOSITOS: LancamentoDeposito[] = [
  l("BG 11", "2026-09-15", 420),
  l("BG 10", "2026-09-17", 500),
  l("BG 03", "2026-09-20", 1300), // domingo → ciclo sexta 18/09 a domingo 20/09
  l("BG 10", "2026-09-20", 1000),
  l("BG 02", "2026-09-21", 800), // segunda → ciclo 21/09 a 24/09
  l("BG 02", "2026-09-24", 600),
  l("BG 10", "2026-09-27", 1000), // domingo → ciclo sexta 25/09 a domingo 27/09
  l("BG 10", "2026-10-01", 900),
  l("BG 13", "2026-10-01", 1850),
  l("BG 10", "2026-10-02", 500),
  l("BG 10", "2026-10-04", 900),
];
const TOTAL = DEPOSITOS.reduce((s, x) => s + x.valor, 0); // 9.770

describe("ciclos de depósito (regra existente, sem recriar)", () => {
  it("segunda–quinta → ciclo de segunda a quinta, depósito na sexta; sexta–domingo → ciclo de sexta a domingo, depósito na segunda", () => {
    expect(cicloDoDia("2026-09-23")).toEqual({ inicio: "2026-09-21", fim: "2026-09-24", depositoEsperado: "2026-09-25", rotulo: "Depósito na sexta-feira desta semana" });
    expect(cicloDoDia("2026-09-24").inicio).toBe("2026-09-21");
    expect(cicloDoDia("2026-09-25")).toEqual({ inicio: "2026-09-25", fim: "2026-09-27", depositoEsperado: "2026-09-28", rotulo: "Depósito na segunda-feira seguinte" });
    expect(cicloDoDia("2026-09-27").inicio).toBe("2026-09-25"); // domingo pertence ao ciclo da sexta anterior
    expect(cicloDoDia("2026-09-28").inicio).toBe("2026-09-28");
  });
});

describe("período anterior preservado", () => {
  it("periodoAnteriorMesmaDuracao: mesma duração, termina na véspera (assinatura e semântica intactas)", () => {
    const p = periodoAnteriorMesmaDuracao(d("2026-09-28"), d("2026-10-04"));
    expect([iso(p.inicio), iso(p.fim), p.dias]).toEqual(["2026-09-21", "2026-09-27", 7]);
    const um = periodoAnteriorMesmaDuracao(d("2026-10-04"), d("2026-10-04"));
    expect([iso(um.inicio), iso(um.fim), um.dias]).toEqual(["2026-10-03", "2026-10-03", 1]);
  });
  it("o painel usa esse mesmo período anterior", () => {
    const p = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: DEPOSITOS, cobertura });
    expect(p.anterior).toEqual({ inicio: "2026-09-27", fim: "2026-09-30" });
  });
});

describe("reconciliação do total de DEPÓSITO", () => {
  const p = montarPainelDeposito({ inicio: "2026-09-14", fim: "2026-10-04", lancamentos: DEPOSITOS, cobertura });

  it("total geral = soma das lojas = soma dos ciclos = soma dos lançamentos", () => {
    expect(p.resumo.total).toBe(TOTAL);
    expect(p.lojas.reduce((s, x) => s + x.total, 0)).toBeCloseTo(TOTAL, 2);
    expect(p.ciclos.reduce((s, x) => s + x.valor, 0)).toBeCloseTo(TOTAL, 2);
    expect(p.lancamentos.reduce((s, x) => s + x.valor, 0)).toBeCloseTo(TOTAL, 2);
    expect(p.resumo.lancamentos).toBe(DEPOSITOS.length);
  });

  it("total de cada loja = soma dos seus ciclos; ciclos distintos ficam em linhas próprias", () => {
    for (const loja of p.lojas) expect(loja.ciclos.reduce((s, c) => s + c.valor, 0)).toBeCloseTo(loja.total, 2);
    const bg10 = p.lojas.find((x) => x.unidade === "BG 10")!;
    expect(bg10.total).toBe(4800);
    expect(bg10.ciclos.map((c) => [c.ciclo.inicio, c.valor, c.lancamentos])).toEqual([
      ["2026-09-14", 500, 1], // 17/09 (quinta)
      ["2026-09-18", 1000, 1], // 20/09 (domingo)
      ["2026-09-25", 1000, 1], // 27/09 (domingo)
      ["2026-09-28", 900, 1], // 01/10 (quinta)
      ["2026-10-02", 1400, 2], // 02/10 (sexta) + 04/10 (domingo)
    ]);
  });

  it("ordenação: maiores retiradas primeiro", () => {
    expect(p.lojas.map((x) => x.unidade)).toEqual(["BG 10", "BG 13", "BG 02", "BG 03", "BG 11"]);
  });

  it("ERRO e SUPRIMENTO nunca entram nos totais (mesmo que a consulta os devolvesse)", () => {
    const mistura = [...DEPOSITOS, l("BG 01", "2026-09-22", 283, "PDV 03", "ERRO"), l("BG 07", "2026-09-26", 4000, "PDV 01", "SUPRIMENTO")];
    const q = montarPainelDeposito({ inicio: "2026-09-14", fim: "2026-10-04", lancamentos: mistura, cobertura });
    expect(q.resumo.total).toBe(TOTAL);
    expect(q.lojas.some((x) => x.unidade === "BG 01" || x.unidade === "BG 07")).toBe(false);
    expect(q.lancamentos.every((x) => x.motivo === MOTIVO_DEPOSITO)).toBe(true);
  });
});

describe("filtro por loja e por intervalo de datas", () => {
  it("só a loja filtrada; intervalo limita os lançamentos", () => {
    const p = montarPainelDeposito({ inicio: "2026-09-20", fim: "2026-09-27", lancamentos: DEPOSITOS, cobertura, unidade: "BG 10" });
    expect(p.lojas.map((x) => x.unidade)).toEqual(["BG 10"]);
    expect(p.resumo.total).toBe(2000); // 20/09 + 27/09
    expect(p.lancamentos.map((x) => x.data)).toEqual(["2026-09-20", "2026-09-27"]);
  });
});

describe("média por loja e dias com depósito", () => {
  it("média = total ÷ lojas com ≥ 1 lançamento DEPÓSITO no período; dias = datas distintas com DEPÓSITO", () => {
    const p = montarPainelDeposito({ inicio: "2026-09-14", fim: "2026-10-04", lancamentos: DEPOSITOS, cobertura });
    expect(p.resumo.lojasComRetirada).toBe(5);
    expect(p.resumo.mediaPorLoja).toBe(1954); // 9.770 ÷ 5
    expect(p.resumo.diasComDeposito).toBe(9); // 15,17,20,21,24,27/09 + 01,02,04/10
    expect(p.periodo.dias).toBe(21);
  });
  it("sem lançamentos: média 0 (sem divisão por zero), nenhuma loja", () => {
    const p = montarPainelDeposito({ inicio: "2026-10-03", fim: "2026-10-04", lancamentos: [], cobertura });
    expect([p.resumo.total, p.resumo.lojasComRetirada, p.resumo.mediaPorLoja, p.resumo.diasComDeposito]).toEqual([0, 0, 0, 0]);
  });
});

describe("ciclos que atravessam os limites do período", () => {
  it("ciclo que começa antes ou termina depois do período é marcado como parcial (só os dias do período foram somados)", () => {
    const p = montarPainelDeposito({ inicio: "2026-09-22", fim: "2026-09-26", lancamentos: DEPOSITOS, cobertura });
    const bg02 = p.ciclos.find((c) => c.unidade === "BG 02")!; // só 24/09 entra; o ciclo é 21/09–24/09
    expect([bg02.valor, bg02.ciclo.inicio, bg02.parcialNoPeriodo]).toEqual([600, "2026-09-21", true]);
    const fim = montarPainelDeposito({ inicio: "2026-09-21", fim: "2026-09-23", lancamentos: DEPOSITOS, cobertura });
    expect(fim.ciclos.find((c) => c.unidade === "BG 02")?.parcialNoPeriodo).toBe(true); // termina em 24/09, depois do período
    const inteiro = montarPainelDeposito({ inicio: "2026-09-21", fim: "2026-09-24", lancamentos: DEPOSITOS, cobertura });
    expect(inteiro.ciclos.find((c) => c.unidade === "BG 02")).toMatchObject({ valor: 1400, parcialNoPeriodo: false });
  });
  it("ciclo que termina depois do último registro da base é marcado como incompleto na base", () => {
    const p = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: DEPOSITOS, cobertura });
    expect(p.ciclos.find((c) => c.unidade === "BG 13")?.incompletoNaBase).toBe(false); // ciclo 28/09–01/10
    expect(p.ciclos.find((c) => c.unidade === "BG 10" && c.ciclo.inicio === "2026-10-02")?.incompletoNaBase).toBe(false); // 02–04/10, base termina 04/10
    expect(montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: DEPOSITOS, cobertura: { ...cobertura, maxBase: "2026-10-03", diasComRegistro: cobertura.diasComRegistro.filter((x) => x <= "2026-10-03") } }).ciclos.find((c) => c.unidade === "BG 10" && c.ciclo.inicio === "2026-10-02")?.incompletoNaBase).toBe(true);
  });
});

describe("datas ausentes e cobertura (23/09)", () => {
  it("lacuna da base = dia sem NENHUMA linha entre o primeiro e o último registro", () => {
    expect(lacunasDaBase(cobertura)).toEqual(["2026-09-23"]);
    expect(lacunasDaBase({ minBase: null, maxBase: null, diasComRegistro: [] })).toEqual([]);
  });

  it("23/09 aparece como 'sem registro na base' (valor nulo, nunca zero); dia só com outras classes = 'sem DEPÓSITO registrado'; depois da base = 'fora da base'", () => {
    const p = montarPainelDeposito({ inicio: "2026-09-21", fim: "2026-10-06", lancamentos: DEPOSITOS, cobertura });
    const por = (x: string) => p.diario.find((y) => y.data === x)!;
    expect(por("2026-09-23")).toEqual({ data: "2026-09-23", estado: "sem-registro", valor: null, lancamentos: 0 });
    expect(por("2026-09-22")).toMatchObject({ estado: "sem-deposito-registrado", valor: null }); // há linhas (outras classes) mas nenhum DEPÓSITO
    expect(por("2026-09-24")).toMatchObject({ estado: "deposito", valor: 600, lancamentos: 1 });
    expect(por("2026-10-05")).toMatchObject({ estado: "fora-da-base", valor: null });
    expect(p.diario.filter((x) => x.valor === 0)).toEqual([]); // nenhum dia com R$ 0 inventado
    expect(p.cobertura.lacunasNoPeriodo).toEqual(["2026-09-23"]);
    expect(p.cobertura.periodoDentroDaBase).toBe(false);
    expect(p.resumo.diasSemRegistro).toBe(1);
  });

  it("resumo da base: intervalo real, histórico curto, seis lojas com DEPÓSITO", () => {
    const p = montarPainelDeposito({ inicio: "2026-09-14", fim: "2026-10-04", lancamentos: DEPOSITOS, cobertura });
    expect([p.cobertura.minBase, p.cobertura.maxBase, p.cobertura.historicoDias]).toEqual(["2026-09-14", "2026-10-04", 21]);
    expect(p.cobertura.historicoCurto).toBe(true);
    expect(p.cobertura.lojasComDeposito).toHaveLength(6);
    expect(intervaloInicialDeposito(cobertura)).toEqual({ inicio: "2026-09-14", fim: "2026-10-04" });
    expect(intervaloInicialDeposito({ minBase: null, maxBase: null })).toBeNull();
  });
});

describe("comparação: válida × sem base", () => {
  it("válida com os dois períodos na base, sem lacuna e com DEPÓSITO no anterior", () => {
    const p = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: DEPOSITOS, cobertura });
    expect(p.comparacao.comparabilidade).toEqual({ valida: true, motivo: null });
    expect(p.comparacao.anterior).toEqual({ total: 1000, lojasComRetirada: 1, lancamentos: 1 }); // 27/09–30/09
    expect(p.resumo.total).toBe(4150); // 900 + 1.850 + 500 + 900
    expect(p.comparacao.variacaoReais).toBe(3150);
    expect(p.comparacao.variacaoPercentual).toBeCloseTo(315, 9);
    // o destaque NÃO é o total (+315%): só BG 10 tem DEPÓSITO nos dois períodos
    expect(p.comparacao.lojasComparaveis.map((x) => [x.unidade, x.atual, x.anterior, x.diferenca])).toEqual([["BG 10", 2300, 1000, 1300]]);
    expect(p.comparacao.soNoAtual).toEqual([{ unidade: "BG 13", atual: 1850 }]);
    expect(p.comparacao.soNoAnterior).toEqual([]);
    expect(p.comparacao.destaque).toMatchObject({ quantidadeLojas: 1, atual: 2300, anterior: 1000, diferenca: 1300 });
    expect(p.comparacao.destaque!.variacaoPercentual).toBeCloseTo(130, 9);
  });

  it("período anterior fora da base → 'Sem base de comparação' (sem totais anteriores nem variação)", () => {
    const p = montarPainelDeposito({ inicio: "2026-09-14", fim: "2026-10-04", lancamentos: DEPOSITOS, cobertura });
    expect(p.comparacao.comparabilidade.valida).toBe(false);
    expect(p.comparacao.comparabilidade.motivo).toMatch(/fora do intervalo da base/);
    expect([p.comparacao.anterior, p.comparacao.variacaoReais, p.comparacao.variacaoPercentual, p.comparacao.destaque]).toEqual([null, null, null, null]);
    expect([p.comparacao.lojasComparaveis, p.comparacao.soNoAtual, p.comparacao.soNoAnterior]).toEqual([[], [], []]);
    expect(p.comparacao.motivoSemDestaque).toMatch(/fora do intervalo da base/);
  });

  it("dia sem registro (23/09) no período ou no anterior invalida a comparação", () => {
    const noAnterior = montarPainelDeposito({ inicio: "2026-09-28", fim: "2026-10-04", lancamentos: DEPOSITOS, cobertura }); // anterior 21–27/09 contém 23/09
    expect(noAnterior.comparacao.comparabilidade.valida).toBe(false);
    expect(noAnterior.comparacao.comparabilidade.motivo).toMatch(/anterior.*sem registro na base.*23\/09/);
    const noAtual = montarPainelDeposito({ inicio: "2026-09-22", fim: "2026-09-24", lancamentos: DEPOSITOS, cobertura });
    expect(noAtual.comparacao.comparabilidade.motivo).toMatch(/selecionado.*23\/09/);
  });

  it("anterior sem nenhum DEPÓSITO → sem base (ausência de registro não prova que não houve depósito)", () => {
    const semAnterior = DEPOSITOS.filter((x) => x.data >= "2026-10-01");
    const p = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: semAnterior, cobertura });
    expect(p.comparacao.comparabilidade.valida).toBe(false);
    expect(p.comparacao.comparabilidade.motivo).toMatch(/Não há DEPÓSITO registrado no período anterior/);
    expect(p.comparacao.variacaoReais).toBeNull(); // nunca "caiu para zero"
  });

  it("período selecionado fora da base e base vazia", () => {
    expect(comparabilidadeDeposito({ atual: { inicio: "2026-10-01", fim: "2026-10-10" }, anterior: { inicio: "2026-09-21", fim: "2026-09-30" }, cobertura, lancamentosAnterior: 3 }).motivo).toMatch(/não está inteiro dentro/);
    expect(comparabilidadeDeposito({ atual: { inicio: "2026-10-01", fim: "2026-10-04" }, anterior: { inicio: "2026-09-27", fim: "2026-09-30" }, cobertura: { minBase: null, maxBase: null, diasComRegistro: [] }, lancamentosAnterior: 0 }).valida).toBe(false);
    const vazio = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: [], cobertura: { ...cobertura, minBase: null, maxBase: null, diasComRegistro: [], lojasComDeposito: [] } });
    expect(vazio.diario.every((x) => x.estado === "fora-da-base")).toBe(true);
  });

  it("com loja filtrada, só DEPÓSITO daquela loja decide o anterior", () => {
    const p = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: DEPOSITOS, cobertura, unidade: "BG 13" });
    expect(p.comparacao.comparabilidade.valida).toBe(false); // BG 13 não tem DEPÓSITO em 27–30/09
  });
});

describe("regressão da camada gerencial existente", () => {
  it("montarDepositoGerencial segue calculando total, variação e 'sem base anterior' como antes", () => {
    const g = montarDepositoGerencial([{ unidade: "BG 01", retiradaCiclo: 1500 }, { unidade: "BG 04", retiradaCiclo: 100 }], [{ unidade: "BG 01", retiradaCiclo: 1000 }]);
    expect([g.totalAtual, g.totalAnterior, g.lojasComRetirada, g.mediaPorLoja]).toEqual([1600, 1000, 2, 800]);
    expect(g.variacaoTotalPercentual).toBeCloseTo(60, 9);
    expect(g.lojas.find((x) => x.unidade === "BG 04")?.situacao).toBe("sem-base-anterior");
  });
});

// Dados reais de 27/09–04/10 (BG 10 tem DEPÓSITO nos dois períodos; BG 13 só no atual)
const REAIS: LancamentoDeposito[] = [
  l("BG 10", "2026-09-27", 1000, "BG10 - PDV 02"),
  l("BG 13", "2026-10-01", 1850, "BG13 - PDV 001"),
  l("BG 10", "2026-10-01", 800, "BG10 - PDV 03"),
  l("BG 10", "2026-10-02", 500, "BG10 - PDV 03"),
  l("BG 10", "2026-10-04", 900, "BG10 - PDV 02"),
];

describe("comparação por loja: lojas comparáveis × registro em apenas um período", () => {
  const p = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: REAIS, cobertura });

  it("01/10–04/10 × 27/09–30/09: o destaque comparável é BG 10 (+R$ 1.200,00, +120%), com uma loja comparável", () => {
    expect(p.anterior).toEqual({ inicio: "2026-09-27", fim: "2026-09-30" });
    expect(p.comparacao.comparabilidade.valida).toBe(true);
    expect(p.comparacao.lojasComparaveis).toEqual([{ unidade: "BG 10", atual: 2200, anterior: 1000, diferenca: 1200, variacaoPercentual: 120 }]);
    expect(p.comparacao.destaque).toEqual({ quantidadeLojas: 1, atual: 2200, anterior: 1000, diferenca: 1200, variacaoPercentual: 120 });
    expect(p.comparacao.motivoSemDestaque).toBeNull();
  });

  it("BG 13 aparece como registro apenas no período atual, sem variação", () => {
    expect(p.comparacao.soNoAtual).toEqual([{ unidade: "BG 13", atual: 1850 }]);
    expect(p.comparacao.lojasComparaveis.some((x) => x.unidade === "BG 13")).toBe(false);
  });

  it("os totais registrados continuam disponíveis, separados do destaque comparável", () => {
    expect(p.resumo.total).toBe(4050);
    expect(p.comparacao.anterior).toEqual({ total: 1000, lojasComRetirada: 1, lancamentos: 1 });
    expect(p.comparacao.variacaoReais).toBe(3050); // diferença entre totais registrados (inclui BG 13)
    expect(p.comparacao.variacaoPercentual).toBeCloseTo(305, 9);
    expect(p.comparacao.destaque!.variacaoPercentual).toBe(120); // ≠ 305: o destaque não usa o total
    expect(p.comparacao.destaque!.diferenca).not.toBe(p.comparacao.variacaoReais);
  });

  it("loja só no período ANTERIOR aparece na lista (não some) e não vira 'queda para zero'", () => {
    const lanc = [...REAIS, l("BG 02", "2026-09-28", 600, "BG02 - PDV 01")];
    const q = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: lanc, cobertura });
    expect(q.comparacao.soNoAnterior).toEqual([{ unidade: "BG 02", anterior: 600 }]);
    expect(q.comparacao.lojasComparaveis.map((x) => x.unidade)).toEqual(["BG 10"]);
    expect(q.comparacao.destaque).toMatchObject({ atual: 2200, anterior: 1000, diferenca: 1200 }); // BG 02 não entra no destaque
    expect(q.comparacao.anterior).toEqual({ total: 1600, lojasComRetirada: 2, lancamentos: 2 }); // total registrado inclui BG 02
    expect(q.lojas.some((x) => x.unidade === "BG 02")).toBe(false); // sem lançamento no atual: não há linha com R$ 0
  });

  it("duas lojas comparáveis: destaque soma só as comparáveis; ordenadas pela maior retirada atual", () => {
    const lanc = [...REAIS, l("BG 02", "2026-09-29", 400, "BG02 - PDV 01"), l("BG 02", "2026-10-03", 700, "BG02 - PDV 01")];
    const q = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: lanc, cobertura });
    expect(q.comparacao.lojasComparaveis.map((x) => [x.unidade, x.atual, x.anterior])).toEqual([["BG 10", 2200, 1000], ["BG 02", 700, 400]]);
    expect(q.comparacao.destaque).toMatchObject({ quantidadeLojas: 2, atual: 2900, anterior: 1400, diferenca: 1500 });
    expect(q.comparacao.destaque!.variacaoPercentual).toBeCloseTo((1500 / 1400) * 100, 9);
    expect(q.comparacao.soNoAtual.map((x) => x.unidade)).toEqual(["BG 13"]);
  });

  it("nenhuma loja comparável (lojas diferentes nos dois períodos) → janela válida, mas sem destaque: 'Sem base' por loja", () => {
    const lanc = [l("BG 02", "2026-09-28", 600), l("BG 13", "2026-10-01", 1850)];
    const q = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: lanc, cobertura });
    expect(q.comparacao.comparabilidade.valida).toBe(true);
    expect(q.comparacao.lojasComparaveis).toEqual([]);
    expect(q.comparacao.destaque).toBeNull();
    expect(q.comparacao.motivoSemDestaque).toBe("Nenhuma loja tem DEPÓSITO registrado nos dois períodos.");
    expect(q.comparacao.soNoAtual).toEqual([{ unidade: "BG 13", atual: 1850 }]);
    expect(q.comparacao.soNoAnterior).toEqual([{ unidade: "BG 02", anterior: 600 }]);
  });

  it("filtro de loja: só compara se a loja tem DEPÓSITO nos dois períodos", () => {
    const dois = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: REAIS, cobertura, unidade: "BG 10" });
    expect(dois.comparacao.destaque).toMatchObject({ quantidadeLojas: 1, atual: 2200, anterior: 1000, diferenca: 1200 });
    const so = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: REAIS, cobertura, unidade: "BG 13" });
    expect(so.comparacao.comparabilidade.valida).toBe(false); // BG 13 não tem DEPÓSITO no anterior
    expect(so.comparacao.destaque).toBeNull();
    const semAtual = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: [l("BG 10", "2026-09-27", 1000)], cobertura, unidade: "BG 10" });
    expect(semAtual.comparacao.comparabilidade.valida).toBe(true); // janela ok e anterior com DEPÓSITO
    expect(semAtual.comparacao.destaque).toBeNull(); // mas sem DEPÓSITO no atual: nada a comparar
    expect(semAtual.comparacao.soNoAnterior).toEqual([{ unidade: "BG 10", anterior: 1000 }]);
  });

  it("ausência de base: janela inválida não produz comparáveis, listas nem destaque", () => {
    const q = montarPainelDeposito({ inicio: "2026-09-28", fim: "2026-10-04", lancamentos: REAIS, cobertura }); // anterior contém 23/09
    expect(q.comparacao.comparabilidade.valida).toBe(false);
    expect([q.comparacao.lojasComparaveis, q.comparacao.soNoAtual, q.comparacao.soNoAnterior, q.comparacao.destaque]).toEqual([[], [], [], null]);
    expect(q.comparacao.motivoSemDestaque).toMatch(/23\/09/);
  });

  it("uma loja com DEPÓSITO de valor líquido zero (ex.: 2 lançamentos que se anulam) ainda conta como 'registrado' e sem % (anterior = 0)", () => {
    const lanc = [l("BG 10", "2026-09-27", 0), l("BG 10", "2026-10-01", 500)];
    const q = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: lanc, cobertura });
    expect(q.comparacao.lojasComparaveis).toEqual([{ unidade: "BG 10", atual: 500, anterior: 0, diferenca: 500, variacaoPercentual: null }]);
    expect(q.comparacao.destaque).toMatchObject({ diferenca: 500, variacaoPercentual: null });
  });
});

describe("ausência de DEPÓSITO × lançamento real de valor zero", () => {
  it("valorRegistrado: sem lançamentos → null; com lançamento (mesmo R$ 0,00) → o total", () => {
    expect(valorRegistrado(0, 0)).toBeNull();
    expect(valorRegistrado(1, 0)).toBe(0);
    expect(valorRegistrado(3, 4050)).toBe(4050);
  });

  it("período sem DEPÓSITO (só ERRO): sem lançamentos → card mostra 'Sem DEPÓSITO registrado'", () => {
    const p = montarPainelDeposito({ inicio: "2026-09-28", fim: "2026-09-30", lancamentos: [l("BG 10", "2026-09-27", 1000, "PDV 02", "ERRO")], cobertura });
    expect(p.resumo.lancamentos).toBe(0);
    expect(valorRegistrado(p.resumo.lancamentos, p.resumo.total)).toBeNull();
  });

  it("lançamento real com valor zero é registrado (R$ 0,00), não ausência", () => {
    const p = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: [l("BG 10", "2026-10-02", 0)], cobertura });
    expect(p.resumo.lancamentos).toBe(1);
    expect(valorRegistrado(p.resumo.lancamentos, p.resumo.total)).toBe(0);
  });

  it("totais registrados da comparação usam o mesmo critério", () => {
    const p = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: REAIS, cobertura });
    const ant = p.comparacao.anterior!;
    expect(valorRegistrado(ant.lancamentos, ant.total)).toBe(1000);
  });
});

describe("Total por loja: união das lojas dos dois períodos", () => {
  const lanc = [...REAIS, l("BG 02", "2026-09-28", 600, "BG02 - PDV 01")];
  const p = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: lanc, cobertura });
  const por = (u: string) => p.linhasLojas.filter((x) => x.unidade === u);

  it("loja nos dois períodos → comparável, com os dois valores e variação válida", () => {
    expect(por("BG 10")).toEqual([
      { unidade: "BG 10", tipo: "comparavel", atual: 2200, anterior: 1000, lancamentos: 3, ciclos: 2, diferenca: 1200, variacaoPercentual: 120 },
    ]);
  });

  it("loja só no atual → valor atual, anterior ausente, sem variação", () => {
    expect(por("BG 13")).toEqual([{ unidade: "BG 13", tipo: "so-atual", atual: 1850, anterior: null, lancamentos: 1, ciclos: 1, diferenca: null, variacaoPercentual: null }]);
  });

  it("loja só no anterior → valor anterior, atual ausente (não é zero), sem variação", () => {
    expect(por("BG 02")).toEqual([{ unidade: "BG 02", tipo: "so-anterior", atual: null, anterior: 600, lancamentos: null, ciclos: null, diferenca: null, variacaoPercentual: null }]);
  });

  it("sem duplicar lojas e reconciliando com os totais registrados", () => {
    const nomes = p.linhasLojas.map((x) => x.unidade);
    expect(new Set(nomes).size).toBe(nomes.length);
    expect([...nomes].sort()).toEqual(["BG 02", "BG 10", "BG 13"]);
    expect(p.linhasLojas.reduce((s, x) => s + (x.atual ?? 0), 0)).toBe(p.resumo.total);
    expect(p.linhasLojas.reduce((s, x) => s + (x.anterior ?? 0), 0)).toBe(p.comparacao.anterior!.total);
    expect(p.comparacao.destaque).toMatchObject({ quantidadeLojas: 1, atual: 2200, anterior: 1000, diferenca: 1200 });
  });

  it("janela sem base: só o período atual, tipo 'sem-comparacao'", () => {
    const q = montarPainelDeposito({ inicio: "2026-09-28", fim: "2026-10-04", lancamentos: REAIS, cobertura });
    expect(q.linhasLojas.every((x) => x.tipo === "sem-comparacao" && x.anterior === null && x.variacaoPercentual === null)).toBe(true);
  });

  it("período atual sem DEPÓSITO: lojas do anterior ainda aparecem (atual null)", () => {
    const q = montarPainelDeposito({ inicio: "2026-10-01", fim: "2026-10-04", lancamentos: [l("BG 10", "2026-09-27", 1000)], cobertura });
    expect(q.linhasLojas).toEqual([{ unidade: "BG 10", tipo: "so-anterior", atual: null, anterior: 1000, lancamentos: null, ciclos: null, diferenca: null, variacaoPercentual: null }]);
  });
});
