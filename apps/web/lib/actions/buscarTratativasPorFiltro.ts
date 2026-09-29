"use server";

import { buscarTratativas } from "@/lib/services/planoAcao.server";
import type { TratativaLinha, FiltroTratativas } from "@/lib/services/planoAcao";

/** Server Action — leitura filtrada do Plano de Ação. */
export async function buscarTratativasPorFiltro(filtro: FiltroTratativas): Promise<TratativaLinha[]> {
  return buscarTratativas(filtro);
}
