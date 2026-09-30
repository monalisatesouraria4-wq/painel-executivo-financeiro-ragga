import { Header } from "@/components/layout/Header";
import { AtualizacaoBasesView } from "@/components/atualizacao/AtualizacaoBasesView";
import { buscarStatusTodasAsBases } from "@/lib/services/statusBases.server";

/**
 * Reprodução funcional de "Atualização de Bases" do painel legado
 * (`renderBaseUpdatePanel` + os 10 modais dedicados, ver auditoria
 * funcional). Rota mantida em `/importacao` (já existente desde a
 * Etapa 1 de fundação do projeto, já ligada à navegação) — o legado usa
 * `data-tab="atualizacao"`, mesma tela, rota diferente por já existir no
 * novo sistema antes deste módulo.
 *
 * `statusInicial` (item 7 da etapa de revisão) — período/quantidade real
 * já persistidos no Supabase por base, para exibir "período atualmente
 * existente no banco" mesmo antes de qualquer upload nesta sessão.
 */
export const dynamic = "force-dynamic";

export default async function ImportacaoPage() {
  const statusInicial = await buscarStatusTodasAsBases();

  return (
    <>
      <Header titulo="Atualização de Bases" />
      <AtualizacaoBasesView statusInicial={statusInicial} />
    </>
  );
}
