import ExcelJS from "exceljs";

/**
 * Leitura de arquivo .xlsx no navegador (client-side), usando ExcelJS —
 * a mesma biblioteca já escolhida no projeto (ver docs/regras-negocio.md:
 * preferida a `xlsx`/SheetJS por causa de CVEs não corrigidas). O
 * legado usa a lib `XLSX` (SheetJS) client-side; aqui reproduzimos o
 * MESMO comportamento (ler todas as abas, célula por célula, sem
 * reinterpretar datas/números) com a biblioteca já validada no projeto.
 */
export interface PlanilhaLida {
  /** Todas as abas do arquivo: nome -> matriz de linhas (linha 0 = primeira linha da aba). */
  sheets: Record<string, unknown[][]>;
  primeiraAba: string;
}

export async function lerArquivoExcel(file: File): Promise<PlanilhaLida> {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  if (workbook.worksheets.length === 0) {
    throw new Error("O arquivo não contém nenhuma aba.");
  }

  const sheets: Record<string, unknown[][]> = {};
  for (const worksheet of workbook.worksheets) {
    const linhas: unknown[][] = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const valoresBrutos = row.values as unknown[];
      // ExcelJS usa índice 1-based e o índice 0 vem sempre vazio.
      const valores = valoresBrutos.slice(1).map((v) => {
        if (v && typeof v === "object" && "result" in (v as Record<string, unknown>)) {
          return (v as { result: unknown }).result; // célula de fórmula
        }
        if (v && typeof v === "object" && "text" in (v as Record<string, unknown>)) {
          return (v as { text: unknown }).text; // rich text
        }
        return v;
      });
      linhas.push(valores);
    });
    sheets[worksheet.name] = linhas;
  }

  return { sheets, primeiraAba: workbook.worksheets[0].name };
}
