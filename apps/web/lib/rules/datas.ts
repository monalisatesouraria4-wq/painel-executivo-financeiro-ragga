/**
 * Regras de data centralizadas (planejamento, "REGRAS DE DATA").
 * Nenhuma tela deve recalcular D-1/D-2/semana real localmente.
 */

function clonarData(data: Date): Date {
  return new Date(data.getTime());
}

/** Brindes, Cancelamentos, Compra Direta, Retirada Depósito: D-1. */
export function dataDMenos1(dataReferencia: Date): Date {
  const d = clonarData(dataReferencia);
  d.setDate(d.getDate() - 1);
  return d;
}

/** PDV × Maquininha, Conferência: D-2. */
export function dataDMenos2(dataReferencia: Date): Date {
  const d = clonarData(dataReferencia);
  d.setDate(d.getDate() - 2);
  return d;
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
