"use server";

import { buscarBrindesPainel as buscarNoBanco } from "@/lib/services/brindesPainel.server";
import type { BrindesPainelData } from "@/lib/services/brindesPainel";

/** Server Action — painel de Brindes: período atual + período de comparação (livres). */
export async function buscarBrindesPainel(
  atualInicio: Date,
  atualFim: Date,
  comparacaoInicio: Date,
  comparacaoFim: Date
): Promise<BrindesPainelData> {
  return buscarNoBanco(atualInicio, atualFim, comparacaoInicio, comparacaoFim);
}
