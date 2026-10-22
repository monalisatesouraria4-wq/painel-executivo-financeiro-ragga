import { describe, expect, it } from "vitest";
import {
  agruparPorMotivo,
  LIMITE_LINHAS_IMAGEM,
  modeloDaImagem,
  montarResumoExecutivo,
  textoWhatsappSemanal,
  variacaoDe,
  type BaseId,
  type CoberturaBase,
  type EntradaPeriodo,
  type JanelaSemana,
} from "@/lib/services/resumoExecutivo";

/** Resumo Semanal Executivo — cálculos, composição dos dados, período, texto e modelo da imagem. Dados fictícios. */
const ATUAL: JanelaSemana = { inicio: "2026-10-12", fim: "2026-10-18" };
const ANTERIOR: JanelaSemana = { inicio: "2026-10-05", fim: "2026-10-11" };
const vazio = (): EntradaPeriodo => ({ faturamentoTotal: 0, formas: [], brindes: [], cancelamentoSalao: [], cancelamentoDelivery: [], compraDireta: [], retiradaDeposito: [], troco: [], quebra: [] });
const cobre = (min = "2026-06-01", max = "2026-10-20"): CoberturaBase => ({ min, max });
const TODAS: BaseId[] = ["faturamento", "formas", "brindes", "cancelamentoSalao", "cancelamentoDelivery", "compraDireta", "retiradaDeposito", "troco", "quebra"];
const bases = (sobrescrever: Partial<Record<BaseId, CoberturaBase>> = {}) => Object.fromEntries(TODAS.map((b) => [b, sobrescrever[b] ?? cobre()])) as Record<BaseId, CoberturaBase>;

const atual: EntradaPeriodo = {
  faturamentoTotal: 1000,
  formas: [{ forma: "CARTAO CREDITO", valor: 400 }, { forma: "TEF - CREDITO", valor: 100 }, { forma: "CARTAO DEBITO", valor: 150 }, { forma: "PIX MAQUININHA", valor: 200 }, { forma: "VOUCHER", valor: 50 }, { forma: "Venda a prazo", valor: 40 }, { forma: "Pagamento online", valor: 50 }, { forma: "Cupom de desconto (Pago pelo iFood)", valor: 10 }],
  brindes: [{ motivo: "BRINDE PRESENTE", valor: 30 }, { motivo: "BRINDE CONSUMO", valor: 70 }, { motivo: "BRINDE PRESENTE", valor: 20 }],
  cancelamentoSalao: [{ motivo: "MOT 01", valor: 10 }, { motivo: "MOT 03", valor: 25.5 }],
  cancelamentoDelivery: [{ motivo: "MOT 02", valor: 15 }],
  compraDireta: [{ motivo: "CMV", valor: 100 }, { motivo: "NOTA FISCAL", valor: 999 }, { motivo: "OPEX", valor: 50 }],
  retiradaDeposito: [{ unidade: "BG 01", valor: 300 }, { unidade: "BG 02", valor: 500 }, { unidade: "BG 01", valor: 200 }],
  troco: [{ diferenca: -5, conferido: 100, informado: 95 }, { diferenca: 0, conferido: 50, informado: 50 }, { diferenca: 2, conferido: 20, informado: 22 }, { diferenca: 0, conferido: 0, informado: 0 }],
  quebra: [{ data: "2026-10-14", motivo: "ERRO DE DESPACHO", valor: 6.5 }, { data: "2026-10-15", motivo: "ERRO DE DESPACHO", valor: 6.5 }, { data: "2026-10-16", motivo: "BRINDE SEM JUSTIFICATIVA", valor: 72.5 }],
};
const anterior: EntradaPeriodo = { ...vazio(), faturamentoTotal: 800, brindes: [{ motivo: "BRINDE PRESENTE", valor: 200 }], cancelamentoSalao: [{ motivo: "MOT 01", valor: 20 }], cancelamentoDelivery: [{ motivo: "MOT 02", valor: 20 }], compraDireta: [{ motivo: "CMV", valor: 120 }], retiradaDeposito: [{ unidade: "BG 01", valor: 900 }], quebra: [{ data: "2026-10-06", motivo: "ERRO DE DESPACHO", valor: 100 }] };
const r = montarResumoExecutivo({ atual: ATUAL, anterior: ANTERIOR, bases: bases(), dadosAtual: atual, dadosAnterior: anterior });
const total = (id: string) => r.totais.find((t) => t.id === id)!;

describe("totais e regras de cada base", () => {
  it("o período do resumo é exatamente a semana selecionada (e a anterior, os 7 dias imediatamente antes)", () => {
    expect(r.periodo).toEqual({ inicio: "2026-10-12", fim: "2026-10-18", rotulo: "12/10/2026 a 18/10/2026" });
    expect(r.anterior.rotulo).toBe("05/10/2026 a 11/10/2026");
  });
  it("totais: faturamento, brindes, cancelamentos (salão + delivery), retirada depósito, quebra", () => {
    expect(total("faturamento").atual.valor).toBe(1000);
    expect(total("brindes").atual.valor).toBe(120);
    expect(total("cancelamentoSalao").atual.valor).toBe(35.5);
    expect(total("cancelamentoDelivery").atual.valor).toBe(15);
    expect(total("cancelamentos").atual.valor).toBe(50.5);
    expect(total("retiradaDeposito").atual.valor).toBe(1000);
    expect(total("quebra").atual.valor).toBe(85.5);
  });
  it("Compra Direta: NOTA FISCAL fica FORA do total da retirada (ajuste sem saída de caixa) e é mostrada à parte", () => {
    expect(total("compraDireta").atual.valor).toBe(150);
    expect(r.detalhes.compraDireta.total.valor).toBe(150);
    expect(r.detalhes.compraDireta.motivos.map((m) => m.motivo)).toEqual(["CMV", "OPEX"]);
    expect(r.detalhes.compraDireta.notaFiscal).toBe(999);
  });
  it("motivos agrupados e ordenados por valor decrescente, com os nomes oficiais", () => {
    expect(r.detalhes.brindes.motivos).toEqual([{ motivo: "BRINDE CONSUMO", valor: 70 }, { motivo: "BRINDE PRESENTE", valor: 50 }]);
    expect(agruparPorMotivo([{ motivo: "B", valor: 1 }, { motivo: "A", valor: 1 }, { motivo: "C", valor: 2 }]).map((m) => m.motivo)).toEqual(["C", "A", "B"]);
  });
  it("formas de pagamento seguem a classificação do sistema (TEF → crédito; iFood → online) e fecham com o faturamento", () => {
    const v = (id: string) => r.formas.find((f) => f.id === id)!.atual.valor;
    expect(v("credito")).toBe(500);
    expect(v("debito")).toBe(150);
    expect(v("pix")).toBe(200);
    expect(v("voucher")).toBe(50);
    expect(v("vendaAPrazo")).toBe(40);
    expect(v("online")).toBe(60);
    expect(r.formas.reduce((s, f) => s + (f.atual.valor ?? 0), 0)).toBe(1000);
  });
  it("troco: grupos consolidados pela regra do sistema (faltas, sobras, divergências, sem valor de conferência)", () => {
    const t = r.detalhes.troco;
    expect(t.disponivel).toBe(true);
    expect(t.caixas).toBe(4);
    expect(t.conferidos).toBe(1);
    expect(t.divergencias).toBe(2);
    expect(t.semConferencia).toBe(1);
    expect(t.faltas).toEqual({ quantidade: 1, valor: 5 });
    expect(t.sobras).toEqual({ quantidade: 1, valor: 2 });
    expect(total("troco").atual.valor).toBe(5);
  });
  it("quebra: total pela data real e separada por ciclo 16→15 quando a semana cruza a virada (14–15/10 × 16/10)", () => {
    expect(r.detalhes.quebra.porCiclo.map((c) => [c.inicio, c.valor, c.quantidade])).toEqual([["2026-09-16", 13, 2], ["2026-10-16", 72.5, 1]]);
    expect(r.detalhes.quebra.quantidade).toBe(3);
  });
});

describe("variação semana a semana", () => {
  it("faturamento (maior é melhor): +25% = melhorou; custos (menor é melhor): queda = melhorou, alta = piorou", () => {
    expect(total("faturamento").variacao).toEqual({ reais: 200, percentual: 25, situacao: "melhorou" });
    expect(total("brindes").variacao?.situacao).toBe("melhorou"); // 120 × 200
    expect(total("cancelamentoSalao").variacao?.situacao).toBe("piorou"); // 35,5 × 20
    expect(total("retiradaDeposito").variacao?.percentual).toBe(11.11); // 900 → 1.000
  });
  it("sem base anterior (ou valor anterior zero) não inventa percentual", () => {
    expect(variacaoDe(10, null, "menor")).toBeNull();
    expect(variacaoDe(10, 0, "menor")).toEqual({ reais: 10, percentual: null, situacao: "piorou" });
    expect(variacaoDe(5, 5, "menor")?.situacao).toBe("estavel");
  });
});

describe("zero real × ausência de dados", () => {
  it("base que cobre o período e não tem lançamento = ZERO real", () => {
    const vaz = montarResumoExecutivo({ atual: ATUAL, anterior: ANTERIOR, bases: bases(), dadosAtual: vazio(), dadosAnterior: vazio() });
    expect(vaz.totais.find((t) => t.id === "brindes")!.atual).toEqual({ valor: 0, status: "ok" });
    expect(vaz.semNenhumDado).toBe(false);
  });
  it("base que NÃO cobre a semana por inteiro = sem dados (null), nunca zero, com a nota de até quando a base vai", () => {
    const sem = montarResumoExecutivo({ atual: ATUAL, anterior: ANTERIOR, bases: bases({ formas: cobre("2026-06-01", "2026-10-04"), troco: cobre("2026-04-08", "2026-10-07") }), dadosAtual: atual, dadosAnterior: anterior });
    const credito = sem.formas.find((f) => f.id === "credito")!;
    expect(credito.atual.valor).toBeNull();
    expect(credito.atual.status).toBe("sem-dados");
    expect(credito.atual.nota).toBe("Formas de pagamento: a base cobre até 04/10/2026");
    expect(sem.totais.find((t) => t.id === "troco")!.atual.valor).toBeNull();
    expect(sem.detalhes.troco.disponivel).toBe(false);
    expect(sem.avisos.some((a) => a.includes("04/10/2026"))).toBe(true);
    const texto = textoWhatsappSemanal(sem);
    expect(texto).toContain("Sem dados no período (Formas de pagamento: a base cobre até 04/10/2026)");
    expect(texto).not.toMatch(/Crédito: R\$ 0,00/);
  });
  it("semana anterior sem dados: valor atual aparece, variação não é calculada", () => {
    const parcial = montarResumoExecutivo({ atual: ATUAL, anterior: ANTERIOR, bases: bases({ brindes: cobre("2026-10-12", "2026-10-20") }), dadosAtual: atual, dadosAnterior: anterior });
    const b = parcial.totais.find((t) => t.id === "brindes")!;
    expect(b.atual.valor).toBe(120);
    expect(b.anterior.valor).toBeNull();
    expect(b.variacao).toBeNull();
  });
  it("nenhuma base com dados na semana", () => {
    const nada = montarResumoExecutivo({ atual: ATUAL, anterior: ANTERIOR, bases: Object.fromEntries(TODAS.map((b) => [b, { min: null, max: null }])) as Record<BaseId, CoberturaBase>, dadosAtual: vazio(), dadosAnterior: vazio() });
    expect(nada.semNenhumDado).toBe(true);
    expect(nada.totais.every((t) => t.atual.valor === null)).toBe(true);
  });
});

describe("texto do WhatsApp e modelo da imagem usam os mesmos dados e o mesmo período", () => {
  const texto = textoWhatsappSemanal(r);
  it("texto: título, período exato, totais, formas, detalhes e rodapé", () => {
    expect(texto).toContain("RESUMO SEMANAL EXECUTIVO — GRUPO LONDRINO");
    expect(texto).toContain("Semana: 12/10/2026 a 18/10/2026");
    expect(texto).toContain("Comparação com a semana anterior: 05/10/2026 a 11/10/2026");
    expect(texto).toContain("Faturamento total: *R$ 1.000,00*");
    expect(texto).toContain("Total de cancelamentos: *R$ 50,50*");
    expect(texto).toContain("- Crédito: R$ 500,00");
    expect(texto).toContain("- Online/iFood: R$ 60,00");
    expect(texto).toContain("- BRINDE CONSUMO: R$ 70,00");
    expect(texto).toContain("Nota Fiscal — ajuste sem saída de caixa (fora do total): R$ 999,00");
    expect(texto).toContain("Ciclo 16/09 a 15/10: R$ 13,00 (2)");
    expect(texto).toContain("— Gestão Ragga · Financeiro");
  });
  it("modelo da imagem: 9 cartões na ordem pedida, valores iguais aos totais, período igual ao do resumo", () => {
    const m = modeloDaImagem(r);
    expect(m.periodo).toBe("Semana de 12/10/2026 a 18/10/2026");
    expect(m.titulo).toBe("RESUMO SEMANAL EXECUTIVO");
    expect(m.grupo).toBe("Grupo Londrino");
    expect(m.cartoes.map((c) => c.rotulo)).toEqual(["Faturamento total", "Brindes", "Quebra de Caixa", "Cancelamento Salão", "Cancelamento Delivery", "Total de cancelamentos", "Retirada de Compra Direta", "Retirada Depósito", "Troco (faltas)"]);
    expect(m.cartoes[0].valor).toBe("R$ 1.000,00");
    expect(m.formas.map((f) => f.rotulo)).toEqual(["Crédito", "Débito", "PIX", "Voucher", "Venda a Prazo", "Online/iFood"]);
    expect(m.secoes.map((s) => s.titulo)).toEqual(["Brindes por motivo", "Cancelamento Delivery por motivo", "Cancelamento Salão por motivo", "Compra Direta por motivo", "Retirada Depósito por loja", "Troco", "Quebra de Caixa (ciclo 16 a 15)"]);
  });
  it("detalhamento extenso NÃO é cortado em silêncio: o excedente vira 'Demais n motivos' com a soma exata", () => {
    const muitos = Array.from({ length: 20 }, (_, i) => ({ motivo: `MOTIVO ${String(i + 1).padStart(2, "0")}`, valor: 100 - i }));
    const big = montarResumoExecutivo({ atual: ATUAL, anterior: ANTERIOR, bases: bases(), dadosAtual: { ...atual, brindes: muitos }, dadosAnterior: anterior });
    const sec = modeloDaImagem(big).secoes[0];
    expect(sec.linhas).toHaveLength(LIMITE_LINHAS_IMAGEM + 1);
    const demais = sec.linhas.at(-1)!;
    expect(demais.texto).toBe("Demais 10 motivos");
    expect(demais.valor).toBe("R$ " + (muitos.slice(LIMITE_LINHAS_IMAGEM).reduce((s, m) => s + m.valor, 0)).toFixed(2).replace(".", ",") + "");
    expect(textoWhatsappSemanal(big)).toContain("- Demais 5 motivos: R$ " + muitos.slice(15).reduce((s, m) => s + m.valor, 0).toFixed(2).replace(".", ","));
  });
});
