import { Header } from "@/components/layout/Header";
import { VisaoGeralView } from "@/components/visaoGeral/VisaoGeralView";
import { buscarVisaoGeral } from "@/lib/services/visaoGeral";

/**
 * `force-dynamic`: consulta o Supabase real em CADA request, nunca
 * prerenderada/congelada no build.
 */
export const dynamic = "force-dynamic";

/**
 * Reprodução funcional da tela "Visão Geral" do painel legado
 * (`renderVisaoGeral`, ver auditoria funcional). Corpo real (hero,
 * alertas, indicadores, controles de caixa, detalhamento por loja) vive
 * em `VisaoGeralView` (Client Component) para ganhar o filtro de "Data
 * de referência" — a data inicial é sempre "agora", igual antes.
 */
export default async function VisaoGeralPage() {
  const dataInicial = new Date();
  const dados = await buscarVisaoGeral(dataInicial);

  return (
    <>
      <Header titulo="Visão Geral" subtitulo="Painel Central de Caixa" />
      <VisaoGeralView dadosIniciais={dados} dataInicial={dataInicial} />
    </>
  );
}
