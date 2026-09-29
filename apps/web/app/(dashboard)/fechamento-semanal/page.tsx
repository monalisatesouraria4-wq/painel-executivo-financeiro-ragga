import { Header } from "@/components/layout/Header";
import { FechamentoSemanalView } from "@/components/fechamentoSemanal/FechamentoSemanalView";
import { semanaRealDoPeriodo } from "@/lib/rules/datas";
import { buscarFechamentoSemanal } from "@/lib/services/fechamentoSemanal.server";

/**
 * Reprodução funcional de "Fechamento Semanal" do painel legado
 * (`renderSemanal`/`computeSemanalReport`, ver auditoria funcional).
 * Data inicial: semana real (`semanaRealDoPeriodo`) contendo "agora".
 */
export const dynamic = "force-dynamic";

export default async function FechamentoSemanalPage() {
  const { inicio, fim } = semanaRealDoPeriodo(new Date());
  const dadosIniciais = await buscarFechamentoSemanal(inicio.toISOString().slice(0, 10), fim.toISOString().slice(0, 10));
  return (
    <>
      <Header titulo="Fechamento Semanal" />
      <FechamentoSemanalView dadosIniciais={dadosIniciais} />
    </>
  );
}
