import { Header } from "@/components/layout/Header";
import { AnaliseGerencialView } from "@/components/analiseGerencial/AnaliseGerencialView";
import { buscarAnaliseGerencial } from "@/lib/services/analiseGerencial.server";
import { buscarComparativoMensal } from "@/lib/services/comparativoMensal.server";
import { buscarTratativas } from "@/lib/services/planoAcao.server";

/**
 * Análise Gerencial — tela única (Comparar → Identificar → Explicar →
 * Agir), unificando a antiga Análise Gerencial + Plano de Ação separado
 * (etapa de revisão: "Plano de Ação" saiu do menu, mas
 * `lib/services/planoAcao*.ts`/tabela `tratativas` continuam os mesmos,
 * agora consumidos aqui). Ver `AnaliseGerencialView.tsx`.
 */
export const dynamic = "force-dynamic";

export default async function AnaliseGerencialPage() {
  const dataInicial = new Date();
  const [dados, comparativo, tratativas] = await Promise.all([
    buscarAnaliseGerencial(dataInicial),
    buscarComparativoMensal(),
    buscarTratativas({}),
  ]);

  return (
    <>
      <Header titulo="Análise Gerencial" subtitulo="Comparar → Identificar → Explicar → Agir" />
      <AnaliseGerencialView
        dadosIniciais={dados}
        comparativo={comparativo}
        tratativasIniciais={tratativas}
        dataInicial={dataInicial}
      />
    </>
  );
}
