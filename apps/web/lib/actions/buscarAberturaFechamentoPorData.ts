"use server";

import { buscarAberturaFechamento } from "@/lib/services/aberturaFechamento.server";
import type { AberturaFechamentoData } from "@/lib/services/aberturaFechamento";

/**
 * Server Action — troca de data no filtro de "Abertura e Fechamento"
 * (client component). Mesma fronteira "use server" já documentada em
 * `lib/actions/buscarRetiradaDepositoPersonalizado.ts` (driver Postgres
 * é Node-only).
 */
export async function buscarAberturaFechamentoPorData(data: Date): Promise<AberturaFechamentoData> {
  return buscarAberturaFechamento(data);
}
