"use server";

import { buscarCancelamentosMadrugada, type MadrugadaDados } from "@/lib/services/cancelamentoMadrugada.server";

/** Server Action — estornos do Cancelamento Salão entre 00h31 e 05h59 cuja data oficial (do estorno) está no período; a data operacional é só classificação exibida. */
export async function buscarCancelamentoMadrugada(inicioOcorrencia: string, fimOcorrencia: string, loja?: string): Promise<MadrugadaDados> {
  return buscarCancelamentosMadrugada(inicioOcorrencia, fimOcorrencia, loja);
}
