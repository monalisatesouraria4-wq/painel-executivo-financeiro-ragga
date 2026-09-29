import { Header } from "@/components/layout/Header";
import { AtualizacaoBasesView } from "@/components/atualizacao/AtualizacaoBasesView";

/**
 * Reprodução funcional de "Atualização de Bases" do painel legado
 * (`renderBaseUpdatePanel` + os 10 modais dedicados, ver auditoria
 * funcional). Rota mantida em `/importacao` (já existente desde a
 * Etapa 1 de fundação do projeto, já ligada à navegação) — o legado usa
 * `data-tab="atualizacao"`, mesma tela, rota diferente por já existir no
 * novo sistema antes deste módulo.
 */
export default function ImportacaoPage() {
  return (
    <>
      <Header titulo="Atualização de Bases" />
      <AtualizacaoBasesView />
    </>
  );
}
