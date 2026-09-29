import { Header } from "@/components/layout/Header";
import { IndicadoresTabs } from "@/components/indicadores/IndicadoresTabs";
import type { FonteIndicador, IndicadorData } from "@/lib/services/indicadores";
import { buscarIndicador } from "@/lib/services/indicadores.server";

/**
 * Reprodução funcional de "Indicadores" do painel legado
 * (`createIndicatorController`/`render()`, ver auditoria funcional):
 * sub-abas Brindes / Cancelamento Salão / Cancelamento Delivery, filtro
 * de período (Dia/Semana/Mês/Personalizado), filtro de loja, KPIs,
 * tabela por Motivo (com Submotivo em Brindes) e tabela "Por unidade".
 */
export const dynamic = "force-dynamic";

export default async function IndicadoresPage() {
  const dataInicial = new Date();
  const fontes: FonteIndicador[] = ["brindes", "cancelamentoSalao", "cancelamentoDelivery"];
  const resultados = await Promise.all(fontes.map((f) => buscarIndicador(f, dataInicial)));

  const dadosPorFonte = Object.fromEntries(
    resultados.map((d) => [d.fonte, d])
  ) as Record<FonteIndicador, IndicadorData>;

  return (
    <>
      <Header titulo="Indicadores" />
      <IndicadoresTabs dadosPorFonte={dadosPorFonte} dataInicial={dataInicial} />
    </>
  );
}
