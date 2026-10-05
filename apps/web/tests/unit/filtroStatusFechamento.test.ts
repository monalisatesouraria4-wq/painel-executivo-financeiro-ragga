import { describe, expect, it } from "vitest";
import { filtrarLinhasPorStatus, resumirLinhasFechamento, type CaixaAberturaFechamentoLinha } from "@/lib/services/aberturaFechamento";

function linha(situacao: string, difFechamento: number | null, unidade = "BG 01"): CaixaAberturaFechamentoLinha {
  return {
    unidade: unidade as never,
    caixa: "CX",
    movimento: "1",
    operador: null,
    abertura: null,
    fechamento: null,
    situacao,
    fechado: situacao === "Fechado" || situacao === "Conciliado",
    difFechamento,
    difConciliacao: null,
    difTotal: null,
  };
}

const linhas = [linha("Conciliado", -10), linha("Conciliado", 4), linha("Fechado", -100), linha("Aberto", null)];

describe("filtro de status do Fechamento de Caixa", () => {
  it("Todos mantém todas as linhas e o resumo atual", () => {
    expect(filtrarLinhasPorStatus(linhas, "TODOS")).toHaveLength(4);
    expect(resumirLinhasFechamento(linhas)).toEqual({ disponivel: true, abertos: 4, fechados: 3, emAberto: 1, diferencaFinanceira: -106 });
  });
  it("Conciliado considera só os conciliados (diferença real dos já conferidos)", () => {
    const r = resumirLinhasFechamento(filtrarLinhasPorStatus(linhas, "Conciliado"));
    expect(r).toEqual({ disponivel: true, abertos: 2, fechados: 2, emAberto: 0, diferencaFinanceira: -6 });
  });
  it("Fechado e Aberto usam exatamente os valores da base; caixa aberto não vira zero", () => {
    expect(resumirLinhasFechamento(filtrarLinhasPorStatus(linhas, "Fechado"))).toMatchObject({ abertos: 1, fechados: 1, emAberto: 0, diferencaFinanceira: -100 });
    const aberto = resumirLinhasFechamento(filtrarLinhasPorStatus(linhas, "Aberto"));
    expect(aberto).toMatchObject({ abertos: 1, fechados: 0, emAberto: 1, diferencaFinanceira: 0 });
  });
  it("status sem registros → indisponível (a tela mostra 'Sem dados no período')", () => {
    expect(resumirLinhasFechamento(filtrarLinhasPorStatus([linha("Conciliado", 1)], "Aberto")).disponivel).toBe(false);
  });
});
