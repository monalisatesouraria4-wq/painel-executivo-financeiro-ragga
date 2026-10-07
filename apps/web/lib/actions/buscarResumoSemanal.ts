"use server";

import { buscarResumoSemanal as buscarNoBanco, type ResumoSemanalResposta } from "@/lib/services/resumoSemanal.server";
import { hojeNegocio, validarPar, type Janela } from "@/lib/services/resumoSemanal";

export type ResumoSemanalAcao = ResumoSemanalResposta | { erro: string };

/** Server Action — Resumo Semanal: valida (segunda→domingo, semanas fechadas, mesma duração, sem sobreposição) antes de consultar. */
export async function buscarResumoSemanal(atual: Janela, comparacao: Janela): Promise<ResumoSemanalAcao> {
  const erro = validarPar(atual, comparacao, hojeNegocio());
  if (erro) return { erro };
  return buscarNoBanco(atual, comparacao);
}
