/**
 * Extrai o período real (com ano) de uma aba de Quebra de Caixa a partir
 * do seu próprio conteúdo — NUNCA do nome da aba nem do texto de título
 * da planilha (confirmado nos arquivos reais: o texto de título "QUEBRA
 * DE CAIXA | 16.08 A 15.09" aparece copiado/desatualizado em abas de
 * outros períodos, então não é confiável).
 *
 * Todas as janelas observadas no arquivo real seguem o mesmo ciclo
 * mensal do dia 16 ao dia 15 do mês seguinte (mesmo formato usado nos
 * nomes das abas de Conferência irmãs, ex. "16.09 a 15.10"). A partir
 * das datas reais da coluna DATA da própria aba, localizamos o ciclo de
 * 16 a 15 em que elas caem e validamos que nenhuma data foge dessa
 * janela.
 *
 * Uma aba só é aceita como Quebra de Caixa válida quando tem pelo menos
 * `MINIMO_LANCAMENTOS_VALIDO` linhas com data reconhecida — a aba real
 * "16-10 A 15-09" (confirmada corrompida pelo usuário: apenas 1 linha de
 * dado real, o resto vazio/duplicado) fica abaixo desse mínimo e é
 * rejeitada por este critério, sem qualquer exclusão por nome.
 */

const MINIMO_LANCAMENTOS_VALIDO = 5;

export type ResultadoPeriodoAbaQuebra =
  | { valida: true; periodoInicio: Date; periodoFim: Date }
  | { valida: false; motivo: string };

/** @param datasLancamentos Datas (já parseadas) de cada linha com LOJA preenchida na aba. */
export function extrairPeriodoDaAbaQuebra(datasLancamentos: Date[]): ResultadoPeriodoAbaQuebra {
  if (datasLancamentos.length < MINIMO_LANCAMENTOS_VALIDO) {
    return {
      valida: false,
      motivo: `Apenas ${datasLancamentos.length} lançamento(s) com data reconhecida — abaixo do mínimo esperado (${MINIMO_LANCAMENTOS_VALIDO}).`,
    };
  }

  let minData = datasLancamentos[0];
  let maxData = datasLancamentos[0];
  for (const d of datasLancamentos) {
    if (d.getTime() < minData.getTime()) minData = d;
    if (d.getTime() > maxData.getTime()) maxData = d;
  }

  // Ciclo 16→15: se o dia da menor data for < 16, o ciclo começou no mês
  // anterior; senão, começou no próprio mês da menor data.
  const anoInicio = minData.getUTCFullYear();
  const mesInicio = minData.getUTCMonth() - (minData.getUTCDate() < 16 ? 1 : 0);
  const periodoInicio = new Date(Date.UTC(anoInicio, mesInicio, 16));
  const periodoFim = new Date(Date.UTC(anoInicio, mesInicio + 1, 15, 23, 59, 59, 999));

  if (minData.getTime() < periodoInicio.getTime() || maxData.getTime() > periodoFim.getTime()) {
    return {
      valida: false,
      motivo: "Datas dos lançamentos não cabem em uma única janela de 16 a 15 — estrutura não corresponde a uma aba de Quebra de Caixa válida.",
    };
  }

  return { valida: true, periodoInicio, periodoFim };
}
