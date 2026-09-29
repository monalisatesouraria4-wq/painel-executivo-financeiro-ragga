"use server";

import { buscarFechamentoWhatsapp } from "@/lib/services/fechamentoWhatsapp.server";
import type { FechamentoWhatsappData } from "@/lib/services/fechamentoWhatsapp";

const formatadorDataBR = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

/** Server Action — "Data de referência" do Fechamento WhatsApp. Data literal do dia (sem D-1/D-2), regra já documentada. */
export async function buscarFechamentoWhatsappPorData(dataReferencia: Date): Promise<FechamentoWhatsappData> {
  const dateStr = formatadorDataBR.format(dataReferencia);
  return buscarFechamentoWhatsapp(dateStr, dataReferencia);
}
