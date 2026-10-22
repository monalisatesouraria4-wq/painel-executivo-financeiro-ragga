/**
 * Regras de data centralizadas (planejamento, "REGRAS DE DATA").
 * REGRA ÚNICA: a data selecionada é a data consultada (sem D-1/D-2/D-3). Não existem funções de deslocamento de data.
 */

function clonarData(data: Date): Date {
  return new Date(data.getTime());
}

/**
 * Semana real (segunda a domingo) correspondente à data de referência.
 * Usada por Troco — sem tolerância inventada, apenas a semana calendário real.
 */
export function semanaRealDoPeriodo(dataReferencia: Date): { inicio: Date; fim: Date } {
  // Métodos UTC consistentes (ver nota em deposito.ts): evita desalinhar
  // o dia da semana em fusos diferentes de UTC.
  const d = clonarData(dataReferencia);
  const diaSemana = d.getUTCDay(); // 0 = domingo, 1 = segunda, ...
  const deslocamentoAteSegunda = diaSemana === 0 ? 6 : diaSemana - 1;

  const inicio = clonarData(d);
  inicio.setUTCDate(d.getUTCDate() - deslocamentoAteSegunda);

  const fim = clonarData(inicio);
  fim.setUTCDate(inicio.getUTCDate() + 6);

  return { inicio, fim };
}
