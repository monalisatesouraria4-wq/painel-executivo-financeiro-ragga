import { Header } from "@/components/layout/Header";
import { RetiradasTabs } from "@/components/retiradas/RetiradasTabs";
import { buscarIndicador } from "@/lib/services/indicadores.server";

/**
 * Reprodução funcional de "Retiradas" do painel legado — sub-abas
 * "Retirada para Depósito" (`renderRetirada`/`renderRetiradaPersonalizado`,
 * agora sempre no modo por período — item 2 da etapa de revisão) e
 * "Retirada Compra Direta" (mesma fábrica de Indicadores, showTabs=false).
 */
export const dynamic = "force-dynamic";

export default async function RetiradasPage() {
  const dataInicial = new Date();
  const compraDireta = await buscarIndicador("compraDireta", dataInicial);

  return (
    <>
      <Header titulo="Retiradas" />
      <RetiradasTabs compraDireta={compraDireta} dataInicial={dataInicial} />
    </>
  );
}
