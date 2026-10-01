"use server";

import { buscarDesempenhoCaixa as buscarNoBanco } from "@/lib/services/desempenhoCaixa.server";
import type { DesempenhoCaixaData } from "@/lib/services/desempenhoCaixa";

/** Server Action — Performance de Caixa para o período escolhido na Visão Geral. */
export async function buscarDesempenhoCaixa(dataInicio: Date, dataFim: Date): Promise<DesempenhoCaixaData> {
  return buscarNoBanco(dataInicio, dataFim);
}
