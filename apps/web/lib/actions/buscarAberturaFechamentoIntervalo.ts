"use server";

import type { CodigoUnidade } from "@painel/shared";
import { buscarAberturaFechamentoIntervalo as buscarAberturaFechamentoIntervaloNoBanco } from "@/lib/services/aberturaFechamento.server";
import type { AberturaFechamentoData } from "@/lib/services/aberturaFechamento";

/** Server Action — Fechamento (Controles de Caixa) com período + loja (item 2 da etapa de revisão). Regra "data exata" preservada (soma literal dos dias do intervalo, sem deslocamento). */
export async function buscarAberturaFechamentoIntervalo(
  inicio: Date,
  fim: Date,
  unidade?: CodigoUnidade
): Promise<AberturaFechamentoData> {
  return buscarAberturaFechamentoIntervaloNoBanco(inicio, fim, unidade);
}
