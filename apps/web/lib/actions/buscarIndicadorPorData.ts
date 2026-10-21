"use server";

import { buscarIndicador } from "@/lib/services/indicadores.server";
import type { FonteIndicador, IndicadorData } from "@/lib/services/indicadores";

/** Server Action — filtro de "Data de referência" de Indicadores/Retiradas > Compra Direta. Data literal (sem D-1). */
export async function buscarIndicadorPorData(fonte: FonteIndicador, data: Date): Promise<IndicadorData> {
  return buscarIndicador(fonte, data);
}
