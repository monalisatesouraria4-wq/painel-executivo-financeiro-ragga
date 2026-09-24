import { describe, expect, it } from "vitest";
import { resolverAba, type AbaPeriodo } from "@/lib/rules/resolverAba";

const abaConferencia16_08: AbaPeriodo = {
  id: "conf-1",
  nomeAba: "16.08 a 15.09",
  periodoInicio: new Date("2026-08-16"),
  periodoFim: new Date("2026-09-15"),
};

const abaConferencia16_09: AbaPeriodo = {
  id: "conf-2",
  nomeAba: "16.09 a 15.10",
  periodoInicio: new Date("2026-09-16"),
  periodoFim: new Date("2026-10-15"),
};

const abasConferencia = [abaConferencia16_08, abaConferencia16_09];

const abaQuebra16_09: AbaPeriodo = {
  id: "quebra-2",
  nomeAba: "QUEBRA 16-09 A 15-10",
  periodoInicio: new Date("2026-09-16"),
  periodoFim: new Date("2026-10-15"),
};

describe("resolverAba", () => {
  it("resolve a aba correta quando a data está dentro do intervalo", () => {
    const resultado = resolverAba(new Date("2026-09-24"), abasConferencia);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.aba.nomeAba).toBe("16.09 a 15.10");
    }
  });

  it("resolve corretamente no limite inicial do período (inclusive)", () => {
    const resultado = resolverAba(new Date("2026-09-16"), abasConferencia);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.aba.id).toBe("conf-2");
  });

  it("resolve corretamente no limite final do período (inclusive)", () => {
    const resultado = resolverAba(new Date("2026-09-15"), abasConferencia);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.aba.id).toBe("conf-1");
  });

  it("retorna erro claro quando nenhuma aba corresponde à data", () => {
    const resultado = resolverAba(new Date("2027-01-01"), abasConferencia);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro).toBe("NENHUMA_ABA_CORRESPONDE");
  });

  it("retorna erro de ambiguidade quando duas abas se sobrepõem para a mesma data", () => {
    const abaSobreposta: AbaPeriodo = {
      id: "conf-2b",
      nomeAba: "16.09 a 15.10 (duplicada)",
      periodoInicio: new Date("2026-09-10"),
      periodoFim: new Date("2026-10-20"),
    };
    const resultado = resolverAba(new Date("2026-09-24"), [...abasConferencia, abaSobreposta]);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok && resultado.erro === "ABAS_AMBIGUAS") {
      expect(resultado.abasConflitantes.length).toBe(2);
    } else {
      throw new Error("esperado erro ABAS_AMBIGUAS");
    }
  });

  it("resolve Conferência e Quebra de Caixa de forma independente para a mesma data", () => {
    const resultadoConferencia = resolverAba(new Date("2026-09-24"), abasConferencia);
    const resultadoQuebra = resolverAba(new Date("2026-09-24"), [abaQuebra16_09]);

    expect(resultadoConferencia.ok).toBe(true);
    expect(resultadoQuebra.ok).toBe(true);
    if (resultadoConferencia.ok && resultadoQuebra.ok) {
      expect(resultadoConferencia.aba.nomeAba).not.toBe(resultadoQuebra.aba.nomeAba);
      expect(resultadoConferencia.aba.id).not.toBe(resultadoQuebra.aba.id);
    }
  });

  it("data futura sem aba cadastrada retorna erro claro, sem assumir aba", () => {
    const resultado = resolverAba(new Date("2028-05-01"), abasConferencia);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.erro).toBe("NENHUMA_ABA_CORRESPONDE");
  });
});
