import { describe, expect, it } from "vitest";
import { dataOperacionalDoEstorno, estornoNaJanelaMadrugada, minutoDoDia, resumirMadrugada, type EstornoMadrugada } from "@/lib/rules/cancelamentoMadrugada";
import { chaveDetalhe, parseCancelamentoSalaoDetalhe, parseDataHoraEstorno } from "@/lib/import/parsers/cancelamentoSalaoDetalhe";

const CAB = ["Filial", "Produto", "Comanda", "Qtde.", "Valor total", "Data/hora estorno", "Atendente lançamento", "Autorizador", "Motivo", "Justificativa", "SEM DESPERDICIO"];
const linha = (loja: string, dh: unknown, comanda: string, produto: string, qtd: number, valor: number, motivo = "MOT 01 - DESISTENCIA", atend = "AT", aut = "AUT", just = "J") => [loja, produto, comanda, qtd, valor, dh, atend, aut, motivo, just, null];

describe("janela após 00h30 e antes das 06h00 (exclui exatamente 00h30 e 06h00)", () => {
  it("limites", () => {
    expect(estornoNaJanelaMadrugada(minutoDoDia(0, 30))).toBe(false); // 00h30 fora
    expect(estornoNaJanelaMadrugada(minutoDoDia(0, 31))).toBe(true); // 00h31 dentro
    expect(estornoNaJanelaMadrugada(minutoDoDia(5, 59))).toBe(true); // 05h59 dentro
    expect(estornoNaJanelaMadrugada(minutoDoDia(6, 0))).toBe(false); // 06h00 fora
    expect(estornoNaJanelaMadrugada(minutoDoDia(0, 0))).toBe(false);
    expect(estornoNaJanelaMadrugada(minutoDoDia(23, 59))).toBe(false);
    expect(estornoNaJanelaMadrugada(minutoDoDia(12, 0))).toBe(false);
  });
});

describe("data operacional (virada da madrugada)", () => {
  it("00h31–05h59 pertencem ao dia calendário anterior; fora da janela mantém a data", () => {
    expect(dataOperacionalDoEstorno("2026-06-02", minutoDoDia(0, 31))).toBe("2026-06-01");
    expect(dataOperacionalDoEstorno("2026-06-02", minutoDoDia(5, 59))).toBe("2026-06-01");
    expect(dataOperacionalDoEstorno("2026-06-02", minutoDoDia(0, 30))).toBe("2026-06-02");
    expect(dataOperacionalDoEstorno("2026-06-02", minutoDoDia(6, 0))).toBe("2026-06-02");
    expect(dataOperacionalDoEstorno("2026-06-02", minutoDoDia(23, 50))).toBe("2026-06-02");
  });
  it("virada de mês e de ano", () => {
    expect(dataOperacionalDoEstorno("2026-06-01", minutoDoDia(0, 39))).toBe("2026-05-31");
    expect(dataOperacionalDoEstorno("2027-01-01", minutoDoDia(1, 0))).toBe("2026-12-31");
    expect(dataOperacionalDoEstorno("2028-03-01", minutoDoDia(2, 0))).toBe("2028-02-29"); // ano bissexto
  });
});

describe("parser do detalhe individual", () => {
  it("lê as colunas reais e classifica a janela / data operacional", () => {
    const r = parseCancelamentoSalaoDetalhe(CAB, [
      linha("BG 04", "01/06/2026 00:39", "237", "00:39 - COCA COLA 600ML", 1, 9.9, "MOT 03 - ERRO OPERACIONAL"),
      linha("BG 04", "01/06/2026 00:30", "238", "00:30 - AGUA", 1, 5),
      linha("BG 04", "01/06/2026 06:00", "239", "06:00 - SUCO", 1, 7),
      linha("BG 04", "01/06/2026 23:10", "240", "23:10 - CERVEJA", 2, 20),
    ]);
    expect(r.rejeitados).toHaveLength(0);
    expect(r.registros.map((x) => [x.madrugada, x.dataCalendario, x.dataOperacional])).toEqual([
      [true, "2026-06-01", "2026-05-31"],
      [false, "2026-06-01", "2026-06-01"],
      [false, "2026-06-01", "2026-06-01"],
      [false, "2026-06-01", "2026-06-01"],
    ]);
    expect(r.registros[0]).toMatchObject({ unidade: "BG 04", estornoEm: "2026-06-01 00:39:00", comanda: "237", produto: "00:39 - COCA COLA 600ML", quantidade: 1, valor: 9.9, motivo: "MOT 03 - ERRO OPERACIONAL", minutoDoDia: 39 });
  });

  it("aceita objeto Date (campos UTC como digitados) e rejeita data/hora sem horário, unidade ou valor inválidos", () => {
    expect(parseDataHoraEstorno(new Date("2026-06-01T12:46:00.000Z"))).toEqual({ dataISO: "2026-06-01", hora: 12, minuto: 46 });
    expect(parseDataHoraEstorno("01/06/2026")).toBeNull(); // sem horário: não dá para classificar
    expect(parseDataHoraEstorno("31/02/2026 01:00")).toBeNull();
    const r = parseCancelamentoSalaoDetalhe(CAB, [
      linha("XX 99", "01/06/2026 01:00", "1", "P", 1, 1),
      linha("BG 01", "01/06/2026", "2", "P", 1, 1),
      linha("BG 01", "01/06/2026 01:00", "3", "P", 1, "abc" as unknown as number),
      linha("BG 01", "01/06/2026 01:00", "4", "P", 1, 3),
    ]);
    expect(r.registros).toHaveLength(1);
    expect(r.rejeitados).toHaveLength(3);
  });

  it("ocorrências legítimas repetidas (mesma loja, minuto, comanda, produto, valor) NÃO são descartadas e recebem ocorrência 1, 2, 3", () => {
    const rep = linha("BG 03", "01/06/2026 00:48", "400", "00:48 - HEINEKEN LATA 350ML", 2, 19.8);
    const r = parseCancelamentoSalaoDetalhe(CAB, [rep, linha("BG 03", "01/06/2026 00:48", "400", "00:48 - HEINEKEN LATA 350ML", 1, 9.9), rep, rep]);
    expect(r.registros).toHaveLength(4);
    expect(r.registros.map((x) => x.ocorrencia)).toEqual([1, 1, 2, 3]); // o de R$ 9,90 é outra chave
    expect(new Set(r.registros.map((x) => chaveDetalhe(x))).size).toBe(4);
  });

  it("a comanda isolada NÃO é chave: a mesma comanda em dias/horários/lojas diferentes gera chaves distintas", () => {
    const r = parseCancelamentoSalaoDetalhe(CAB, [
      linha("BG 01", "01/06/2026 01:00", "400", "P", 1, 10),
      linha("BG 01", "02/06/2026 01:00", "400", "P", 1, 10),
      linha("BG 02", "01/06/2026 01:00", "400", "P", 1, 10),
    ]);
    expect(new Set(r.registros.map((x) => chaveDetalhe(x))).size).toBe(3);
    expect(r.registros.every((x) => x.ocorrencia === 1)).toBe(true);
  });

  it("idempotência: o mesmo arquivo lido duas vezes gera exatamente as mesmas chaves (reimportação não duplica)", () => {
    const linhas = [linha("BG 03", "01/06/2026 00:48", "400", "P", 2, 19.8), linha("BG 03", "01/06/2026 00:48", "400", "P", 2, 19.8), linha("BG 05", "01/06/2026 01:26", "999", "Q", 1, 29.99)];
    const a = parseCancelamentoSalaoDetalhe(CAB, linhas).registros.map(chaveDetalhe);
    const b = parseCancelamentoSalaoDetalhe(CAB, linhas).registros.map(chaveDetalhe);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe("resumo do alerta", () => {
  const e = (unidade: string, dia: string, comanda: string, valor: number, motivo = "M1"): EstornoMadrugada => ({
    unidade, dataOperacional: dia, estornoEm: `${dia} 01:00:00`, comanda, produto: "P", quantidade: 1, valor, motivo, atendente: "A", autorizador: "B",
  });
  it("estornos = linhas; valor soma; lojas ordenadas por valor; comandas = comanda + dia operacional", () => {
    const r = resumirMadrugada([e("BG 01", "2026-06-01", "10", 10), e("BG 01", "2026-06-01", "10", 5), e("BG 01", "2026-06-02", "10", 5), e("BG 02", "2026-06-01", "10", 40, "M2")]);
    expect(r.estornos).toBe(4);
    expect(r.valor).toBe(60);
    expect(r.lojas.map((l) => [l.unidade, l.estornos, l.comandas, l.valor])).toEqual([["BG 02", 1, 1, 40], ["BG 01", 3, 2, 20]]);
    expect(r.comandas).toBe(3);
    expect(r.porMotivo[0]).toEqual({ motivo: "M2", estornos: 1, valor: 40 });
  });
  it("sem estornos: zeros e listas vazias (nada inventado)", () => {
    expect(resumirMadrugada([])).toEqual({ estornos: 0, valor: 0, comandas: 0, lojas: [], porMotivo: [] });
  });
});
