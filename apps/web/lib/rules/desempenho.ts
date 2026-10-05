import type { FaixaSemaforo } from "./semaforos";

/**
 * Regras da visão de Performance de Caixa — puras (sem banco), usadas pelo
 * serviço servidor e pela tela.
 */

// Brindes: a avaliação usa a classificação oficial do painel (`lib/rules/brindes.ts` — controláveis × não
// controláveis; semáforo só sobre os controláveis). Não há regra paralela de "consumo de funcionários" aqui.

/**
 * Meta em % do faturamento = teto da última faixa "boa" (azul/verde) do
 * semáforo vigente. Não é um número novo: é o limite que já separa
 * "Excelente/Bom" de "Atenção/Crítico" em `lib/rules/semaforos.ts`.
 */
export function metaDoSemaforo(faixas: FaixaSemaforo[]): number {
  let meta = 0;
  for (const f of faixas) {
    if ((f.cor === "azul" || f.cor === "verde") && Number.isFinite(f.ateInclusive)) meta = f.ateInclusive;
  }
  return meta;
}

const MS_DIA = 86_400_000;

/** Quantidade de dias do intervalo (inclusive nas duas pontas). Datas "puras" em UTC. */
export function diasNoPeriodo(inicio: Date, fim: Date): number {
  return Math.round((fim.getTime() - inicio.getTime()) / MS_DIA) + 1;
}

function ultimoDiaDoMes(ano: number, mes0: number): number {
  return new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate();
}

/** Mesmo dia do mês anterior (limitado ao último dia daquele mês, ex.: 31/03 → 28/02). */
function mesAnterior(data: Date): Date {
  const ano = data.getUTCMonth() === 0 ? data.getUTCFullYear() - 1 : data.getUTCFullYear();
  const mes0 = data.getUTCMonth() === 0 ? 11 : data.getUTCMonth() - 1;
  return new Date(Date.UTC(ano, mes0, Math.min(data.getUTCDate(), ultimoDiaDoMes(ano, mes0))));
}

/**
 * Período equivalente do mês anterior: mesmos dias do mês. Para um mês em
 * andamento (01 a 15/10) compara 01 a 15/09 — nunca o mês anterior inteiro.
 */
export function periodoEquivalenteMesAnterior(inicio: Date, fim: Date): { inicio: Date; fim: Date } {
  return { inicio: mesAnterior(inicio), fim: mesAnterior(fim) };
}

/** Projeção de fechamento: só quando o período começa no dia 1 e termina antes do fim do mesmo mês. */
export function projecaoDeFechamento(inicio: Date, fim: Date, realizado: number): number | null {
  const mesmoMes = inicio.getUTCFullYear() === fim.getUTCFullYear() && inicio.getUTCMonth() === fim.getUTCMonth();
  if (!mesmoMes || inicio.getUTCDate() !== 1) return null;
  const diasMes = ultimoDiaDoMes(fim.getUTCFullYear(), fim.getUTCMonth());
  const decorridos = diasNoPeriodo(inicio, fim);
  if (decorridos >= diasMes) return null; // mês já fechado
  return (realizado / decorridos) * diasMes;
}
