"use server";

import { buscarCompraDiretaPainel as buscarNoBanco } from "@/lib/services/compraDiretaPainel.server";
import type { CompraDiretaPainelData } from "@/lib/services/compraDiretaPainel";

/** Server Action — painel de Compra Direta: período atual + período de comparação (livres). */
export async function buscarCompraDiretaPainel(
  atualInicio: Date,
  atualFim: Date,
  comparacaoInicio: Date,
  comparacaoFim: Date
): Promise<CompraDiretaPainelData> {
  return buscarNoBanco(atualInicio, atualFim, comparacaoInicio, comparacaoFim);
}
