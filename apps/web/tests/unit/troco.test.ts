import { describe, expect, it } from "vitest";
import { parseTroco } from "@/lib/import/parsers/troco";
import { gerarRelatorioImportacao } from "@/lib/import/relatorio";

const cabecalho = [
  "LOJA", "DATA", "CAIXA ", "R$ TROCO CONFERIDO PELO GERENTE",
  "R$ TROCO  INFORMADO PELO COLABORADOR", "DIFERENÇA TROCO ", "OPERADOR ", "PLANO DE AÇÃO ",
];

// ExcelJS entrega a coluna DATA como objeto Date (confirmado nos arquivos
// reais) — usar essa forma nos testes, não uma string ISO (que
// parseDataCelula não reconhece, só dd/mm/aaaa ou Date).
const DATA_TESTE = new Date("2026-04-08T00:00:00.000Z");

describe("parseTroco — preserva os dois valores separadamente", () => {
  it("lê conferido e informado, recalculando a diferença (fórmula sem cache na fonte real)", () => {
    const linhas = [
      ["BG 01", DATA_TESTE, "DELIVERY NOTURNO", 1306.75, 1300, { formula: "..." }, "Ana", null],
    ];
    const resultado = parseTroco(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(1);
    const r = resultado.registros[0];
    expect(r.extras.trocoConferidoGerente).toBe("1306.75");
    expect(r.extras.trocoInformadoColaborador).toBe("1300");
    expect(r.extras.diferenca).toBe("6.75"); // 1306.75 - 1300, não lido da fórmula
  });

  it("quando conferido == informado, diferença é 0 (caso mais comum na fonte real)", () => {
    const linhas = [["BG 01", DATA_TESTE, "SALÃO DIURNO", 3410.35, 3410.35, {}, null, null]];
    const resultado = parseTroco(cabecalho, linhas);
    expect(resultado.registros[0].extras.diferenca).toBe("0");
  });

  it("preserva Operador e Plano de Ação da fonte real", () => {
    const linhas = [["BG 01", DATA_TESTE, "CAIXA GERENTE", 100, 100, {}, "MARIA", "Revisar troco amanhã"]];
    const resultado = parseTroco(cabecalho, linhas);
    expect(resultado.registros[0].extras.operador).toBe("MARIA");
    expect(resultado.registros[0].extras.plano_de_acao).toBe("Revisar troco amanhã");
  });

  it('corrige o erro de digitação real "DELIVERUY DIURNO" -> "DELIVERY DIURNO" (mesma correção do painel atual)', () => {
    const linhas = [["BG 01", DATA_TESTE, "DELIVERUY DIURNO", 100, 100, {}, null, null]];
    const resultado = parseTroco(cabecalho, linhas);
    expect(resultado.registros[0].extras.caixa).toBe("DELIVERY DIURNO");
  });

  it("duas linhas com a mesma chave (unidade+data+caixa) NÃO colidem no PARSE (ambas viram registros) " +
    "— mas o RELATÓRIO agora aponta a colisão de chave (Etapa 6: troco passou a ser upsert, não mais sem-dedup)", () => {
    const linhas = [
      ["BG 01", DATA_TESTE, "CAIXA GERENTE", 100, 100, {}, null, null],
      ["BG 01", DATA_TESTE, "CAIXA GERENTE", 105, 100, {}, null, null], // mesma chave, valor diferente (correção)
    ];
    const resultado = parseTroco(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(2);
    const relatorio = gerarRelatorioImportacao("troco", resultado);
    expect(relatorio.colisoesDeChaveNoArquivo).toBe(1);
  });

  it("chaves diferentes (caixas diferentes) não colidem", () => {
    const linhas = [
      ["BG 01", DATA_TESTE, "CAIXA GERENTE", 100, 100, {}, null, null],
      ["BG 01", DATA_TESTE, "DELIVERY DIURNO", 50, 50, {}, null, null],
    ];
    const resultado = parseTroco(cabecalho, linhas);
    const relatorio = gerarRelatorioImportacao("troco", resultado);
    expect(relatorio.colisoesDeChaveNoArquivo).toBe(0);
  });

  it("rejeita unidade não reconhecida e caixa vazio", () => {
    const linhas = [
      ["LOJA X", DATA_TESTE, "CAIXA", 100, 100, {}, null, null],
      ["BG 01", DATA_TESTE, "", 100, 100, {}, null, null],
    ];
    const resultado = parseTroco(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(0);
    expect(resultado.rejeitados).toHaveLength(2);
  });

  it("aceita data como objeto Date (formato real do arquivo) e como texto dd/mm/aaaa", () => {
    const linhas = [
      ["BG 01", new Date("2026-04-08T00:00:00.000Z"), "CAIXA", 100, 100, {}, null, null],
      ["BG 01", "08/04/2026", "CAIXA", 100, 100, {}, null, null],
    ];
    const resultado = parseTroco(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(2);
  });
});
