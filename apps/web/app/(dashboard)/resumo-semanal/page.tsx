import { Header } from "@/components/layout/Header";
import { ResumoSemanalView } from "@/components/resumoSemanal/ResumoSemanalView";
import { ResumoExecutivoPainel } from "@/components/resumoSemanal/ResumoExecutivoPainel";
import { buscarResumoSemanal } from "@/lib/services/resumoSemanal.server";
import { buscarResumoExecutivo } from "@/lib/services/resumoExecutivo.server";
import { hojeNegocio, janelaAnterior, ultimaSemanaCompleta } from "@/lib/services/resumoSemanal";

/**
 * Resumo Semanal Executivo (reunião de acompanhamento de quinta-feira). Abre na última semana COMPLETA (segunda→domingo).
 * Bloco 1: resumo executivo com imagem e texto para WhatsApp (filtro por data). Bloco 2: comparativo por loja × semana anterior.
 */
export const dynamic = "force-dynamic";

export default async function ResumoSemanalPage() {
  const hoje = hojeNegocio();
  const atual = ultimaSemanaCompleta(hoje);
  const comparacao = janelaAnterior(atual);
  const [inicial, executivo] = await Promise.all([buscarResumoSemanal(atual, comparacao), buscarResumoExecutivo(atual)]);
  return (
    <>
      <Header titulo="Resumo Semanal Executivo" subtitulo="Resumo da semana (segunda a domingo) com imagem e texto para WhatsApp, e comparativo com a semana anterior" />
      <div className="p-4 pb-0 sm:p-6 sm:pb-0">
        <ResumoExecutivoPainel hoje={hoje} ultimaSemana={atual} inicial={executivo} />
      </div>
      <ResumoSemanalView hoje={hoje} inicial={inicial} />
    </>
  );
}
