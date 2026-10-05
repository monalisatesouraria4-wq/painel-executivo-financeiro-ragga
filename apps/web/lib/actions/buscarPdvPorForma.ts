"use server";

import { buscarPdvPorForma as buscarNoBanco } from "@/lib/services/controlesLojaPainel.server";
import type { PdvFormaBruta } from "@/lib/services/controlesLojaPainel";

/** Server Action — PDV × Maquininha por loja + forma de pagamento (datas já com o deslocamento D-2 aplicado). */
export async function buscarPdvPorForma(inicio: Date, fim: Date): Promise<PdvFormaBruta[]> {
  return buscarNoBanco(inicio, fim);
}
