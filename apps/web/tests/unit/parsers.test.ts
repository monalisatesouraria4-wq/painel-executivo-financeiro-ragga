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

describe("gerarRelatorioImportacao — colisão de chave no próprio arquivo", () => {
  const cabecalho = ["Filial", "Caixa", "Data", "Valor", "Motivo", "Descrição"];

  it("detecta duas linhas de compra_direta com a mesma chave (filial+data+motivo)", () => {
    const linhas = [
      ["BG 01", "PDV 01", "01/07/2026", "100", "CMO/FREE", "desc 1"],
      ["BG 01", "PDV 02", "01/07/2026", "50", "CMO/FREE", "desc 2"], // mesma chave: filial+data+motivo
    ];
    const resultado = parseListaSimples(cabecalho, linhas, CONFIGS_LISTA_SIMPLES.compra_direta);
    const relatorio = gerarRelatorioImportacao("compra_direta", resultado);
    expect(relatorio.colisoesDeChaveNoArquivo).toBe(1);
  });
});

describe("parseQuebraCaixa", () => {
  const cabecalho = ["MÊS", "DATA", "LOJA", "CONFERENTE", "QUEBRA", "OPERADOR", "CPF", "MOTIVO"];

  it("parseia registros de quebra de uma aba já resolvida", () => {
    const linhas = [
      ["AGOSTO", "16/08/2026", "BG 07", "MONALISA", 64.29, "JAIME SOUZA", "111", "BRINDE INJUSTIFICADO"],
      ["SETEMBRO", "23/09/2026", "BG 04", "MONALISA", 5.5, "LUIZA FERREIRA", "222", "ERRO DE DESPACHO"],
    ];
    const resultado = parseQuebraCaixa(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(2);
    expect(resultado.registros[0].valor).toBe(64.29);
    expect(resultado.registros[0].unidade).toBe("BG 07");
  });
});
