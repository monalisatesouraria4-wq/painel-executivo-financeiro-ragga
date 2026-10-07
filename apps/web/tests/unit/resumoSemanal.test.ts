import { describe, expect, it } from "vitest";
import {
  coberturaDaBase,
  coberturaFaturamento,
  hojeNegocio,
  janelaAnterior,
  janelaDeSemanas,
  montarResumoSemanal,
  semanasDisponiveis,
  situacaoSemanal,
  ultimaSemanaCompleta,
  validarJanela,
  validarPar,
  type EntradaResumoSemanal,
} from "@/lib/services/resumoSemanal";
import { diasDoIntervalo } from "@/lib/services/compraDiretaPainel";

describe("semanas completas (segunda a domingo)", () => {
  it("quarta 2026-10-07 → última completa 28/09–04/10; anterior 21/09–27/09", () => {
    const u = ultimaSemanaCompleta("2026-10-07");
    expect(u).toEqual({ inicio: "2026-09-28", fim: "2026-10-04" });
    expect(janelaAnterior(u)).toEqual({ inicio: "2026-09-21", fim: "2026-09-27" });
  });
  it("no domingo (semana ainda não fechou) e na segunda seguinte", () => {
    expect(ultimaSemanaCompleta("2026-10-11").fim).toBe("2026-10-04"); // domingo: a semana 05–11 ainda está em andamento
    expect(ultimaSemanaCompleta("2026-10-12").fim).toBe("2026-10-11"); // segunda: a semana 05–11 fechou
  });
  it("lista de semanas: sem sobreposição, todas segunda→domingo, da mais recente para a mais antiga", () => {
    const l = semanasDisponiveis("2026-10-07", 6);
    expect(l[0].inicio).toBe("2026-09-28");
    for (let i = 0; i < l.length; i++) {
      expect(new Date(`${l[i].inicio}T00:00:00Z`).getUTCDay()).toBe(1);
      expect(new Date(`${l[i].fim}T00:00:00Z`).getUTCDay()).toBe(0);
      if (i > 0) expect(l[i].fim < l[i - 1].inicio).toBe(true);
    }
  });
  it("janela de N semanas e anterior de mesma duração, sem sobreposição", () => {
    const a = janelaDeSemanas("2026-09-28", 4);
    expect(a).toEqual({ inicio: "2026-09-07", fim: "2026-10-04" });
  });
  it("4 semanas: 28 dias; anterior termina na véspera e tem 28 dias", () => {
    const a = janelaDeSemanas("2026-09-28", 4);
    expect(diasDoIntervalo(a.inicio, a.fim)).toHaveLength(28);
    const c = janelaAnterior(a);
    expect(c.fim).toBe("2026-09-06");
    expect(diasDoIntervalo(c.inicio, c.fim)).toHaveLength(28);
    expect(validarPar(a, c, "2026-10-07")).toBeNull();
  });
  it("hoje no fuso do negócio (domingo 22h em São Paulo ainda é domingo)", () => {
    expect(hojeNegocio(new Date("2026-10-12T01:00:00Z"))).toBe("2026-10-11");
  });
});

describe("validação: nunca aceita semana incompleta", () => {
  const hoje = "2026-10-07";
  it("recusa semana em andamento, início fora de segunda, fim fora de domingo", () => {
    expect(validarJanela({ inicio: "2026-10-05", fim: "2026-10-11" }, hoje)).toMatch(/ainda não terminou/);
    expect(validarJanela({ inicio: "2026-09-29", fim: "2026-10-04" }, hoje)).toMatch(/segunda/);
    expect(validarJanela({ inicio: "2026-09-28", fim: "2026-10-03" }, hoje)).toMatch(/domingo/);
    expect(validarJanela({ inicio: "2026-09-21", fim: "2026-10-04" }, hoje)).toBeNull(); // 2 semanas
    expect(validarJanela({ inicio: "2026-09-28", fim: "2026-10-04" }, hoje)).toBeNull();
  });
  it("recusa sobreposição, durações diferentes e datas inválidas", () => {
    expect(validarPar({ inicio: "2026-09-28", fim: "2026-10-04" }, { inicio: "2026-09-28", fim: "2026-10-04" }, hoje)).toMatch(/sobrepor/);
    expect(validarPar({ inicio: "2026-09-21", fim: "2026-10-04" }, { inicio: "2026-09-14", fim: "2026-09-20" }, hoje)).toMatch(/mesma duração/);
    expect(validarJanela({ inicio: "lixo", fim: "2026-10-04" }, hoje)).toMatch(/inválidas/);
  });
});

describe("cobertura de dados", () => {
  const j = { inicio: "2026-09-28", fim: "2026-10-04" };
  it("base cobre por inteiro / parcialmente / não cobre", () => {
    expect(coberturaDaBase({ min: "2026-01-01", max: "2026-10-04" }, j)).toBe("completa");
    expect(coberturaDaBase({ min: "2026-01-01", max: "2026-10-02" }, j)).toBe("parcial");
    expect(coberturaDaBase({ min: "2026-09-30", max: "2026-10-10" }, j)).toBe("parcial");
    expect(coberturaDaBase({ min: "2026-01-01", max: "2026-09-20" }, j)).toBe("sem-dados");
    expect(coberturaDaBase({ min: null, max: null }, j)).toBe("sem-dados");
  });
  it("faturamento: precisa dos 7 dias", () => {
    const dias = diasDoIntervalo(j.inicio, j.fim);
    expect(coberturaFaturamento(dias, j)).toBe("completa");
    expect(coberturaFaturamento(dias.slice(0, 5), j)).toBe("parcial");
    expect(coberturaFaturamento([], j)).toBe("sem-dados");
  });
});

describe("situação (menor = melhorou)", () => {
  it("decide pelo % quando existe nos dois períodos, mesmo que o valor suba", () => {
    // valor sobe (100 → 120) mas o faturamento subiu mais: % cai (1,00% → 0,80%)
    expect(situacaoSemanal({ valorAtual: 120, valorAnterior: 100, percentualAtual: 0.8, percentualAnterior: 1 }).situacao).toBe("melhorou");
    expect(situacaoSemanal({ valorAtual: 80, valorAnterior: 100, percentualAtual: 1.2, percentualAnterior: 1 })).toEqual({ situacao: "piorou", base: "percentual" });
  });
  it("sem % válido, decide pelo valor; zero nos dois = sem ocorrência; null = sem base (nunca zero)", () => {
    expect(situacaoSemanal({ valorAtual: 90, valorAnterior: 100, percentualAtual: null, percentualAnterior: 1 })).toEqual({ situacao: "melhorou", base: "valor" });
    expect(situacaoSemanal({ valorAtual: 0, valorAnterior: 0, percentualAtual: 0, percentualAnterior: 0 }).situacao).toBe("sem-ocorrencia");
    expect(situacaoSemanal({ valorAtual: 10, valorAnterior: null, percentualAtual: 1, percentualAnterior: null }).situacao).toBe("sem-base");
    expect(situacaoSemanal({ valorAtual: null, valorAnterior: 10, percentualAtual: null, percentualAnterior: 1 }).situacao).toBe("sem-base");
  });
  it("igual no arredondamento do painel = estável", () => {
    expect(situacaoSemanal({ valorAtual: 10, valorAnterior: 12, percentualAtual: 1.001, percentualAnterior: 1.004 }).situacao).toBe("estavel");
  });
});

// ── montagem ──
const ATUAL = { inicio: "2026-09-28", fim: "2026-10-04" };
const ANT = { inicio: "2026-09-21", fim: "2026-09-27" };
const base = { min: "2026-01-01", max: "2026-10-04" };

function entrada(sobre: Partial<EntradaResumoSemanal> = {}): EntradaResumoSemanal {
  const fat = (codigo: string, j: { inicio: string; fim: string }, v: number) => diasDoIntervalo(j.inicio, j.fim).map((data) => ({ codigo, data, valor: v }));
  return {
    atual: ATUAL,
    comparacao: ANT,
    // BG 01: 1.000/dia (7.000/sem) nas duas semanas; BG 02: 2.000/dia atual, 1.000/dia anterior
    faturamento: [...fat("BG 01", ATUAL, 1000), ...fat("BG 01", ANT, 1000), ...fat("BG 02", ATUAL, 2000), ...fat("BG 02", ANT, 1000)],
    brindes: [],
    cancelamentoSalao: [
      { codigo: "BG 01", data: "2026-09-29", motivo: "MOT 01", valor: 70 },
      { codigo: "BG 01", data: "2026-09-22", motivo: "MOT 01", valor: 35 },
    ],
    cancelamentoDelivery: [{ codigo: "BG 01", data: "2026-09-30", motivo: "MOT 02", valor: 30 }],
    compraDireta: [
      { codigo: "BG 01", data: "2026-09-29", motivo: "MATERIAL", valor: 140 },
      { codigo: "BG 01", data: "2026-09-29", motivo: "NOTA FISCAL", valor: 999 },
      { codigo: "BG 01", data: "2026-09-22", motivo: "MATERIAL", valor: 70 },
      { codigo: "BG 02", data: "2026-09-30", motivo: "MATERIAL", valor: 200 },
    ],
    quebra: [
      { unidade: "BG 01", data: "2026-10-01", operador: "A", cpf: "1", motivo: "FALTA", valor: 50 },
      { unidade: "BG 02", data: "2026-09-23", operador: "B", cpf: "2", motivo: "FALTA", valor: 40 },
    ],
    bases: { faturamento: base, brindes: base, cancelamentoSalao: base, cancelamentoDelivery: base, compraDireta: base, quebra: base },
    ...sobre,
  };
}
const ind = (r: ReturnType<typeof montarResumoSemanal>, id: string) => r.indicadores.find((i) => i.id === id)!;

describe("montarResumoSemanal", () => {
  const r = montarResumoSemanal(entrada());

  it("filtra só os dias de cada janela (sem vazar dia de outra semana)", () => {
    expect(ind(r, "cancelamentos").atual.valor).toBe(100); // 70 + 30
    expect(ind(r, "cancelamentos").anterior.valor).toBe(35);
    expect(r.avisos).toEqual([]);
  });

  it("Compra Direta: NOTA FISCAL fica fora da saída real, informada à parte", () => {
    const cd = ind(r, "compraDireta");
    expect(cd.atual.valor).toBe(340); // 140 + 200, sem os 999
    expect(cd.atual.detalhes.find((d) => d.foraDoTotal)?.valor).toBe(999);
    expect(cd.anterior.valor).toBe(70);
  });

  it("% sobre o faturamento da rede e variações", () => {
    const c = ind(r, "cancelamentos"); // fat atual 21.000, anterior 14.000
    expect(c.atual.faturamento).toBe(21000);
    expect(c.atual.percentual).toBeCloseTo((100 / 21000) * 100, 9);
    expect(c.anterior.percentual).toBeCloseTo((35 / 14000) * 100, 9);
    expect(c.variacaoReais).toBe(65);
    expect(c.variacaoPercentual).toBeCloseTo((65 / 35) * 100, 9);
    expect(c.variacaoPp).toBeCloseTo((100 / 21000 - 35 / 14000) * 100, 9);
    expect(c.situacao).toBe("piorou");
    expect(c.base).toBe("percentual");
  });

  it("rede = soma das lojas", () => {
    for (const i of r.indicadores) {
      expect(i.porLoja.reduce((s, l) => s + (l.atual.valor ?? 0), 0)).toBeCloseTo(i.atual.valor ?? 0, 2);
      expect(i.porLoja.reduce((s, l) => s + (l.anterior.valor ?? 0), 0)).toBeCloseTo(i.anterior.valor ?? 0, 2);
    }
  });

  it("valor maior não significa pior: BG 02 tem valor maior, mas % menor que BG 01", () => {
    const cd = ind(r, "compraDireta");
    const bg01 = cd.porLoja.find((l) => l.unidade === "BG 01")!;
    const bg02 = cd.porLoja.find((l) => l.unidade === "BG 02")!;
    expect(bg02.atual.valor).toBe(200);
    expect(bg01.atual.valor).toBe(140);
    expect(bg02.atual.percentual!).toBeLessThan(bg01.atual.percentual!); // 200/14000 < 140/7000
    expect(bg01.situacao).toBe("piorou"); // dobrou o valor com o mesmo faturamento
  });

  it("loja com base completa e sem linha = zero real (melhorou/sem ocorrência), não sem-dado", () => {
    const q = ind(r, "quebra");
    const bg02 = q.porLoja.find((l) => l.unidade === "BG 02")!;
    expect(bg02.atual.valor).toBe(0);
    expect(bg02.anterior.valor).toBe(40);
    expect(bg02.situacao).toBe("melhorou");
  });

  it("Brindes: situação pelos controláveis; total e detalhes exibidos", () => {
    const rb = montarResumoSemanal(
      entrada({
        brindes: [
          { codigo: "BG 01", data: "2026-09-29", motivo: "BRINDE PRESENTE", motivo2: "", valor: 70 },
          { codigo: "BG 01", data: "2026-09-29", motivo: "DESCONTO EMPRESAS", motivo2: "", valor: 500 },
          { codigo: "BG 01", data: "2026-09-22", motivo: "BRINDE PRESENTE", motivo2: "", valor: 70 },
        ],
      })
    );
    const b = ind(rb, "brindes");
    expect(b.atual.valor).toBe(b.atual.detalhes.reduce((s, d) => s + d.valor, 0));
    expect(b.atual.valorDecisivo).toBe(b.atual.detalhes.find((d) => d.rotulo === "Controláveis")!.valor);
    // controláveis iguais em R$, faturamento da rede maior → % controláveis cai → melhorou
    expect(b.situacao).toBe("melhorou");
  });

  it("base que não cobre o período → null (nunca zero) + aviso", () => {
    const rq = montarResumoSemanal(entrada({ bases: { ...entrada().bases, quebra: { min: "2026-09-25", max: "2026-10-04" } } }));
    const q = ind(rq, "quebra");
    expect(q.coberturaAnterior).toBe("parcial");
    expect(q.anterior.valor).toBeNull();
    expect(q.anterior.percentual).toBeNull();
    expect(q.situacao).toBe("sem-base");
    expect(q.variacaoReais).toBeNull();
    expect(rq.avisos.some((a) => a.indicador === "quebra" && a.periodo === "comparacao")).toBe(true);
    expect(q.atual.valor).toBe(50);
  });

  it("faturamento incompleto: R$ continua, % some (sem dividir por base parcial)", () => {
    const rf = montarResumoSemanal(entrada({ faturamento: entrada().faturamento.filter((l) => l.data !== "2026-10-02") }));
    const c = ind(rf, "cancelamentos");
    expect(c.atual.valor).toBe(100);
    expect(c.atual.percentual).toBeNull();
    expect(c.variacaoPp).toBeNull();
    expect(c.base).toBe("valor");
    expect(rf.coberturaFaturamento.atual).toBe("parcial");
    expect(rf.avisos.some((a) => a.indicador === "faturamento")).toBe(true);
  });

  it("área de atenção: rankings e 'piora' só para quem piorou", () => {
    const l01 = r.lojas.find((l) => l.unidade === "BG 01")!;
    expect(l01.atencao.some((a) => a.indicador === "quebra" && a.motivo === "maior-percentual" && a.posicao === 1)).toBe(true);
    expect(r.lojas[0].atencao.length).toBeGreaterThanOrEqual(r.lojas[r.lojas.length - 1].atencao.length);
    for (const l of r.lojas) for (const a of l.atencao.filter((x) => x.motivo === "piora")) expect(l.porIndicador[a.indicador]?.situacao).toBe("piorou");
  });

  it("loja sem faturamento em um dos períodos (rede completa) fica sem base — nunca melhora/piora", () => {
    const e = entrada();
    const rn = montarResumoSemanal({
      ...e,
      faturamento: e.faturamento.filter((l) => !(l.codigo === "BG 02" && l.data >= "2026-09-21" && l.data <= "2026-09-27")),
    });
    const bg02 = ind(rn, "compraDireta").porLoja.find((l) => l.unidade === "BG 02")!;
    expect(bg02.anterior.percentual).toBeNull();
    expect(bg02.situacao).toBe("sem-base");
    expect(ind(rn, "compraDireta").porLoja.find((l) => l.unidade === "BG 01")!.situacao).toBe("piorou");
    expect(rn.lojas.find((l) => l.unidade === "BG 02")!.atencao.filter((a) => a.motivo === "piora")).toEqual([]);
  });

  it("loja com faturamento em menos dias: mantém R$, sem % e sem ranking proporcional; aviso de cobertura", () => {
    const e = entrada();
    const rp = montarResumoSemanal({ ...e, faturamento: e.faturamento.filter((l) => !(l.codigo === "BG 02" && (l.data === "2026-09-28" || l.data === "2026-09-29"))) });
    const bg02 = ind(rp, "compraDireta").porLoja.find((l) => l.unidade === "BG 02")!;
    expect(bg02.coberturaParcial).toBe(true);
    expect(bg02.atual.valor).toBe(200); // valor absoluto preservado
    expect(bg02.atual.percentual).toBeNull();
    expect(bg02.situacao).toBe("sem-base");
    expect(rp.avisosLojas).toEqual([{ unidade: "BG 02", periodo: "atual", diasComFaturamento: 5, dias: 7 }]);
    const l02 = rp.lojas.find((l) => l.unidade === "BG 02")!;
    expect(l02.atencao.filter((a) => a.motivo !== "maior-valor")).toEqual([]);
    expect(l02.atencao.some((a) => a.motivo === "maior-valor")).toBe(true);
    // rede segue com faturamento completo e a outra loja continua com %
    expect(ind(rp, "compraDireta").porLoja.find((l) => l.unidade === "BG 01")!.atual.percentual).not.toBeNull();
  });

  it("Quebra: informa dias sem registro (lidos como sem ocorrência)", () => {
    const q = ind(r, "quebra");
    expect(q.diasSemRegistro).toEqual({ atual: 6, anterior: 6, dias: 7 }); // atual: só 01/10; anterior: só 23/09
  });

  it("duas semanas por período: 14 dias vs 14 dias anteriores", () => {
    const a = janelaDeSemanas("2026-09-28", 2);
    const c = janelaAnterior(a);
    const rr = montarResumoSemanal(entrada({ atual: a, comparacao: c }));
    expect(rr.semanas).toBe(2);
    // faturamento só existe a partir de 21/09: a janela anterior (07–20/09) fica sem faturamento → aviso, sem % e sem inventar valor
    expect(rr.coberturaFaturamento.comparacao).toBe("sem-dados");
    expect(ind(rr, "cancelamentos").anterior.percentual).toBeNull();
  });
});
