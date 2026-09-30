"use server";

import { buscarVisaoGeralPeriodo } from "@/lib/services/visaoGeral";
import type { VisaoGeralData } from "@/lib/services/visaoGeral";

/**
 * Server Action — filtro de "Período" da Visão Geral (Data inicial + Data
 * final). Modo "data única" continua chamando `buscarVisaoGeralPorData`;
 * esta action é só para quando `dataInicio !== dataFim`, mas aceita os
 * dois casos (mesma função de serviço, `buscarVisaoGeralPeriodo`).
 */
export async function buscarVisaoGeralPorPeriodo(dataInicio: Date, dataFim: Date): Promise<VisaoGeralData> {
  return buscarVisaoGeralPeriodo(dataInicio, dataFim);
}
