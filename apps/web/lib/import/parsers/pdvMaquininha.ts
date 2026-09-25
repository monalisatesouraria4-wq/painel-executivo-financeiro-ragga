import { normalizarUnidade } from "../normalizarUnidade";
import { parseDataCelula, parseValorCelula, parseTextoCelula } from "../parseCelula";
import { localizarColuna } from "../localizarColuna";
import type { ResultadoParse, RegistroBase } from "../tipos";

/**
 * Parser de PDV × Maquininha — regra oficial confirmada a partir do
 * código-fonte do painel HTML atual (`lerArquivoPdv`, ver
 * docs/regras-negocio.md, seção "Regras Confirmadas a partir do Painel
 * Atual"). Fonte oficial: `PDV X Adquirente - Consolidado.xlsx`, aba
 * "Export" (o chamador é responsável por ler essa aba especificamente —
 * este parser só recebe cabeçalho+linhas já extraídos dela).
 *
 * Colunas exigidas: Loja, Data, coluna que começa com "forma de pag",
 * coluna que começa com "venda" (PDV), coluna que começa com "total maq"
 * (Maquininha), Diferença. Os 3 valores (PDV, Maquininha, Diferença) são
 * lidos direto da planilha, sem recalcular — mesmo comportamento do
 * painel atual. `valor` (campo comum de RegistroBase) recebe o valor do
 * PDV; Maquininha e Diferença vão em `extras` (como string, preservando
 * o número original para o relatório/dry-run converter de volta).
 */
export function parsePdvMaquininha(cabecalho: unknown[], linhas: unknown[][]): ResultadoParse {
  const idxLoja = localizarColuna(cabecalho, "LOJA");
  const idxData = localizarColuna(cabecalho, "DATA");
  const idxForma = localizarColuna(cabecalho, "FORMA DE PAG");
  const idxPdv = localizarColuna(cabecalho, "VENDA");
  const idxMaquininha = localizarColuna(cabecalho, "TOTAL MAQ");
  const idxDiferenca = localizarColuna(cabecalho, "DIFEREN"); // "Diferença" sem acento na busca

  const resultado: ResultadoParse = { registros: [], rejeitados: [] };

  linhas.forEach((linha, i) => {
    const linhaOrigem = i + 2;
    const vazio = linha.every((v) => v === null || v === undefined || v === "");
    if (vazio) return;

    const lojaTexto = parseTextoCelula(linha[idxLoja]);
    // Linhas de totalizador ("TOTAL") existem no arquivo real — não são
    // um lançamento, são o rodapé. Ignoradas, sem contar como rejeitadas.
    if (lojaTexto.toUpperCase() === "TOTAL") return;

    const valoresBrutos: Record<string, unknown> = {
      LOJA: linha[idxLoja],
      DATA: linha[idxData],
      "FORMA DE PAG.": linha[idxForma],
    };

    const unidadeResultado = normalizarUnidade(lojaTexto);
    if (!unidadeResultado.ok) {
      resultado.rejeitados.push({
        linhaOrigem,
        motivo: `Unidade não reconhecida: "${unidadeResultado.valorOriginal}"`,
        valoresBrutos,
      });
      return;
    }

    const data = parseDataCelula(linha[idxData]);
    if (!data) {
      resultado.rejeitados.push({ linhaOrigem, motivo: `Data inválida: "${String(linha[idxData])}"`, valoresBrutos });
      return;
    }

    const valorPdv = parseValorCelula(linha[idxPdv]) ?? 0;
    const valorMaquininha = parseValorCelula(linha[idxMaquininha]) ?? 0;
    const diferenca = parseValorCelula(linha[idxDiferenca]) ?? 0;

    const registro: RegistroBase = {
      unidade: unidadeResultado.codigo,
      data,
      valor: valorPdv,
      extras: {
        forma: idxForma >= 0 ? parseTextoCelula(linha[idxForma]) : "",
        valorMaquininha: String(valorMaquininha),
        diferenca: String(diferenca),
      },
      linhaOrigem,
    };
    resultado.registros.push(registro);
  });

  return resultado;
}
