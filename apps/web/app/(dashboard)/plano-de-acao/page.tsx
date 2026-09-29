import { Header } from "@/components/layout/Header";
import { PlanoAcaoView } from "@/components/planoAcao/PlanoAcaoView";
import { buscarTratativas } from "@/lib/services/planoAcao.server";
import type { NovaTratativaInput } from "@/lib/services/planoAcao";
import type { CodigoUnidade } from "@painel/shared";

/**
 * Plano de Ação — CRUD sobre `tratativas` (já existente antes desta
 * etapa). Ver `lib/services/planoAcao.server.ts` para o detalhe da
 * leitura e `components/planoAcao/PlanoAcaoView.tsx` para o formulário.
 *
 * `searchParams` (opcionais) pré-preenchem o formulário quando a tela é
 * aberta a partir do botão "Criar tratativa" da Análise Gerencial —
 * ver `components/analiseGerencial/AnaliseGerencialView.tsx`.
 */
export const dynamic = "force-dynamic";

export default async function PlanoAcaoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const dados = await buscarTratativas({});

  const prefill: Partial<NovaTratativaInput> | null = params.unidade
    ? {
        unidade: params.unidade as CodigoUnidade,
        indicador: params.indicador,
        dataOcorrencia: params.dataOcorrencia ? new Date(`${params.dataOcorrencia}T00:00:00.000Z`) : null,
        problema: params.problema ?? "",
        acao: params.acao ?? "",
      }
    : null;

  return (
    <>
      <Header titulo="Plano de Ação" subtitulo="Tratativas abertas a partir dos indicadores conectados" />
      <main className="px-6 py-6">
        <PlanoAcaoView dadosIniciais={dados} prefill={prefill} />
      </main>
    </>
  );
}
