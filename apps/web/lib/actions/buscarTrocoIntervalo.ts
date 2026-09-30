"use server";

import type { CodigoUnidade } from "@painel/shared";
import { getDb } from "@/lib/db/client";
import { buscarTrocoDoIntervalo } from "@/lib/services/controlesCaixa";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";

/** Server Action — Troco com período personalizado + loja (item 2 da etapa de revisão). Regra "semana correspondente" preservada. */
export async function buscarTrocoIntervalo(
  inicio: Date,
  fim: Date,
  unidade?: CodigoUnidade
): Promise<ControlesCaixaData["troco"]> {
  if (!process.env.DATABASE_URL) {
    return { disponivel: false, totalConferido: null, totalInformado: null, diferencaTotal: null, divergencias: null, linhas: [] };
  }
  return buscarTrocoDoIntervalo(getDb(), inicio, fim, unidade);
}
