import { describe, expect, it } from "vitest";
import { parseFaturamento } from "@/lib/import/parsers/faturamento";

const cabecalho = [
  "Filial", "Caixa", "Data", "Cupom", "Hora", "Itens", "Chave",
  "CPF/CNPJ", "Nome do cliente", "Desc. pagam.", "Nr. parc", "Vl. pagamento",
];

describe("parseFaturamento — regra oficial (SUM por filial+data)", () => {
  it("agrega múltiplos cupons/formas de pagamento do mesmo dia numa única soma por filial+data", () => {
    const linhas = [
      ["BG 01", "PDV 01", "01/02/2026", "1", "00:21", "1", null, null, null, "CARTAO CREDITO", "1", 38],
      ["BG 01", "PDV 01", "01/02/2026", "2", "00:25", "1", null, null, null, "DINHEIRO", "1", 44.4],
      ["BG 01", "PDV 02", "02/02/2026", "3", "00:31", "1", null, null, null, "PIX", "1", 100],
    ];
    const resultado = parseFaturamento(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(2); // BG01/01-02 e BG01/02-02
    const dia1 = resultado.registros.find((r) => r.data.toISOString().slice(0, 10) === "2026-02-01");
    expect(dia1?.valor).toBeCloseTo(82.4, 2);
    const dia2 = resultado.registros.find((r) => r.data.toISOString().slice(0, 10) === "2026-02-02");
    expect(dia2?.valor).toBe(100);
  });

  it("cupom com múltiplas formas de pagamento (split) soma normalmente, sem duplicar", () => {
    const linhas = [
      ["BG 02", "PDV 01", "01/02/2026", "10", "10:00", "1", null, null, null, "CARTAO CREDITO", "1", 50],
      ["BG 02", "PDV 01", "01/02/2026", "10", "10:00", "1", null, null, null, "DINHEIRO", "1", 20],
    ];
    const resultado = parseFaturamento(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(1);
    expect(resultado.registros[0].valor).toBe(70);
  });

  it("NÃO exclui valores negativos nem faz filtro de cancelamento (regra oficial atual)", () => {
    const linhas = [
      ["BG 03", "PDV 01", "01/02/2026", "20", "10:00", "1", null, null, null, "ESTORNO", "1", -30],
      ["BG 03", "PDV 01", "01/02/2026", "21", "10:05", "1", null, null, null, "DINHEIRO", "1", 100],
    ];
    const resultado = parseFaturamento(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(1);
    expect(resultado.registros[0].valor).toBe(70); // -30 + 100, somado sem exclusão
  });

  it("rejeita unidade não reconhecida e data inválida, sem quebrar a agregação das demais", () => {
    const linhas = [
      ["LOJA FANTASMA", "PDV 01", "01/02/2026", "1", "10:00", "1", null, null, null, "PIX", "1", 10],
      ["BG 01", "PDV 01", "31/13/2026", "2", "10:00", "1", null, null, null, "PIX", "1", 20],
      ["BG 01", "PDV 01", "01/02/2026", "3", "10:00", "1", null, null, null, "PIX", "1", 30],
    ];
    const resultado = parseFaturamento(cabecalho, linhas);
    expect(resultado.rejeitados).toHaveLength(2);
    expect(resultado.registros).toHaveLength(1);
    expect(resultado.registros[0].valor).toBe(30);
  });

  it("ignora linhas completamente vazias", () => {
    const linhas = [
      ["BG 01", "PDV 01", "01/02/2026", "1", "10:00", "1", null, null, null, "PIX", "1", 10],
      [null, null, null, null, null, null, null, null, null, null, null, null],
    ];
    const resultado = parseFaturamento(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(1);
    expect(resultado.rejeitados).toHaveLength(0);
  });
});
