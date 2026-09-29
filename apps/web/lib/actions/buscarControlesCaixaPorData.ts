"use server";

import { buscarControlesCaixa } from "@/lib/services/controlesCaixa";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";

/**
 * Server Action — filtro único de "Data de referência" de Controles de
 * Caixa (Fechamento/PDV/Troco/Conferência/Quebra). Cada bloco continua
 * aplicando sua própria janela já validada (D-1, D-2, semana real, ciclo
 * 16→15) em cima da mesma data — nenhuma regra nova.
 */
export async function buscarControlesCaixaPorData(data: Date): Promise<ControlesCaixaData> {
  return buscarControlesCaixa(data);
}
