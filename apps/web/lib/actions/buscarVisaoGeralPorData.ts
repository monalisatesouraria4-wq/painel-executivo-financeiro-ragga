"use server";

import { buscarVisaoGeral } from "@/lib/services/visaoGeral";
import type { VisaoGeralData } from "@/lib/services/visaoGeral";

/** Server Action — filtro de "Data de referência" da Visão Geral. Mesma regra D-1 já validada, só muda a data. */
export async function buscarVisaoGeralPorData(data: Date): Promise<VisaoGeralData> {
  return buscarVisaoGeral(data);
}
