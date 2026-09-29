import { Header } from "@/components/layout/Header";
import { FechamentoWhatsappView } from "@/components/fechamentoWhatsapp/FechamentoWhatsappView";
import { buscarFechamentoWhatsapp } from "@/lib/services/fechamentoWhatsapp.server";

const formatadorDataBR = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

/**
 * Reprodução funcional de "Fechamento WhatsApp" do painel legado
 * (`renderWhatsapp`/`computeWhatsappReport`, ver auditoria funcional).
 */
export const dynamic = "force-dynamic";

export default async function FechamentoWhatsappPage() {
  const dataInicial = new Date();
  const dadosIniciais = await buscarFechamentoWhatsapp(formatadorDataBR.format(dataInicial), dataInicial);
  return (
    <>
      <Header titulo="Fechamento WhatsApp" />
      <FechamentoWhatsappView dadosIniciais={dadosIniciais} />
    </>
  );
}
