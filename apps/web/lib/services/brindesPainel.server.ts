import { between, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { dataDMenos1 } from "@/lib/rules/datas";
import { unidades, faturamento, brindes } from "@/lib/db/schema";
import { montarPeriodoBrindes, type BrindesPainelData, type PeriodoBrindes } from "./brindesPainel";
import type { BaseCobertura } from "./resumoSemanal";

/**
 * Consulta real do painel de Brindes (Indicadores). Só importado por Server Components/Server Actions. Mantém a
 * janela D-1 da aba (mesma `dataDMenos1` de `buscarIndicadorPeriodo`): o período escolhido é a REFERÊNCIA e a
 * ocorrência consultada é [início−1, fim−1]. Duas consultas por período (faturamento loja × dia; brindes loja ×
 * dia × motivo × submotivo); a classificação controlável/não controlável e as agregações são feitas por
 * `montarPeriodoBrindes` reutilizando `classificarBrinde`.
 */

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function buscarPeriodo(db: ReturnType<typeof getDb>, referenciaInicio: Date, referenciaFim: Date): Promise<PeriodoBrindes> {
  const inicioJanela = dataDMenos1(referenciaInicio);
  const fimJanela = dataDMenos1(referenciaFim);

  const [fatRows, brRows] = await Promise.all([
    db
      .select({ codigo: unidades.codigo, data: sql<string>`${faturamento.data}::text`, total: sql<string>`sum(${faturamento.valor})` })
      .from(faturamento)
      .innerJoin(unidades, eq(faturamento.unidadeId, unidades.id))
      .where(between(faturamento.data, inicioJanela, fimJanela))
      .groupBy(unidades.codigo, faturamento.data),
    db
      .select({
        codigo: unidades.codigo,
        data: sql<string>`${brindes.data}::text`,
        motivo: brindes.motivo,
        motivo2: brindes.motivo2,
        total: sql<string>`sum(${brindes.valor})`,
      })
      .from(brindes)
      .innerJoin(unidades, eq(brindes.unidadeId, unidades.id))
      .where(between(brindes.data, inicioJanela, fimJanela))
      .groupBy(unidades.codigo, brindes.data, brindes.motivo, brindes.motivo2),
  ]);

  return montarPeriodoBrindes(
    iso(inicioJanela),
    iso(fimJanela),
    fatRows.map((r) => ({ codigo: r.codigo, data: r.data, valor: Number(r.total) })),
    brRows.map((r) => ({ codigo: r.codigo, data: r.data, motivo: r.motivo, motivo2: r.motivo2, valor: Number(r.total) }))
  );
}

/** Menor/maior data da base de Brindes (uma agregação simples) — base da validação de cobertura. */
async function buscarCobertura(db: ReturnType<typeof getDb>): Promise<BaseCobertura> {
  const [r] = await db.select({ min: sql<string | null>`min(${brindes.data})::text`, max: sql<string | null>`max(${brindes.data})::text` }).from(brindes);
  return { min: r?.min ?? null, max: r?.max ?? null };
}

export async function buscarBrindesPainel(atualInicio: Date, atualFim: Date, comparacaoInicio: Date, comparacaoFim: Date): Promise<BrindesPainelData> {
  const conectado = Boolean(process.env.DATABASE_URL);
  if (!conectado) {
    const vazio = montarPeriodoBrindes(iso(dataDMenos1(atualInicio)), iso(dataDMenos1(atualFim)), [], []);
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
