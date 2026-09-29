import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { faturamento, brindes, cancelamentoSalao, cancelamentoDelivery, compraDireta, fechamentoCaixa, formasPagamento } from "@/lib/db/schema";
import type { FechamentoWhatsappData, WhatsappReportData } from "./fechamentoWhatsapp";
import { agregarEmBuckets } from "@/lib/rules/formasPagamento";

/**
 * Consulta real ao Postgres para "Fechamento WhatsApp" — todos os
 * indicadores usam DATA LITERAL do dia selecionado (sem D-1/D-2,
 * confirmado no legado), exceto Formas de Pagamento (fonte ainda não
 * conectada — buckets ficam zerados, documentado como pendência, nunca
 * inventado). PDV × Maquininha e Conferência não entram nesta tela
 * (confirmado, ausentes de `computeWhatsappReport`).
 */
async function somaComMotivo(
  db: ReturnType<typeof getDb>,
  tabela: typeof brindes | typeof cancelamentoSalao | typeof cancelamentoDelivery | typeof compraDireta,
  data: Date
): Promise<{ total: number; motivoMap: Record<string, number> }> {
  const linhas = await db
    .select({ motivo: tabela.motivo, total: sql<string>`sum(${tabela.valor})` })
    .from(tabela)
    .where(eq(tabela.data, data))
    .groupBy(tabela.motivo);

  const motivoMap: Record<string, number> = {};
  let total = 0;
  for (const l of linhas) {
    motivoMap[l.motivo] = Number(l.total);
    total += Number(l.total);
  }
  return { total, motivoMap };
}

export async function buscarFechamentoWhatsapp(dateStr: string, dataReferencia: Date): Promise<FechamentoWhatsappData> {
  const conectado = Boolean(process.env.DATABASE_URL);

  if (!conectado) {
    return { conectado, disponivel: false, dateStr, semDados: false, report: null };
  }

  const db = getDb();

  const [
    { total: faturamentoTotalStr },
    brd,
    cancSal,
    cancDel,
    compra,
    fechRows,
    formasRows,
  ] = await Promise.all([
    db.select({ total: sql<string>`coalesce(sum(${faturamento.valor}), 0)` }).from(faturamento).where(eq(faturamento.data, dataReferencia)).then((r) => r[0]),
    somaComMotivo(db, brindes, dataReferencia),
    somaComMotivo(db, cancelamentoSalao, dataReferencia),
    somaComMotivo(db, cancelamentoDelivery, dataReferencia),
    somaComMotivo(db, compraDireta, dataReferencia),
    db.select({ situacao: fechamentoCaixa.situacao }).from(fechamentoCaixa).where(eq(fechamentoCaixa.data, dataReferencia)),
    db.select({ forma: formasPagamento.forma, valor: formasPagamento.valor }).from(formasPagamento).where(eq(formasPagamento.data, dataReferencia)),
  ]);

  const formaBuckets = agregarEmBuckets(formasRows.map((r) => ({ forma: r.forma, valor: Number(r.valor) })));

  const faturamentoTotal = Number(faturamentoTotalStr);
  const cancTotal = cancSal.total + cancDel.total;
  const semDados = faturamentoTotal === 0 && brd.total === 0 && cancTotal === 0 && compra.total === 0 && fechRows.length === 0;

  const report: WhatsappReportData = {
    dateStr,
    faturamentoTotal,
    formaBuckets,
    brindeTotal: brd.total,
    brindeMotivoMap: brd.motivoMap,
    cancSalaoTotal: cancSal.total,
    cancSalaoMotivoMap: cancSal.motivoMap,
    cancDeliveryTotal: cancDel.total,
    cancDeliveryMotivoMap: cancDel.motivoMap,
    cancTotal,
    compraDiretaTotal: compra.total,
    compraDiretaMotivoMap: compra.motivoMap,
    quebraTotal: 0,
    fechAbertos: fechRows.filter((r) => r.situacao === "Aberto").length,
    fechFechados: fechRows.filter((r) => r.situacao === "Fechado").length,
    fechConciliados: fechRows.filter((r) => r.situacao === "Conciliado").length,
  };

  return { conectado, disponivel: true, dateStr, semDados, report };
}
