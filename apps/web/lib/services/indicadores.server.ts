import { eq, sql } from "drizzle-orm";
import { UNIDADES } from "@painel/shared";
import { classificarSemaforo } from "@/lib/rules/semaforos";
import { dataDMenos1 } from "@/lib/rules/datas";
import { getDb } from "@/lib/db/client";
import { unidades, faturamento, brindes, cancelamentoSalao, cancelamentoDelivery, compraDireta } from "@/lib/db/schema";
import { buscarConfigFonte, type FonteIndicador, type IndicadorData, type MotivoLinha, type SubmotivoLinha, type FilialIndicadorLinha } from "./indicadores";

/**
 * Consulta real ao Postgres para a tela Indicadores (e Retiradas >
 * Compra Direta, que reaproveita a mesma fonte "compraDireta"). Só
 * importado pela Server Component da página — nunca por componentes
 * client (ver nota em `indicadores.ts`).
 *
 * Com `DATABASE_URL`: janela D-1 (`dataDMenos1`, mesma regra já usada em
 * `visaoGeral.ts` — modo "Dia" do legado, o padrão). Filtros de período
 * Semana/Mês/Personalizado e de loja continuam só como controles de UI
 * (etapa futura). Ordenação de "Por unidade": ordem canônica de
 * `UNIDADES`, nunca por valor (confirmado no legado, `compareFilial`).
 *
 * Sem DATABASE_URL: `disponivel: false` — nenhum valor inventado.
 */

const TABELA_POR_FONTE = {
  brindes,
  cancelamentoSalao,
  cancelamentoDelivery,
  compraDireta,
} as const;

export async function buscarIndicador(fonte: FonteIndicador, dataReferencia: Date = new Date()): Promise<IndicadorData> {
  const conectado = Boolean(process.env.DATABASE_URL);
  const config = buscarConfigFonte(fonte);

  const base: IndicadorData = {
    conectado,
    fonte,
    config,
    disponivel: false,
    totalIndicador: null,
    percentualFaturamento: null,
    semaforo: null,
    faturamentoPeriodo: null,
    porMotivo: [],
    porFilial: [],
  };

  if (!conectado) return base;

  const db = getDb();
  const d1 = dataDMenos1(dataReferencia);
  const tabela = TABELA_POR_FONTE[fonte];

  const [{ total: faturamentoTotalStr }] = await db
    .select({ total: sql<string>`coalesce(sum(${faturamento.valor}), 0)` })
    .from(faturamento)
    .where(eq(faturamento.data, d1));
  const faturamentoTotal = Number(faturamentoTotalStr);

  const [{ total: indicadorTotalStr, linhas: linhasIndicadorCount }] = await db
    .select({ total: sql<string>`coalesce(sum(${tabela.valor}), 0)`, linhas: sql<string>`count(*)` })
    .from(tabela)
    .where(eq(tabela.data, d1));
  const totalIndicador = Number(indicadorTotalStr);
  const existeRegistroIndicador = Number(linhasIndicadorCount) > 0;

  if (!existeRegistroIndicador) return base;
  const percentualFaturamento = faturamentoTotal > 0 ? (totalIndicador / faturamentoTotal) * 100 : 0;
  const semaforo = classificarSemaforo(percentualFaturamento, config.faixas);

  // Tabela por Motivo (ordenada por valor desc, confirmado no legado).
  const porMotivoRows = await db
    .select({ motivo: tabela.motivo, total: sql<string>`sum(${tabela.valor})` })
    .from(tabela)
    .where(eq(tabela.data, d1))
    .groupBy(tabela.motivo)
    .orderBy(sql`sum(${tabela.valor}) desc`);

  let submotivosPorMotivo = new Map<string, SubmotivoLinha[]>();
  if (config.hasSubmotivo && fonte === "brindes") {
    const subRows = await db
      .select({
        motivo: brindes.motivo,
        motivo2: brindes.motivo2,
        total: sql<string>`sum(${brindes.valor})`,
        ocorrencias: sql<string>`count(*)`,
      })
      .from(brindes)
      .where(eq(brindes.data, d1))
      .groupBy(brindes.motivo, brindes.motivo2);

    submotivosPorMotivo = new Map();
    for (const row of subRows) {
      if (!row.motivo2) continue;
      const lista = submotivosPorMotivo.get(row.motivo) ?? [];
      lista.push({ submotivo: row.motivo2, valor: Number(row.total), ocorrencias: Number(row.ocorrencias) });
      submotivosPorMotivo.set(row.motivo, lista);
    }
    for (const lista of submotivosPorMotivo.values()) lista.sort((a, b) => b.valor - a.valor);
  }

  const porMotivo: MotivoLinha[] = porMotivoRows.map((r) => ({
    motivo: r.motivo,
    valor: Number(r.total),
    percentualFaturamento: faturamentoTotal > 0 ? (Number(r.total) / faturamentoTotal) * 100 : 0,
    submotivos: submotivosPorMotivo.get(r.motivo) ?? [],
  }));

  // Tabela "Por unidade" — ordem canônica de UNIDADES, nunca por valor.
  const [porFilialRows, faturamentoPorLojaRows, porFilialMotivoRows] = await Promise.all([
    db
      .select({ codigo: unidades.codigo, total: sql<string>`sum(${tabela.valor})` })
      .from(tabela)
      .innerJoin(unidades, eq(tabela.unidadeId, unidades.id))
      .where(eq(tabela.data, d1))
      .groupBy(unidades.codigo),
    db
      .select({ codigo: unidades.codigo, total: sql<string>`sum(${faturamento.valor})` })
      .from(faturamento)
      .innerJoin(unidades, eq(faturamento.unidadeId, unidades.id))
      .where(eq(faturamento.data, d1))
      .groupBy(unidades.codigo),
    // Loja × motivo (mesma janela D-1) — só para saber qual motivo abrir na coluna Plano de
    // Ação (item 2 da etapa de revisão); não altera valor/percentual/semáforo já calculados.
    db
      .select({ codigo: unidades.codigo, motivo: tabela.motivo, total: sql<string>`sum(${tabela.valor})` })
      .from(tabela)
      .innerJoin(unidades, eq(tabela.unidadeId, unidades.id))
      .where(eq(tabela.data, d1))
      .groupBy(unidades.codigo, tabela.motivo),
  ]);

  const valorPorLoja = new Map(porFilialRows.map((r) => [r.codigo, Number(r.total)]));
  const faturamentoPorLoja = new Map(faturamentoPorLojaRows.map((r) => [r.codigo, Number(r.total)]));

  const motivoPrincipalPorLoja = new Map<string, string>();
  const maiorValorMotivoPorLoja = new Map<string, number>();
  for (const r of porFilialMotivoRows) {
    const total = Number(r.total);
    const atual = maiorValorMotivoPorLoja.get(r.codigo) ?? -Infinity;
    if (total > atual) {
      maiorValorMotivoPorLoja.set(r.codigo, total);
      motivoPrincipalPorLoja.set(r.codigo, r.motivo);
    }
  }

  const porFilial: FilialIndicadorLinha[] = UNIDADES.filter((u) => valorPorLoja.has(u)).map((unidade) => {
    const valor = valorPorLoja.get(unidade) ?? 0;
    const fatLoja = faturamentoPorLoja.get(unidade) ?? 0;
    const percentualLoja = fatLoja > 0 ? (valor / fatLoja) * 100 : 0;
    return {
      unidade,
      valor,
      faturamento: fatLoja,
      percentualFaturamento: percentualLoja,
      semaforo: classificarSemaforo(percentualLoja, config.faixas),
      motivoPrincipal: motivoPrincipalPorLoja.get(unidade) ?? null,
    };
  });

  return {
    ...base,
    disponivel: true,
    totalIndicador,
    percentualFaturamento,
    semaforo,
    faturamentoPeriodo: faturamentoTotal,
    porMotivo,
    porFilial,
  };
}
