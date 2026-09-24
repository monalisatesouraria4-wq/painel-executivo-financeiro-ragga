/**
 * Semáforos objetivos (planejamento, "SEMÁFOROS ATUAIS").
 * Faixas parametrizáveis futuramente via tabela `parametros_semaforo`;
 * os valores abaixo são os aprovados e servem de default/seed.
 */

export type CorSemaforo = "azul" | "verde" | "amarelo" | "vermelho";

export interface FaixaSemaforo {
  ateInclusive: number; // percentual, ex: 0.5 = 0,50%
  cor: CorSemaforo;
}

export const FAIXAS_CANCELAMENTO: FaixaSemaforo[] = [
  { ateInclusive: 0.5, cor: "azul" },
  { ateInclusive: 1.0, cor: "verde" },
  { ateInclusive: 2.0, cor: "amarelo" },
  { ateInclusive: Infinity, cor: "vermelho" },
];

export const FAIXAS_BRINDES: FaixaSemaforo[] = [
  { ateInclusive: 0.25, cor: "azul" },
  { ateInclusive: 0.4, cor: "amarelo" },
  { ateInclusive: Infinity, cor: "vermelho" },
];

export const FAIXAS_COMPRA_DIRETA: FaixaSemaforo[] = [
  { ateInclusive: 5.0, cor: "verde" },
  { ateInclusive: 7.0, cor: "amarelo" },
  { ateInclusive: Infinity, cor: "vermelho" },
];

/** Classifica um percentual segundo uma lista de faixas ordenada crescente. */
export function classificarSemaforo(percentual: number, faixas: FaixaSemaforo[]): CorSemaforo {
  for (const faixa of faixas) {
    if (percentual <= faixa.ateInclusive) {
      return faixa.cor;
    }
  }
  return faixas[faixas.length - 1].cor;
}
