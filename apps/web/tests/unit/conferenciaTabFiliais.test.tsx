import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConferenciaTab } from "@/components/controlesCaixa/ConferenciaTab";
import type { ControlesCaixaData, ConferenciaLinha } from "@/lib/services/controlesCaixa";

/**
 * Tela de Conferência: TODAS as filiais da rede aparecem (inclusive as sem conferência no ciclo), "X" continua X e os cartões
 * separam cadastro (Σ Qtd. caixas = "TOTAL DE CAIXAS" da planilha) de soma diária de conferidos/previstos. Dados fictícios.
 */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TODAS = ["BG 01", "BG 02", "BG 03", "BG 04", "BG 05", "BG 06", "BG 07", "BG 08 E 09", "BG 10", "BG 11", "BG 12", "BG 13", "IS 01", "IS 02", "IS 03", "ROBS", "MAPOLI"] as const;
const CAD: Record<string, number> = { "BG 01": 5, "BG 02": 5, "BG 03": 5, "BG 04": 5, "BG 05": 5, "BG 06": 4, "BG 07": 6, "BG 08 E 09": 3, "BG 10": 4, "BG 11": 4, "BG 12": 4, "BG 13": 4, "IS 01": 4, "IS 02": 2, "IS 03": 2, ROBS: 1, MAPOLI: 1 };

function dia(data: string, cad: number, conf: number | null, atraso = false) {
  return { data: d(data), qtdCadastrados: cad, qtdConferidos: conf, emAtraso: atraso, respConferencia: "MONALISA", status: null };
}
function linha(u: (typeof TODAS)[number], dias: ReturnType<typeof dia>[]): ConferenciaLinha {
  return dias.length
    ? { unidade: u, ultimaDataConferida: dias[0].data, status: null, percentualConferido: 100, atrasos: dias.filter((x) => x.emAtraso).length, qtdCadastrados: CAD[u], qtdConferidos: dias[0].qtdConferidos, pendentes: 0, dias }
    : { unidade: u, ultimaDataConferida: null, status: null, percentualConferido: null, atrasos: 0, qtdCadastrados: CAD[u], qtdConferidos: null, pendentes: null, dias: [], semRegistroNoPeriodo: true, respConferenciaConhecida: "MONALISA" };
}

const comRegistro: Record<string, ReturnType<typeof dia>[]> = {
  "BG 01": [dia("2026-10-18", 5, 3), dia("2026-10-17", 5, 5), dia("2026-10-16", 5, 5)],
  "BG 02": [dia("2026-10-18", 5, 3), dia("2026-10-17", 5, 5), dia("2026-10-16", 5, null, true)], // 16/10 = "X"
};
const dados: ControlesCaixaData["conferencia"] = {
  disponivel: true, percentualConferidoRede: null, totalEmAtraso: null,
  linhas: TODAS.map((u) => linha(u, comRegistro[u] ?? [])),
  totalCaixasRede: 10, totalConferidosRede: 6, totalPendentesRede: 0,
  periodoInicio: d("2026-10-16"), periodoFim: d("2026-11-15"),
  totalCaixasCadastradasRede: 64, lojasSemRegistro: TODAS.filter((u) => !comRegistro[u]),
};
const html = renderToStaticMarkup(<ConferenciaTab dados={dados} />);

describe("ConferenciaTab — filiais e totais", () => {
  it("lista TODAS as 17 filiais na matriz (as sem conferência aparecem com 'sem registro' e o cadastro de caixas)", () => {
    for (const u of TODAS) expect(html).toContain(`>${u}`);
    expect((html.match(/sem registro/g) ?? []).length).toBe(15); // 15 filiais sem conferência: marcadas na matriz
    expect(html).toContain("Filiais sem conferência registrada neste ciclo");
    expect(html).toContain("BG 03, BG 04, BG 05, BG 06, BG 07, BG 08 E 09, BG 10, BG 11, BG 12, BG 13, IS 01, IS 02, IS 03, ROBS, MAPOLI");
  });

  it("cartão 'Caixas cadastradas' = Σ Qtd. caixas (64) e fica separado de 'Caixas previstos/conferidos' (soma diária)", () => {
    expect(html).toContain("Caixas cadastradas");
    expect(html).toMatch(/Caixas cadastradas<\/p><p[^>]*>64</);
    // BG 01: 3+5+5 = 13 conferidos; BG 02: 3+5 = 8 conferidos + X (5 caixas) em atraso ⇒ conferidos 21, atraso 5, previstos 26
    expect(html).toMatch(/Caixas conferidos<\/p><p[^>]*>21</);
    expect(html).toMatch(/Caixas em atraso<\/p><p[^>]*>5</);
    expect(html).toMatch(/Caixas previstos<\/p><p[^>]*>26</);
  });

  it('o "X" continua X (atraso), nunca uma quantidade', () => {
    expect(html).toContain(">X<");
  });

  it("sem o total de cadastro conhecido, o cartão mostra '—' (nunca zero)", () => {
    const h = renderToStaticMarkup(<ConferenciaTab dados={{ ...dados, totalCaixasCadastradasRede: null }} />);
    expect(h).toMatch(/Caixas cadastradas<\/p><p[^>]*>—</);
  });

  it("sem registros no ciclo: 'Sem dados para o período' (nada inventado)", () => {
    const h = renderToStaticMarkup(<ConferenciaTab dados={{ ...dados, disponivel: false }} />);
    expect(h).toContain("Sem dados para o período");
  });
});
