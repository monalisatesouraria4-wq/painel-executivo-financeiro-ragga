"use server";

import { buscarResumoExecutivo as buscarNoBanco, type RespostaResumoExecutivo } from "@/lib/services/resumoExecutivo.server";
import type { JanelaSemana } from "@/lib/services/resumoExecutivo";

/** Server Action — Resumo Semanal Executivo (somente leitura). A janela é validada (segunda→domingo, semana completa) antes da consulta. */
export async function buscarResumoExecutivo(janela: JanelaSemana): Promise<RespostaResumoExecutivo> {
  return buscarNoBanco({ inicio: String(janela.inicio), fim: String(janela.fim) });
}
