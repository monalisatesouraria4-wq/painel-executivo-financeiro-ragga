/**
 * Comparativo mensal da Visão Geral: só existe quando o período selecionado
 * é um MÊS CALENDÁRIO COMPLETO (dia 1 até o último dia do mesmo mês). O
 * período anterior é o mês calendário imediatamente anterior (ex.:
 * 01/09–30/09 → 01/08–31/08), nunca "os últimos 30 dias". Datas "puras" em
 * UTC (meia-noite), como no restante do painel.
 */

export interface PeriodoMensal {
  inicio: Date;
  fim: Date;
}

export function ehMesCalendarioCompleto(inicio: Date, fim: Date): boolean {
  const ano = inicio.getUTCFullYear();
  const mes = inicio.getUTCMonth();
  if (inicio.getUTCDate() !== 1) return false;
  return fim.getTime() === Date.UTC(ano, mes + 1, 0);
}

/** Mês calendário anterior ao período, ou `null` quando o período não é um mês completo. */
export function mesAnteriorCompleto(inicio: Date, fim: Date): PeriodoMensal | null {
  if (!ehMesCalendarioCompleto(inicio, fim)) return null;
  const ano = inicio.getUTCFullYear();
  const mes = inicio.getUTCMonth();
  return { inicio: new Date(Date.UTC(ano, mes - 1, 1)), fim: new Date(Date.UTC(ano, mes, 0)) };
}

/**
 * Período de comparação padrão para um período recebido por navegação (links entre telas): mês calendário completo →
 * mês anterior completo (mesma regra do comparativo mensal); qualquer outro período → o período imediatamente anterior
 * de MESMA duração (ex.: 02/10–03/10 → 30/09–01/10). O usuário pode trocar livremente na tela.
 */
export function periodoComparacaoPadrao(inicio: Date, fim: Date): PeriodoMensal {
  const mes = mesAnteriorCompleto(inicio, fim);
  if (mes) return mes;
  const MS_DIA = 86_400_000;
  const dias = Math.round((fim.getTime() - inicio.getTime()) / MS_DIA) + 1;
  const fimComp = new Date(inicio.getTime() - MS_DIA);
  return { inicio: new Date(fimComp.getTime() - (dias - 1) * MS_DIA), fim: fimComp };
}

/** Último mês calendário COMPLETO anterior à data informada (ex.: 02/10/2026 → 01/09–30/09/2026). */
export function ultimoMesFechado(hoje: Date): PeriodoMensal {
  const ano = hoje.getUTCFullYear();
  const mes = hoje.getUTCMonth();
  return { inicio: new Date(Date.UTC(ano, mes - 1, 1)), fim: new Date(Date.UTC(ano, mes, 0)) };
}
