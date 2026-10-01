import { Header } from "@/components/layout/Header";
import { VisaoGeralView } from "@/components/visaoGeral/VisaoGeralView";
import { buscarVisaoGeralPeriodo } from "@/lib/services/visaoGeral";
import { buscarDesempenhoCaixa } from "@/lib/services/desempenhoCaixa.server";

/**
 * `force-dynamic`: consulta o Supabase real em CADA request, nunca
 * prerenderada/congelada no build.
 */
export const dynamic = "force-dynamic";

/** Hoje no fuso de Brasília, como data "pura" (meia-noite UTC), igual ao restante do painel. */
function hojeBrasilia(): Date {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Visão Geral com foco em Performance de Caixa. Período inicial = mês em
 * andamento (dia 1 até ontem), para comparar com o limite dos dias
 * decorridos e projetar o fechamento; no dia 1, abre o mês anterior inteiro.
 */
export default async function VisaoGeralPage() {
  const hoje = hojeBrasilia();
  const ontem = new Date(hoje.getTime() - 86_400_000);
  const emAndamento = hoje.getUTCDate() > 1;
  const inicio = emAndamento
    ? new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1))
    : new Date(Date.UTC(ontem.getUTCFullYear(), ontem.getUTCMonth(), 1));
  const fim = ontem;

  const [dados, desempenho] = await Promise.all([buscarVisaoGeralPeriodo(inicio, fim), buscarDesempenhoCaixa(inicio, fim)]);

  return (
    <>
      <Header titulo="Visão Geral" subtitulo="Performance de caixa" />
      <VisaoGeralView dadosIniciais={dados} dataInicial={inicio} dataFimInicial={fim} desempenhoInicial={desempenho} />
    </>
  );
}
