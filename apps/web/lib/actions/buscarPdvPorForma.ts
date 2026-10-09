"use server";

import { buscarPdvPorForma as buscarNoBanco } from "@/lib/services/controlesLojaPainel.server";
import type { PdvFormaBruta } from "@/lib/services/controlesLojaPainel";

/** Server Action — PDV × Maquininha por loja + forma de pagamento, nas datas EXATAS recebidas (sem D-2); `formas` opcional restringe as formas. */
export async function buscarPdvPorForma(inicio: Date, fim: Date, formas?: string[]): Promise<PdvFormaBruta[]> {
  return buscarNoBanco(inicio, fim, formas);
}
