"use server";

import type { CodigoUnidade } from "@painel/shared";
import { getDb } from "@/lib/db/client";
import { buscarQuebraCaixaDoIntervalo } from "@/lib/services/controlesCaixa";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";

/** Server Action — Quebra de Caixa com período personalizado + loja (opcional, além dos ciclos/filtros existentes). */
export async function buscarQuebraCaixaIntervalo(
  inicio: Date,
  fim: Date,
  unidade?: CodigoUnidade
): Promise<ControlesCaixaData["quebraCaixa"]> {
  if (!process.env.DATABASE_URL) return { disponivel: false, totalGeral: null, porOperador: [], detalhado: [] };
  return buscarQuebraCaixaDoIntervalo(getDb(), inicio, fim, unidade);
}
