import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  faturamento,
  brindes,
  cancelamentoSalao,
  cancelamentoDelivery,
  compraDireta,
  troco,
  quebraCaixa,
} from "@/lib/db/schema";
import type { ComparativoMensalData, IndicadorMensal, IndicadorExcluido } from "./comparativoMensal";

/**
 * Camada de serviço do Comparativo por Mês. Reaproveita exclusivamente
 * tabelas e colunas já validadas — nenhum parser, chave ou schema novo.
 *
 * Auditoria de histórico (feita antes de implementar, ver relatório):
 * Faturamento, Brindes, Cancelamento Salão, Cancelamento Delivery e
 * Compra Direta têm 3-4 meses de histórico real (jun-set/2026, Brindes
 * a partir de jul) — comparação mensal segura. Troco tem histórico mais
 * longo (desde abril/2026), agregado por soma/contagem por mês. Quebra
 * de Caixa só tem 2 períodos importados (parte de agosto + parte de
 * setembro) — incluído, mas os meses são parciais (não um mês fechado
 * inteiro), o que é reportado.
 *
 * Retirada Depósito (10 registros, só set/2026), Fechamento/PDV×Maquininha
 * (só set/2026) e Conferência (5 dias em set/2026) NÃO entram no
 * comparativo: cada um só tem UM mês de dado, então não há "mês a
 * comparar com outro" ainda — incluí-los mostraria uma "evolução" de um
 * único ponto, o que seria enganoso. Ficam em `indicadoresExcluidos`.
 */

const arredondar = (v: number) => Math.round(v * 100) / 100;

async function somaPorMes(
  db: ReturnType<typeof getDb>,
  tabela: typeof faturamento | typeof brindes | typeof cancelamentoSalao | typeof cancelamentoDelivery | typeof compraDireta | typeof quebraCaixa
): Promise<Map<string, number>> {
  const linhas = await db
    .select({
      mes: sql<string>`to_char(date_trunc('month', ${tabela.data}), 'YYYY-MM')`,
      total: sql<string>`coalesce(sum(${tabela.valor}), 0)`,
    })
    .from(tabela)
    .groupBy(sql`1`);

  return new Map(linhas.map((l) => [l.mes, Number(l.total)]));
}

function construirIndicador(label: string, meses: string[], porMes: Map<string, number>): IndicadorMensal {
  const resultado: Record<string, { disponivel: boolean; valor?: number }> = {};
  for (const mes of meses) {
    const valor = porMes.get(mes);
    resultado[mes] = valor === undefined ? { disponivel: false } : { disponivel: true, valor: arredondar(valor) };
  }
  return { label, porMes: resultado };
}

export async function buscarComparativoMensal(): Promise<ComparativoMensalData> {
  const conectado = Boolean(process.env.DATABASE_URL);

  const indicadoresExcluidos: IndicadorExcluido[] = [
    {
      nome: "Retirada Depósito",
      motivo: "Só há dados de um único mês (setembro/2026, 10 registros) — sem um segundo mês para comparar.",
    },
    {
      nome: "Fechamento (caixas em aberto)",
      motivo: "Só há dados de um único mês (setembro/2026) — sem um segundo mês para comparar.",
    },
    {
      nome: "PDV × Maquininha",
      motivo: "Só há dados de um único mês parcial (01 a 20/09/2026) — sem um segundo mês para comparar.",
    },
    {
      nome: "Conferência",
      motivo: "Só há 5 dias de dados (16 a 20/09/2026) — período insuficiente para uma comparação mensal confiável.",
    },
  ];

  if (!conectado) {
    return {
      conectado: false,
      meses: [],
      faturamento: { label: "Faturamento", porMes: {} },
      brindes: { label: "Brindes", porMes: {} },
      percentualBrindes: { label: "% Brindes sobre faturamento", porMes: {} },
      cancelamentoSalao: { label: "Cancelamento Salão", porMes: {} },
      cancelamentoDelivery: { label: "Cancelamento Delivery", porMes: {} },
      compraDireta: { label: "Retirada Compra Direta", porMes: {} },
      trocoDiferenca: { label: "Troco — diferença total", porMes: {} },
      trocoDivergencias: { label: "Troco — divergências", porMes: {} },
      quebraCaixa: { label: "Quebra de Caixa", porMes: {} },
      indicadoresExcluidos,
    };
  }

  const db = getDb();

  const [
    faturamentoPorMes,
    brindesPorMes,
    cancSalaoPorMes,
    cancDeliveryPorMes,
    compraDiretaPorMes,
    quebraCaixaPorMes,
    trocoLinhas,
  ] = await Promise.all([
    somaPorMes(db, faturamento),
    somaPorMes(db, brindes),
    somaPorMes(db, cancelamentoSalao),
    somaPorMes(db, cancelamentoDelivery),
    somaPorMes(db, compraDireta),
    somaPorMes(db, quebraCaixa),
    db
      .select({
        mes: sql<string>`to_char(date_trunc('month', ${troco.data}), 'YYYY-MM')`,
        diferenca: sql<string>`coalesce(sum(${troco.diferenca}), 0)`,
        divergencias: sql<string>`count(*) filter (where ${troco.diferenca} <> 0)::int`,
      })
      .from(troco)
      .groupBy(sql`1`),
  ]);

  const trocoDiferencaPorMes = new Map(trocoLinhas.map((l) => [l.mes, Number(l.diferenca)]));
  const trocoDivergenciasPorMes = new Map(trocoLinhas.map((l) => [l.mes, Number(l.divergencias)]));

  const todosOsMeses = new Set<string>([
    ...faturamentoPorMes.keys(),
    ...brindesPorMes.keys(),
    ...cancSalaoPorMes.keys(),
    ...cancDeliveryPorMes.keys(),
    ...compraDiretaPorMes.keys(),
    ...quebraCaixaPorMes.keys(),
    ...trocoDiferencaPorMes.keys(),
  ]);
  const meses = [...todosOsMeses].sort();

  const percentualBrindesPorMes = new Map<string, number>();
  for (const mes of meses) {
    const fat = faturamentoPorMes.get(mes);
    const brd = brindesPorMes.get(mes);
    if (fat !== undefined && fat > 0 && brd !== undefined) {
      percentualBrindesPorMes.set(mes, (brd / fat) * 100);
    }
  }

  return {
    conectado: true,
    meses,
    faturamento: construirIndicador("Faturamento", meses, faturamentoPorMes),
    brindes: construirIndicador("Brindes", meses, brindesPorMes),
    percentualBrindes: construirIndicador("% Brindes sobre faturamento", meses, percentualBrindesPorMes),
    cancelamentoSalao: construirIndicador("Cancelamento Salão", meses, cancSalaoPorMes),
    cancelamentoDelivery: construirIndicador("Cancelamento Delivery", meses, cancDeliveryPorMes),
    compraDireta: construirIndicador("Retirada Compra Direta", meses, compraDiretaPorMes),
    trocoDiferenca: construirIndicador("Troco — diferença total", meses, trocoDiferencaPorMes),
    trocoDivergencias: construirIndicador("Troco — divergências", meses, trocoDivergenciasPorMes),
    quebraCaixa: construirIndicador("Quebra de Caixa", meses, quebraCaixaPorMes),
    indicadoresExcluidos,
  };
}
