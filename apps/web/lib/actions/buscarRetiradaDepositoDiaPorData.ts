"use server";

import { buscarRetiradaDepositoDia } from "@/lib/services/retiradaDeposito.server";
import type { RetiradaDepositoDiaData } from "@/lib/services/retiradaDeposito";

/** Server Action — filtro de "Data de referência" de Retiradas > Retirada para Depósito (modo Dia). Mesma regra D-1 já validada. */
export async function buscarRetiradaDepositoDiaPorData(data: Date): Promise<RetiradaDepositoDiaData> {
  return buscarRetiradaDepositoDia(data);
}
