import { describe, expect, it } from "vitest";
import { ehFimDeSemanaSemConferencia, resumirConferenciaGerencial } from "@/lib/services/conferenciaGerencial";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
// 2026-09-21 = segunda · 22 terça · 26 sábado · 27 domingo
const dia = (data: string, cad: number, conf: number | null, emAtraso = false) => ({
  data: d(data),
  qtdCadastrados: cad,
  qtdConferidos: conf,
  emAtraso,
  respConferencia: "RESP",
  status: null,
});
const loja = (unidade: string, dias: ReturnType<typeof dia>[]) => ({ unidade: unidade as never, dias });

describe("Conferência gerencial — previsto × conferido × pendente", () => {
  const linhas = [
    loja("BG 07", [dia("2026-09-21", 20, 14), dia("2026-09-22", 20, 14)]), // 28/40 = 70%
    loja("BG 02", [dia("2026-09-21", 20, 16), dia("2026-09-22", 20, 16)]), // 32/40 = 80%
    loja("BG 01", [dia("2026-09-21", 10, 10), dia("2026-09-22", 10, 10)]), // 100%
  ];
  const r = resumirConferenciaGerencial(linhas);

  it("conferidos + pendentes = previstos (rede e cada loja) e % = conferidos ÷ previstos × 100", () => {
    expect(r.rede).toEqual({ previstos: 100, conferidos: 80, pendentes: 20, percentual: 80 }); // 28 + 32 + 20
    expect(r.rede.conferidos + r.rede.pendentes).toBe(r.rede.previstos);
    for (const l of r.lojas) {
      expect(l.conferidos + l.pendentes).toBe(l.previstos);
      expect(l.percentual).toBeCloseTo((l.conferidos / l.previstos) * 100, 9);
    }
  });

  it("soma das lojas = rede", () => {
    expect(r.lojas.reduce((s, l) => s + l.previstos, 0)).toBe(r.rede.previstos);
    expect(r.lojas.reduce((s, l) => s + l.conferidos, 0)).toBe(r.rede.conferidos);
    expect(r.lojas.reduce((s, l) => s + l.pendentes, 0)).toBe(r.rede.pendentes);
  });

  it("ranking: menor % primeiro (70% → 80% → 100%)", () => {
    expect(r.lojas.map((l) => [l.unidade, l.percentual])).toEqual([["BG 07", 70], ["BG 02", 80], ["BG 01", 100]]);
  });

  it("empate de %: mais caixas pendentes primeiro; persistindo, ordem oficial das lojas", () => {
    const e = resumirConferenciaGerencial([
      loja("BG 03", [dia("2026-09-21", 10, 5)]), // 50%, 5 pendentes
      loja("BG 02", [dia("2026-09-21", 20, 10)]), // 50%, 10 pendentes
      loja("BG 01", [dia("2026-09-21", 10, 5)]), // 50%, 5 pendentes (ordem oficial antes de BG 03)
    ]);
    expect(e.lojas.map((l) => l.unidade)).toEqual(["BG 02", "BG 01", "BG 03"]);
  });

  it("conferido nulo (em atraso/vazio) conta como 0 conferido → todo o previsto fica pendente", () => {
    const e = resumirConferenciaGerencial([loja("BG 05", [dia("2026-09-21", 5, null, true), dia("2026-09-22", 5, 5)])]);
    expect(e.rede).toEqual({ previstos: 10, conferidos: 5, pendentes: 5, percentual: 50 });
  });

  it("conferido acima do cadastrado é limitado ao cadastrado e não compensa pendência de outro dia/loja", () => {
    const e = resumirConferenciaGerencial([loja("BG 08 E 09", [dia("2026-09-21", 3, 4), dia("2026-09-22", 3, 1)])]);
    expect(e.rede).toEqual({ previstos: 6, conferidos: 4, pendentes: 2, percentual: (4 / 6) * 100 }); // 3 (limitado) + 1
    expect(e.registrosComExcedente).toBe(1);
    expect(e.unidadesExcedente).toBe(1);
    expect(e.rede.conferidos + e.rede.pendentes).toBe(e.rede.previstos);
  });

  it("MAPOLI aos sábados e domingos não é previsto; nos dias úteis continua", () => {
    expect(ehFimDeSemanaSemConferencia("MAPOLI", d("2026-09-26"))).toBe(true);
    expect(ehFimDeSemanaSemConferencia("MAPOLI", d("2026-09-27"))).toBe(true);
    expect(ehFimDeSemanaSemConferencia("MAPOLI", d("2026-09-22"))).toBe(false);
    expect(ehFimDeSemanaSemConferencia("BG 01", d("2026-09-26"))).toBe(false);
    const e = resumirConferenciaGerencial([loja("MAPOLI", [dia("2026-09-22", 1, 1), dia("2026-09-26", 1, 0), dia("2026-09-27", 1, 0)])]);
    expect(e.rede).toEqual({ previstos: 1, conferidos: 1, pendentes: 0, percentual: 100 });
    expect(e.registrosMapoliFimDeSemana).toBe(2);
  });

  it("filtro de loja: tudo é recalculado só sobre a loja", () => {
    const so = resumirConferenciaGerencial(linhas.filter((l) => l.unidade === "BG 07"));
    expect(so.lojas).toHaveLength(1);
    expect(so.rede).toEqual({ previstos: 40, conferidos: 28, pendentes: 12, percentual: 70 });
  });

  it("período diferente = outro conjunto de dias → outros totais (mesma regra)", () => {
    const umDia = resumirConferenciaGerencial(linhas.map((l) => ({ ...l, dias: l.dias.slice(0, 1) })));
    expect(umDia.rede).toEqual({ previstos: 50, conferidos: 40, pendentes: 10, percentual: 80 }); // 14 + 16 + 10
  });

  it("sem registros → sem previsto e percentual nulo (nunca 0% inventado)", () => {
    const e = resumirConferenciaGerencial([]);
    expect(e.rede).toEqual({ previstos: 0, conferidos: 0, pendentes: 0, percentual: null });
    expect(e.lojas).toEqual([]);
  });
});
