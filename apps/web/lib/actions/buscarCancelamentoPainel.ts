"use server";

import { buscarCancelamentoPainel as buscarNoBanco } from "@/lib/services/cancelamentoPainel.server";
import type { CancelamentoPainelData, FonteCancelamentoPainel } from "@/lib/services/cancelamentoPainel";

/** Server Action — painel de Cancelamento: período atual + período de comparação (livres). */
export async function buscarCancelamentoPainel(
  fonte: FonteCancelamentoPainel,
  atualInicio: Date,
  atualFim: Date,
  comparacaoInicio: Date,
  comparacaoFim: Date
): Promise<CancelamentoPainelData> {
  return buscarNoBanco(fonte, atualInicio, atualFim, comparacaoInicio, comparacaoFim);
}
