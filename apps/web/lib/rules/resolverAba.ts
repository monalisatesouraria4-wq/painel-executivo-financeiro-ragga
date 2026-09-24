/**
 * Resolução de aba por período (planejamento v2, itens 1 e 2).
 *
 * Conferência e Quebra de Caixa são arquivos organizados por abas, cada
 * uma cobrindo um intervalo de datas. Esta função identifica, para uma
 * data selecionada, qual aba (dentre as cadastradas para aquele tipo de
 * base) contém essa data — sem nunca escolher arbitrariamente em caso
 * de ambiguidade e sem assumir uma aba fixa.
 */

export interface AbaPeriodo {
  id: string;
  nomeAba: string;
  periodoInicio: Date;
  periodoFim: Date;
}

export type ResolverAbaResultado =
  | { ok: true; aba: AbaPeriodo }
  | { ok: false; erro: "NENHUMA_ABA_CORRESPONDE" }
  | { ok: false; erro: "ABAS_AMBIGUAS"; abasConflitantes: AbaPeriodo[] };

/**
 * @param dataSelecionada Data para a qual se quer localizar a aba.
 * @param abasDisponiveis Abas cadastradas para o tipo de base em questão
 *   (Conferência e Quebra de Caixa consultam listas independentes —
 *   nunca compartilham o resultado desta função).
 */
export function resolverAba(
  dataSelecionada: Date,
  abasDisponiveis: AbaPeriodo[]
): ResolverAbaResultado {
  const correspondentes = abasDisponiveis.filter(
    (aba) => dataSelecionada >= aba.periodoInicio && dataSelecionada <= aba.periodoFim
  );

  if (correspondentes.length === 0) {
    return { ok: false, erro: "NENHUMA_ABA_CORRESPONDE" };
  }

  if (correspondentes.length > 1) {
    return { ok: false, erro: "ABAS_AMBIGUAS", abasConflitantes: correspondentes };
  }

  return { ok: true, aba: correspondentes[0] };
}
