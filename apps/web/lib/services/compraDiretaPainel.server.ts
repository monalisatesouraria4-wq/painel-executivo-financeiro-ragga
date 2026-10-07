import { between, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { dataDMenos1 } from "@/lib/rules/datas";
import { unidades, faturamento, compraDireta } from "@/lib/db/schema";
import {
  montarPeriodoCompraDireta,
  type CompraDiretaPainelData,
  type PeriodoCompraDireta,
} from "./compraDiretaPainel";
import type { BaseCobertura } from "./resumoSemanal";

/**
 * Consulta real do painel de Compra Direta (Retiradas). Só importado por
 * Server Components/Server Actions. Mantém a janela D-1 da aba (mesma
 * `dataDMenos1` já usada por `buscarIndicadorPeriodo`): o período escolhido é
 * a REFERÊNCIA e a ocorrência consultada é [início−1, fim−1]. Duas consultas
 * por período (faturamento loja × dia; compra direta loja × dia × motivo) —
 * o restante é agregação em memória (`montarPeriodoCompraDireta`).
 */

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function buscarPeriodo(db: ReturnType<typeof getDb>, referenciaInicio: Date, referenciaFim: Date): Promise<PeriodoCompraDireta> {
  const inicioJanela = dataDMenos1(referenciaInicio);
  const fimJanela = dataDMenos1(referenciaFim);

  const [fatRows, cdRows] = await Promise.all([
    db
      .select({ codigo: unidades.codigo, data: sql<string>`${faturamento.data}::text`, total: sql<string>`sum(${faturamento.valor})` })
      .from(faturamento)
      .innerJoin(unidades, eq(faturamento.unidadeId, unidades.id))
      .where(between(faturamento.data, inicioJanela, fimJanela))
      .groupBy(unidades.codigo, faturamento.data),
    db
      .select({
        codigo: unidades.codigo,
        data: sql<string>`${compraDireta.data}::text`,
        motivo: compraDireta.motivo,
        total: sql<string>`sum(${compraDireta.valor})`,
      })
      .from(compraDireta)
      .innerJoin(unidades, eq(compraDireta.unidadeId, unidades.id))
      .where(between(compraDireta.data, inicioJanela, fimJanela))
      .groupBy(unidades.codigo, compraDireta.data, compraDireta.motivo),
  ]);

  return montarPeriodoCompraDireta(
    iso(inicioJanela),
    iso(fimJanela),
    fatRows.map((r) => ({ codigo: r.codigo, data: r.data, valor: Number(r.total) })),
    cdRows.map((r) => ({ codigo: r.codigo, data: r.data, motivo: r.motivo, valor: Number(r.total) }))
  );
}

/** Menor/maior data da base de Compra Direta (uma agregação simples, só leitura) — base da validação de cobertura. */
async function buscarCobertura(db: ReturnType<typeof getDb>): Promise<BaseCobertura> {
  const [r] = await db.select({ min: sql<string | null>`min(${compraDireta.data})::text`, max: sql<string | null>`max(${compraDireta.data})::text` }).from(compraDireta);
  return { min: r?.min ?? null, max: r?.max ?? null };
}

export async function buscarCompraDiretaPainel(
  atualInicio: Date,
  atualFim: Date,
  comparacaoInicio: Date,
  comparacaoFim: Date
): Promise<CompraDiretaPainelData> {
  const conectado = Boolean(process.env.DATABASE_URL);
  if (!conectado) {
    const vazio = montarPeriodoCompraDireta(iso(dataDMenos1(atualInicio)), iso(dataDMenos1(atualFim)), [], []);
    return { conectado, cobertura: { min: null, max: null }, atual: vazio, comparacao: vazio };
  }
  const db = getDb();
  const [atual, comparacao, cobertura] = await Promise.all([
    buscarPeriodo(db, atualInicio, atualFim),
    buscarPeriodo(db, comparacaoInicio, comparacaoFim),
    buscarCobertura(db),
  ]);
  return { conectado, cobertura, atual, comparacao };
}
