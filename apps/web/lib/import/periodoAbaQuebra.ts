/**
 * Período de uma aba de Quebra de Caixa, a partir do seu próprio conteúdo — NUNCA do nome da aba nem do texto de título da
 * planilha (confirmado nos arquivos reais: o texto de título "QUEBRA DE CAIXA | 16.08 A 15.09" aparece copiado/desatualizado
 * em abas de outros períodos, então não é confiável).
 *
 * Ciclo mensal do dia 16 ao dia 15 do mês seguinte. O ciclo da aba é o ciclo da sua MENOR data de lançamento.
 *
 * REGRA DE DATA (decisão definitiva): cada lançamento vale pela SUA data real. Uma aba pode conter lançamentos do ciclo
 * seguinte (ex.: a aba "16-09 A 15-10" recebeu lançamentos de 16 a 18/10): eles NÃO invalidam a aba nem são deslocados.
 * São aceitos pela data real e identificados como "posteriores ao ciclo da aba". O que não é aceito é REJEITADO COM MOTIVO
 * (nunca descartado em silêncio): data anterior ao ciclo da aba ou além do ciclo seguinte (provável erro de digitação).
 *
 * Uma aba só é considerada de Quebra quando tem pelo menos `MINIMO_LANCAMENTOS_VALIDO` linhas com data reconhecida — a aba
 * real "16-10 A 15-09" (corrompida: 1 linha de dado real) fica abaixo do mínimo e é descartada por este critério, sem exclusão
 * por nome.
 */

export const MINIMO_LANCAMENTOS_VALIDO = 5;

export type ResultadoPeriodoAbaQuebra =
  | { valida: true; periodoInicio: Date; periodoFim: Date; primeiraData: Date; ultimaData: Date; coberturaAte: Date }
  | { valida: false; motivo: string };

/** Ciclo 16→15 que contém a data: início no dia 16 e fim no dia 15 do mês seguinte (fim às 23:59:59.999 UTC). */
export function cicloDaData(data: Date): { inicio: Date; fim: Date } {
  const ano = data.getUTCFullYear();
  const mes = data.getUTCMonth() - (data.getUTCDate() < 16 ? 1 : 0);
  return { inicio: new Date(Date.UTC(ano, mes, 16)), fim: new Date(Date.UTC(ano, mes + 1, 15, 23, 59, 59, 999)) };
}

/** @param datasLancamentos Datas (já parseadas) de cada linha com LOJA preenchida na aba. */
export function extrairPeriodoDaAbaQuebra(datasLancamentos: Date[]): ResultadoPeriodoAbaQuebra {
  if (datasLancamentos.length < MINIMO_LANCAMENTOS_VALIDO) {
    return {
      valida: false,
      motivo: `Apenas ${datasLancamentos.length} lançamento(s) com data reconhecida — abaixo do mínimo esperado (${MINIMO_LANCAMENTOS_VALIDO}).`,
    };
  }
  let primeiraData = datasLancamentos[0];
  let ultimaData = datasLancamentos[0];
  for (const d of datasLancamentos) {
    if (d.getTime() < primeiraData.getTime()) primeiraData = d;
    if (d.getTime() > ultimaData.getTime()) ultimaData = d;
  }
  const ciclo = cicloDaData(primeiraData);
  // Cobertura "estendida": até o fim do ciclo da ÚLTIMA data lançada (usada só quando nenhuma aba tem a referência no próprio ciclo).
  const coberturaAte = cicloDaData(ultimaData).fim;
  return { valida: true, periodoInicio: ciclo.inicio, periodoFim: ciclo.fim, primeiraData, ultimaData, coberturaAte };
}

export type SituacaoLancamentoQuebra = "no_ciclo" | "posterior_ao_ciclo";

export interface LancamentoClassificado<T> {
  registro: T;
  situacao: SituacaoLancamentoQuebra;
}

export interface LancamentoRejeitadoQuebra {
  linhaOrigem: number;
  motivo: string;
  valoresBrutos: Record<string, unknown>;
}

/**
 * Classifica os registros já parseados de uma aba pela data real de cada um.
 *  - dentro do ciclo da aba → aceito ("no_ciclo");
 *  - até o fim do ciclo SEGUINTE → aceito ("posterior_ao_ciclo"), pela data real, sem deslocamento;
 *  - anterior ao início do ciclo ou além do ciclo seguinte → REJEITADO com motivo (nunca descartado em silêncio).
 */
export function classificarLancamentosQuebra<T extends { data: Date; linhaOrigem: number; unidade?: string; valor?: number }>(
  registros: T[],
  periodoInicio: Date,
  periodoFim: Date
): { aceitos: LancamentoClassificado<T>[]; rejeitados: LancamentoRejeitadoQuebra[] } {
  const proximoFim = cicloDaData(new Date(periodoFim.getTime() + 24 * 3_600_000)).fim;
  const aceitos: LancamentoClassificado<T>[] = [];
  const rejeitados: LancamentoRejeitadoQuebra[] = [];
  const br = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join("/");
  for (const r of registros) {
    const t = r.data.getTime();
    const valoresBrutos = { LOJA: r.unidade, DATA: r.data.toISOString().slice(0, 10), QUEBRA: r.valor };
    if (t < periodoInicio.getTime()) {
      rejeitados.push({ linhaOrigem: r.linhaOrigem, motivo: `Data ${br(r.data)} anterior ao início do ciclo da aba (${br(periodoInicio)}) — provável erro de digitação`, valoresBrutos });
    } else if (t <= periodoFim.getTime()) {
      aceitos.push({ registro: r, situacao: "no_ciclo" });
    } else if (t <= proximoFim.getTime()) {
      aceitos.push({ registro: r, situacao: "posterior_ao_ciclo" });
    } else {
      rejeitados.push({ linhaOrigem: r.linhaOrigem, motivo: `Data ${br(r.data)} além do ciclo seguinte ao da aba (até ${br(proximoFim)}) — provável erro de digitação`, valoresBrutos });
    }
  }
  return { aceitos, rejeitados };
}
