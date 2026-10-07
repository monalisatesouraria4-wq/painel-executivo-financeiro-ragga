import { describe, expect, it } from "vitest";
import { compararMotivosCancelados, lojasDoMotivo, motivosCancelados, percentualCancelamentoValido, situacaoPorPercentual } from "@/lib/services/cancelamentoAnalise";
import {
  agruparFamiliaCMO,
  aplicarSituacaoPorValor,
  aplicarSituacaoPorValorLojas,
  ajustesSemSaidaPorLoja,
  baseCobreOsPeriodos,
  comparabilidadeCompraDireta,
  contagemStatusValida,
  ehMotivoFamiliaCMO,
  linhasLojasCompraDireta,
  ordenarLojasCompraDireta,
  PREFIXO_FAMILIA_CMO,
  situacaoPorValor,
} from "@/lib/services/compraDiretaAnalise";
import { diasDoIntervalo, montarPeriodoCompraDireta, statusDoPercentual, type CompraDiretaPainelData } from "@/lib/services/compraDiretaPainel";

const ATUAL = { inicio: "2026-09-28", fim: "2026-10-04" };
const ANT = { inicio: "2026-09-21", fim: "2026-09-27" };
const fat = (codigo: string, j: { inicio: string; fim: string }, v: number, pular: string[] = []) =>
  diasDoIntervalo(j.inicio, j.fim)
    .filter((d) => !pular.includes(d))
    .map((data) => ({ codigo, data, valor: v }));
const c = (codigo: string, data: string, motivo: string, valor: number) => ({ codigo, data, motivo, valor });

// BG 01: 70.000 · BG 02: 140.000 (atual) / 70.000 (anterior) · MAPOLI: 5 dias com faturamento (parcial)
const fatAtual = [...fat("BG 01", ATUAL, 10000), ...fat("BG 02", ATUAL, 20000), ...fat("MAPOLI", ATUAL, 3000, ["2026-09-28", "2026-09-29"])];
const fatAnt = [...fat("BG 01", ANT, 10000), ...fat("BG 02", ANT, 10000), ...fat("MAPOLI", ANT, 3000, ["2026-09-21", "2026-09-22"])];

const linhasAtual = [
  c("BG 01", "2026-09-29", "CMO/FREE", 3000),
  c("BG 01", "2026-09-30", "CMO/ENDOMARKETING", 600),
  c("BG 01", "2026-10-01", "SEGURANÇA", 400),
  c("BG 01", "2026-10-02", "SUPRIMENTO/EMPRÉSTIMO", 200), // permanece na retirada real
  c("BG 01", "2026-10-02", "NOTA FISCAL", 999), // ajuste sem saída de caixa
  c("BG 02", "2026-09-30", "CMO/FREE", 8000),
  c("BG 02", "2026-10-01", "OPEX", 1000),
  c("BG 02", "2026-10-03", "CMV", 1000),
  c("MAPOLI", "2026-10-01", "CMV", 300),
];
const linhasAnt = [
  c("BG 01", "2026-09-22", "CMO/FREE", 2500),
  c("BG 01", "2026-09-23", "SEGURANÇA", 500),
  c("BG 01", "2026-09-24", "NOTA FISCAL", 100),
  c("BG 02", "2026-09-23", "CMO/FREE", 6000),
  c("BG 02", "2026-09-24", "CMV", 800),
];

const pA = montarPeriodoCompraDireta(ATUAL.inicio, ATUAL.fim, fatAtual, linhasAtual);
const pC = montarPeriodoCompraDireta(ANT.inicio, ANT.fim, fatAnt, linhasAnt);
const dados = (atual = pA, comparacao = pC, sobre: Partial<CompraDiretaPainelData> = {}): CompraDiretaPainelData => ({
  conectado: true,
  cobertura: { min: "2026-06-01", max: "2026-10-04" },
  atual,
  comparacao,
  ...sobre,
});

describe("reconciliação: motivos e lojas fecham com o total da retirada real", () => {
  const m = motivosCancelados(pA);

  it("soma dos motivos originais = total de retirada real (SUPRIMENTO/EMPRÉSTIMO dentro; Nota Fiscal fora)", () => {
    expect(pA.valor).toBe(14500); // 4.200 + 10.000 + 300
    expect(m.reduce((s, x) => s + x.valor, 0)).toBeCloseTo(pA.valor, 2);
    expect(m.find((x) => x.motivo === "SUPRIMENTO/EMPRÉSTIMO")?.valor).toBe(200);
    expect(m.some((x) => x.motivo === "NOTA FISCAL")).toBe(false);
  });

  it("nomes dos motivos preservados exatamente como na base", () => {
    expect(m.map((x) => x.motivo).sort()).toEqual(["CMO/ENDOMARKETING", "CMO/FREE", "CMV", "OPEX", "SEGURANÇA", "SUPRIMENTO/EMPRÉSTIMO"].sort());
  });

  it("soma das lojas = total de retirada real", () => {
    expect(linhasLojasCompraDireta(pA, pC, true).reduce((s, l) => s + l.valor, 0)).toBeCloseTo(pA.valor, 2);
    for (const l of pA.porLoja) {
      expect(m.flatMap((x) => x.lojas).filter((x) => x.unidade === l.unidade).reduce((s, x) => s + x.valor, 0)).toBeCloseTo(l.valor, 2);
    }
  });

  it("participação por motivo = 100% (tolerância numérica); lojas de cada motivo somam o motivo", () => {
    expect(m.reduce((s, x) => s + x.percentualDoTotal, 0)).toBeCloseTo(100, 6);
    for (const x of m) expect(x.lojas.reduce((s, l) => s + l.valor, 0)).toBeCloseTo(x.valor, 2);
  });
});

describe("Nota Fiscal = ajuste sem saída de caixa (fora de total, %, ranking e status)", () => {
  it("fora da retirada real e do % sobre o faturamento; valor mantido à parte", () => {
    expect(pA.ajustesSemSaida).toBe(999);
    expect(pA.totalLancado).toBe(14500 + 999);
    const bg01 = pA.porLoja.find((l) => l.unidade === "BG 01")!;
    expect(bg01.valor).toBe(4200);
    expect(bg01.percentual).toBeCloseTo((4200 / 70000) * 100, 9); // sem os 999
    expect(bg01.ajustesSemSaida).toBe(999);
  });

  it("não entra nas linhas por loja (valor), no ranking nem no status; aparece só no bloco próprio", () => {
    const linhas = linhasLojasCompraDireta(pA, pC, true);
    expect(linhas.find((l) => l.unidade === "BG 01")?.valor).toBe(4200);
    expect(ordenarLojasCompraDireta(linhas, "valor")[0].unidade).toBe("BG 02");
    const aj = ajustesSemSaidaPorLoja(pA, pC, true);
    expect(aj).toEqual([{ unidade: "BG 01", atual: 999, comparado: 100 }]);
    expect(ajustesSemSaidaPorLoja(pA, pC, false)[0].comparado).toBeNull(); // sem base → nunca zero
    expect(percentualCancelamentoValido(pA)).toBeCloseTo((14500 / 225000) * 100, 9);
  });

  it("período só com Nota Fiscal: retirada real = 0, não vira retirada", () => {
    const so = montarPeriodoCompraDireta(ANT.inicio, ANT.fim, fatAnt, [c("BG 01", "2026-09-24", "NOTA FISCAL", 500)]);
    expect(so.valor).toBe(0);
    expect(motivosCancelados(so)).toEqual([]);
  });
});

describe("família CMO (subtotal visual por prefixo literal)", () => {
  const linhas = compararMotivosCancelados(pA, pC, true);
  const g = agruparFamiliaCMO(linhas);

  it("reconhece só o prefixo literal 'CMO/' (nada de renomear)", () => {
    expect(PREFIXO_FAMILIA_CMO).toBe("CMO/");
    expect(ehMotivoFamiliaCMO("CMO/FREE")).toBe(true);
    expect(ehMotivoFamiliaCMO("CMO/PAG. DE FERIADO")).toBe(true);
    expect(ehMotivoFamiliaCMO("CMV")).toBe(false);
    expect(ehMotivoFamiliaCMO("SUPRIMENTO/EMPRÉSTIMO")).toBe(false);
    expect(ehMotivoFamiliaCMO("cmo/free")).toBe(false);
  });

  it("subtotal CMO = soma de todos os motivos 'CMO/' (valor, participação, comparado)", () => {
    const fam = g.find((x) => x.tipo === "familia");
    expect(fam?.tipo).toBe("familia");
    if (fam?.tipo !== "familia") return;
    const cmo = linhas.filter((l) => l.motivo.startsWith("CMO/"));
    expect(fam.filhos.map((f) => f.motivo).sort()).toEqual(cmo.map((l) => l.motivo).sort());
    expect(fam.subtotal.atual).toBe(cmo.reduce((s, l) => s + l.atual, 0)); // 3.000 + 600 + 8.000
    expect(fam.subtotal.atual).toBe(11600);
    expect(fam.subtotal.comparado).toBe(8500); // 2.500 + 6.000
    expect(fam.subtotal.percentualDoTotal).toBeCloseTo(cmo.reduce((s, l) => s + l.percentualDoTotal, 0), 9);
    expect(fam.subtotal.percentualFaturamento).toBeCloseTo((11600 / 225000) * 100, 9);
  });

  it("a visão agrupada não duplica valores: o subtotal substitui os componentes e o total é o mesmo", () => {
    const topo = g.map((x) => (x.tipo === "familia" ? x.subtotal : x.linha));
    expect(topo.reduce((s, l) => s + l.atual, 0)).toBeCloseTo(pA.valor, 2);
    expect(topo.reduce((s, l) => s + l.percentualDoTotal, 0)).toBeCloseTo(100, 6);
    expect(topo.some((l) => l.motivo.startsWith("CMO/"))).toBe(false); // filhos só dentro da família
    expect(g.filter((x) => x.tipo === "familia")).toHaveLength(1);
  });

  it("sem motivos CMO/ não cria família; ordenação do topo pelo valor", () => {
    const sem = agruparFamiliaCMO(linhas.filter((l) => !l.motivo.startsWith("CMO/")));
    expect(sem.every((x) => x.tipo === "motivo")).toBe(true);
    const valores = g.map((x) => (x.tipo === "familia" ? x.subtotal.atual : x.linha.atual));
    expect(valores).toEqual([...valores].sort((a, b) => b - a));
  });

  it("comparado inválido: subtotal sem base (null), nunca zero", () => {
    const fam = agruparFamiliaCMO(compararMotivosCancelados(pA, pC, false)).find((x) => x.tipo === "familia");
    if (fam?.tipo !== "familia") throw new Error("família esperada");
    expect([fam.subtotal.comparado, fam.subtotal.variacaoReais, fam.subtotal.variacaoPp]).toEqual([null, null, null]);
    expect(fam.subtotal.situacao).toBe("sem-base");
  });
});

describe("cobertura e comparabilidade", () => {
  it("base e faturamento completos → comparação válida", () => {
    expect(baseCobreOsPeriodos(dados())).toBe(true);
    expect(comparabilidadeCompraDireta(dados()).valida).toBe(true);
  });

  it("base que não cobre o comparado → inválida e sem variações", () => {
    const d = dados(pA, pC, { cobertura: { min: "2026-09-25", max: "2026-10-04" } });
    const r = comparabilidadeCompraDireta(d);
    expect(r.valida).toBe(false);
    expect(r.motivo).toMatch(/não cobre/);
    expect(linhasLojasCompraDireta(pA, pC, baseCobreOsPeriodos(d)).every((l) => l.comparado === null && l.variacaoReais === null && l.variacaoPp === null)).toBe(true);
    const motivos = aplicarSituacaoPorValor(compararMotivosCancelados(pA, pC, false));
    expect(motivos.every((x) => x.comparado === null && x.situacao === "sem-base")).toBe(true); // sem base: nunca zero nem status
  });

  it("faturamento da rede com dia faltando → % e comparação inválidos (valor absoluto mantido)", () => {
    const semDia = montarPeriodoCompraDireta(ANT.inicio, ANT.fim, [...fat("BG 01", ANT, 10000, ["2026-09-23"]), ...fat("BG 02", ANT, 10000, ["2026-09-23"])], linhasAnt);
    const r = comparabilidadeCompraDireta(dados(pA, semDia));
    expect(r.valida).toBe(false);
    expect(r.motivo).toMatch(/Faturamento incompleto/);
    expect(percentualCancelamentoValido(semDia)).toBeNull();
    // valor absoluto continua calculado
    expect(semDia.valor).toBeGreaterThan(0);
  });

  it("escopo de loja usa o faturamento da loja; período comparado sem registros → inválido", () => {
    expect(comparabilidadeCompraDireta(dados(), "BG 01").valida).toBe(true);
    const vazio = montarPeriodoCompraDireta(ANT.inicio, ANT.fim, fatAnt, []);
    expect(comparabilidadeCompraDireta(dados(pA, vazio)).valida).toBe(false);
  });
});

describe("comparativo por loja: status, cobertura parcial e ausência de faturamento", () => {
  const linhas = linhasLojasCompraDireta(pA, pC, true);
  const por = (u: string) => linhas.find((l) => l.unidade === u)!;

  it("faixas de status continuam as existentes (até 5% controlado; até 7% atenção; acima crítico)", () => {
    expect(statusDoPercentual(5).status).toBe("controlado");
    expect(statusDoPercentual(5.01).status).toBe("atencao");
    expect(statusDoPercentual(7).status).toBe("atencao");
    expect(statusDoPercentual(7.01).status).toBe("critico");
    expect(por("BG 01").percentual).toBeCloseTo(6, 9);
    expect(por("BG 01").status).toBe("atencao");
    expect(por("BG 02").percentual).toBeCloseTo((10000 / 140000) * 100, 9);
    expect(por("BG 02").status).toBe("critico");
  });

  it("loja com faturamento em menos dias: sem %, sem comparação; R$ preservado; fora da contagem de status", () => {
    const m = por("MAPOLI");
    expect(m.coberturaParcial).toBe(true);
    expect([m.diasComFaturamento, m.diasDoPeriodo]).toEqual([5, 7]);
    expect([m.percentual, m.comparado, m.variacaoReais, m.variacaoPp]).toEqual([null, null, null, null]);
    expect(m.valor).toBe(300);
    const cont = contagemStatusValida(linhas);
    expect(cont).toEqual({ controlado: 0, atencao: 1, critico: 1, semCobertura: 1, comCobertura: 2 });
  });

  it("ausência de faturamento não vira % nem status: loja sem nenhum faturamento fica com percentual null", () => {
    const sem = montarPeriodoCompraDireta(ATUAL.inicio, ATUAL.fim, [...fat("BG 01", ATUAL, 10000)], [c("BG 02", "2026-09-30", "CMV", 500), c("BG 01", "2026-09-30", "CMV", 100)]);
    const l = linhasLojasCompraDireta(sem, pC, true).find((x) => x.unidade === "BG 02")!;
    expect(l.diasComFaturamento).toBe(0);
    expect(l.percentual).toBeNull();
    expect(l.coberturaParcial).toBe(true);
    expect(l.valor).toBe(500);
    expect(contagemStatusValida(linhasLojasCompraDireta(sem, pC, true)).semCobertura).toBe(1);
  });

  it("loja: status pelas faixas 5% / 7% e variação factual; p.p. à parte (sem situação inventada)", () => {
    // BG 02: 10.000 ÷ 140.000 = 7,14% (crítico) × 6.800 ÷ 70.000 = 9,71% → o % caiu 2,57 p.p., mas o valor em R$ subiu 3.200
    const l = por("BG 02");
    expect(l.variacaoReais).toBe(3200);
    expect(l.variacaoPp).toBeCloseTo((10000 / 140000) * 100 - (6800 / 70000) * 100, 9);
    expect(l.variacaoPp!).toBeLessThan(0);
    expect(l.status).toBe("critico");
    // BG 01: 4.200 ÷ 70.000 = 6,00% (atenção) × 3.000 ÷ 70.000 = 4,29% → +1,71 p.p.
    expect(por("BG 01").status).toBe("atencao");
    expect(por("BG 01").variacaoPp).toBeCloseTo(6 - (3000 / 70000) * 100, 9);
  });

  it("ordenação: valor, % e variação independentes; sem % por último", () => {
    expect(ordenarLojasCompraDireta(linhas, "valor").map((l) => l.unidade)).toEqual(["BG 02", "BG 01", "MAPOLI"]);
    expect(ordenarLojasCompraDireta(linhas, "percentual").map((l) => l.unidade)).toEqual(["BG 02", "BG 01", "MAPOLI"]);
    expect(ordenarLojasCompraDireta(linhas, "variacao").map((l) => l.unidade).at(-1)).toBe("MAPOLI");
    expect(ordenarLojasCompraDireta(linhas, "criticidade").map((l) => l.unidade)).toEqual(["BG 02", "BG 01", "MAPOLI"]);
    expect(ordenarLojasCompraDireta(linhas, "loja").map((l) => l.unidade)).toEqual(["BG 01", "BG 02", "MAPOLI"]);
  });
});

describe("investigar por motivo (motivo original)", () => {
  it("lojas do motivo somam o motivo; participação 100%; chave original preservada", () => {
    const lojas = lojasDoMotivo("CMO/FREE", pA, pC, true);
    expect(lojas.reduce((s, l) => s + l.valor, 0)).toBe(11000);
    expect(lojas.reduce((s, l) => s + l.percentualDoMotivo, 0)).toBeCloseTo(100, 6);
    expect(lojas.map((l) => l.unidade)).toEqual(["BG 02", "BG 01"]);
  });

  it("SUPRIMENTO/EMPRÉSTIMO pode ser investigado; Nota Fiscal não é um motivo da retirada real", () => {
    expect(lojasDoMotivo("SUPRIMENTO/EMPRÉSTIMO", pA, pC, true).map((l) => l.valor)).toEqual([200]);
    expect(lojasDoMotivo("NOTA FISCAL", pA, pC, true)).toEqual([]);
  });

  it("cobertura parcial da loja: sem % nem comparação; base inválida: sem comparado", () => {
    const mapoli = lojasDoMotivo("CMV", pA, pC, true).find((l) => l.unidade === "MAPOLI")!;
    expect([mapoli.faturamento, mapoli.percentualFaturamento, mapoli.comparado]).toEqual([null, null, null]);
    expect(aplicarSituacaoPorValorLojas([mapoli])[0].situacao).toBe("sem-base"); // sem comparado → sem status inventado
    expect(mapoli.valor).toBe(300);
    expect(lojasDoMotivo("CMV", pA, pC, false).every((l) => l.comparado === null)).toBe(true);
  });
});

describe("situação por motivo = valor em R$ (regra existente da Compra Direta)", () => {
  it("valor menor = melhorou; maior = piorou; diferença < R$ 0,005 = estável; sem comparado = sem base", () => {
    expect(situacaoPorValor(90, 100)).toBe("melhorou");
    expect(situacaoPorValor(110, 100)).toBe("piorou");
    expect(situacaoPorValor(100.004, 100)).toBe("estavel");
    expect(situacaoPorValor(100, 100)).toBe("estavel");
    expect(situacaoPorValor(100.006, 100)).toBe("piorou");
    expect(situacaoPorValor(100, null)).toBe("sem-base");
    expect(situacaoPorValor(0, null)).toBe("sem-base"); // ausência de base nunca vira "zero = melhorou"
  });

  it("decisão pelo valor em R$, independente do % sobre o faturamento", () => {
    // CMV: atual 1.300 (1.000 + 300) × anterior 800 → valor subiu; % da rede: 1.300/225.000 (0,58%) × 800/155.000 (0,52%)
    const m = aplicarSituacaoPorValor(compararMotivosCancelados(pA, pC, true));
    const cmv = m.find((x) => x.motivo === "CMV")!;
    expect([cmv.atual, cmv.comparado]).toEqual([1300, 800]);
    expect(cmv.situacao).toBe("piorou");
    // construção explícita: valor sobe, % cai → pela regra existente continua "piorou"
    expect(situacaoPorValor(120, 100)).toBe("piorou");
    expect(situacaoPorPercentual({ valorAtual: 120, valorComparado: 100, percentualAtual: 0.8, percentualComparado: 1 })).toBe("melhorou"); // a regra de Cancelamentos NÃO é a usada aqui
  });

  it("motivo que só existia no comparado: atual 0 vs comparado > 0 = melhorou; novo no atual = piorou", () => {
    const m = aplicarSituacaoPorValor(compararMotivosCancelados(pA, pC, true));
    const novo = m.find((x) => x.motivo === "OPEX")!; // não existia no comparado → 0 real (base cobre)
    expect([novo.atual, novo.comparado, novo.situacao]).toEqual([1000, 0, "piorou"]);
    const so = montarPeriodoCompraDireta(ANT.inicio, ANT.fim, fatAnt, [...linhasAnt, c("BG 01", "2026-09-25", "FIXAS", 40)]);
    const f = aplicarSituacaoPorValor(compararMotivosCancelados(pA, so, true)).find((x) => x.motivo === "FIXAS")!;
    expect([f.atual, f.comparado, f.situacao]).toEqual([0, 40, "melhorou"]);
  });

  it("% sobre o faturamento e p.p. continuam disponíveis à parte (só com cobertura) e a situação não depende deles", () => {
    const ok = aplicarSituacaoPorValor(compararMotivosCancelados(pA, pC, true)).find((x) => x.motivo === "CMO/FREE")!;
    expect(ok.percentualFaturamento).toBeCloseTo((11000 / 225000) * 100, 9);
    expect(ok.percentualFaturamentoComparado).toBeCloseTo((8500 / 155000) * 100, 9);
    expect(ok.variacaoPp).not.toBeNull();
    expect(ok.situacao).toBe("piorou"); // 11.000 > 8.500
    // faturamento do comparado incompleto: % comparado e p.p. somem, mas o comparado em R$ (base válida) segue → situação por valor
    const semDia = montarPeriodoCompraDireta(ANT.inicio, ANT.fim, [...fat("BG 01", ANT, 10000, ["2026-09-23"]), ...fat("BG 02", ANT, 10000, ["2026-09-23"])], linhasAnt);
    expect(comparabilidadeCompraDireta(dados(pA, semDia)).valida).toBe(false);
    const inv = aplicarSituacaoPorValor(compararMotivosCancelados(pA, semDia, false)).find((x) => x.motivo === "CMO/FREE")!;
    expect([inv.comparado, inv.percentualFaturamentoComparado, inv.variacaoPp, inv.situacao]).toEqual([null, null, null, "sem-base"]);
    expect(inv.atual).toBe(11000); // valor absoluto mantido
  });

  it("subtotal da família CMO também segue o valor em R$", () => {
    const fam = agruparFamiliaCMO(aplicarSituacaoPorValor(compararMotivosCancelados(pA, pC, true))).find((x) => x.tipo === "familia");
    if (fam?.tipo !== "familia") throw new Error("família esperada");
    expect([fam.subtotal.atual, fam.subtotal.comparado, fam.subtotal.situacao]).toEqual([11600, 8500, "piorou"]);
  });

  it("Cancelamentos não é afetado: a mesma estrutura continua sendo avaliada pelo % (regra própria)", () => {
    const porPct = compararMotivosCancelados(pA, pC, true).find((x) => x.motivo === "CMV")!;
    // CMV: valor 1.300 × 800 (↑) e % 0,58% × 0,52% (↑) → ambos "piorou" aqui; a função compartilhada segue pelo % (situacaoPorPercentual)
    expect(porPct.situacao).toBe(
      situacaoPorPercentual({ valorAtual: porPct.atual, valorComparado: porPct.comparado, percentualAtual: porPct.percentualFaturamento, percentualComparado: porPct.percentualFaturamentoComparado })
    );
  });
});
