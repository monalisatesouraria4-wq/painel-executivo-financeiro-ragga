import { describe, expect, it } from "vitest";
import { agregarQuebra, ordenarLojasQuebra, recortarLoja, situacaoQuebra, type LinhaQuebraBruta } from "@/lib/services/quebraPainel";

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
