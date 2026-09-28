import { describe, expect, it } from "vitest";
import { parseListaSimples, CONFIGS_LISTA_SIMPLES } from "@/lib/import/parsers/listaSimples";
import { parseQuebraCaixa } from "@/lib/import/parsers/quebraCaixa";
import { gerarRelatorioImportacao } from "@/lib/import/relatorio";

describe("parseListaSimples — brindes", () => {
  const cabecalho = ["Loja", "Tipo", "Motivo", "Data", "Caixa", "Cupom", "Valor", "Motivo 02"];

  it("aceita BG 08 E 09 como uma única unidade e soma corretamente", () => {
    const linhas = [
      ["BG 08 E 09", "DESCONTO", "BRINDE ANIVERSARIANTE", "01/07/2026", "PDV 01", "100", 10, "COMBO"],
      ["BG 08 E 09", "DESCONTO", "BRINDE ANIVERSARIANTE", "02/07/2026", "PDV 01", "101", 5, "COMBO"],
    ];
    const resultado = parseListaSimples(cabecalho, linhas, CONFIGS_LISTA_SIMPLES.brindes);
    expect(resultado.registros).toHaveLength(2);
    expect(resultado.registros.every((r) => r.unidade === "BG 08 E 09")).toBe(true);

    const relatorio = gerarRelatorioImportacao("brindes", resultado);
    expect(relatorio.somaValor).toBe(15);
    expect(relatorio.porFilial).toEqual([{ unidade: "BG 08 E 09", registros: 2, somaValor: 15 }]);
  });

  it("rejeita unidade desconhecida com motivo claro", () => {
    const linhas = [["LOJA FANTASMA", "DESCONTO", "X", "01/07/2026", "PDV 01", "100", 10, ""]];
    const resultado = parseListaSimples(cabecalho, linhas, CONFIGS_LISTA_SIMPLES.brindes);
    expect(resultado.registros).toHaveLength(0);
    expect(resultado.rejeitados).toHaveLength(1);
    expect(resultado.rejeitados[0].motivo).toMatch(/Unidade não reconhecida/);
  });

  it("rejeita data inválida", () => {
    const linhas = [["BG 01", "DESCONTO", "X", "31/13/2026", "PDV 01", "100", 10, ""]];
    const resultado = parseListaSimples(cabecalho, linhas, CONFIGS_LISTA_SIMPLES.brindes);
    expect(resultado.rejeitados[0].motivo).toMatch(/Data inválida/);
  });

  it("ignora linhas completamente vazias", () => {
    const linhas = [
      ["BG 01", "DESCONTO", "X", "01/07/2026", "PDV 01", "100", 10, ""],
      [null, null, null, null, null, null, null, null],
    ];
    const resultado = parseListaSimples(cabecalho, linhas, CONFIGS_LISTA_SIMPLES.brindes);
    expect(resultado.registros).toHaveLength(1);
    expect(resultado.rejeitados).toHaveLength(0);
  });

  it("aceita objeto Date (como o ExcelJS entrega) além de texto dd/mm/aaaa", () => {
    const linhas = [["BG 01", "DESCONTO", "X", new Date("2026-07-01T00:00:00Z"), "PDV 01", "100", 10, ""]];
    const resultado = parseListaSimples(cabecalho, linhas, CONFIGS_LISTA_SIMPLES.brindes);
    expect(resultado.registros).toHaveLength(1);
    expect(resultado.registros[0].data.toISOString().slice(0, 10)).toBe("2026-07-01");
  });
});

describe("parseListaSimples — pré-agregação por soma (confirmado no painel HTML: agg.set + combo.valor += valor)", () => {
  const cabecalhoCompra = ["Filial", "Caixa", "Data", "Valor", "Motivo", "Descrição"];

  it("compra_direta: duas linhas com a mesma chave (filial+data+motivo) são SOMADAS num único registro, não sobrescritas", () => {
    const linhas = [
      ["BG 01", "PDV 01", "01/07/2026", "100", "CMO/FREE", "desc 1"],
      ["BG 01", "PDV 02", "01/07/2026", "50", "CMO/FREE", "desc 2"], // mesma chave: filial+data+motivo
    ];
    const resultado = parseListaSimples(cabecalhoCompra, linhas, CONFIGS_LISTA_SIMPLES.compra_direta);
    expect(resultado.registros).toHaveLength(1);
    expect(resultado.registros[0].valor).toBe(150); // 100 + 50, não 50 (última) nem colisão
    const relatorio = gerarRelatorioImportacao("compra_direta", resultado);
    expect(relatorio.colisoesDeChaveNoArquivo).toBe(0); // já agregado — nenhuma chave duplicada sobra
    expect(relatorio.somaValor).toBe(150);
  });

  it("brindes: soma financeira ANTES da agregação == soma DEPOIS da agregação (nenhum valor perdido)", () => {
    const cabecalhoBrindes = ["Loja", "Tipo", "Motivo", "Data", "Caixa", "Cupom", "Valor", "Motivo 02"];
    const linhas = [
      ["BG 01", "DESCONTO", "AA", "01/07/2026", "PDV 01", "1", 10, "X"],
      ["BG 01", "DESCONTO", "AA", "01/07/2026", "PDV 02", "2", 20, "X"], // mesma chave (motivo+motivo2 iguais)
      ["BG 01", "DESCONTO", "AA", "01/07/2026", "PDV 03", "3", 5.5, "X"], // 3 linhas na mesma chave
    ];
    const somaAntes = linhas.reduce((s, l) => s + (l[6] as number), 0);
    const resultado = parseListaSimples(cabecalhoBrindes, linhas, CONFIGS_LISTA_SIMPLES.brindes);
    expect(resultado.registros).toHaveLength(1);
    const somaDepois = resultado.registros.reduce((s, r) => s + r.valor, 0);
    expect(somaDepois).toBe(somaAntes);
    expect(somaDepois).toBe(35.5);
  });

  it("motivo vazio vira 'NÃO INFORMADO' (confirmado no painel), motivo2 continua vazio (não confirmado para motivo2)", () => {
    const cabecalhoBrindes = ["Loja", "Tipo", "Motivo", "Data", "Caixa", "Cupom", "Valor", "Motivo 02"];
    const linhas = [["BG 01", "DESCONTO", "", "01/07/2026", "PDV 01", "1", 10, ""]];
    const resultado = parseListaSimples(cabecalhoBrindes, linhas, CONFIGS_LISTA_SIMPLES.brindes);
    expect(resultado.registros[0].extras.motivo).toBe("NÃO INFORMADO");
    expect(resultado.registros[0].extras.motivo2).toBe("");
  });

  it("retirada_deposito NÃO agrega por soma (o painel grava uma linha por lançamento nesta base)", () => {
    const cabecalhoRetirada = ["Filial", "Caixa", "Data", "Valor", "Motivo", "Motivo/Descrição", "Usuário", "Usuário autorizador"];
    const linhas = [
      ["BG 01", "PDV 01", "01/07/2026", 100, "DEPOSITO", "d1", "A", "A"],
      ["BG 01", "PDV 01", "01/07/2026", 100, "DEPOSITO", "d1", "A", "A"], // linha idêntica — legítima, não deve virar 1 só
    ];
    const resultado = parseListaSimples(cabecalhoRetirada, linhas, CONFIGS_LISTA_SIMPLES.retirada_deposito);
    expect(resultado.registros).toHaveLength(2);
  });
});

describe("parseQuebraCaixa", () => {
  const cabecalho = ["MÊS", "DATA", "LOJA", "CONFERENTE", "QUEBRA", "OPERADOR", "CPF", "MOTIVO"];

  it("parseia registros de quebra de uma aba já resolvida, incluindo CPF", () => {
    const linhas = [
      ["AGOSTO", "16/08/2026", "BG 07", "MONALISA", 64.29, "JAIME SOUZA", "111", "BRINDE INJUSTIFICADO"],
      ["SETEMBRO", "23/09/2026", "BG 04", "MONALISA", 5.5, "LUIZA FERREIRA", "222", "ERRO DE DESPACHO"],
    ];
    const resultado = parseQuebraCaixa(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(2);
    expect(resultado.registros[0].valor).toBe(64.29);
    expect(resultado.registros[0].unidade).toBe("BG 07");
    expect(resultado.registros[0].extras.cpf).toBe("111");
  });

  it("REGRESSÃO: chave completa (conferente+operador+cpf+motivo) não gera falsa colisão " +
    "— valor da quebra nunca entra na chave", () => {
    const linhas = [
      ["AGOSTO", "16/08/2026", "BG 07", "MONALISA", 64.29, "JAIME SOUZA", "111", "MOTIVO A"],
      ["AGOSTO", "16/08/2026", "BG 07", "OUTRO CONFERENTE", 10, "OUTRO OPERADOR", "222", "MOTIVO B"],
    ];
    const resultado = parseQuebraCaixa(cabecalho, linhas);
    const relatorio = gerarRelatorioImportacao("quebra_caixa", resultado);
    expect(relatorio.colisoesDeChaveNoArquivo).toBe(0);
  });

  it("mesma combinação de chave com valor diferente é tratada como atualização (colide), não como novo registro", () => {
    const linhas = [
      ["AGOSTO", "16/08/2026", "BG 07", "MONALISA", 64.29, "JAIME SOUZA", "111", "MOTIVO A"],
      ["AGOSTO", "16/08/2026", "BG 07", "MONALISA", 999, "JAIME SOUZA", "111", "MOTIVO A"], // só o valor mudou
    ];
    const resultado = parseQuebraCaixa(cabecalho, linhas);
    const relatorio = gerarRelatorioImportacao("quebra_caixa", resultado);
    expect(relatorio.colisoesDeChaveNoArquivo).toBe(1);
  });
});
