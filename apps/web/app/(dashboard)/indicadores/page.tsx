import { UNIDADES } from "@painel/shared";
import { Header } from "@/components/layout/Header";
import { IndicadoresTabs } from "@/components/indicadores/IndicadoresTabs";
import { buscarBrindesPainel } from "@/lib/services/brindesPainel.server";
import { buscarCancelamentoPainel } from "@/lib/services/cancelamentoPainel.server";
import type { FonteIndicador } from "@/lib/services/indicadores";
import { periodoComparacaoPadrao, ultimoMesFechado } from "@/lib/rules/mesAnterior";

/**
 * Indicadores: sub-abas Brindes / Cancelamento Salão / Cancelamento Delivery — painéis analíticos
 * (`BrindesPainel`/`CancelamentoPainel`). Sem parâmetros abre no último mês calendário fechado comparado com o mês
 * anterior. Aceita `?fonte=&inicio=&fim=&loja=` como entrada de navegação (links da Visão Geral / Central de Caixa):
 * `fonte` escolhe a sub-aba; `inicio`/`fim` são a data de REFERÊNCIA (a regra D-1 de cada aba continua aplicada nos
 * serviços); `loja` pré-seleciona a loja. O período de comparação é o mês anterior (se o período for um mês completo)
 * ou o período imediatamente anterior de mesma duração — e pode ser trocado na tela. Parâmetros inválidos são ignorados.
 */
export const dynamic = "force-dynamic";

const FONTES: FonteIndicador[] = ["brindes", "cancelamentoSalao", "cancelamentoDelivery"];
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const dataDoInput = (valor: string) => new Date(`${valor}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function IndicadoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const fonteInicial = FONTES.find((f) => f === um(params.fonte)) ?? "brindes";
  const lojaInicial = UNIDADES.find((u) => u === um(params.loja)) ?? "TODAS";

  const inicioParam = um(params.inicio);
  const fimParam = um(params.fim);
  const periodoInformado =
    Boolean(inicioParam && fimParam && DATA_VALIDA.test(inicioParam) && DATA_VALIDA.test(fimParam)) &&
    Number(inicioParam!.slice(0, 4)) >= 2000 &&
    inicioParam! <= fimParam!;

  const atual = periodoInformado ? { inicio: dataDoInput(inicioParam!), fim: dataDoInput(fimParam!) } : ultimoMesFechado(new Date());
  const comparacao = periodoComparacaoPadrao(atual.inicio, atual.fim);

  const [brindesPainel, cancelamentoSalaoPainel, cancelamentoDeliveryPainel] = await Promise.all([
    buscarBrindesPainel(atual.inicio, atual.fim, comparacao.inicio, comparacao.fim),
    buscarCancelamentoPainel("cancelamentoSalao", atual.inicio, atual.fim, comparacao.inicio, comparacao.fim),
    buscarCancelamentoPainel("cancelamentoDelivery", atual.inicio, atual.fim, comparacao.inicio, comparacao.fim),
  ]);

  return (
    <>
      <Header titulo="Indicadores" />
      <IndicadoresTabs
        brindesPainel={brindesPainel}
        cancelamentoSalaoPainel={cancelamentoSalaoPainel}
        cancelamentoDeliveryPainel={cancelamentoDeliveryPainel}
        periodoPadrao={{ inicio: iso(atual.inicio), fim: iso(atual.fim), compInicio: iso(comparacao.inicio), compFim: iso(comparacao.fim) }}
        fonteInicial={fonteInicial}
        lojaInicial={lojaInicial}
      />
    </>
  );
}
