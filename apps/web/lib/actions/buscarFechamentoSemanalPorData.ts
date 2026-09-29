"use server";

import { semanaRealDoPeriodo } from "@/lib/rules/datas";
import { buscarFechamentoSemanal } from "@/lib/services/fechamentoSemanal.server";
import type { FechamentoSemanalData } from "@/lib/services/fechamentoSemanal";

/**
 * Server Action — "Data de referência" do Fechamento Semanal. A data
 * escolhida resolve a semana real correspondente (`semanaRealDoPeriodo`,
 * mesma regra já usada em Troco — não uma regra nova), e o relatório
 * passa a cobrir Segunda a Domingo dessa semana.
 */
export async function buscarFechamentoSemanalPorData(dataReferencia: Date): Promise<FechamentoSemanalData> {
  const { inicio, fim } = semanaRealDoPeriodo(dataReferencia);
  const iniISO = inicio.toISOString().slice(0, 10);
  const fimISO = fim.toISOString().slice(0, 10);
  return buscarFechamentoSemanal(iniISO, fimISO);
}
