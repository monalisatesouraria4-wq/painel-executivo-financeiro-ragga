import { describe, expect, it } from "vitest";
import { parseFormasPagamento } from "@/lib/import/parsers/formasPagamento";
import { gerarRelatorioImportacao } from "@/lib/import/relatorio";

const cabecalho = [
  "Filial", "Caixa", "Data", "Cupom", "Hora", "Itens", "Chave",
  "CPF/CNPJ", "Nome do cliente", "Desc. pagam.", "Nr. parc", "Vl. pagamento",
];

describe("parseFormasPagamento — mesma fonte do Faturamento, agregado por filial+data+forma", () => {
  it("agrega por forma separadamente (não mistura formas diferentes no mesmo dia)", () => {
    const linhas = [
      ["BG 01", "PDV 01", "01/02/2026", "1", "10:00", "1", null, null, null, "CARTAO CREDITO", "1", 50],
      ["BG 01", "PDV 01", "01/02/2026", "2", "10:05", "1", null, null, null, "DINHEIRO", "1", 20],
      ["BG 01", "PDV 01", "01/02/2026", "3", "10:10", "1", null, null, null, "CARTAO CREDITO", "1", 30],
    ];
    const resultado = parseFormasPagamento(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(2);
    const credito = resultado.registros.find((r) => r.extras.forma === "CARTAO CREDITO");
    const dinheiro = resultado.registros.find((r) => r.extras.forma === "DINHEIRO");
    expect(credito?.valor).toBe(80);
    expect(dinheiro?.valor).toBe(20);
  });

  it("mesma forma, dias diferentes, gera registros separados", () => {
    const linhas = [
      ["BG 01", "PDV 01", "01/02/2026", "1", "10:00", "1", null, null, null, "PIX", "1", 10],
      ["BG 01", "PDV 01", "02/02/2026", "2", "10:00", "1", null, null, null, "PIX", "1", 20],
    ];
    const resultado = parseFormasPagamento(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(2);
  });

  it("chave filial+data+forma não colide no relatório (mesmo campo usado em CHAVES_POR_BASE)", () => {
    const linhas = [
      ["BG 01", "PDV 01", "01/02/2026", "1", "10:00", "1", null, null, null, "PIX", "1", 10],
      ["BG 01", "PDV 01", "01/02/2026", "2", "10:00", "1", null, null, null, "DINHEIRO", "1", 20],
    ];
    const resultado = parseFormasPagamento(cabecalho, linhas);
    const relatorio = gerarRelatorioImportacao("formas_pagamento", resultado);
    expect(relatorio.colisoesDeChaveNoArquivo).toBe(0);
  });

  it("rejeita unidade não reconhecida e forma vazia", () => {
    const linhas = [
      ["LOJA X", "PDV 01", "01/02/2026", "1", "10:00", "1", null, null, null, "PIX", "1", 10],
      ["BG 01", "PDV 01", "01/02/2026", "2", "10:00", "1", null, null, null, "", "1", 10],
    ];
    const resultado = parseFormasPagamento(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(0);
    expect(resultado.rejeitados).toHaveLength(2);
  });
});
