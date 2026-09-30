"use server";

import type { CodigoUnidade } from "@painel/shared";
import { getDb } from "@/lib/db/client";
import { buscarConferenciaDoIntervalo } from "@/lib/services/controlesCaixa";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";

/** Server Action — Conferência com período personalizado + loja (item 2 da etapa de revisão), além do ciclo 16→15 padrão. */
export async function buscarConferenciaIntervalo(
  inicio: Date,
  fim: Date,
  unidade?: CodigoUnidade
): Promise<ControlesCaixaData["conferencia"]> {
  if (!process.env.DATABASE_URL) {
    return {
      disponivel: false,
      percentualConferidoRede: null,
      totalEmAtraso: null,
      linhas: [],
      totalCaixasRede: null,
      totalConferidosRede: null,
      totalPendentesRede: null,
      periodoInicio: null,
      periodoFim: null,
    };
  }
  return buscarConferenciaDoIntervalo(getDb(), inicio, fim, unidade);
}
