import { Header } from "@/components/layout/Header";
import { ResumoSemanalView } from "@/components/resumoSemanal/ResumoSemanalView";
import { buscarResumoSemanal } from "@/lib/services/resumoSemanal.server";
import { hojeNegocio, janelaAnterior, ultimaSemanaCompleta } from "@/lib/services/resumoSemanal";

/**
 * Resumo Semanal Executivo (reunião de acompanhamento de quinta-feira). Abre na última semana COMPLETA
 * (segunda→domingo) comparada com a semana completa imediatamente anterior; o usuário pode trocar as duas.
 */
export const dynamic = "force-dynamic";

export default async function ResumoSemanalPage() {
  const hoje = hojeNegocio();
  const atual = ultimaSemanaCompleta(hoje);
  const comparacao = janelaAnterior(atual);
  const inicial = await buscarResumoSemanal(atual, comparacao);
  return (
    <>
      <Header titulo="Resumo Semanal Executivo" subtitulo="Última semana completa (segunda a domingo) × semana imediatamente anterior" />
      <ResumoSemanalView hoje={hoje} inicial={inicial} />
    </>
  );
}
