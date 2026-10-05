import { between, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { dataDMenos1 } from "@/lib/rules/datas";
import { unidades, faturamento, brindes } from "@/lib/db/schema";
import { montarPeriodoBrindes, type BrindesPainelData, type PeriodoBrindes } from "./brindesPainel";

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

export async function buscarBrindesPainel(atualInicio: Date, atualFim: Date, comparacaoInicio: Date, comparacaoFim: Date): Promise<BrindesPainelData> {
  const conectado = Boolean(process.env.DATABASE_URL);
  if (!conectado) {
    const vazio = montarPeriodoBrindes(iso(dataDMenos1(atualInicio)), iso(dataDMenos1(atualFim)), [], []);
    return { conectado, atual: vazio, comparacao: vazio };
  }
  const db = getDb();
  const [atual, comparacao] = await Promise.all([buscarPeriodo(db, atualInicio, atualFim), buscarPeriodo(db, comparacaoInicio, comparacaoFim)]);
  return { conectado, atual, comparacao };
}
