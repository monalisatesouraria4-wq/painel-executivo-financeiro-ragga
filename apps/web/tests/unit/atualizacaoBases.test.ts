import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { processarArquivoBase } from "@/lib/services/atualizacaoBases";
import type { RegistroBase } from "@/lib/import/tipos";

/**
 * Testes de integração REAIS da camada de orquestração da Atualização
 * de Bases: gera um .xlsx de verdade em memória (ExcelJS) e testa o
 * fluxo completo upload -> leitura -> validação -> parser -> merge,
 * sem mockar o parser (integração real com o código já validado).
 */
async function gerarXlsx(linhas: unknown[][]): Promise<File> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  linhas.forEach((linha) => sheet.addRow(linha));
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer as BlobPart], "arquivo.xlsx");
}

describe("processarArquivoBase — compra_direta (integração real com parser + merge)", () => {
  it("sucesso: aplica os registros e reporta inseridos/atualizados/totalFinal corretamente", async () => {
    const arquivo = await gerarXlsx([
      ["FILIAL", "DATA", "VALOR", "MOTIVO"],
      ["BG 01", "10/09/2026", 150.5, "MATERIAL DE LIMPEZA"],
    ]);

    const resultado = await processarArquivoBase("compraDireta", arquivo, [], new Date("2026-09-10"));

    expect(resultado.status).toBe("sucesso");
    if (resultado.status === "sucesso") {
      expect(resultado.inseridos).toBe(1);
      expect(resultado.atualizados).toBe(0);
      expect(resultado.totalFinal).toBe(1);
      expect(resultado.novoEstado).toHaveLength(1);
      expect(resultado.novoEstado[0].unidade).toBe("BG 01");
      expect(resultado.novoEstado[0].valor).toBe(150.5);
    }
  });

  it("reimportar a mesma chave conta como ATUALIZADO, não duplica o estado", async () => {
    const estadoAnterior: RegistroBase[] = [
      {
        unidade: "BG 01",
        data: new Date("2026-09-10"),
        valor: 100,
        extras: { motivo: "MATERIAL DE LIMPEZA" },
        linhaOrigem: 1,
      },
    ];
    const arquivo = await gerarXlsx([
      ["FILIAL", "DATA", "VALOR", "MOTIVO"],
      ["BG 01", "10/09/2026", 999, "MATERIAL DE LIMPEZA"],
    ]);

    const resultado = await processarArquivoBase("compraDireta", arquivo, estadoAnterior, new Date("2026-09-10"));

    expect(resultado.status).toBe("sucesso");
    if (resultado.status === "sucesso") {
      expect(resultado.atualizados).toBe(1);
      expect(resultado.inseridos).toBe(0);
      expect(resultado.novoEstado).toHaveLength(1);
      expect(resultado.novoEstado[0].valor).toBe(999);
    }
  });

  it("coluna obrigatória faltando -> erro específico, sem tocar no estado anterior", async () => {
    const estadoAnterior: RegistroBase[] = [
      { unidade: "BG 01", data: new Date("2026-09-01"), valor: 10, extras: {}, linhaOrigem: 1 },
    ];
    const arquivoSemMotivo = await gerarXlsx([
      ["FILIAL", "DATA", "VALOR"],
      ["BG 01", "10/09/2026", 150],
    ]);

    const resultado = await processarArquivoBase("compraDireta", arquivoSemMotivo, estadoAnterior, new Date());

    expect(resultado.status).toBe("erro");
    if (resultado.status === "erro") {
      expect(resultado.mensagem).toContain("Campo(s) obrigatório(s) não encontrado(s)");
      expect(resultado.mensagem).toContain("MOTIVO");
    }
    // estadoAnterior não é mutado pela função (garantia de rollback: quem chama decide se troca o estado)
    expect(estadoAnterior).toHaveLength(1);
  });

  it("planilha sem nenhuma linha válida (unidade não reconhecida) -> erro de zero registros", async () => {
    const arquivo = await gerarXlsx([
      ["FILIAL", "DATA", "VALOR", "MOTIVO"],
      ["LOJA INEXISTENTE", "10/09/2026", 150, "MOTIVO X"],
    ]);

    const resultado = await processarArquivoBase("compraDireta", arquivo, [], new Date());

    expect(resultado.status).toBe("erro");
    if (resultado.status === "erro") {
      expect(resultado.mensagem).toContain("Nenhuma linha válida foi encontrada");
    }
  });
});

describe("processarArquivoBase — pdv_maquininha (colunas 'contains', não exatas)", () => {
  it("sucesso com cabeçalho real (colunas localizadas por 'contains')", async () => {
    const arquivo = await gerarXlsx([
      ["Loja", "Data", "Forma de Pag.", "Venda (PDV)", "Total Maq.", "Diferença"],
      ["BG 01", "10/09/2026", "CREDITO", 100, 100, 0],
    ]);

    const resultado = await processarArquivoBase("pdvMaquininha", arquivo, [], new Date());

    expect(resultado.status).toBe("sucesso");
    if (resultado.status === "sucesso") {
      expect(resultado.inseridos).toBe(1);
    }
  });
});

describe("processarArquivoBase — arquivo inválido (não é .xlsx / corrompido)", () => {
  it("erro de leitura não derruba a função, retorna status de erro", async () => {
    const arquivoCorrompido = new File([new Uint8Array([1, 2, 3, 4])], "corrompido.xlsx");
    const resultado = await processarArquivoBase("compraDireta", arquivoCorrompido, [], new Date());
    expect(resultado.status).toBe("erro");
  });
});
