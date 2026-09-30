import { eq, sql } from "drizzle-orm";
import type { CodigoUnidade } from "@painel/shared";
import { getDb } from "@/lib/db/client";
import { unidades, faturamento, brindes, cancelamentoSalao, cancelamentoDelivery, compraDireta } from "@/lib/db/schema";
import type { HistoricoMensalLojaData, LinhaHistoricoMensal, CelulaMensal } from "./historicoMensalLoja";

/**
 * Histórico mensal de UMA loja (item 4/5 da etapa de revisão — expansão
 * da linha em "Detalhamento por loja"). Mesmo padrão de agregação de
 * `comparativoMensal.server.ts` (`date_trunc('month', data)`), só que
 * filtrado por unidade em vez de somar a rede inteira — nenhuma tabela,
 * parser ou regra nova. Não toca no Comparativo mensal existente.
 */

const arredondar = (v: number) => Math.round(v * 100) / 100;

async function somaPorMesDaLoja(
  db: ReturnType<typeof getDb>,
  tabela: typeof faturamento | typeof brindes | typeof cancelamentoSalao | typeof cancelamentoDelivery | typeof compraDireta,
  unidadeId: string
): Promise<Map<string, number>> {
  const linhas = await db
    .select({
      mes: sql<string>`to_char(date_trunc('month', ${tabela.data}), 'YYYY-MM')`,
      total: sql<string>`coalesce(sum(${tabela.valor}), 0)`,
    })
    .from(tabela)
    .where(eq(tabela.unidadeId, unidadeId))
    .groupBy(sql`1`);

  return new Map(linhas.map((l) => [l.mes, Number(l.total)]));
}

function celula(porMes: Map<string, number>, mes: string, faturamentoDoMes: number | undefined): CelulaMensal {
  const valor = porMes.get(mes);
  if (valor === undefined) return { disponivel: false };
  const percentualFaturamento = faturamentoDoMes && faturamentoDoMes > 0 ? (valor / faturamentoDoMes) * 100 : undefined;
  return { disponivel: true, valor: arredondar(valor), percentualFaturamento };
}

export async function buscarHistoricoMensalLoja(unidade: CodigoUnidade): Promise<HistoricoMensalLojaData> {
  const conectado = Boolean(process.env.DATABASE_URL);
  if (!conectado) return { conectado: false, linhas: [] };

  const db = getDb();
  const [{ id: unidadeId } = { id: null }] = await db.select({ id: unidades.id }).from(unidades).where(eq(unidades.codigo, unidade));
  if (!unidadeId) return { conectado: true, linhas: [] };

  const [faturamentoPorMes, brindesPorMes, cancSalaoPorMes, cancDeliveryPorMes, compraDiretaPorMes] = await Promise.all([
    somaPorMesDaLoja(db, faturamento, unidadeId),
    somaPorMesDaLoja(db, brindes, unidadeId),
    somaPorMesDaLoja(db, cancelamentoSalao, unidadeId),
    somaPorMesDaLoja(db, cancelamentoDelivery, unidadeId),
    somaPorMesDaLoja(db, compraDireta, unidadeId),
  ]);

  const todosOsMeses = new Set<string>([
    ...faturamentoPorMes.keys(),
    ...brindesPorMes.keys(),
    ...cancSalaoPorMes.keys(),
    ...cancDeliveryPorMes.keys(),
    ...compraDiretaPorMes.keys(),
  ]);
  const meses = [...todosOsMeses].sort().reverse(); // mais recente primeiro

  const linhas: LinhaHistoricoMensal[] = meses.map((mes) => {
    const fatMes = faturamentoPorMes.get(mes);
    return {
      mes,
      faturamento: fatMes !== undefined ? { disponivel: true, valor: arredondar(fatMes) } : { disponivel: false },
      brindes: celula(brindesPorMes, mes, fatMes),
      cancelamentoSalao: celula(cancSalaoPorMes, mes, fatMes),
      cancelamentoDelivery: celula(cancDeliveryPorMes, mes, fatMes),
      compraDireta: celula(compraDiretaPorMes, mes, fatMes),
    };
  });

  return { conectado: true, linhas };
}
