import { UNIDADES, type CodigoUnidade } from "@painel/shared";
import { Header } from "@/components/layout/Header";
import { IndicadoresTabs } from "@/components/indicadores/IndicadoresTabs";
import type { FonteIndicador, IndicadorData } from "@/lib/services/indicadores";
import { buscarIndicador, buscarIndicadorPeriodo } from "@/lib/services/indicadores.server";

/**
 * Central de indicadores: cards big number clicáveis, Delivery × iFood e
 * ranking por loja com plano de ação. Aceita `?fonte=&inicio=&fim=&loja=`
 * (links vindos dos cards da Visão Geral) — `inicio`/`fim` são a data de
 * REFERÊNCIA, e a regra D-1 continua aplicada em `indicadores.server.ts`.
 */
export const dynamic = "force-dynamic";

const FONTES: FonteIndicador[] = ["brindes", "cancelamentoSalao", "cancelamentoDelivery"];
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const dataDoInput = (valor: string) => new Date(`${valor}T00:00:00.000Z`);

export default async function IndicadoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const fonteParam = um(params.fonte);
  const fonteInicial = FONTES.find((f) => f === fonteParam) ?? "brindes";
  const lojaParam = um(params.loja);
  const unidadeInicial = UNIDADES.find((u) => u === lojaParam) as CodigoUnidade | undefined;
  const inicioParam = um(params.inicio);
  const fimParam = um(params.fim);
  const periodoInformado = Boolean(inicioParam && fimParam && DATA_VALIDA.test(inicioParam) && DATA_VALIDA.test(fimParam));

  const dataInicial = periodoInformado ? dataDoInput(inicioParam!) : new Date();
  const dataFim = periodoInformado ? dataDoInput(fimParam!) : dataInicial;

  const resultados: IndicadorData[] =
    periodoInformado || unidadeInicial
      ? await Promise.all(FONTES.map((f) => buscarIndicadorPeriodo(f, dataInicial, dataFim, unidadeInicial)))
      : await Promise.all(FONTES.map((f) => buscarIndicador(f, dataInicial)));

  const dadosPorFonte = Object.fromEntries(resultados.map((d) => [d.fonte, d])) as Record<FonteIndicador, IndicadorData>;

  return (
    <>
      <Header titulo="Indicadores" subtitulo="Central de caixa · ranking e plano de ação" />
      <IndicadoresTabs
        dadosPorFonte={dadosPorFonte}
        dataInicial={dataInicial}
        dataFimInicial={dataFim}
        fonteInicial={fonteInicial}
        unidadeInicial={unidadeInicial ?? "TODAS"}
      />
    </>
  );
}
