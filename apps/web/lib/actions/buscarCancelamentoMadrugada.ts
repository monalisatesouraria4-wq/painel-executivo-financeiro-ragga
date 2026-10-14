"use server";

import { buscarCancelamentosMadrugada, type MadrugadaDados } from "@/lib/services/cancelamentoMadrugada.server";

/** Server Action — estornos do Cancelamento Salão entre 00h31 e 05h59 (data operacional = dia anterior) na janela de ocorrência. */
export async function buscarCancelamentoMadrugada(inicioOcorrencia: string, fimOcorrencia: string, loja?: string): Promise<MadrugadaDados> {
  return buscarCancelamentosMadrugada(inicioOcorrencia, fimOcorrencia, loja);
}
