import { describe, expect, it } from "vitest";
import { parseFechamentoCaixa } from "@/lib/import/parsers/fechamentoCaixa";
import { gerarRelatorioImportacao } from "@/lib/import/relatorio";

const cabecalho = [
  "Data", "Filial", "Caixa", "Movto.", "Abertura", "Fechamento", "Operador",
  "Situação", "Dif. fech.", "Dif. conc.", "Dif. total",
];

describe("parseFechamentoCaixa — sem valor monetário, campos reais preservados", () => {
  it("lê os campos reais (sem inventar 'valor')", () => {
    const linhas = [
      ["01/09/2026", "BIGGS 11 - SANTO AMARO", "BG11 - PDV 001", "1", "10:26", "01/09 14:08", "THAWANNY", "Conciliado", 0.08, null, 0.08],
    ];
    const resultado = parseFechamentoCaixa(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(1);
    const r = resultado.registros[0];
    expect(r.unidade).toBe("BG 11");
    expect(r.valor).toBe(0);
    expect(r.extras.caixa).toBe("BG11 - PDV 001");
    expect(r.extras.movimento).toBe("1");
    expect(r.extras.situacao).toBe("Conciliado");
    expect(r.extras.difFechamento).toBe("0.08");
    expect(r.extras.difConciliacao).toBe(""); // null na fonte -> vazio, não "0"
  });

  it("dois caixas diferentes da mesma filial/data/movimento geram chaves diferentes (não colidem)", () => {
    const linhas = [
      ["01/09/2026", "BG 11", "BG11 - PDV 001", "1", "10:00", "14:00", "A", "Conciliado", 0, 0, 0],
      ["01/09/2026", "BG 11", "BG11 - PDV 002", "1", "10:00", "14:00", "B", "Conciliado", 0, 0, 0],
    ];
    const resultado = parseFechamentoCaixa(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(2);
  });

  it("normaliza filiais 'ISAIAS NN' e 'BIGGS NN' (confirmado neste arquivo real)", () => {
    const linhas = [
      ["01/09/2026", "ISAIAS 01 - MARINGA", "IS01 - PDV 03", "1", "10:07", "14:08", "A", "Conciliado", null, null, null],
      ["01/09/2026", "BIGGS 07 - JAMIL E ACAI", "BG07 - PDV 02", "1", "14:09", "14:10", "B", "Conciliado", null, null, null],
    ];
    const resultado = parseFechamentoCaixa(cabecalho, linhas);
    expect(resultado.registros.map((r) => r.unidade)).toEqual(["IS 01", "BG 07"]);
  });

  it("rejeita unidade não reconhecida e caixa/movimento vazios", () => {
    const linhas = [
      ["01/09/2026", "LOJA X", "PDV 01", "1", "", "", "", "", null, null, null],
      ["01/09/2026", "BG 01", "", "", "", "", "", "", null, null, null],
    ];
    const resultado = parseFechamentoCaixa(cabecalho, linhas);
    expect(resultado.registros).toHaveLength(0);
    expect(resultado.rejeitados).toHaveLength(2);
  });

  it("chave filial+data+caixa+movimento: caixas diferentes não colidem", () => {
    const linhas = [
      ["01/09/2026", "BG 11", "BG11 - PDV 001", "1", "10:00", "14:00", "A", "Conciliado", 0, 0, 0],
      ["01/09/2026", "BG 11", "BG11 - PDV 002", "1", "10:00", "14:00", "B", "Conciliado", 0, 0, 0],
    ];
    const resultado = parseFechamentoCaixa(cabecalho, linhas);
    const relatorio = gerarRelatorioImportacao("fechamento_caixa", resultado);
    expect(relatorio.colisoesDeChaveNoArquivo).toBe(0);
  });

  it("REGRESSÃO (Etapa 6): mesma filial+data+caixa+movimento (ex. correção de horário/situação) " +
    "agora É reportada como colisão de chave — fechamento_caixa passou a ser upsert, alinhado ao " +
    "painel HTML atual (chaveFechamento), não mais 'sem dedup'", () => {
    const linhas = [
      ["01/09/2026", "BG 11", "BG11 - PDV 001", "1", "10:00", "14:00", "A", "Aberto", 0, 0, 0],
      ["01/09/2026", "BG 11", "BG11 - PDV 001", "1", "10:00", "14:08", "A", "Conciliado", 0, 0, 0],
    ];
    const resultado = parseFechamentoCaixa(cabecalho, linhas);
    const relatorio = gerarRelatorioImportacao("fechamento_caixa", resultado);
    expect(relatorio.colisoesDeChaveNoArquivo).toBe(1);
  });
});
