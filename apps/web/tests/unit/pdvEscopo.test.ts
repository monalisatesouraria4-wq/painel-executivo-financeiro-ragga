import { describe, expect, it } from "vitest";
import { dataDMenos2 } from "@/lib/rules/datas";
import { FORMAS_PDV_POWER_BI, TEXTO_COBERTURA_PDV, avisoComparacaoSemMaquininha, classesPontoDeAtencao, contarSemMaquininha, janelaConsultaPdv, OPCOES_ORDEM_RANKING_PDV, ordenarRankingPdv, periodoAnteriorPdv, posicaoPorValorPdv, textoSemMaquininha } from "@/lib/services/pdvEscopo";
import { montarPdvGerencial } from "@/lib/services/pdvGerencial";
import { agregarPdv, percentualDivergenciaPdv, recortarLojaPainel, redePdv, situacaoLoja, pdvPorForma } from "@/lib/services/controlesLojaPainel";
import type { PdvMaquininhaLinha } from "@/lib/services/controlesCaixa";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

// Referência validada: PDV X Adquirente - Consolidado.xlsx (aba Export), 28/09 a 04/10/2026, 4 formas, por loja
const SEMANA_VALIDADA: [string, number, number][] = [
  ["BG 01", 68948.24, 68987.75],
  ["BG 02", 78841.4, 79241.23],
  ["BG 03", 44013.06, 43861.99],
  ["BG 04", 71012.69, 71008.35],
  ["BG 05", 92656.46, 92690.61],
  ["BG 06", 27794.24, 27717.15],
  ["BG 07", 98406.75, 98496.44],
  ["BG 08 E 09", 37053.58, 37045.03],
  ["BG 10", 30862.99, 30895.39],
  ["BG 11", 50490.26, 50550.88],
  ["BG 12", 39195.04, 39302.52],
  ["BG 13", 62927.99, 62903.94],
  ["IS 01", 57848.03, 58178.88],
  ["IS 02", 25988.45, 25995.44],
  ["IS 03", 28512.62, 28513.52],
  ["MAPOLI", 14188.66, 14188.66],
  ["ROBS", 12776.64, 12902.22],
];
const arred = (v: number) => Math.round(v * 100) / 100;
const linha = (u: string, pdv: number, maq: number): PdvMaquininhaLinha => ({ unidade: u as PdvMaquininhaLinha["unidade"], totalPdv: arred(pdv), totalMaquininha: arred(maq), diferenca: arred(maq - pdv) });
const SEMANA_ATUAL = SEMANA_VALIDADA.map(([u, p, m]) => linha(u, p, m));

describe("período literal da aba PDV × Maquininha (sem D-2)", () => {
  it("28/09 a 04/10 é consultado exatamente como selecionado — início e fim sem deslocamento", () => {
    const sel = { inicio: d("2026-09-28"), fim: d("2026-10-04") };
    const q = janelaConsultaPdv(sel);
    expect([iso(q.inicio), iso(q.fim)]).toEqual(["2026-09-28", "2026-10-04"]);
    // o D-2 (que continua existindo para outras regras) daria 26/09 a 02/10 — a aba NÃO o usa
    expect([iso(dataDMenos2(sel.inicio)), iso(dataDMenos2(sel.fim))]).toEqual(["2026-09-26", "2026-10-02"]);
    expect(iso(q.inicio)).not.toBe(iso(dataDMenos2(sel.inicio)));
  });

  it("data de referência (dia único) também é literal e a entrada não é alterada", () => {
    const sel = { inicio: d("2026-10-04"), fim: d("2026-10-04") };
    const q = janelaConsultaPdv(sel);
    expect([iso(q.inicio), iso(q.fim)]).toEqual(["2026-10-04", "2026-10-04"]);
    expect(iso(sel.inicio)).toBe("2026-10-04");
    expect(q.inicio).not.toBe(sel.inicio); // cópia, nunca a mesma referência
  });

  it("semana anterior equivalente: mesma quantidade de dias, terminando na véspera (21/09 a 27/09), sem D-2", () => {
    const ant = periodoAnteriorPdv({ inicio: d("2026-09-28"), fim: d("2026-10-04") });
    expect([iso(ant.inicio), iso(ant.fim)]).toEqual(["2026-09-21", "2026-09-27"]);
    const dias = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
    expect(dias(ant.inicio, ant.fim)).toBe(7);
  });
});

describe("escopo: só as quatro formas da extração do Power BI", () => {
  it("Crédito, Débito, Pix e Voucher — sem Dinheiro, Pagamento online, Venda a prazo", () => {
    expect([...FORMAS_PDV_POWER_BI]).toEqual(["Crédito", "Débito", "Pix", "Voucher"]);
    expect(FORMAS_PDV_POWER_BI).not.toContain("Dinheiro");
    expect(FORMAS_PDV_POWER_BI).not.toContain("Pagamento online");
    expect(FORMAS_PDV_POWER_BI).not.toContain("Venda a prazo");
    expect(TEXTO_COBERTURA_PDV).toMatch(/não são tratadas como zero/);
  });

  it("nota de Maquininha em branco: só aparece quando há linhas candidatas e diz que a origem pode estar em branco", () => {
    const moeda = (v: number) => `R$ ${v}`;
    expect(textoSemMaquininha(undefined, moeda)).toBeNull();
    expect(textoSemMaquininha({ linhas: 0, pdv: 0 }, moeda)).toBeNull();
    const t = textoSemMaquininha({ linhas: 3, pdv: 334.4 }, moeda)!;
    expect(t).toMatch(/3 linha\(s\)/);
    expect(t).toMatch(/em branco/);
  });
});

describe("semana 28/09 a 04/10 — totais validados no arquivo de origem", () => {
  const g = montarPdvGerencial(SEMANA_ATUAL, null);

  it("rede: PDV R$ 841.517,10 | Maquininha R$ 842.480,00 | Diferença +R$ 962,90 (Maquininha − PDV)", () => {
    expect(g.rede.totalPdv).toBe(841517.1);
    expect(g.rede.totalMaquininha).toBe(842480);
    expect(g.rede.diferenca).toBe(962.9);
    expect(g.rede.diferenca).toBe(arred(g.rede.totalMaquininha - g.rede.totalPdv));
  });

  it("% de divergência = Diferença ÷ Total PDV (positivo: maquininha acima do PDV)", () => {
    expect(percentualDivergenciaPdv(g.rede.diferenca, g.rede.totalPdv)).toBeCloseTo((962.9 / 841517.1) * 100, 10);
    expect(g.rede.percentual).toBeCloseTo(0.1144, 3);
  });

  it("cards, ranking e painel por loja usam a MESMA base: mesmos totais por loja e na rede", () => {
    const painel = agregarPdv(SEMANA_ATUAL);
    expect(arred(painel.rede.valor)).toBe(g.rede.diferenca); // painel por loja
    expect(painel.rede.valor).toBeCloseTo(962.9, 2);
    for (const l of g.lojas) {
      const p = painel.lojas.find((x) => x.unidade === l.unidade)!;
      expect(arred(p.valor)).toBe(l.diferenca);
      expect(p.detalhe.totalPdv).toBe(l.totalPdv);
      expect(p.detalhe.totalMaquininha).toBe(l.totalMaquininha);
    }
    expect(g.lojas.length).toBe(17);
    expect(arred(g.lojas.reduce((s, l) => s + l.totalPdv, 0))).toBe(g.rede.totalPdv); // Σ lojas = rede
    expect(arred(g.lojas.reduce((s, l) => s + l.diferenca, 0))).toBe(g.rede.diferenca);
  });

  it("ranking pela gravidade (|diferença|): BG 02 no topo; lojas negativas = as 5 com maquininha abaixo do PDV", () => {
    expect(g.lojas[0].unidade).toBe("BG 02");
    expect(g.lojas[0].diferenca).toBe(399.83);
    const negativas = g.lojas.filter((l) => l.sentido === "falta").map((l) => l.unidade).sort();
    expect(negativas).toEqual(["BG 03", "BG 04", "BG 06", "BG 08 E 09", "BG 13"]);
    expect(g.lojas.find((l) => l.unidade === "MAPOLI")!.sentido).toBe("sem-diferenca");
  });

  it("filtro de loja: um recorte coerente (cards = ranking = painel) para a loja escolhida", () => {
    const so = SEMANA_ATUAL.filter((x) => x.unidade === "BG 04");
    const g1 = montarPdvGerencial(so, null);
    expect(g1.rede.diferenca).toBe(-4.34);
    const painel = recortarLojaPainel(agregarPdv(so), "BG 04", redePdv);
    expect(painel.rede.valor).toBeCloseTo(-4.34, 2);
    expect(g1.lojas.map((l) => l.unidade)).toEqual(["BG 04"]);
  });
});

describe("comparação com a semana anterior equivalente (mesmas formas, mesma agregação)", () => {
  // semana anterior sintética, mesmas 17 lojas e mesmas regras de agregação
  const anterior = SEMANA_VALIDADA.map(([u, p, m]) => linha(u, p, m - (u === "BG 03" ? 900 : u === "BG 06" ? 50 : 0)));
  const g = montarPdvGerencial(SEMANA_ATUAL, anterior);

  it("variação em R$ é a do módulo da divergência da rede (atual − anterior)", () => {
    expect(g.comparacao.temBase).toBe(true);
    const absAtual = Math.abs(g.rede.diferenca);
    const absAnterior = Math.abs(g.comparacao.anterior!.diferenca);
    expect(g.comparacao.variacaoReais).toBe(arred(absAtual - absAnterior));
  });

  it("melhora/piora compara o MÓDULO da diferença (não o sinal): BG 03 passou de −1.051,07 para −151,07 → melhorou", () => {
    const atual = agregarPdv(SEMANA_ATUAL).lojas.find((x) => x.unidade === "BG 03")!;
    const ant = agregarPdv(anterior).lojas.find((x) => x.unidade === "BG 03")!;
    expect(arred(ant.valor)).toBe(-1051.07);
    expect(situacaoLoja(atual, ant)).toBe("melhorou");
  });

  it("de −100 para +500 o módulo aumentou: piorou, mesmo que o valor tenha 'subido'", () => {
    const a = agregarPdv([linha("BG 01", 1000, 1500)]).lojas[0];
    const b = agregarPdv([linha("BG 01", 1000, 900)]).lojas[0];
    expect(situacaoLoja(a, b)).toBe("piorou");
  });

  it("detalhe por forma soma exatamente a loja (Σ formas = diferença da loja)", () => {
    const formas = [
      { unidade: "BG 05", forma: "Crédito", valorPdv: 100, valorMaquininha: 98 },
      { unidade: "BG 05", forma: "Pix", valorPdv: 50, valorMaquininha: 55 },
      { unidade: "BG 05", forma: "Voucher", valorPdv: 10, valorMaquininha: 10 },
      { unidade: "BG 01", forma: "Pix", valorPdv: 999, valorMaquininha: 1 }, // outra loja não entra
    ];
    const linhas = pdvPorForma(formas, "BG 05");
    expect(arred(linhas.reduce((s, f) => s + f.diferenca, 0))).toBe(3);
    expect(linhas.some((f) => f.forma === "Dinheiro")).toBe(false);
  });
});

describe("aviso de Maquininha zerada na comparação semanal", () => {
  const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  it("conta só as linhas com Maquininha = 0 e PDV > 0 (sem alterar nenhum valor)", () => {
    const linhas = [
      { valorPdv: "100.00", valorMaquininha: "0.00" }, // candidata
      { valorPdv: 50, valorMaquininha: 0 }, // candidata
      { valorPdv: "0.00", valorMaquininha: "0.00" }, // zero real nos dois lados: não conta
      { valorPdv: "80.00", valorMaquininha: "79.00" }, // maquininha > 0: não conta
      { valorPdv: "0.00", valorMaquininha: "10.00" }, // PDV zerado: não conta
    ];
    const copia = JSON.stringify(linhas);
    expect(contarSemMaquininha(linhas)).toEqual({ linhas: 2, pdv: 150 });
    expect(JSON.stringify(linhas)).toBe(copia); // nada foi convertido
    expect(contarSemMaquininha([])).toEqual({ linhas: 0, pdv: 0 });
  });

  it("semana 21/09 a 27/09: 24 linhas e R$ 23.252,92 — o aviso informa quantidade, PDV, a limitação do zero e a validação da extração", () => {
    const t = avisoComparacaoSemMaquininha({ linhas: 24, pdv: 23252.92 }, moeda, "21/09/2026 a 27/09/2026")!;
    expect(t).toMatch(/21\/09\/2026 a 27\/09\/2026/);
    expect(t).toMatch(/24 linha\(s\)/);
    expect(t).toMatch(/23\.252,92/);
    expect(t).toMatch(/não permite distinguir uma célula em branco na origem de um valor realmente igual a zero/);
    expect(t).toMatch(/Valide a extração original/);
    expect(t).toMatch(/antes de concluir que houve falta de recebimento/);
  });

  it("sem linhas nessa condição (ou sem dados) → nenhum aviso: some junto com o período/filtro", () => {
    expect(avisoComparacaoSemMaquininha({ linhas: 0, pdv: 0 }, moeda, "28/09/2026 a 04/10/2026")).toBeNull();
    expect(avisoComparacaoSemMaquininha(undefined, moeda, "x")).toBeNull();
  });

  it("o texto muda com o período comparado e com a contagem (atualiza conforme os filtros)", () => {
    const a = avisoComparacaoSemMaquininha({ linhas: 24, pdv: 23252.92 }, moeda, "21/09/2026 a 27/09/2026")!;
    const b = avisoComparacaoSemMaquininha({ linhas: 3, pdv: 334.4 }, moeda, "14/09/2026 a 20/09/2026")!;
    expect(a).not.toBe(b);
    expect(b).toMatch(/14\/09\/2026 a 20\/09\/2026/);
    expect(b).toMatch(/3 linha\(s\)/);
  });
});

describe("cores dos pontos de atenção por sinal", () => {
  it("negativa = vermelho discreto; positiva = âmbar discreto; sem diferença = neutro", () => {
    expect(classesPontoDeAtencao("falta")).toContain("semaforo-vermelho");
    expect(classesPontoDeAtencao("sobra")).toContain("semaforo-amarelo");
    const neutro = classesPontoDeAtencao("sem-diferenca");
    expect(neutro).not.toContain("semaforo-vermelho");
    expect(neutro).not.toContain("semaforo-amarelo");
    expect(new Set([classesPontoDeAtencao("falta"), classesPontoDeAtencao("sobra"), neutro]).size).toBe(3);
  });

  it("a ordenação continua pela maior divergência ABSOLUTA, preservando o sinal e os valores", () => {
    const g = montarPdvGerencial(
      [linha("BG 01", 1000, 700), linha("BG 02", 1000, 1500), linha("BG 03", 1000, 990), linha("BG 04", 1000, 1000)],
      null
    );
    expect(g.pontosDeAtencao.map((l) => [l.unidade, l.diferenca, l.sentido])).toEqual([
      ["BG 02", 500, "sobra"],
      ["BG 01", -300, "falta"],
      ["BG 03", -10, "falta"],
    ]); // BG 04 (sem diferença) não entra; o sinal é mantido
  });
});

describe("ordenação do ranking de lojas (só a ordem visual)", () => {
  const nomes = (xs: { unidade: string }[]) => xs.map((x) => x.unidade);
  const g = montarPdvGerencial(SEMANA_ATUAL, null);

  it("as três opções existem, com os rótulos pedidos", () => {
    expect(OPCOES_ORDEM_RANKING_PDV).toEqual([
      { id: "loja", rotulo: "Loja (A–Z)" },
      { id: "valor", rotulo: "Valor da divergência" },
      { id: "percentual", rotulo: "% de divergência" },
    ]);
  });

  it("Loja (A–Z): ordem alfabética com números em ordem natural (BG 02 antes de BG 10; BG 08 E 09 depois de BG 07)", () => {
    const o = ordenarRankingPdv(g.lojas, "loja");
    expect(nomes(o)).toEqual(["BG 01", "BG 02", "BG 03", "BG 04", "BG 05", "BG 06", "BG 07", "BG 08 E 09", "BG 10", "BG 11", "BG 12", "BG 13", "IS 01", "IS 02", "IS 03", "MAPOLI", "ROBS"]);
  });

  it("Valor da divergência: maior |diferença| primeiro, preservando o sinal (negativa e positiva misturadas)", () => {
    const o = ordenarRankingPdv(g.lojas, "valor");
    expect(o.slice(0, 5).map((l) => [l.unidade, l.diferenca])).toEqual([
      ["BG 02", 399.83],
      ["IS 01", 330.85],
      ["BG 03", -151.07], // negativa: entra pelo módulo e mantém o sinal
      ["ROBS", 125.58],
      ["BG 12", 107.48],
    ]);
    expect(o[o.length - 1].unidade).toBe("MAPOLI"); // diferença zero por último
    expect(g.lojas.find((l) => l.unidade === "BG 03")!.diferenca).toBe(-151.07); // original intacto
  });

  it("% de divergência: maior |%| primeiro, com o sinal do percentual original", () => {
    const o = ordenarRankingPdv(g.lojas, "percentual");
    expect(nomes(o).slice(0, 4)).toEqual(["ROBS", "IS 01", "BG 02", "BG 03"]);
    const bg03 = o.find((l) => l.unidade === "BG 03")!;
    expect(bg03.percentual!).toBeLessThan(0); // sinal preservado
    expect(Math.abs(bg03.percentual!)).toBeCloseTo((151.07 / 44013.06) * 100, 8);
    expect(o.find((l) => l.unidade === "ROBS")!.percentual!).toBeCloseTo((125.58 / 12776.64) * 100, 8);
  });

  it("empate: critério secundário estável = nome da loja (A–Z), em valor e em percentual", () => {
    const l = (u: string, pdv: number, maq: number) => montarPdvGerencial([linha(u, pdv, maq)], null).lojas[0];
    const empateValor = [l("BG 10", 1000, 900), l("BG 02", 1000, 1100), l("BG 05", 1000, 900)]; // |dif| = 100 nas três
    expect(nomes(ordenarRankingPdv(empateValor, "valor"))).toEqual(["BG 02", "BG 05", "BG 10"]);
    expect(nomes(ordenarRankingPdv([...empateValor].reverse(), "valor"))).toEqual(["BG 02", "BG 05", "BG 10"]); // independe da ordem de entrada
    const empatePct = [l("IS 01", 2000, 1900), l("BG 03", 1000, 950), l("BG 01", 1000, 1050)]; // |%| = 5 nas três
    expect(nomes(ordenarRankingPdv(empatePct, "percentual"))).toEqual(["BG 01", "BG 03", "IS 01"]);
  });

  it("loja sem % (sem PDV) vai para o fim na ordenação por percentual", () => {
    const semPdv = { unidade: "BG 99", diferenca: 50, percentual: null as number | null };
    const com = { unidade: "BG 01", diferenca: 1, percentual: 0.01 };
    expect(nomes(ordenarRankingPdv([semPdv, com], "percentual"))).toEqual(["BG 01", "BG 99"]);
  });

  it("só reordena: mesmo conjunto, mesmos totais, a lista original não é alterada, REDE não é uma loja ordenável", () => {
    const antes = JSON.stringify(g.lojas);
    for (const ordem of ["loja", "valor", "percentual"] as const) {
      const o = ordenarRankingPdv(g.lojas, ordem);
      expect(o.length).toBe(17);
      expect(nomes(o).includes("REDE")).toBe(false);
      expect(arred(o.reduce((s, x) => s + x.totalPdv, 0))).toBe(841517.1);
      expect(arred(o.reduce((s, x) => s + x.totalMaquininha, 0))).toBe(842480);
      expect(arred(o.reduce((s, x) => s + x.diferenca, 0))).toBe(962.9);
    }
    expect(JSON.stringify(g.lojas)).toBe(antes);
    expect(g.rede).toMatchObject({ totalPdv: 841517.1, totalMaquininha: 842480, diferenca: 962.9 }); // rodapé fixo, intacto
  });

  it("a coluna 'Ranking (valor)' é a mesma qualquer que seja a ordem exibida", () => {
    const pos = posicaoPorValorPdv(g.lojas);
    expect(pos.get("BG 02")).toBe(1);
    expect(pos.get("IS 01")).toBe(2);
    expect(pos.get("BG 03")).toBe(3);
    expect(pos.size).toBe(17);
    expect(posicaoPorValorPdv(ordenarRankingPdv(g.lojas, "loja")).get("BG 02")).toBe(1);
  });
});
