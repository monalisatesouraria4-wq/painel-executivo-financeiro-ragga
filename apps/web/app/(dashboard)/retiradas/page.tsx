import { UNIDADES } from "@painel/shared";
import { Header } from "@/components/layout/Header";
import { RetiradasTabs } from "@/components/retiradas/RetiradasTabs";
import { buscarCompraDiretaPainel } from "@/lib/services/compraDiretaPainel.server";
import { buscarCoberturaDeposito } from "@/lib/services/retiradaDepositoPainel.server";
import { intervaloInicialDeposito } from "@/lib/services/retiradaDepositoAnalise";
import { periodoComparacaoPadrao, ultimoMesFechado } from "@/lib/rules/mesAnterior";

/**
 * Retiradas: sub-aba "Retirada para Depósito" (período por ciclo, inalterado) e
 * "Retirada Compra Direta" (painel de performance). Sem parâmetros, o painel abre
 * no último mês calendário fechado comparado com o mês anterior; o usuário pode
 * trocar os dois períodos livremente.
 *
 * Entrada de navegação (links da Visão Geral / Central de Caixa), no mesmo padrão
 * dos Indicadores: `?fonte=compraDireta&inicio=&fim=&loja=`. `fonte=compraDireta`
 * abre a sub-aba de Compra Direta; `inicio`/`fim` são a data de REFERÊNCIA (a regra
 * D-1 da Compra Direta continua aplicada no serviço); `loja` pré-seleciona a loja.
 * Comparação: mês anterior (se o período for um mês completo) ou o período
 * imediatamente anterior de mesma duração. Parâmetros inválidos são ignorados.
 */
export const dynamic = "force-dynamic";

const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const dataDoInput = (valor: string) => new Date(`${valor}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function RetiradasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const subAbaInicial = um(params.fonte) === "compraDireta" ? "compradireta" : "deposito";
  const lojaInicial = UNIDADES.find((u) => u === um(params.loja)) ?? "TODAS";

  const inicioParam = um(params.inicio);
  const fimParam = um(params.fim);
  const periodoInformado =
    Boolean(inicioParam && fimParam && DATA_VALIDA.test(inicioParam) && DATA_VALIDA.test(fimParam)) &&
    Number(inicioParam!.slice(0, 4)) >= 2000 &&
    inicioParam! <= fimParam!;

  const dataInicial = new Date();
  const atual = periodoInformado ? { inicio: dataDoInput(inicioParam!), fim: dataDoInput(fimParam!) } : ultimoMesFechado(dataInicial);
  const comparacao = periodoComparacaoPadrao(atual.inicio, atual.fim);
  const [painel, coberturaDeposito] = await Promise.all([
    buscarCompraDiretaPainel(atual.inicio, atual.fim, comparacao.inicio, comparacao.fim),
    buscarCoberturaDeposito(),
  ]);

  return (
    <>
      <Header titulo="Retiradas" />
      <RetiradasTabs
        compraDiretaPainel={painel}
        periodoCompraDireta={{ inicio: iso(atual.inicio), fim: iso(atual.fim), compInicio: iso(comparacao.inicio), compFim: iso(comparacao.fim) }}
        dataInicial={dataInicial}
        intervaloDeposito={intervaloInicialDeposito(coberturaDeposito)}
        subAbaInicial={subAbaInicial}
        lojaInicial={lojaInicial}
      />
    </>
  );
}
