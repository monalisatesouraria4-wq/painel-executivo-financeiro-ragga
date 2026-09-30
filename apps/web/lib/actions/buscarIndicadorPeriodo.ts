"use server";

import type { CodigoUnidade } from "@painel/shared";
import { buscarIndicadorPeriodo as buscarIndicadorPeriodoNoBanco } from "@/lib/services/indicadores.server";
import type { FonteIndicador, IndicadorData } from "@/lib/services/indicadores";

/** Server Action — Indicadores/Retiradas com filtro de Loja + Período (item 2 da etapa de revisão). Regra D-1 preservada. */
export async function buscarIndicadorPeriodo(
  fonte: FonteIndicador,
  dataInicio: Date,
  dataFim: Date,
  unidade?: CodigoUnidade
): Promise<IndicadorData> {
  return buscarIndicadorPeriodoNoBanco(fonte, dataInicio, dataFim, unidade);
}
