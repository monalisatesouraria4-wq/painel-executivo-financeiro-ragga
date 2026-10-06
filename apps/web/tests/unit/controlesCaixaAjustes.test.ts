import { describe, expect, it } from "vitest";
import { agregarQuebra, ordenarLojasQuebra, situacaoLojaQuebra, situacaoQuebraDetalhada } from "@/lib/services/quebraPainel";
import { agregarFechamento, percentualDivergenciaPdv, recortarLojaPainel, redeFechamento } from "@/lib/services/controlesLojaPainel";
import {
  classificarCaixaTroco,
  ehCaixaSemConferencia,
  lojasSemValorDeConferencia,
  rankingFaltasPorLoja,
  resumirTroco,
  resumirTrocoQuebraEConferencia,
  tipoSemValorDoCaixa,
  tipoSemValorPorLojaData,
  type CaixaTrocoLoja,
} from "@/lib/services/trocoIndicadores";
import { filtrarLinhasPorStatus, resumirLinhasFechamento, type CaixaAberturaFechamentoLinha } from "@/lib/services/aberturaFechamento";

describe("Quebra de Caixa — situação detalhada do comparativo", () => {
  const base = { valorAtual: 100, valorComparado: 80, metricaAtual: 1, metricaComparada: 0.8, baseValida: true };

  it("melhorou = a métrica diminuiu; piorou = a métrica aumentou", () => {
    expect(situacaoQuebraDetalhada({ ...base, metricaAtual: 0.5, metricaComparada: 0.8 })).toBe("melhorou");
    expect(situacaoQuebraDetalhada({ ...base, metricaAtual: 1.2, metricaComparada: 0.8 })).toBe("piorou");
  });

  it("estável = há quebra e a métrica é igual no arredondamento de 2 casas (não é 'sem ocorrência')", () => {
    expect(situacaoQuebraDetalhada({ ...base, metricaAtual: 0.8, metricaComparada: 0.8 })).toBe("estavel");
    expect(situacaoQuebraDetalhada({ ...base, metricaAtual: 0.8001, metricaComparada: 0.7999 })).toBe("estavel");
    expect(situacaoQuebraDetalhada({ ...base, metricaAtual: 0.81, metricaComparada: 0.8 })).toBe("piorou");
  });

  it("sem ocorrência = nenhuma quebra nos DOIS períodos (nunca 'sem alteração')", () => {
    expect(situacaoQuebraDetalhada({ valorAtual: 0, valorComparado: 0, metricaAtual: 0, metricaComparada: 0, baseValida: true })).toBe("sem-ocorrencia");
  });

  it("quebra só em um dos períodos NÃO é sem ocorrência", () => {
    expect(situacaoQuebraDetalhada({ valorAtual: 0, valorComparado: 50, metricaAtual: 0, metricaComparada: 0.5, baseValida: true })).toBe("melhorou");
    expect(situacaoQuebraDetalhada({ valorAtual: 50, valorComparado: 0, metricaAtual: 0.5, metricaComparada: 0, baseValida: true })).toBe("piorou");
  });

  it("sem base = base não cobre o período comparado, ou o item não existe lá", () => {
    expect(situacaoQuebraDetalhada({ ...base, baseValida: false })).toBe("sem-base");
    expect(situacaoQuebraDetalhada({ ...base, valorComparado: null, metricaComparada: null })).toBe("sem-base");
    // mesmo com tudo zero, sem base continua sem base (não vira "sem ocorrência")
    expect(situacaoQuebraDetalhada({ valorAtual: 0, valorComparado: 0, metricaAtual: 0, metricaComparada: 0, baseValida: false })).toBe("sem-base");
  });

  it("por loja: decide pelo % sobre o faturamento (valor maior com % menor = melhorou)", () => {
    const l = (unidade: string, operador: string, valor: number) => ({ unidade, operador, cpf: "1", motivo: "X", valor });
    const atual = agregarQuebra([l("BG 01", "A", 200)], { "BG 01": 100000 }); // 0,2%
    const comp = agregarQuebra([l("BG 01", "A", 100)], { "BG 01": 20000 }); // 0,5%
    const a = atual.porLoja[0];
    const c = comp.porLoja[0];
    expect(a.valor).toBeGreaterThan(c.valor);
    expect(situacaoLojaQuebra(a, c, true)).toBe("melhorou");
  });

  it("loja sem registro no comparado (nem faturamento) = sem base; ordenação por performance usa os novos estados", () => {
    const l = (unidade: string, valor: number) => ({ unidade, operador: "A", cpf: "1", motivo: "X", valor });
    const atual = agregarQuebra([l("BG 01", 100), l("BG 02", 10), l("BG 03", 0.0001)], { "BG 01": 10000, "BG 02": 10000, "BG 03": 10000 });
    const comp = agregarQuebra([l("BG 01", 50), l("BG 02", 50)], { "BG 01": 10000, "BG 02": 10000 });
    const lojas = atual.porLoja;
    expect(situacaoLojaQuebra(lojas.find((x) => x.unidade === "BG 03")!, comp.porLoja.find((x) => x.unidade === "BG 03"), true)).toBe("sem-base");
    const ordem = ordenarLojasQuebra(lojas, comp, "performance", true).map((x) => x.unidade);
    expect(ordem[0]).toBe("BG 01"); // piorou
    expect(ordem[ordem.length - 1]).toBe("BG 02"); // melhorou
  });
});

describe("PDV × Maquininha — % de divergência", () => {
  it("(Diferença ÷ Total PDV) × 100 com o sinal da Diferença: exemplo do período atual ≈ −0,45%", () => {
    const p = percentualDivergenciaPdv(-27407.36, 6138871.95)!;
    expect(p).toBeCloseTo(-0.4465, 3);
    expect(p.toFixed(2)).toBe("-0.45");
  });
  it("positivo mantém o sinal; Total PDV zero → sem percentual (nunca divide por zero)", () => {
    expect(percentualDivergenciaPdv(100, 10000)).toBeCloseTo(1, 6);
    expect(percentualDivergenciaPdv(10, 0)).toBeNull();
  });
});

describe("Troco — valor encaminhado para Quebra e caixas sem conferência", () => {
  const c = (conferido: number, informado: number) => ({ conferido, informado, diferenca: Math.round((conferido - informado) * 100) / 100 });

  it("valor encaminhado para Quebra soma só as FALTAS (diferença negativa); sobras não entram", () => {
    const r = resumirTrocoQuebraEConferencia([c(1061.75, 1078.65), c(2817.95, 2820.95), c(1613.25, 1593.3), c(100, 100)]);
    expect(r.valorEncaminhadoParaQuebra).toBeCloseTo(16.9 + 3, 6);
    expect(r.caixasComFalta).toBe(2);
    expect(r.caixasComSobra).toBe(1);
  });

  it("sem conferência = conferido E informado zerados; 0,00 isolado é divergência, não ausência de conferência", () => {
    expect(ehCaixaSemConferencia({ conferido: 0, informado: 0 })).toBe(true);
    expect(ehCaixaSemConferencia({ conferido: 0, informado: 120 })).toBe(false);
    expect(ehCaixaSemConferencia({ conferido: 120, informado: 0 })).toBe(false);
    const r = resumirTrocoQuebraEConferencia([c(0, 0), c(0, 0), c(0, 50), c(50, 50)]);
    expect(r.caixasSemConferencia).toBe(2);
    // "0 conferido, 50 informado" é falta de 50 → entra na Quebra, NÃO em sem conferência
    expect(r.valorEncaminhadoParaQuebra).toBe(50);
  });

  it("sem caixas → zeros (sem erro)", () => {
    expect(resumirTrocoQuebraEConferencia([])).toEqual({ valorEncaminhadoParaQuebra: 0, caixasComFalta: 0, caixasComSobra: 0, caixasSemConferencia: 0 });
  });
});

describe("Fechamento — o card usa o campo DIF. TOTAL", () => {
  const linha = (situacao: string, difTotal: number | null, difFechamento: number | null, unidade = "BG 01"): CaixaAberturaFechamentoLinha => ({
    unidade: unidade as never,
    caixa: "CX",
    movimento: "1",
    operador: null,
    abertura: null,
    fechamento: null,
    situacao,
    fechado: situacao !== "Aberto",
    difFechamento,
    difConciliacao: null,
    difTotal,
  });

  it("soma `difTotal` (não `difFechamento`) e ignora registros sem DIF. TOTAL", () => {
    const linhas = [linha("Conciliado", -5, -50), linha("Conciliado", null, -70), linha("Fechado", -10, -10)];
    expect(resumirLinhasFechamento(linhas).diferencaFinanceira).toBe(-15);
  });
});

describe("Fechamento — card e tabela por loja usam a MESMA fonte (DIF. TOTAL)", () => {
  const l = (unidade: string, situacao: string, difTotal: number | null): CaixaAberturaFechamentoLinha => ({
    unidade: unidade as never,
    caixa: "CX",
    movimento: "1",
    operador: null,
    abertura: null,
    fechamento: null,
    situacao,
    fechado: situacao !== "Aberto",
    difFechamento: difTotal === null ? 555 : difTotal * 3 - 17, // decoy: o campo antigo NÃO pode influenciar
    difConciliacao: null,
    difTotal,
  });
  const linhas = [
    l("BG 01", "Conciliado", -10.5),
    l("BG 01", "Fechado", -40),
    l("BG 01", "Conciliado", null), // sem DIF. TOTAL: não entra em nenhuma soma
    l("BG 02", "Conciliado", 25.25),
    l("BG 02", "Conciliado", -5),
    l("BG 03", "Fechado", -100),
    l("BG 03", "Aberto", null),
  ];
  const confere = (conjunto: CaixaAberturaFechamentoLinha[]) => {
    const card = resumirLinhasFechamento(conjunto).diferencaFinanceira;
    const tabela = agregarFechamento(conjunto);
    const somaLojas = Math.round(tabela.lojas.reduce((s, x) => s + x.valor, 0) * 100) / 100;
    return { card, somaLojas, rede: tabela.rede.valor };
  };

  it("todos os status: Σ lojas = rede = card", () => {
    const r = confere(linhas);
    expect(r.card).toBeCloseTo(-130.25, 6);
    expect(r.somaLojas).toBeCloseTo(r.card, 6);
    expect(r.rede).toBeCloseTo(r.card, 6);
  });

  it("Status = Conciliado: card e tabela somam só os conciliados (DIF. TOTAL)", () => {
    const conciliados = filtrarLinhasPorStatus(linhas, "Conciliado");
    const r = confere(conciliados);
    expect(r.card).toBeCloseTo(9.75, 6); // -10,5 + 25,25 − 5
    expect(r.somaLojas).toBeCloseTo(r.card, 6);
    expect(r.rede).toBeCloseTo(r.card, 6);
  });

  it("Status = Fechado e Aberto", () => {
    expect(confere(filtrarLinhasPorStatus(linhas, "Fechado")).somaLojas).toBeCloseTo(-140, 6);
    expect(confere(filtrarLinhasPorStatus(linhas, "Aberto")).somaLojas).toBe(0); // caixa aberto sem DIF. TOTAL não vira valor
  });

  it("loja específica: card e tabela da loja coincidem; as demais lojas não entram", () => {
    const so = linhas.filter((x) => x.unidade === "BG 01");
    const r = confere(so);
    expect(r.card).toBeCloseTo(-50.5, 6);
    expect(r.somaLojas).toBeCloseTo(r.card, 6);
    const recortado = recortarLojaPainel(agregarFechamento(linhas), "BG 01", redeFechamento);
    expect(recortado.lojas).toHaveLength(1);
    expect(recortado.rede.valor).toBeCloseTo(-50.5, 6);
  });

  it("loja + status combinados (Conciliado em BG 02)", () => {
    const r = confere(filtrarLinhasPorStatus(linhas.filter((x) => x.unidade === "BG 02"), "Conciliado"));
    expect(r.card).toBeCloseTo(20.25, 6);
    expect(r.somaLojas).toBeCloseTo(20.25, 6);
  });
});

describe("Troco — classificação 0/0, ranking de faltas e lojas sem valor de conferência", () => {
  const dia = (d: string) => new Date(`${d}T00:00:00Z`);
  const cx = (unidade: string, data: string, conferido: number, informado: number, planoDeAcao: string | null = null): CaixaTrocoLoja => ({
    unidade,
    data: dia(data),
    caixa: "CX",
    conferido,
    informado,
    diferenca: Math.round((conferido - informado) * 100) / 100,
    status: conferido - informado === 0 ? "Conferido" : "Divergência",
    operador: "OP",
    planoDeAcao,
  });
  const caixas: CaixaTrocoLoja[] = [
    // BG 01 em 16/09: loja INTEIRA 0/0 (3 caixas)
    cx("BG 01", "2026-09-16", 0, 0), cx("BG 01", "2026-09-16", 0, 0), cx("BG 01", "2026-09-16", 0, 0),
    // BG 02 em 16/09: parcial (1 de 3 zerado) + 1 conferido real + 1 falta
    cx("BG 02", "2026-09-16", 0, 0), cx("BG 02", "2026-09-16", 500, 500), cx("BG 02", "2026-09-16", 100, 130, "Quebra lançada para a op."),
    // BG 03: falta maior sem plano, uma sobra
    cx("BG 03", "2026-09-16", 200, 260), cx("BG 03", "2026-09-16", 300, 290), cx("BG 03", "2026-09-16", 400, 400),
  ];

  it("classificação: 0/0 nunca é conferido; conferido ≠ 0 e diferença 0 é conferido; diferença ≠ 0 é divergência", () => {
    expect(classificarCaixaTroco({ conferido: 0, informado: 0, diferenca: 0 })).toBe("sem-valor");
    expect(classificarCaixaTroco({ conferido: 500, informado: 500, diferenca: 0 })).toBe("conferido");
    expect(classificarCaixaTroco({ conferido: 100, informado: 130, diferenca: -30 })).toBe("divergencia");
    expect(classificarCaixaTroco({ conferido: 10, informado: 5, diferenca: 5 })).toBe("divergencia");
  });

  it("resumo: conferidos EXCLUI 0/0; conferidos + sem valor + divergências = total (sem dupla contagem)", () => {
    const r = resumirTroco(caixas);
    expect(r.total).toBe(9);
    expect(r.semValor).toBe(4);
    expect(r.conferidos).toBe(2); // 500/500 e 400/400
    expect(r.divergencias).toBe(3);
    expect(r.conferidos + r.semValor + r.divergencias).toBe(r.total);
  });

  it("faltas: só diferença negativa; sobras separadas; plano de quebra é subconjunto das faltas (texto livre)", () => {
    const r = resumirTroco(caixas);
    expect(r.faltas).toEqual({ quantidade: 2, valor: 90 }); // 30 + 60
    expect(r.sobras).toEqual({ quantidade: 1, valor: 10 });
    expect(r.faltasComPlanoDeQuebra).toEqual({ quantidade: 1, valor: 30 });
    expect(r.faltasComPlanoDeQuebra.valor).toBeLessThanOrEqual(r.faltas.valor);
  });

  it("ranking: maior falta financeira primeiro; sobras e lojas sem falta não aparecem", () => {
    const r = rankingFaltasPorLoja(caixas);
    expect(r.map((x) => [x.unidade, x.valorFalta, x.ocorrencias])).toEqual([["BG 03", 60, 1], ["BG 02", 30, 1]]);
    expect(r.reduce((s, x) => s + x.valorFalta, 0)).toBe(resumirTroco(caixas).faltas.valor);
  });

  it("lojas sem valor de conferência: contagem, total de caixas, % e distinção loja inteira × caixa isolado", () => {
    const r = lojasSemValorDeConferencia(caixas);
    expect(r.map((x) => x.unidade)).toEqual(["BG 01", "BG 02"]); // ordenado por quantidade
    const bg01 = r[0];
    expect([bg01.semValor, bg01.total, bg01.caixasEmLojaInteira, bg01.caixasIsolados]).toEqual([3, 3, 3, 0]);
    expect(bg01.percentual).toBe(100);
    const bg02 = r[1];
    expect([bg02.semValor, bg02.total, bg02.caixasEmLojaInteira, bg02.caixasIsolados]).toEqual([1, 3, 0, 1]);
    expect(bg02.percentual).toBeCloseTo(100 / 3, 6);
    // a distinção não muda a contagem
    expect(r.reduce((s, x) => s + x.semValor, 0)).toBe(resumirTroco(caixas).semValor);
  });

  it("tipo por loja/data e por caixa", () => {
    const tipos = tipoSemValorPorLojaData(caixas);
    expect(tipoSemValorDoCaixa(caixas[0], tipos)).toBe("loja-inteira");
    expect(tipoSemValorDoCaixa(caixas[3], tipos)).toBe("caixa-isolado");
    expect(tipoSemValorDoCaixa(caixas[4], tipos)).toBeNull(); // conferido real não tem tipo
  });

  it("filtro de loja: tudo é recalculado só sobre a loja escolhida", () => {
    const so = caixas.filter((c) => c.unidade === "BG 02");
    expect(resumirTroco(so)).toMatchObject({ total: 3, semValor: 1, conferidos: 1, divergencias: 1 });
    expect(rankingFaltasPorLoja(so)).toHaveLength(1);
    expect(lojasSemValorDeConferencia(so)).toHaveLength(1);
  });

  it("sem registros → tudo zerado, sem erro", () => {
    expect(resumirTroco([])).toMatchObject({ total: 0, conferidos: 0, semValor: 0, divergencias: 0 });
    expect(rankingFaltasPorLoja([])).toEqual([]);
    expect(lojasSemValorDeConferencia([])).toEqual([]);
  });
});
