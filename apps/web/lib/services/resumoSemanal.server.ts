import { between, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { unidades, faturamento, brindes, cancelamentoSalao, cancelamentoDelivery, compraDireta, quebraCaixa } from "@/lib/db/schema";
import { montarResumoSemanal, type BaseCobertura, type EntradaResumoSemanal, type Janela, type ResumoSemanal } from "./resumoSemanal";

/**
 * Consulta do Resumo Semanal Executivo. Só importado por Server Components/Server Actions. Datas de OCORRÊNCIA exatas
 * (sem D-1/D-2): a semana segunda→domingo soma exatamente esses sete dias. Uma consulta por base para os DOIS
 * períodos (faturamento compartilhado entre os quatro indicadores — sem repetir a consulta) + uma de cobertura
 * (menor/maior data de cada base); toda a agregação é feita pelos módulos puros já existentes.
 */

const data = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export interface ResumoSemanalResposta {
  conectado: boolean;
  resumo: ResumoSemanal | null;
}

async function coberturas(db: ReturnType<typeof getDb>): Promise<EntradaResumoSemanal["bases"]> {
  const linhas = await db.execute<{ base: string; min: string | null; max: string | null }>(sql`
    select 'faturamento' as base, min(${faturamento.data})::text as min, max(${faturamento.data})::text as max from ${faturamento}
    union all select 'brindes', min(${brindes.data})::text, max(${brindes.data})::text from ${brindes}
    union all select 'cancelamentoSalao', min(${cancelamentoSalao.data})::text, max(${cancelamentoSalao.data})::text from ${cancelamentoSalao}
    union all select 'cancelamentoDelivery', min(${cancelamentoDelivery.data})::text, max(${cancelamentoDelivery.data})::text from ${cancelamentoDelivery}
    union all select 'compraDireta', min(${compraDireta.data})::text, max(${compraDireta.data})::text from ${compraDireta}
    union all select 'quebra', min(${quebraCaixa.data})::text, max(${quebraCaixa.data})::text from ${quebraCaixa}
  `);
  const por = (b: string): BaseCobertura => {
    const l = [...linhas].find((x) => x.base === b);
    return { min: l?.min ?? null, max: l?.max ?? null };
  };
  return {
    faturamento: por("faturamento"),
    brindes: por("brindes"),
    cancelamentoSalao: por("cancelamentoSalao"),
    cancelamentoDelivery: por("cancelamentoDelivery"),
    compraDireta: por("compraDireta"),
    quebra: por("quebra"),
  };
}

export async function buscarResumoSemanal(atual: Janela, comparacao: Janela): Promise<ResumoSemanalResposta> {
  if (!process.env.DATABASE_URL) return { conectado: false, resumo: null };
  const db = getDb();
  const na = (col: Parameters<typeof between>[0]) => or(between(col, data(atual.inicio), data(atual.fim)), between(col, data(comparacao.inicio), data(comparacao.fim)));

  const agrupado = (t: typeof cancelamentoSalao | typeof cancelamentoDelivery | typeof compraDireta) =>
    db
      .select({ codigo: unidades.codigo, data: sql<string>`${t.data}::text`, motivo: t.motivo, total: sql<string>`sum(${t.valor})` })
      .from(t)
      .innerJoin(unidades, eq(t.unidadeId, unidades.id))
      .where(na(t.data))
      .groupBy(unidades.codigo, t.data, t.motivo);

  const [bases, fatRows, brRows, salaoRows, deliveryRows, cdRows, quebraRows] = await Promise.all([
    coberturas(db),
    db
      .select({ codigo: unidades.codigo, data: sql<string>`${faturamento.data}::text`, total: sql<string>`sum(${faturamento.valor})` })
      .from(faturamento)
      .innerJoin(unidades, eq(faturamento.unidadeId, unidades.id))
      .where(na(faturamento.data))
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
      .where(na(brindes.data))
      .groupBy(unidades.codigo, brindes.data, brindes.motivo, brindes.motivo2),
    agrupado(cancelamentoSalao),
    agrupado(cancelamentoDelivery),
    agrupado(compraDireta),
    db
      .select({
        codigo: unidades.codigo,
        data: sql<string>`${quebraCaixa.data}::text`,
        operador: quebraCaixa.operador,
        cpf: quebraCaixa.cpf,
        motivo: quebraCaixa.motivo,
        valor: quebraCaixa.valor,
      })
      .from(quebraCaixa)
      .innerJoin(unidades, eq(quebraCaixa.unidadeId, unidades.id))
      .where(na(quebraCaixa.data)),
  ]);

  const doValor = (r: { codigo: string; data: string; motivo: string; total: string }) => ({ codigo: r.codigo, data: r.data, motivo: r.motivo, valor: Number(r.total) });

  return {
    conectado: true,
    resumo: montarResumoSemanal({
      atual,
      comparacao,
      bases,
      faturamento: fatRows.map((r) => ({ codigo: r.codigo, data: r.data, valor: Number(r.total) })),
      brindes: brRows.map((r) => ({ codigo: r.codigo, data: r.data, motivo: r.motivo, motivo2: r.motivo2, valor: Number(r.total) })),
      cancelamentoSalao: salaoRows.map(doValor),
      cancelamentoDelivery: deliveryRows.map(doValor),
      compraDireta: cdRows.map(doValor),
      quebra: quebraRows.map((r) => ({ unidade: r.codigo, data: r.data, operador: r.operador, cpf: r.cpf, motivo: r.motivo, valor: Number(r.valor) })),
    }),
  };
}
