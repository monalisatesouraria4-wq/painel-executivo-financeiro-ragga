import { describe, expect, it } from "vitest";
import { extrairPeriodoDaAbaConferencia } from "@/lib/import/periodoAbaConferencia";
import { resolverAbaConferenciaPorData, type AbaConferenciaBruta } from "@/lib/import/resolverAbaConferencia";

/** Gera uma sequência de datas UTC consecutivas, como a linha 6 real. */
function sequenciaDeDatas(inicioISO: string, quantidadeDias: number): Date[] {
  const inicio = new Date(inicioISO + "T00:00:00.000Z");
  return Array.from({ length: quantidadeDias }, (_, i) => {
    const d = new Date(inicio.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });
}

// Abas reais confirmadas em CONTROLE DE CONFERENCIA E QUEBRAS DE CAIXA (5).xlsx
// (período extraído da própria linha de datas do arquivo, não do nome da aba).
const ABA_AGO_SET: AbaConferenciaBruta = {
  nomeAba: "16.08 a 15.09",
  celulasLinhaDeDatas: sequenciaDeDatas("2026-08-16", 30), // até 2026-09-14, confirmado no arquivo real
};
const ABA_SET_OUT: AbaConferenciaBruta = {
  nomeAba: "16.09 a 15.10",
  celulasLinhaDeDatas: sequenciaDeDatas("2026-09-16", 30), // até 2026-10-15
};
const ABA_OUT_NOV: AbaConferenciaBruta = {
  nomeAba: "16.10 a 15.11",
  celulasLinhaDeDatas: sequenciaDeDatas("2026-10-16", 30), // até 2026-11-14
};
const ABA_DEZ_JAN: AbaConferenciaBruta = {
  nomeAba: "16.12 a 15.01",
  celulasLinhaDeDatas: sequenciaDeDatas("2026-12-16", 30), // vira o ano: até 2027-01-14
};

// Aba real "16-10 A 15-09": na verdade tem layout de Quebra de Caixa
// (linha 6 mistura fórmula/texto, não é uma sequência de datas).
const ABA_INVALIDA_REAL: AbaConferenciaBruta = {
  nomeAba: "16-10 A 15-09",
  celulasLinhaDeDatas: [
    "MONALISA",
    "BG 01",
    5,
    { formula: "IFERROR(VLOOKUP(...))", result: "072.949.209-58" },
    "RETIRADA INDEVIDA",
  ],
};

describe("extrairPeriodoDaAbaConferencia", () => {
  it("extrai período de uma sequência válida de datas consecutivas", () => {
    const r = extrairPeriodoDaAbaConferencia(ABA_SET_OUT.celulasLinhaDeDatas);
    expect(r.valida).toBe(true);
    if (r.valida) {
      expect(r.periodoInicio.toISOString().slice(0, 10)).toBe("2026-09-16");
      expect(r.periodoFim.toISOString().slice(0, 10)).toBe("2026-10-15");
    }
  });

  it("rejeita a aba real '16-10 A 15-09' — estrutura de Quebra de Caixa, não uma linha de datas", () => {
    const r = extrairPeriodoDaAbaConferencia(ABA_INVALIDA_REAL.celulasLinhaDeDatas);
    expect(r.valida).toBe(false);
  });

  it("rejeita datas não consecutivas (buraco na sequência)", () => {
    const datas = sequenciaDeDatas("2026-09-16", 10);
    datas.splice(5, 1); // remove um dia no meio
    const r = extrairPeriodoDaAbaConferencia(datas);
    expect(r.valida).toBe(false);
  });

  it("rejeita período curto demais (abaixo do mínimo)", () => {
    const r = extrairPeriodoDaAbaConferencia(sequenciaDeDatas("2026-09-16", 3));
    expect(r.valida).toBe(false);
  });
});

describe("resolverAbaConferenciaPorData — cenário real com as abas do arquivo", () => {
  const abas = [ABA_AGO_SET, ABA_SET_OUT, ABA_OUT_NOV, ABA_DEZ_JAN, ABA_INVALIDA_REAL];

  it("data no INÍCIO do período (16/09) -> aba '16.09 a 15.10'", () => {
    const { resultado } = resolverAbaConferenciaPorData(new Date("2026-09-16T00:00:00Z"), abas);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.aba.nomeAba).toBe("16.09 a 15.10");
  });

  it("data no MEIO do período (20/09) -> aba '16.09 a 15.10'", () => {
    const { resultado } = resolverAbaConferenciaPorData(new Date("2026-09-20T00:00:00Z"), abas);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.aba.nomeAba).toBe("16.09 a 15.10");
  });

  it("data no FIM do período (15/10) -> ainda aba '16.09 a 15.10'", () => {
    const { resultado } = resolverAbaConferenciaPorData(new Date("2026-10-15T00:00:00Z"), abas);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.aba.nomeAba).toBe("16.09 a 15.10");
  });

  it("um dia após o fim (16/10) -> aba do período seguinte '16.10 a 15.11'", () => {
    const { resultado } = resolverAbaConferenciaPorData(new Date("2026-10-16T00:00:00Z"), abas);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.aba.nomeAba).toBe("16.10 a 15.11");
  });

  it("trata corretamente a virada de ano (aba 16.12 a 15.01, ex. 05/01/2027)", () => {
    const { resultado } = resolverAbaConferenciaPorData(new Date("2027-01-05T00:00:00Z"), abas);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.aba.nomeAba).toBe("16.12 a 15.01");
      expect(resultado.aba.periodoFim.toISOString().slice(0, 10)).toBe("2027-01-14");
    }
  });

  it("data sem nenhuma aba correspondente -> erro claro, nenhuma aba escolhida", () => {
    // 25/11/2026 não é coberto por nenhuma das abas de teste (falta o período 16.11 a 15.12)
    const { resultado } = resolverAbaConferenciaPorData(new Date("2026-11-25T00:00:00Z"), abas);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro).toBe("NENHUMA_ABA_CORRESPONDE");
  });

  it("a aba real inválida '16-10 A 15-09' nunca é escolhida, mesmo por engano", () => {
    // Se o nome fosse interpretado literalmente, poderia parecer cobrir out/set.
    // Como a estrutura é inválida, ela é excluída e não aparece na resolução.
    const { abasInvalidas, resultado } = resolverAbaConferenciaPorData(
      new Date("2026-09-20T00:00:00Z"),
      abas
    );
    expect(abasInvalidas.map((a) => a.nomeAba)).toContain("16-10 A 15-09");
    if (resultado.ok) expect(resultado.aba.nomeAba).not.toBe("16-10 A 15-09");
  });

  it("ambiguidade: duas abas com período sobreposto cobrindo a mesma data -> erro, sem escolha arbitrária", () => {
    const abaDuplicada: AbaConferenciaBruta = {
      nomeAba: "16.09 a 15.10 (cópia)",
      celulasLinhaDeDatas: sequenciaDeDatas("2026-09-10", 30), // sobrepõe ABA_SET_OUT
    };
    const { resultado } = resolverAbaConferenciaPorData(new Date("2026-09-20T00:00:00Z"), [
      ...abas,
      abaDuplicada,
    ]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok && resultado.erro === "ABAS_AMBIGUAS") {
      const nomes = resultado.abasConflitantes.map((a) => a.nomeAba);
      expect(nomes).toContain("16.09 a 15.10");
      expect(nomes).toContain("16.09 a 15.10 (cópia)");
    } else {
      throw new Error("esperado erro ABAS_AMBIGUAS");
    }
  });

  it("não assume que o período atual é sempre o último: funciona igual para o primeiro período da lista", () => {
    const { resultado } = resolverAbaConferenciaPorData(new Date("2026-08-20T00:00:00Z"), abas);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.aba.nomeAba).toBe("16.08 a 15.09");
  });
});
