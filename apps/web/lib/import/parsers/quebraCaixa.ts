import { normalizarUnidade } from "../normalizarUnidade";
import { parseDataCelula, parseValorCelula, parseTextoCelula } from "../parseCelula";
import { localizarColuna } from "../localizarColuna";
import type { ResultadoParse } from "../tipos";

/**
 * Parser de Quebra de Caixa. Estrutura real confirmada (Etapa 3): dentro
 * da aba resolvida (ex. "QUEBRA 16-09 A 15-10"), o cabeçalho real fica na
 * linha 4 da aba (não na linha 1 — as 3 primeiras são título/instruções):
 * MÊS | DATA | LOJA | CONFERENTE | QUEBRA | OPERADOR | CPF | MOTIVO
 *
 * O chamador é responsável por extrair `cabecalho` (linha 4) e `linhas`
 * (a partir da linha 5) da aba já resolvida por resolverAba
 * (lib/rules/resolverAba.ts) — nunca lê a planilha inteira nem mistura
 * abas de períodos diferentes.
 */
export function parseQuebraCaixa(cabecalho: unknown[], linhas: unknown[][]): ResultadoParse {
  const idxData = localizarColuna(cabecalho, "DATA");
  const idxLoja = localizarColuna(cabecalho, "LOJA");
  const idxQuebra = localizarColuna(cabecalho, "QUEBRA");
  const idxOperador = localizarColuna(cabecalho, "OPERADOR");
  const idxMotivo = localizarColuna(cabecalho, "MOTIVO");
  const idxConferente = localizarColuna(cabecalho, "CONFERENTE");

  const resultado: ResultadoParse = { registros: [], rejeitados: [] };

  linhas.forEach((linha, i) => {
    const linhaOrigem = i + 5; // dados começam na linha 5 da aba
    const vazio = linha.every((v) => v === null || v === undefined || v === "");
    if (vazio) return;

    const valoresBrutos: Record<string, unknown> = {
      LOJA: linha[idxLoja],
      DATA: linha[idxData],
      QUEBRA: linha[idxQuebra],
    };

    const unidadeResultado = normalizarUnidade(parseTextoCelula(linha[idxLoja]));
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
      resultado.rejeitados.push({
        linhaOrigem,
        motivo: `Data inválida: "${String(linha[idxData])}"`,
        valoresBrutos,
      });
      return;
    }

    const valor = parseValorCelula(linha[idxQuebra]);
    if (valor === null) {
      resultado.rejeitados.push({
        linhaOrigem,
        motivo: `Valor de quebra inválido: "${String(linha[idxQuebra])}"`,
        valoresBrutos,
      });
      return;
    }

    resultado.registros.push({
      unidade: unidadeResultado.codigo,
      data,
      valor,
      extras: {
        operador: idxOperador >= 0 ? parseTextoCelula(linha[idxOperador]) : "",
        motivo: idxMotivo >= 0 ? parseTextoCelula(linha[idxMotivo]) : "",
        conferente: idxConferente >= 0 ? parseTextoCelula(linha[idxConferente]) : "",
      },
      linhaOrigem,
    });
  });

  return resultado;
}
