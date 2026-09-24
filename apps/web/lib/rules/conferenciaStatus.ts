/**
 * Status de Conferência (planejamento, "CONFERÊNCIA").
 * 0 = conferido/normal; X = marcado manualmente como atraso; vazio = não lançado.
 */
export type MarcacaoConferencia = "0" | "X" | "";

export type StatusConferencia =
  | "Completa"
  | "Parcial"
  | "Inconsistente"
  | "Pendente"
  | "Em atraso";

/**
 * @param total Total esperado de lançamentos no período.
 * @param conferido Quantidade efetivamente conferida.
 * @param emAtrasoPelaRegraGlobal Resultado da regra D-2/referência global
 *   (calculada em datas.ts) já aplicada pelo chamador para esta unidade/data.
 * @param unidadeSemConferenciaNoFimDeSemana true apenas para MAPOLI (planejamento).
 * @param dataEhFimDeSemana Indica se a data avaliada cai em sábado/domingo.
 */
export function calcularStatusConferencia(params: {
  total: number;
  conferido: number;
  emAtrasoPelaRegraGlobal: boolean;
  unidadeSemConferenciaNoFimDeSemana: boolean;
  dataEhFimDeSemana: boolean;
}): StatusConferencia | null {
  const {
    total,
    conferido,
    emAtrasoPelaRegraGlobal,
    unidadeSemConferenciaNoFimDeSemana,
    dataEhFimDeSemana,
  } = params;

  // MAPOLI não possui conferência aos finais de semana: não gera status.
  if (unidadeSemConferenciaNoFimDeSemana && dataEhFimDeSemana) {
    return null;
  }

  if (conferido > total) return "Inconsistente";
  if (conferido === total) return "Completa";
  if (conferido === 0 && emAtrasoPelaRegraGlobal) return "Em atraso";
  if (conferido < total) return "Parcial";

  return "Pendente";
}

/** Quantidade pendente = Total - Conferido (planejamento). */
export function calcularPendente(total: number, conferido: number): number {
  return total - conferido;
}
