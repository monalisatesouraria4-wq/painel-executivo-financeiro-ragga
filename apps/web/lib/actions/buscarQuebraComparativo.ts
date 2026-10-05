"use server";

import { buscarQuebraComparativo as buscarNoBanco } from "@/lib/services/quebraPainel.server";
import type { QuebraComparativoDados } from "@/lib/services/quebraPainel";

/** Server Action — Quebra de Caixa por loja: período comparado + faturamento por loja (atual e comparado). */
export async function buscarQuebraComparativo(
  atualInicio: Date,
  atualFim: Date,
  comparacaoInicio: Date,
  comparacaoFim: Date
): Promise<QuebraComparativoDados> {
  return buscarNoBanco(atualInicio, atualFim, comparacaoInicio, comparacaoFim);
}
