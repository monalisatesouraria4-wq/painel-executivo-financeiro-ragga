import { describe, expect, it } from "vitest";
import type { CaixaAberturaFechamentoLinha } from "@/lib/services/aberturaFechamento";
import type { PdvMaquininhaLinha, TrocoLinha } from "@/lib/services/controlesCaixa";
import {
  agregarFechamento,
  agregarPdv,
  agregarTroco,
  mapaPorLoja,
  ordenarLojasPainel,
  pdvPorForma,
  recortarLojaPainel,
  redeFechamento,
  redePdv,
  redeTroco,
  situacaoLoja,
} from "@/lib/services/controlesLojaPainel";
import { periodoComparacaoPadrao } from "@/lib/rules/mesAnterior";
import { semanaRealDoPeriodo } from "@/lib/rules/datas";

const cx = (unidade: string, caixa: string, situacao: string, dif: number | null): CaixaAberturaFechamentoLinha => ({
  unidade: unidade as CaixaAberturaFechamentoLinha["unidade"],
  caixa,
  movimento: "1",
  operador: "OP",
  abertura: null,
  fechamento: null,
  situacao,
  fechado: situacao !== "Aberto",
  difFechamento: dif,
  difConciliacao: null,
  difTotal: dif,
});

describe("Fechamento por loja", () => {
  const atual = [cx("BG 01", "1", "Fechado", -30), cx("BG 01", "2", "Conciliado", 10), cx("BG 02", "1", "Aberto", null), cx("BG 03", "1", "Fechado", -100)];
  const p = agregarFechamento(atual);

  it("rede = soma das lojas = soma dos caixas; sinal preservado (sem valor absoluto)", () => {
    expect(p.lojas.find((l) => l.unidade === "BG 01")!.valor).toBe(-20);
    expect(p.lojas.find((l) => l.unidade === "BG 03")!.valor).toBe(-100);
    expect(p.rede.valor).toBe(p.lojas.reduce((s, l) => s + l.valor, 0));
    expect(p.rede.valor).toBe(atual.reduce((s, l) => s + (l.difFechamento ?? 0), 0));
    for (const l of p.lojas) expect(l.valor).toBe(l.detalhe.reduce((s, c) => s + (c.difFechamento ?? 0), 0));
    expect(p.rede.quantidade).toBe(atual.length);
  });

  it("ordena por valor com as maiores diferenças NEGATIVAS primeiro; loja A→Z", () => {
    expect(ordenarLojasPainel(p.lojas, null, "valor", "negativo-primeiro").map((l) => l.unidade)).toEqual(["BG 03", "BG 01", "BG 02"]);
    expect(ordenarLojasPainel(p.lojas, null, "loja", "negativo-primeiro").map((l) => l.unidade)).toEqual(["BG 01", "BG 02", "BG 03"]);
  });

  it("comparação atual × anterior: distância até zero (menor = melhorou); loja sem registro no comparado = sem base", () => {
    const comp = agregarFechamento([cx("BG 01", "1", "Fechado", -5), cx("BG 03", "1", "Fechado", -200)]);
    const mapa = mapaPorLoja(comp);
    const por = (u: string) => situacaoLoja(p.lojas.find((l) => l.unidade === u)!, mapa?.get(u));
    expect(por("BG 01")).toBe("piorou"); // |−20| > |−5|
    expect(por("BG 03")).toBe("melhorou"); // |−100| < |−200|
    expect(por("BG 02")).toBe("sem-base"); // sem registro no comparado → nada de zero falso
    expect(ordenarLojasPainel(p.lojas, mapa, "performance", "negativo-primeiro")[0].unidade).toBe("BG 01");
  });

  it("filtro de loja: só ela; rede = soma das lojas exibidas; loja inexistente → sem dados", () => {
    const r = recortarLojaPainel(p, "BG 03", redeFechamento);
    expect(r.lojas).toHaveLength(1);
    expect(r.rede.valor).toBe(-100);
    expect(recortarLojaPainel(p, "BG 13", redeFechamento).disponivel).toBe(false);
  });

  it("sem dados → indisponível (não vira zero)", () => {
    expect(agregarFechamento([]).disponivel).toBe(false);
  });

  it("filtro de status continua valendo sobre a agregação (recorte antes de agregar)", () => {
    const soFechado = agregarFechamento(atual.filter((l) => l.situacao === "Fechado"));
    expect(soFechado.rede.valor).toBe(-130);
    expect(soFechado.lojas.map((l) => l.unidade)).toEqual(["BG 01", "BG 03"]);
  });
});

describe("PDV × Maquininha por loja", () => {
  const linhas: PdvMaquininhaLinha[] = [
    { unidade: "BG 01", totalPdv: 1000, totalMaquininha: 980.5, diferenca: -19.5 },
    { unidade: "BG 02", totalPdv: 500, totalMaquininha: 500, diferenca: 0 },
    { unidade: "BG 04", totalPdv: 200, totalMaquininha: 260, diferenca: 60 },
  ];
  const p = agregarPdv(linhas);

  it("rede = soma das lojas (Maquininha − PDV) e bate com a diferença das lojas", () => {
    expect(p.rede.valor).toBeCloseTo(40.5, 6);
    expect(p.lojas.reduce((s, l) => s + l.valor, 0)).toBeCloseTo(p.rede.valor, 6);
    expect(p.lojas.every((l) => l.percentual === null)).toBe(true); // sem % inventado
  });

  it("ordena por valor (maior divergência absoluta), diferença (mais negativa) e loja", () => {
    expect(ordenarLojasPainel(p.lojas, null, "valor", "magnitude").map((l) => l.unidade)).toEqual(["BG 04", "BG 01", "BG 02"]);
    expect(ordenarLojasPainel(p.lojas, null, "diferenca", "magnitude").map((l) => l.unidade)).toEqual(["BG 01", "BG 02", "BG 04"]);
  });

  it("situação por distância até zero; sem registro no comparado = sem base", () => {
    const comp = agregarPdv([{ unidade: "BG 01", totalPdv: 1000, totalMaquininha: 1000, diferenca: 0 }, { unidade: "BG 04", totalPdv: 200, totalMaquininha: 290, diferenca: 90 }]);
    const mapa = mapaPorLoja(comp);
    const por = (u: string) => situacaoLoja(p.lojas.find((l) => l.unidade === u)!, mapa?.get(u));
    expect(por("BG 01")).toBe("piorou");
    expect(por("BG 04")).toBe("melhorou");
    expect(por("BG 02")).toBe("sem-base");
  });

  it("filtro de loja", () => {
    const r = recortarLojaPainel(p, "BG 04", redePdv);
    expect(r.rede.valor).toBe(60);
    expect(r.lojas).toHaveLength(1);
  });

  it("expansão por forma de pagamento: Σ formas = diferença da loja (sem duplicar)", () => {
    const brutas = [
      { unidade: "BG 01", forma: "PIX", valorPdv: 400, valorMaquininha: 390 },
      { unidade: "BG 01", forma: "PIX", valorPdv: 100, valorMaquininha: 100 },
      { unidade: "BG 01", forma: "CREDITO", valorPdv: 500, valorMaquininha: 490.5 },
      { unidade: "BG 02", forma: "PIX", valorPdv: 500, valorMaquininha: 500 },
    ];
    const f = pdvPorForma(brutas, "BG 01");
    expect(f.map((x) => x.forma)).toEqual(["PIX", "CREDITO"]); // maior divergência absoluta primeiro (−10 × −9,5)
    expect(f.reduce((s, x) => s + x.diferenca, 0)).toBeCloseTo(p.lojas.find((l) => l.unidade === "BG 01")!.valor, 6);
  });
});

describe("Troco por loja", () => {
  const caixa = (c: string, dif: number, status: "Conferido" | "Divergência") => ({
    caixa: c,
    data: new Date("2026-09-10T00:00:00Z"),
    conferido: 100,
    informado: 100 + dif,
    diferenca: dif,
    status,
    operador: null,
    planoDeAcao: null,
  });
  const linhas: TrocoLinha[] = [
    { unidade: "BG 01", caixas: [caixa("1", 0, "Conferido"), caixa("2", -5, "Divergência"), caixa("3", 2, "Divergência"), caixa("4", 0, "Conferido")] },
    { unidade: "BG 02", caixas: [caixa("1", 0, "Conferido"), caixa("2", 0, "Conferido")] },
  ];
  const p = agregarTroco(linhas);

  it("valor = Σ |dif| das divergências; % = caixas com divergência ÷ caixas; rede = soma das lojas", () => {
    const bg01 = p.lojas.find((l) => l.unidade === "BG 01")!;
    expect(bg01.valor).toBe(7);
    expect(bg01.percentual).toBe(50);
    expect(bg01.detalhe.diferencaLiquida).toBe(-3); // sinal preservado no detalhe
    expect(p.lojas.find((l) => l.unidade === "BG 02")).toMatchObject({ valor: 0, percentual: 0 });
    expect(p.rede.valor).toBe(7);
    expect(p.rede.percentual).toBeCloseTo((2 / 6) * 100, 6);
    expect(p.rede.quantidade).toBe(6);
    for (const l of p.lojas) expect(l.quantidade).toBe(l.detalhe.caixas.length);
  });

  it("cards (todas as caixas) = tabela (lojas)", () => {
    const todas = linhas.flatMap((l) => l.caixas);
    expect(p.rede.valor).toBe(todas.filter((c) => c.status === "Divergência").reduce((s, c) => s + Math.abs(c.diferenca), 0));
  });

  it("situação pelo % de caixas com divergência; ordenação por valor, % e performance", () => {
    const comp = agregarTroco([{ unidade: "BG 01", caixas: [caixa("1", 0, "Conferido"), caixa("2", 0, "Conferido")] }, { unidade: "BG 02", caixas: [caixa("1", -9, "Divergência")] }]);
    const mapa = mapaPorLoja(comp);
    expect(situacaoLoja(p.lojas[0], mapa?.get("BG 01"))).toBe("piorou");
    expect(situacaoLoja(p.lojas[1], mapa?.get("BG 02"))).toBe("melhorou");
    expect(ordenarLojasPainel(p.lojas, mapa, "valor", "magnitude").map((l) => l.unidade)).toEqual(["BG 01", "BG 02"]);
    expect(ordenarLojasPainel(p.lojas, mapa, "percentual", "magnitude").map((l) => l.unidade)).toEqual(["BG 01", "BG 02"]);
    expect(ordenarLojasPainel(p.lojas, mapa, "performance", "magnitude")[0].unidade).toBe("BG 01");
  });

  it("filtro de loja e ausência de dados", () => {
    const r = recortarLojaPainel(p, "BG 02", redeTroco);
    expect(r.rede).toMatchObject({ valor: 0, percentual: 0, quantidade: 2 });
    expect(agregarTroco([]).disponivel).toBe(false);
  });
});

describe("período comparado (mesma lógica dos demais indicadores)", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const iso = (x: Date) => x.toISOString().slice(0, 10);

  it("mês completo → mês anterior; período personalizado → mesma duração imediatamente antes", () => {
    const mes = periodoComparacaoPadrao(d("2026-09-01"), d("2026-09-30"));
    expect([iso(mes.inicio), iso(mes.fim)]).toEqual(["2026-08-01", "2026-08-31"]);
    const livre = periodoComparacaoPadrao(d("2026-09-01"), d("2026-09-15"));
    expect([iso(livre.inicio), iso(livre.fim)]).toEqual(["2026-08-17", "2026-08-31"]);
  });

  it("Troco: o período efetivo são semanas reais e o comparado mantém o mesmo nº de semanas alinhadas", () => {
    const ini = semanaRealDoPeriodo(d("2026-09-09")).inicio; // quarta → segunda 07/09
    const fim = semanaRealDoPeriodo(d("2026-09-17")).fim; // quinta → domingo 20/09
    expect([iso(ini), iso(fim)]).toEqual(["2026-09-07", "2026-09-20"]);
    const comp = periodoComparacaoPadrao(ini, fim);
    expect([iso(comp.inicio), iso(comp.fim)]).toEqual(["2026-08-24", "2026-09-06"]);
    expect(semanaRealDoPeriodo(comp.inicio).inicio.getTime()).toBe(comp.inicio.getTime());
    expect(semanaRealDoPeriodo(comp.fim).fim.getTime()).toBe(comp.fim.getTime());
  });
});
