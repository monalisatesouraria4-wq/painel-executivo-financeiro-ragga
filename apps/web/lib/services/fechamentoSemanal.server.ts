import { between, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  faturamento,
  brindes,
  cancelamentoSalao,
  cancelamentoDelivery,
  compraDireta,
  fechamentoCaixa,
  quebraCaixa,
  pdvMaquininha,
  formasPagamento,
} from "@/lib/db/schema";
import { buscarTrocoDaSemana, buscarConferenciaDoPeriodo } from "@/lib/services/controlesCaixa";
import {
  normalizarPeriodo,
  janelaD1,
  janelaD2,
  type FechamentoSemanalData,
  type SemanalReportData,
} from "./fechamentoSemanal";
import { agregarEmBuckets } from "@/lib/rules/formasPagamento";

/**
 * Consulta real ao Postgres para "Fechamento Semanal" — reaproveita
 * exatamente as janelas já documentadas em `fechamentoSemanal.ts`
 * (D-1 para Faturamento/Formas de Pagamento/Brindes/Cancelamentos/Compra
 * Direta, D-2 para PDV×Maquininha, data literal para Fechamento/Quebra,
 * semana real para Troco via `buscarTrocoDaSemana`, ciclo 16→15 para
 * Conferência via `buscarConferenciaDoPeriodo` — ambas já validadas, não
 * duplicadas). Formas de Pagamento: mesma janela D-1 do Faturamento,
 * classificada nas 8 categorias via `agregarEmBuckets`.
 */

async function somaValor(
  db: ReturnType<typeof getDb>,
  tabela: typeof faturamento | typeof brindes | typeof cancelamentoSalao | typeof cancelamentoDelivery | typeof compraDireta,
  inicio: Date,
  fim: Date
): Promise<{ total: number; motivoMap: Record<string, number> }> {
  const [{ total: totalStr }] = await db
    .select({ total: sql<string>`coalesce(sum(${tabela.valor}), 0)` })
    .from(tabela)
    .where(between(tabela.data, inicio, fim));

  const motivoMap: Record<string, number> = {};
  if ("motivo" in tabela) {
    const linhas = await db
      .select({ motivo: (tabela as typeof brindes).motivo, total: sql<string>`sum(${tabela.valor})` })
      .from(tabela)
      .where(between(tabela.data, inicio, fim))
      .groupBy((tabela as typeof brindes).motivo);
    for (const l of linhas) motivoMap[l.motivo] = Number(l.total);
  }

  return { total: Number(totalStr), motivoMap };
}

export async function buscarFechamentoSemanal(iniISO: string, fimISO: string): Promise<FechamentoSemanalData> {
  const conectado = Boolean(process.env.DATABASE_URL);

  if (!iniISO || !fimISO) {
    return { conectado, disponivel: false, periodoLabel: null, report: null };
  }

  const { iniBase, fimBase, periodoLabel } = normalizarPeriodo(iniISO, fimISO);

  if (!conectado) {
    return { conectado, disponivel: false, periodoLabel, report: null };
  }

  const db = getDb();
  const d1 = janelaD1(iniBase, fimBase);
  const d2 = janelaD2(iniBase, fimBase);

  const [
    fat,
    brd,
    cancSal,
    cancDel,
    compra,
    fechRows,
    quebraRows,
    pdvRows,
    trocoData,
    conferenciaData,
    formasRows,
  ] = await Promise.all([
    somaValor(db, faturamento, d1.inicio, d1.fim),
    somaValor(db, brindes, d1.inicio, d1.fim),
    somaValor(db, cancelamentoSalao, d1.inicio, d1.fim),
    somaValor(db, cancelamentoDelivery, d1.inicio, d1.fim),
    somaValor(db, compraDireta, d1.inicio, d1.fim),
    db
      .select({ situacao: fechamentoCaixa.situacao })
      .from(fechamentoCaixa)
      .where(between(fechamentoCaixa.data, iniBase, fimBase)),
    db
      .select({ valor: quebraCaixa.valor })
      .from(quebraCaixa)
      .where(between(quebraCaixa.data, iniBase, fimBase)),
    db
      .select({ valorPdv: pdvMaquininha.valorPdv, valorMaquininha: pdvMaquininha.valorMaquininha })
      .from(pdvMaquininha)
      .where(between(pdvMaquininha.data, d2.inicio, d2.fim)),
    buscarTrocoDaSemana(db, iniBase),
    buscarConferenciaDoPeriodo(db, iniBase),
    db
      .select({ forma: formasPagamento.forma, valor: formasPagamento.valor })
      .from(formasPagamento)
      .where(between(formasPagamento.data, d1.inicio, d1.fim)),
  ]);

  const pdvTotalPdv = pdvRows.reduce((s, r) => s + Number(r.valorPdv), 0);
  const pdvTotalMaq = pdvRows.reduce((s, r) => s + Number(r.valorMaquininha), 0);
  const formaBuckets = agregarEmBuckets(formasRows.map((r) => ({ forma: r.forma, valor: Number(r.valor) })));

  const fechAbertos = fechRows.filter((r) => r.situacao === "Aberto").length;
  const fechFechados = fechRows.filter((r) => r.situacao === "Fechado").length;
  const fechConciliados = fechRows.filter((r) => r.situacao === "Conciliado").length;
  const quebraTotal = quebraRows.reduce((s, r) => s + Number(r.valor), 0);

  const report: SemanalReportData = {
    periodoLabel,
    faturamentoTotal: fat.total,
    formaBuckets,
    brindeTotal: brd.total,
    brindeMotivoMap: brd.motivoMap,
    cancDeliveryTotal: cancDel.total,
    cancDeliveryMotivoMap: cancDel.motivoMap,
    cancSalaoTotal: cancSal.total,
    cancSalaoMotivoMap: cancSal.motivoMap,
    compraDiretaTotal: compra.total,
    compraDiretaMotivoMap: compra.motivoMap,
    fechAbertos,
    fechFechados,
    fechConciliados,
    quebraTotal,
    quebraQtd: quebraRows.length,
    pdvTotalPdv,
    pdvTotalMaq,
    pdvDiferenca: pdvTotalMaq - pdvTotalPdv,
    trocoTotalInformado: trocoData.totalInformado ?? 0,
    trocoTotalConferido: trocoData.totalConferido ?? 0,
    trocoDiferenca: trocoData.diferencaTotal ?? 0,
    trocoQtdConferido: trocoData.linhas.flatMap((l) => l.caixas).filter((c) => c.status === "Conferido").length,
    trocoQtdDivergencia: trocoData.divergencias ?? 0,
    trocoQtdSemConferencia: 0,
    confCadastro: conferenciaData.totalCaixasRede ?? 0,
    confQtdConferidos: conferenciaData.totalConferidosRede ?? 0,
    confQtdAtraso: conferenciaData.totalEmAtraso ?? 0,
    confQtdPendentes: conferenciaData.totalPendentesRede ?? 0,
    pctConferido: conferenciaData.percentualConferidoRede,
  };

  const disponivel =
    fat.total > 0 ||
    brd.total > 0 ||
    cancSal.total > 0 ||
    cancDel.total > 0 ||
    compra.total > 0 ||
    quebraTotal > 0 ||
    fechRows.length > 0;

  return { conectado, disponivel, periodoLabel, report: disponivel ? report : null };
}
