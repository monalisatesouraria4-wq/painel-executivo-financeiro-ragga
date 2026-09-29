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

  if (typeof valor === "number" && Number.isFinite(valor) && valor > 0) {
    // Data como serial numérico do Excel (confirmado em VENDAS.xlsx lido
    // via ExcelJS.stream.xlsx.WorkbookReader — o leitor em streaming, ao
    // contrário do leitor completo, não converte toda célula de data para
    // objeto Date; algumas vêm como o número serial bruto). Conversão
    // padrão (mesma usada por SheetJS/Excel): serial 25569 = 1970-01-01
    // UTC, 86400 segundos por dia — já compensa corretamente o bug do
    // "ano bissexto 1900" do Excel para qualquer data real (>= 1900-03-01).
    const data = new Date(Math.round((valor - 25569) * 86400 * 1000));
    if (Number.isNaN(data.getTime())) return null;
    return new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()));
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
    // célula com fórmula (ExcelJS) — usa o resultado calculado, mas só
    // quando for um valor real (texto ou número). Uma fórmula cujo
    // resultado não foi calculado/cacheado no arquivo, ou cujo resultado
    // é ele mesmo um objeto (ex.: erro do Excel como #N/A), não tem
    // texto real para extrair — vira "" (achado real: CPF de "TAIS
    // TOLEDO" na Quebra de Caixa virava "[object Object]" por isso,
    // nunca um CPF inventado).
    const resultado = (valor as { result: unknown }).result;
    return typeof resultado === "string" || typeof resultado === "number" ? String(resultado).trim() : "";
  }
  if (typeof valor === "object") {
    // Objeto de célula sem chave "result" (fórmula sem valor cacheado) —
    // mesmo caso acima, sem texto real para extrair.
    return "";
  }
  return String(valor).trim();
}
