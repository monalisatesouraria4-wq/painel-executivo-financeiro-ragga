import { Header } from "@/components/layout/Header";
import { RetiradasTabs } from "@/components/retiradas/RetiradasTabs";
import { buscarRetiradaDepositoDia } from "@/lib/services/retiradaDeposito.server";
import { buscarIndicador } from "@/lib/services/indicadores.server";

/**
 * Reprodução funcional de "Retiradas" do painel legado — sub-abas
 * "Retirada para Depósito" (`renderRetirada`/`renderRetiradaPersonalizado`)
 * e "Retirada Compra Direta" (mesma fábrica de Indicadores, showTabs=false).
 */
export const dynamic = "force-dynamic";

export default async function RetiradasPage() {
  const dataInicial = new Date();
  const [depositoDia, compraDireta] = await Promise.all([
    buscarRetiradaDepositoDia(dataInicial),
    buscarIndicador("compraDireta", dataInicial),
  ]);

  return (
    <>
      <Header titulo="Retiradas" />
      <RetiradasTabs depositoDia={depositoDia} compraDireta={compraDireta} dataInicial={dataInicial} />
    </>
  );
}
