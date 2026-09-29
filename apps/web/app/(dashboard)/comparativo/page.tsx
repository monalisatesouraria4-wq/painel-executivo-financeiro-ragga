import { Header } from "@/components/layout/Header";
import { ComparativoMensalView } from "@/components/comparativo/ComparativoMensalView";
import { buscarComparativoMensal } from "@/lib/services/comparativoMensal.server";

/**
 * Comparativo por Mês — visão histórica dos indicadores já conectados ao
 * Supabase (Faturamento, Brindes, Cancelamentos, Compra Direta, Troco,
 * Quebra de Caixa), agregados por mês a partir das mesmas tabelas/colunas
 * já usadas em Visão Geral/Indicadores/Controles de Caixa — nenhum
 * parser, chave ou regra de negócio nova. Indicadores com histórico
 * insuficiente (menos de 2 meses de dado real) ficam de fora — ver
 * `indicadoresExcluidos` em comparativoMensal.server.ts.
 */
export const dynamic = "force-dynamic";

export default async function ComparativoPage() {
  const dados = await buscarComparativoMensal();

  return (
    <>
      <Header titulo="Comparativo por Mês" subtitulo="Evolução mensal dos indicadores já conectados ao Supabase" />
      {!dados.conectado && (
        <div className="mx-6 mt-6 rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          Banco de dados ainda não conectado (<code>DATABASE_URL</code> não definida). O
          comparativo fica pendente até a carga de dados reais ser autorizada — nenhum valor
          foi inventado.
        </div>
      )}
      <ComparativoMensalView dados={dados} />
    </>
  );
}
