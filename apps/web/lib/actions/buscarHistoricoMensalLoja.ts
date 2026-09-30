"use server";

import type { CodigoUnidade } from "@painel/shared";
import { buscarHistoricoMensalLoja as buscarHistoricoMensalLojaNoBanco } from "@/lib/services/historicoMensalLoja.server";
import type { HistoricoMensalLojaData } from "@/lib/services/historicoMensalLoja";

/** Server Action — histórico mensal de uma loja, para a expansão da tabela "Detalhamento por loja" da Visão Geral. */
export async function buscarHistoricoMensalLoja(unidade: CodigoUnidade): Promise<HistoricoMensalLojaData> {
  return buscarHistoricoMensalLojaNoBanco(unidade);
}
