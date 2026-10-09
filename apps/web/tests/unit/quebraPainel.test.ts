import { describe, expect, it } from "vitest";
import { agregarQuebra, barrasQuebraPorMotivo, fatiasQuebraPorLoja, ordenarLojasQuebra, percentualSobreFaturamento, recortarLoja, situacaoQuebra, type LinhaQuebraBruta } from "@/lib/services/quebraPainel";

const l = (unidade: string, operador: string, motivo: string, valor: number, cpf = "000"): LinhaQuebraBruta => ({ unidade, operador, cpf: cpf + operador, motivo, valor });

const atualLinhas = [
  l("BG 01", "ANA", "FALTA DE DINHEIRO", 30),
  l("BG 01", "ANA", "FALTA DE DINHEIRO", 20),
  l("BG 01", "BIA", "TROCO ERRADO", 50),
  l("BG 02", "CAIO", "FALTA DE DINHEIRO", 100),
  l("BG 03", "DUDA", "TROCO ERRADO", 10),
];
const fatAtual = { "BG 01": 10000, "BG 02": 5000, "BG 03": 2000, "BG 04": 1000 };
const compLinhas = [l("BG 01", "ANA", "FALTA DE DINHEIRO", 40), l("BG 02", "CAIO", "FALTA DE DINHEIRO", 400), l("BG 03", "DUDA", "TROCO ERRADO", 10)];
const fatComp = { "BG 01": 8000, "BG 02": 20000, "BG 03": 2000 };

describe("agregarQuebra — REDE → LOJA → OPERADOR/MOTIVO", () => {
  const p = agregarQuebra(atualLinhas, fatAtual);

  it("rede = soma das lojas = soma dos operadores = soma dos motivos (sem duplicar)", () => {
    const somaLojas = p.porLoja.reduce((s, x) => s + x.valor, 0);
    const somaOperadores = p.porLoja.reduce((s, x) => s + x.operadores.reduce((t, o) => t + o.valor, 0), 0);
    const somaMotivos = p.motivos.reduce((s, m) => s + m.valor, 0);
    const totalLinhas = atualLinhas.reduce((s, x) => s + x.valor, 0);
    expect(p.valor).toBe(totalLinhas);
    expect(somaLojas).toBe(totalLinhas);
    expect(somaOperadores).toBe(totalLinhas);
    expect(somaMotivos).toBe(totalLinhas);
    expect(p.quantidade).toBe(atualLinhas.length);
  });

  it("loja = soma dos operadores daquela loja; operadores ordenados por contribuição", () => {
    const bg01 = p.porLoja.find((x) => x.unidade === "BG 01")!;
    expect(bg01.valor).toBe(100);
    expect(bg01.operadores.reduce((s, o) => s + o.valor, 0)).toBe(bg01.valor);
    expect(bg01.operadores.map((o) => [o.operador, o.valor, o.quantidade])).toEqual([["ANA", 50, 2], ["BIA", 50, 1]].sort((a, b) => (b[1] as number) - (a[1] as number) || String(a[0]).localeCompare(String(b[0]))));
    expect(bg01.operadores.reduce((s, o) => s + o.percentualDaLoja, 0)).toBeCloseTo(100, 6);
    expect(bg01.motivos.reduce((s, m) => s + m.percentualDoTotal, 0)).toBeCloseTo(100, 6);
  });

  it("% sobre o faturamento da própria loja; loja só com faturamento aparece com quebra zero (zero real)", () => {
    expect(p.porLoja.find((x) => x.unidade === "BG 01")!.percentual).toBeCloseTo(1, 6); // 100 / 10.000
    expect(p.porLoja.find((x) => x.unidade === "BG 02")!.percentual).toBeCloseTo(2, 6); // 100 / 5.000
    expect(p.porLoja.find((x) => x.unidade === "BG 04")).toMatchObject({ valor: 0, quantidade: 0 });
    expect(p.percentual).toBeCloseTo((210 / 18000) * 100, 6);
  });

  it("motivos exatamente como na base", () => {
    expect(p.motivos.map((m) => m.motivo)).toEqual(["FALTA DE DINHEIRO", "TROCO ERRADO"]);
  });

  it("filtro de loja mantém só essa loja e a soma continua batendo", () => {
    const r = recortarLoja(p, "BG 02");
    expect(r.porLoja).toHaveLength(1);
    expect(r.valor).toBe(100);
    expect(r.motivos.reduce((s, m) => s + m.valor, 0)).toBe(r.valor);
    expect(recortarLoja(p, "BG 13").disponivel).toBe(false);
  });

  it("sem registros → indisponível", () => {
    expect(agregarQuebra([], fatAtual).disponivel).toBe(false);
  });
});

describe("situação e ordenação reais", () => {
  const atual = agregarQuebra(atualLinhas, fatAtual);
  const comp = agregarQuebra(compLinhas, fatComp);

  it("menor % = melhorou; maior = piorou; igual = sem alteração; sem base", () => {
    expect(situacaoQuebra(1, 0.5)).toBe("piorou");
    expect(situacaoQuebra(0.4, 0.5)).toBe("melhorou");
    expect(situacaoQuebra(0.5, 0.5)).toBe("sem-alteracao");
    expect(situacaoQuebra(0.5, null)).toBe("sem-base");
  });

  it("ordena por Loja, Valor, % e Performance de verdade", () => {
    const lojas = atual.porLoja.filter((x) => x.quantidade > 0);
    expect(ordenarLojasQuebra(lojas, comp, "loja").map((x) => x.unidade)).toEqual(["BG 01", "BG 02", "BG 03"]);
    // valor: BG 01 (100) e BG 02 (100) empatam → desempate por nome; BG 03 (10) por último
    expect(ordenarLojasQuebra(lojas, comp, "valor").map((x) => x.unidade)).toEqual(["BG 01", "BG 02", "BG 03"]);
    // %: BG 02 2% > BG 03 0,5% e BG 01 1% → BG 02, BG 01, BG 03
    expect(ordenarLojasQuebra(lojas, comp, "percentual").map((x) => x.unidade)).toEqual(["BG 02", "BG 01", "BG 03"]);
    // performance: BG 01 piorou (0,5%→1%), BG 02 melhorou (2%→... comp 400/20000=2% → igual), BG 03 piorou? 0,5%→0,5% igual
    const perf = ordenarLojasQuebra(lojas, comp, "performance").map((x) => x.unidade);
    expect(perf[0]).toBe("BG 01"); // única que piorou
    expect(perf).toHaveLength(3);
  });
});

describe("% da quebra sobre o faturamento — card geral e tabela por loja", () => {
  const fat = { "BG 01": 10000, "BG 02": 5000, "BG 03": 2000 };
  const p = agregarQuebra(atualLinhas, fat); // quebra: BG 01 = 100, BG 02 = 100, BG 03 = 10

  it("soma das lojas = total geral da quebra e do faturamento", () => {
    expect(p.porLoja.reduce((s, x) => s + x.valor, 0)).toBe(p.valor);
    expect(p.porLoja.reduce((s, x) => s + x.faturamento, 0)).toBe(p.faturamento);
    expect(p.valor).toBe(210);
    expect(p.faturamento).toBe(17000);
  });

  it("percentual geral = quebra total ÷ faturamento total × 100; individual usa a MESMA loja", () => {
    const g = percentualSobreFaturamento(p.valor, p.faturamento, false);
    expect(g.estado).toBe("ok");
    expect(g.percentual).toBeCloseTo((210 / 17000) * 100, 9);
    const esperado: Record<string, number> = { "BG 01": 1, "BG 02": 2, "BG 03": 0.5 };
    for (const x of p.porLoja) expect(percentualSobreFaturamento(x.valor, x.faturamento, false).percentual).toBeCloseTo(esperado[x.unidade], 9);
  });

  it("faturamento zero, ausente ou inválido → indisponível (nunca 0%); carregando → sem valor e sem erro", () => {
    expect(percentualSobreFaturamento(100, 0, false)).toEqual({ estado: "indisponivel", percentual: null });
    expect(percentualSobreFaturamento(100, null, false)).toEqual({ estado: "indisponivel", percentual: null });
    expect(percentualSobreFaturamento(100, undefined, false)).toEqual({ estado: "indisponivel", percentual: null });
    expect(percentualSobreFaturamento(100, Number.NaN, false)).toEqual({ estado: "indisponivel", percentual: null });
    expect(percentualSobreFaturamento(100, 5000, true)).toEqual({ estado: "carregando", percentual: null });
    expect(percentualSobreFaturamento(100, 0, true).estado).toBe("carregando");
  });

  it("loja sem faturamento na base: faturamento 0 → percentual indisponível; as demais seguem calculadas", () => {
    const sem = agregarQuebra(atualLinhas, { "BG 01": 10000 });
    const bg02 = sem.porLoja.find((x) => x.unidade === "BG 02");
    expect(bg02?.faturamento).toBe(0);
    expect(percentualSobreFaturamento(bg02!.valor, bg02!.faturamento, false).estado).toBe("indisponivel");
    expect(percentualSobreFaturamento(100, 10000, false).percentual).toBeCloseTo(1, 9);
  });

  it("filtro de loja: card e tabela recalculam só sobre a loja", () => {
    const so = recortarLoja(p, "BG 02");
    expect(percentualSobreFaturamento(so.valor, so.faturamento, false).percentual).toBeCloseTo(2, 9);
    expect(so.porLoja).toHaveLength(1);
  });
});

describe("gráficos de Quebra — rosca por loja e barras por motivo", () => {
  const p = agregarQuebra(atualLinhas, { "BG 01": 10000, "BG 02": 5000, "BG 03": 2000 });
  // lojas: BG 01 = 100, BG 02 = 100, BG 03 = 10 · motivos: FALTA DE DINHEIRO = 150, TROCO ERRADO = 60 (total 210)

  it("rosca: só lojas com quebra, maior valor primeiro, participação sobre o total do mesmo recorte (soma = 100%)", () => {
    const f = fatiasQuebraPorLoja(p.porLoja, p.valor);
    expect(f.map((x) => x.unidade)).toEqual(["BG 01", "BG 02", "BG 03"]);
    expect(f.reduce((s, x) => s + x.valor, 0)).toBe(p.valor);
    expect(f.reduce((s, x) => s + x.participacao, 0)).toBeCloseTo(100, 9);
    expect(f[2].participacao).toBeCloseTo((10 / 210) * 100, 9);
    const comZero = agregarQuebra(atualLinhas, { "BG 01": 10000, "BG 04": 3000 }); // BG 04: faturamento sem quebra
    expect(fatiasQuebraPorLoja(comZero.porLoja, comZero.valor).map((x) => x.unidade)).not.toContain("BG 04");
  });

  it("barras: motivos reais da base, maior primeiro, % do mesmo total; sem comparação não há variação", () => {
    const b = barrasQuebraPorMotivo(p.motivos, null, false, p.valor);
    expect(b.map((x) => [x.motivo, x.valor])).toEqual([["FALTA DE DINHEIRO", 150], ["TROCO ERRADO", 60]]);
    expect(b[0].percentual).toBeCloseTo((150 / 210) * 100, 9);
    expect(b.reduce((s, x) => s + x.percentual, 0)).toBeCloseTo(100, 9);
    expect(b.every((x) => x.variacaoValor === null && x.variacaoPercentual === null)).toBe(true);
  });

  it("barras: variação só com base válida; motivo ausente no comparado = 0 (variação % indefinida)", () => {
    const comparada = agregarQuebra([l("BG 01", "ANA", "FALTA DE DINHEIRO", 100)], {});
    const b = barrasQuebraPorMotivo(p.motivos, comparada.motivos, true, p.valor);
    expect(b[0]).toMatchObject({ motivo: "FALTA DE DINHEIRO", variacaoValor: 50 });
    expect(b[0].variacaoPercentual).toBeCloseTo(50, 9);
    expect(b[1]).toMatchObject({ motivo: "TROCO ERRADO", variacaoValor: 60, variacaoPercentual: null });
    expect(barrasQuebraPorMotivo(p.motivos, comparada.motivos, false, p.valor)[0].variacaoValor).toBeNull();
  });

  it("sem dados ou total zero: estado vazio, sem percentuais inventados", () => {
    const vazio = agregarQuebra([], {});
    expect(fatiasQuebraPorLoja(vazio.porLoja, vazio.valor)).toEqual([]);
    expect(barrasQuebraPorMotivo(vazio.motivos, null, false, vazio.valor)).toEqual([]);
  });

  it("filtro de loja: os dois gráficos usam só a loja e o total dela", () => {
    const so = recortarLoja(p, "BG 01");
    const f = fatiasQuebraPorLoja(so.porLoja, so.valor);
    expect(f).toHaveLength(1);
    expect(f[0].participacao).toBeCloseTo(100, 9);
    const b = barrasQuebraPorMotivo(so.motivos, null, false, so.valor);
    expect(b.reduce((s, x) => s + x.valor, 0)).toBe(so.valor);
  });
});
