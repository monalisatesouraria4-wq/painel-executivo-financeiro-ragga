import { Header } from "@/components/layout/Header";
import { AberturaFechamentoView } from "@/components/aberturaFechamento/AberturaFechamentoView";
import { buscarAberturaFechamento } from "@/lib/services/aberturaFechamento.server";

/**
 * "Abertura e Fechamento" — acompanhamento diário/operacional dos caixas
 * da rede, reaproveitando a mesma tabela `fechamento_caixa` já validada
 * (ver docstring de aberturaFechamento.server.ts para a auditoria de
 * "Situação"/aberto/fechado). Data inicial: a mais recente disponível no
 * banco (nunca uma data fixa/inventada) — o usuário troca livremente
 * depois pelo filtro.
 */
export const dynamic = "force-dynamic";

export default async function AberturaFechamentoPage() {
  const primeiraConsulta = await buscarAberturaFechamento(new Date());
  const dataMaisRecente = primeiraConsulta.dataMaisRecenteDisponivel ?? new Date();
  const dadosIniciais =
    primeiraConsulta.disponivel || !primeiraConsulta.dataMaisRecenteDisponivel
      ? primeiraConsulta
      : await buscarAberturaFechamento(dataMaisRecente);

  return (
    <>
      <Header titulo="Abertura e Fechamento" subtitulo="Acompanhamento diário dos caixas da rede" />
      <AberturaFechamentoView dataInicial={dataMaisRecente} dadosIniciais={dadosIniciais} />
    </>
  );
}
