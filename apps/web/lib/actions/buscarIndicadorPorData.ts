"use server";

import { buscarIndicador } from "@/lib/services/indicadores.server";
import type { FonteIndicador, IndicadorData } from "@/lib/services/indicadores";

/** Server Action — filtro de "Data de referência" de Indicadores/Retiradas > Compra Direta. Mesma regra D-1 já validada. */
export async function buscarIndicadorPorData(fonte: FonteIndicador, data: Date): Promise<IndicadorData> {
  return buscarIndicador(fonte, data);
}
