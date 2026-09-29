"use server";

import { buscarAnaliseGerencial } from "@/lib/services/analiseGerencial.server";
import type { AnaliseGerencialData } from "@/lib/services/analiseGerencial";

/** Server Action — filtro de "Data de referência" da Análise Gerencial. Reaproveita janelas já validadas, sem regra nova. */
export async function buscarAnaliseGerencialPorData(data: Date): Promise<AnaliseGerencialData> {
  return buscarAnaliseGerencial(data);
}
