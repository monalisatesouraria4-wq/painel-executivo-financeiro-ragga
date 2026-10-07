import { between, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { dataDMenos1 } from "@/lib/rules/datas";
import { unidades, faturamento, cancelamentoSalao, cancelamentoDelivery } from "@/lib/db/schema";
import { montarPeriodoCancelamento, type CancelamentoPainelData, type FonteCancelamentoPainel, type PeriodoCancelamento } from "./cancelamentoPainel";
import type { BaseCobertura } from "./resumoSemanal";

/**
 * Consulta real do painel de Cancelamento (Salão/Delivery). Só importado por Server Components/Server Actions.
 * Mantém a janela D-1 da aba (mesma `dataDMenos1` de `buscarIndicadorPeriodo`): o período escolhido é a
 * REFERÊNCIA e a ocorrência consultada é [início−1, fim−1]. Duas consultas por período (faturamento loja × dia;
 * cancelamento loja × dia × motivo); o restante é agregação em memória.
 */

const TABELAS = { cancelamentoSalao, cancelamentoDelivery } as const;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function buscarPeriodo(
  db: ReturnType<typeof getDb>,
  fonte: FonteCancelamentoPainel,
  referenciaInicio: Date,
  referenciaFim: Date
): Promise<PeriodoCancelamento> {
  const tabela = TABELAS[fonte];
  const inicioJanela = dataDMenos1(referenciaInicio);
  const fimJanela = dataDMenos1(referenciaFim);

  const [fatRows, canRows] = await Promise.all([
    db
      .select({ codigo: unidades.codigo, data: sql<string>`${faturamento.data}::text`, total: sql<string>`sum(${faturamento.valor})` })
      .from(faturamento)
      .innerJoin(unidades, eq(faturamento.unidadeId, unidades.id))
      .where(between(faturamento.data, inicioJanela, fimJanela))
      .groupBy(unidades.codigo, faturamento.data),
    db
      .select({ codigo: unidades.codigo, data: sql<string>`${tabela.data}::text`, motivo: tabela.motivo, total: sql<string>`sum(${tabela.valor})` })
      .from(tabela)
      .innerJoin(unidades, eq(tabela.unidadeId, unidades.id))
      .where(between(tabela.data, inicioJanela, fimJanela))
      .groupBy(unidades.codigo, tabela.data, tabela.motivo),
  ]);

  return montarPeriodoCancelamento(
    iso(inicioJanela),
    iso(fimJanela),
    fatRows.map((r) => ({ codigo: r.codigo, data: r.data, valor: Number(r.total) })),
    canRows.map((r) => ({ codigo: r.codigo, data: r.data, motivo: r.motivo, valor: Number(r.total) }))
  );
}

/** Menor/maior data da base da fonte (uma agregação simples, só leitura) — base da validação de cobertura. */
async function buscarCobertura(db: ReturnType<typeof getDb>, fonte: FonteCancelamentoPainel): Promise<BaseCobertura> {
  const tabela = TABELAS[fonte];
  const [r] = await db.select({ min: sql<string | null>`min(${tabela.data})::text`, max: sql<string | null>`max(${tabela.data})::text` }).from(tabela);
  return { min: r?.min ?? null, max: r?.max ?? null };
}

export async function buscarCancelamentoPainel(
  fonte: FonteCancelamentoPainel,
  atualInicio: Date,
  atualFim: Date,
  comparacaoInicio: Date,
  comparacaoFim: Date
): Promise<CancelamentoPainelData> {
  const conectado = Boolean(process.env.DATABASE_URL);
  if (!conectado) {
    const vazio = montarPeriodoCancelamento(iso(dataDMenos1(atualInicio)), iso(dataDMenos1(atualFim)), [], []);
    return { conectado, cobertura: { min: null, max: null }, atual: vazio, comparacao: vazio };
  }
  const db = getDb();
  const [atual, comparacao, cobertura] = await Promise.all([
    buscarPeriodo(db, fonte, atualInicio, atualFim),
    buscarPeriodo(db, fonte, comparacaoInicio, comparacaoFim),
    buscarCobertura(db, fonte),
  ]);
  return { conectado, cobertura, atual, comparacao };
}
