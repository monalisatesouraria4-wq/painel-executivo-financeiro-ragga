import { describe, expect, it } from "vitest";
import { classificarLancamentosQuebra, cicloDaData, extrairPeriodoDaAbaQuebra } from "@/lib/import/periodoAbaQuebra";
import { resolverAbaQuebraPorData } from "@/lib/import/resolverAbaQuebra";
import { lerQuebraDaPlanilha } from "@/lib/import/quebraDaPlanilha";

/**
 * Quebra de Caixa: cada lançamento vale pela SUA data real. Uma aba pode conter lançamentos do ciclo seguinte (caso real:
 * "QUEBRA 16-09 A 15-10" com lançamentos de 16 a 18/10) sem ser invalidada nem deslocar datas; nada é descartado em silêncio.
 * Dados 100% fictícios.
 */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);

describe("cicloDaData — ciclo 16→15", () => {
  it("dia 16 inicia o ciclo; dia 15 o encerra; virada de ano", () => {
    expect([iso(cicloDaData(d("2026-09-16")).inicio), iso(cicloDaData(d("2026-09-16")).fim)]).toEqual(["2026-09-16", "2026-10-15"]);
    expect([iso(cicloDaData(d("2026-10-15")).inicio), iso(cicloDaData(d("2026-10-15")).fim)]).toEqual(["2026-09-16", "2026-10-15"]);
    expect([iso(cicloDaData(d("2026-10-16")).inicio), iso(cicloDaData(d("2026-10-16")).fim)]).toEqual(["2026-10-16", "2026-11-15"]);
    expect([iso(cicloDaData(d("2027-01-10")).inicio), iso(cicloDaData(d("2027-01-10")).fim)]).toEqual(["2026-12-16", "2027-01-15"]);
  });
});

describe("extrairPeriodoDaAbaQuebra — aba com lançamentos do ciclo seguinte continua válida", () => {
  const datas = ["2026-09-16", "2026-09-20", "2026-10-01", "2026-10-10", "2026-10-15", "2026-10-16", "2026-10-18"].map(d);
  it("ciclo = o da menor data; cobertura estendida = ciclo da última data lançada", () => {
    const r = extrairPeriodoDaAbaQuebra(datas);
    expect(r.valida).toBe(true);
    if (!r.valida) return;
    expect([iso(r.periodoInicio), iso(r.periodoFim)]).toEqual(["2026-09-16", "2026-10-15"]);
    expect([iso(r.primeiraData), iso(r.ultimaData), iso(r.coberturaAte)]).toEqual(["2026-09-16", "2026-10-18", "2026-11-15"]);
  });
  it("abaixo do mínimo de lançamentos continua inválida (aba corrompida)", () => {
    expect(extrairPeriodoDaAbaQuebra([d("2026-08-16")]).valida).toBe(false);
  });
});

describe("classificarLancamentosQuebra — aceita pela data real; rejeita com motivo", () => {
  const reg = (data: string, linhaOrigem: number) => ({ data: d(data), linhaOrigem, unidade: "BG 01", valor: 5 });
  const { inicio, fim } = cicloDaData(d("2026-09-20"));
  it("no ciclo e posterior ao ciclo são aceitos SEM mudar a data; fora disso é rejeitado com motivo", () => {
    const r = classificarLancamentosQuebra([reg("2026-09-16", 5), reg("2026-10-15", 6), reg("2026-10-16", 7), reg("2026-11-15", 8), reg("2026-11-16", 9), reg("2026-09-15", 10)], inicio, fim);
    expect(r.aceitos.map((a) => [iso(a.registro.data), a.situacao])).toEqual([
      ["2026-09-16", "no_ciclo"],
      ["2026-10-15", "no_ciclo"],
      ["2026-10-16", "posterior_ao_ciclo"],
      ["2026-11-15", "posterior_ao_ciclo"],
    ]);
    expect(r.rejeitados.map((x) => x.linhaOrigem)).toEqual([9, 10]);
    expect(r.rejeitados[0].motivo).toMatch(/além do ciclo seguinte/);
    expect(r.rejeitados[1].motivo).toMatch(/anterior ao início do ciclo/);
  });
});

describe("resolverAbaQuebraPorData", () => {
  const abaA = { nomeAba: "QUEBRA 16-08 A 15-09", datasLancamentos: ["2026-08-16", "2026-08-20", "2026-08-25", "2026-09-01", "2026-09-15"].map(d) };
  const abaB = { nomeAba: "QUEBRA 16-09 A 15-10", datasLancamentos: ["2026-09-16", "2026-09-20", "2026-10-01", "2026-10-15", "2026-10-16", "2026-10-18"].map(d) };
  it("referência dentro do ciclo da aba → critério 'ciclo'", () => {
    const r = resolverAbaQuebraPorData(d("2026-10-10"), [abaA, abaB]);
    expect(r.resultado.ok && r.resultado.aba.nomeAba).toBe("QUEBRA 16-09 A 15-10");
    expect(r.criterio).toBe("ciclo");
  });
  it("referência 19/10 (ciclo dos lançamentos 16–18/10) → cobertura estendida; o período registrado continua sendo o ciclo da aba", () => {
    const r = resolverAbaQuebraPorData(d("2026-10-19"), [abaA, abaB]);
    expect(r.resultado.ok).toBe(true);
    if (!r.resultado.ok) return;
    expect(r.resultado.aba.nomeAba).toBe("QUEBRA 16-09 A 15-10");
    expect([iso(r.resultado.aba.periodoInicio), iso(r.resultado.aba.periodoFim)]).toEqual(["2026-09-16", "2026-10-15"]);
    expect(r.criterio).toBe("cobertura_estendida");
  });
  it("nunca escolhe um ciclo ANTERIOR automaticamente: referência fora de qualquer cobertura → NENHUMA_ABA", () => {
    const r = resolverAbaQuebraPorData(d("2026-11-20"), [abaA, abaB]);
    expect(r.resultado.ok).toBe(false);
    if (!r.resultado.ok) expect(r.resultado.erro).toBe("NENHUMA_ABA_CORRESPONDE");
  });
  it("quando existe a aba do ciclo novo, ela vence a cobertura estendida da anterior (sem ambiguidade)", () => {
    const abaC = { nomeAba: "QUEBRA 16-10 A 15-11", datasLancamentos: ["2026-10-16", "2026-10-17", "2026-10-20", "2026-10-25", "2026-11-02"].map(d) };
    const r = resolverAbaQuebraPorData(d("2026-10-19"), [abaA, abaB, abaC]);
    expect(r.resultado.ok && r.resultado.aba.nomeAba).toBe("QUEBRA 16-10 A 15-11");
    expect(r.criterio).toBe("ciclo");
  });
  it("aba corrompida (poucas linhas) é descartada e reportada, sem exclusão por nome", () => {
    const r = resolverAbaQuebraPorData(d("2026-10-10"), [abaB, { nomeAba: "16-10 A 15-09", datasLancamentos: [d("2026-08-16")] }]);
    expect(r.abasInvalidas.map((a) => a.nomeAba)).toEqual(["16-10 A 15-09"]);
  });
});

describe("lerQuebraDaPlanilha — lançamentos de 16–18/10 na aba do ciclo anterior", () => {
  const cab = ["MÊS", "DATA", "LOJA", "CONFERENTE", "QUEBRA", "OPERADOR", "CPF", "MOTIVO"];
  const linha = (data: string, loja: string, valor: number, op: string) => ["X", new Date(`${data}T00:00:00.000Z`), loja, "C", valor, op, "", "ERRO DE DESPACHO"];
  const sheets = {
    "QUEBRA 16-09 A 15-10": [
      ["QUEBRA DE CAIXA"], [""], [""], cab,
      linha("2026-09-16", "BG 01", 10, "A"),
      linha("2026-09-20", "BG 02", 11, "B"),
      linha("2026-10-01", "BG 03", 12, "C"),
      linha("2026-10-10", "BG 04", 13, "D"),
      linha("2026-10-15", "BG 05", 14, "E"),
      linha("2026-10-16", "BG 01", 6.5, "F"), // posterior ao ciclo — vale pela data real
      linha("2026-10-18", "BG 07", 2, "G"),
      linha("2026-10-17", "BG 99X", 3, "H"), // unidade desconhecida → rejeitada com motivo
      ["", "", "", "", "", "", "", ""], // linha em branco
    ],
  } as Record<string, unknown[][]>;

  it("aceita pela data real, sem deslocar; rejeitados voltam com motivo; nenhum registro some", () => {
    const r = lerQuebraDaPlanilha(sheets, d("2026-10-19"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parse.registros.map((x) => iso(x.data))).toEqual(["2026-09-16", "2026-09-20", "2026-10-01", "2026-10-10", "2026-10-15", "2026-10-16", "2026-10-18"]);
    expect(r.situacoes.filter((s) => s === "posterior_ao_ciclo")).toHaveLength(2);
    expect(r.parse.rejeitados.some((x) => /Unidade não reconhecida/.test(x.motivo))).toBe(true);
    expect([iso(r.aba.periodoInicio), iso(r.aba.periodoFim)]).toEqual(["2026-09-16", "2026-10-15"]);
  });
});
