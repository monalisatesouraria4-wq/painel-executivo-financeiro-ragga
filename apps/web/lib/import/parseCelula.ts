/**
 * Leitura de células de planilha real: datas aparecem ora como objeto
 * Date (Excel serial já convertido pelo ExcelJS), ora como texto
 * "dd/mm/aaaa" (confirmado nos arquivos reais da Etapa 3). Valores
 * monetários aparecem como number.
 */

export function parseDataCelula(valor: unknown): Date | null {
  if (valor instanceof Date) {
    // Normaliza para meia-noite UTC (data "pura", sem hora), consistente
    // com o restante do sistema (ver lib/rules/datas.ts).
    return new Date(Date.UTC(valor.getUTCFullYear(), valor.getUTCMonth(), valor.getUTCDate()));
  }

  if (typeof valor === "string") {
    const texto = valor.trim();
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(texto);
    if (match) {
      const dia = Number(match[1]);
      const mes = Number(match[2]);
      const ano = Number(match[3]);
      if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
      const data = new Date(Date.UTC(ano, mes - 1, dia));
      // Confirma que a data não "rolou" (ex.: 31/04 não existe).
      if (data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null;
      return data;
    }
  }

  return null;
}

export function parseValorCelula(valor: unknown): number | null {
  if (typeof valor === "number") return valor;
  if (typeof valor === "string") {
    const normalizado = valor.trim().replace(/\./g, "").replace(",", ".");
    const numero = Number(normalizado);
    return Number.isFinite(numero) ? numero : null;
  }
  return null;
}

export function parseTextoCelula(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "object" && "result" in (valor as object)) {
    // célula com fórmula (ExcelJS) — usa o resultado calculado
    return String((valor as { result: unknown }).result ?? "").trim();
  }
  return String(valor).trim();
}
