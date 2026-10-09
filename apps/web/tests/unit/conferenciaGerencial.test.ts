import { describe, expect, it } from "vitest";
import { ehFimDeSemanaSemConferencia, posicaoDoUltimoDia, resumirConferenciaGerencial } from "@/lib/services/conferenciaGerencial";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
// 2026-09-28 = segunda · 03/10 sábado · 04/10 domingo
const dia = (data: string, cad: number, conf: number | null, emAtraso = false) => ({
  data: d(data),
  qtdCadastrados: cad,
  qtdConferidos: conf,
  emAtraso,
  respConferencia: "RESP",
  status: null,
});
const loja = (unidade: string, dias: ReturnType<typeof dia>[]) => ({ unidade: unidade as never, dias });

// Matriz real de referência: BG 07, 6 caixas cadastradas, 28/09 a 04/10 → X 5 6 6 X X 3
const bg07 = () =>
  loja("BG 07", [
    dia("2026-09-28", 6, null, true),
    dia("2026-09-29", 6, 5),
    dia("2026-09-30", 6, 6),
    dia("2026-10-01", 6, 6),
    dia("2026-10-02", 6, null, true),
    dia("2026-10-03", 6, null, true),
    dia("2026-10-04", 6, 3),
  ]);

describe("Conferência gerencial — exemplo de referência BG 07", () => {
  it("20 conferidos, 18 em atraso (3 X × 6), 38 previstos e 52,6%", () => {
    const r = resumirConferenciaGerencial([bg07()]);
    expect(r.rede.conferidas).toBe(20);
    expect(r.rede.atrasadas).toBe(18);
    expect(r.rede.previstas).toBe(38);
    expect(r.rede.percentual).toBeCloseTo((20 / 38) * 100, 9);
    expect(r.rede.percentual?.toFixed(1)).toBe("52.6");
    expect(r.lojas[0]).toMatchObject({ unidade: "BG 07", conferidas: 20, atrasadas: 18, previstas: 38 });
  });
});

describe("Conferência gerencial — regras de leitura da matriz", () => {
  it("cada X conta a quantidade cadastrada DAQUELE dia (cadastro pode variar por dia)", () => {
    const r = resumirConferenciaGerencial([loja("BG 02", [dia("2026-09-28", 5, null, true), dia("2026-09-29", 7, null, true), dia("2026-09-30", 5, 5)])]);
    expect(r.rede).toMatchObject({ atrasadas: 12, conferidas: 5, previstas: 17 });
  });

  it("números verdes são somados integralmente, inclusive acima do cadastro", () => {
    const r = resumirConferenciaGerencial([loja("BG 08 E 09", [dia("2026-09-28", 5, 6), dia("2026-09-29", 5, 5)])]);
    expect(r.rede).toMatchObject({ conferidas: 11, atrasadas: 0, previstas: 11, percentual: 100 });
  });

  it("valor 0 não gera atraso automaticamente", () => {
    const r = resumirConferenciaGerencial([loja("BG 03", [dia("2026-09-28", 5, 0), dia("2026-09-29", 5, 5)])]);
    expect(r.rede).toMatchObject({ conferidas: 5, atrasadas: 0, previstas: 5 });
  });

  it("diferença entre cadastro e conferência, sem X, não gera atraso", () => {
    const r = resumirConferenciaGerencial([loja("BG 04", [dia("2026-09-28", 10, 2), dia("2026-09-29", 10, 3)])]);
    expect(r.rede).toMatchObject({ conferidas: 5, atrasadas: 0, previstas: 5, percentual: 100 });
    expect(r.lojas[0].atrasadas).toBe(0);
  });

  it("X é atraso em qualquer dia, mesmo logo na segunda (antes de qualquer prazo)", () => {
    const r = resumirConferenciaGerencial([loja("BG 05", [dia("2026-09-28", 4, null, true)])]);
    expect(r.rede.atrasadas).toBe(4);
  });

  it("percentual é ponderado (Σ conferidos ÷ Σ previstos), não média de percentuais das lojas", () => {
    const r = resumirConferenciaGerencial([loja("BG 01", [dia("2026-09-28", 100, 100)]), loja("BG 02", [dia("2026-09-28", 1, null, true)])]);
    expect(r.rede.percentual).toBeCloseTo((100 / 101) * 100, 9); // média simples seria 50%
  });

  it("soma das lojas = rede", () => {
    const r = resumirConferenciaGerencial([bg07(), loja("BG 01", [dia("2026-09-28", 5, 5)])]);
    expect(r.lojas.reduce((s, l) => s + l.conferidas, 0)).toBe(r.rede.conferidas);
    expect(r.lojas.reduce((s, l) => s + l.atrasadas, 0)).toBe(r.rede.atrasadas);
    expect(r.lojas.reduce((s, l) => s + l.previstas, 0)).toBe(r.rede.previstas);
  });

  it("sem registros: zeros e percentual nulo (a tela mostra 'Sem dados para o período', sem inventar %)", () => {
    const r = resumirConferenciaGerencial([]);
    expect(r.rede).toEqual({ previstas: 0, conferidas: 0, atrasadas: 0, percentual: null });
    expect(r.lojas).toEqual([]);
  });
});

describe("Conferência gerencial — ranking", () => {
  it("mais caixas em atraso primeiro; empate: menor %; depois ordem oficial", () => {
    const r = resumirConferenciaGerencial([
      loja("BG 01", [dia("2026-09-28", 5, 5)]), // 0 atraso, 100%
      loja("BG 02", [dia("2026-09-28", 4, null, true), dia("2026-09-29", 4, 4)]), // 4 atraso, 50%
      loja("BG 03", [dia("2026-09-28", 4, null, true), dia("2026-09-29", 4, 1)]), // 4 atraso, 20%
      loja("BG 04", [dia("2026-09-28", 6, null, true)]), // 6 atraso, 0%
      loja("BG 05", [dia("2026-09-28", 5, 1)]), // 0 atraso, 100% (conferido abaixo do cadastro não é atraso)
    ]);
    expect(r.lojas.map((l) => l.unidade)).toEqual(["BG 04", "BG 03", "BG 02", "BG 01", "BG 05"]);
  });
});

describe("Conferência gerencial — MAPOLI aos sábados e domingos", () => {
  it("fica fora de todos os indicadores (inclusive X); nos dias úteis continua", () => {
    expect(ehFimDeSemanaSemConferencia("MAPOLI", d("2026-10-03"))).toBe(true);
    expect(ehFimDeSemanaSemConferencia("MAPOLI", d("2026-10-04"))).toBe(true);
    expect(ehFimDeSemanaSemConferencia("MAPOLI", d("2026-09-29"))).toBe(false);
    expect(ehFimDeSemanaSemConferencia("BG 01", d("2026-10-03"))).toBe(false);
    const r = resumirConferenciaGerencial([loja("MAPOLI", [dia("2026-09-29", 1, 1), dia("2026-10-03", 1, null, true), dia("2026-10-04", 1, 0)])]);
    expect(r.rede).toEqual({ previstas: 1, conferidas: 1, atrasadas: 0, percentual: 100 });
    expect(r.registrosMapoliFimDeSemana).toBe(2);
  });
});

describe("Conferência gerencial — posição do último dia × resumo do período", () => {
  it("a posição usa só a data de referência e o resumo continua usando o período inteiro", () => {
    const linhas = [bg07(), loja("BG 01", [dia("2026-10-03", 5, 5), dia("2026-10-04", 5, 2)]), loja("MAPOLI", [dia("2026-10-04", 1, 1)])];
    const p = posicaoDoUltimoDia(linhas);
    expect(p.data?.toISOString().slice(0, 10)).toBe("2026-10-04");
    // 04/10 sem a MAPOLI de domingo: BG 07 = 3 conferidos; BG 01 = 2 conferidos; sem X nessa data
    expect(p.resumo).toEqual({ previstas: 5, conferidas: 5, atrasadas: 0, percentual: 100 });
    // período inteiro: o X de 03/10 e os demais continuam contados no resumo
    expect(resumirConferenciaGerencial(linhas).rede.atrasadas).toBe(18);
  });

  it("X da própria data entra na posição do dia", () => {
    const p = posicaoDoUltimoDia([loja("BG 07", [dia("2026-10-02", 6, 6), dia("2026-10-03", 6, null, true)])]);
    expect(p.data?.toISOString().slice(0, 10)).toBe("2026-10-03");
    expect(p.resumo).toEqual({ previstas: 6, conferidas: 0, atrasadas: 6, percentual: 0 });
  });

  it("sem registros: data nula e % nulo; MAPOLI de fim de semana não define a data", () => {
    const vazio = posicaoDoUltimoDia([]);
    expect(vazio.data).toBeNull();
    expect(vazio.resumo.percentual).toBeNull();
    const so = posicaoDoUltimoDia([loja("BG 01", [dia("2026-10-02", 2, 2)]), loja("MAPOLI", [dia("2026-10-04", 1, 1)])]);
    expect(so.data?.toISOString().slice(0, 10)).toBe("2026-10-02");
  });
});
