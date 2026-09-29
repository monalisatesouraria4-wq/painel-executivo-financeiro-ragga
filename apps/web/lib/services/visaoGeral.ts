import { and, eq, sql } from "drizzle-orm";
import type { CodigoUnidade } from "@painel/shared";
import { classificarSemaforo, FAIXAS_BRINDES, FAIXAS_CANCELAMENTO, FAIXAS_COMPRA_DIRETA, type CorSemaforo } from "@/lib/rules/semaforos";
import { dataDMenos1 } from "@/lib/rules/datas";
import { getDb } from "@/lib/db/client";
import { unidades, faturamento, brindes, cancelamentoSalao, cancelamentoDelivery, compraDireta, retiradaDeposito, formasPagamento } from "@/lib/db/schema";
import { buscarControlesCaixa } from "@/lib/services/controlesCaixa";
import { agregarEmBuckets } from "@/lib/rules/formasPagamento";
import type { FormaPagamentoBuckets } from "@/lib/services/fechamentoWhatsapp";

/**
 * Camada de serviço da tela Visão Geral — espelha exatamente os cards e a
 * tabela de `renderVisaoGeral` do painel HTML legado (ver auditoria
 * funcional: hero Faturamento, cards de Indicadores/Retiradas/Controles,
 * tabela "Detalhamento por loja").
 *
 * Sem `DATABASE_URL`, retorna `disponivel: false` em tudo — nenhum dado
 * inventado. Com `DATABASE_URL`, consulta o banco real via `getDb()` +
 * `lib/db/schema`, usando D-1 (`dataDMenos1`, já validada/testada) para
 * Faturamento/Brindes/Cancelamentos/Compra Direta/Retirada Depósito —
 * exatamente a mesma janela usada pelo legado (ver auditoria funcional,
 * `renderVisaoGeral`, linha 3714).
 *
 * NESTA ETAPA: Faturamento, Brindes, Cancelamento Salão, Cancelamento
 * Delivery, Retirada Compra Direta e Retirada para Depósito (filtro
 * `motivo = 'DEPOSITO'`, regra já validada, não alterada) estão
 * conectados. Fechamento/PDV×Maquininha/Troco/Conferência/Quebra de
 * Caixa permanecem como dependência pendente nesta etapa (instrução:
 * "preparar a integração" de Controles de Caixa, não necessariamente
 * conectar — as regras de janela desses 5 blocos, especialmente
 * Troco/Conferência, envolvem lógica de "semana mais próxima"/"status
 * global" que merece sua própria etapa de conexão dedicada).
 */

export interface IndicadorComSemaforo {
  disponivel: boolean;
  valor?: number;
  percentualFaturamento?: number;
  semaforo?: CorSemaforo;
}

export interface IndicadorSimples {
  disponivel: boolean;
  valor?: number;
}

export interface LinhaDetalhamentoLoja {
  unidade: CodigoUnidade;
  faturamento: IndicadorSimples;
  retiradaCompraDireta: IndicadorComSemaforo;
  brindes: IndicadorComSemaforo;
  cancelamentoSalao: IndicadorComSemaforo;
  cancelamentoDelivery: IndicadorComSemaforo;
}

export interface VisaoGeralData {
  conectado: boolean;
  dataReferencia: Date;
  faturamento: IndicadorSimples & { qtdVendas?: number };
  formasPagamento: { disponivel: boolean; buckets?: FormaPagamentoBuckets };
  brindes: IndicadorComSemaforo;
  cancelamentoSalao: IndicadorComSemaforo;
  cancelamentoDelivery: IndicadorComSemaforo;
  retiradaCompraDireta: IndicadorComSemaforo;
  retiradaDeposito: {
    disponivel: boolean;
    valorDia?: number;
    acumuladoCiclo?: number;
  };
  fechamento: { disponivel: boolean; caixasAbertos?: number };
  pdvMaquininha: { disponivel: boolean; diferenca?: number };
  troco: { disponivel: boolean; divergencias?: number };
  conferencia: { disponivel: boolean; percentualConferido?: number; emAtraso?: number };
  quebraCaixa: { disponivel: boolean; total?: number };
  detalhamentoPorLoja: LinhaDetalhamentoLoja[];
}

function indisponivel(): IndicadorComSemaforo {
  return { disponivel: false };
}

/** Aplica o semáforo correto (reaproveitando `lib/rules/semaforos.ts`) quando o percentual estiver disponível. */
export function comSemaforo(
  valor: number,
  percentualFaturamento: number,
  faixas: Parameters<typeof classificarSemaforo>[1]
): IndicadorComSemaforo {
  return {
    disponivel: true,
    valor,
    percentualFaturamento,
    semaforo: classificarSemaforo(percentualFaturamento, faixas),
  };
}

/** Soma o valor de uma base de fatos por unidade, para uma data específica. Retorna Map<codigoUnidade, valor>. */
async function somaPorLoja(
  db: ReturnType<typeof getDb>,
  tabela: typeof brindes | typeof cancelamentoSalao | typeof cancelamentoDelivery | typeof compraDireta | typeof faturamento,
  data: Date
): Promise<Map<string, number>> {
  const linhas = await db
    .select({ codigo: unidades.codigo, total: sql<string>`coalesce(sum(${tabela.valor}), 0)` })
    .from(tabela)
    .innerJoin(unidades, eq(tabela.unidadeId, unidades.id))
    .where(eq(tabela.data, data))
    .groupBy(unidades.codigo);

  return new Map(linhas.map((l) => [l.codigo, Number(l.total)]));
}

function totalDoMapa(mapa: Map<string, number>): number {
  let total = 0;
  for (const v of mapa.values()) total += v;
  return total;
}

export async function buscarVisaoGeral(dataReferencia: Date): Promise<VisaoGeralData> {
  const conectado = Boolean(process.env.DATABASE_URL);

  const base: VisaoGeralData = {
    conectado,
    dataReferencia,
    faturamento: { disponivel: false },
    formasPagamento: { disponivel: false },
    brindes: indisponivel(),
    cancelamentoSalao: indisponivel(),
    cancelamentoDelivery: indisponivel(),
    retiradaCompraDireta: indisponivel(),
    retiradaDeposito: { disponivel: false },
    fechamento: { disponivel: false },
    pdvMaquininha: { disponivel: false },
    troco: { disponivel: false },
    conferencia: { disponivel: false },
    quebraCaixa: { disponivel: false },
    detalhamentoPorLoja: [],
  };

  if (!conectado) return base;

  const db = getDb();
  const d1 = dataDMenos1(dataReferencia);

  const [faturamentoPorLoja, brindesPorLoja, cancSalaoPorLoja, cancDeliveryPorLoja, compraDiretaPorLoja, retiradaDepositoLinhas, controlesCaixa, formasRows] =
    await Promise.all([
      somaPorLoja(db, faturamento, d1),
      somaPorLoja(db, brindes, d1),
      somaPorLoja(db, cancelamentoSalao, d1),
      somaPorLoja(db, cancelamentoDelivery, d1),
      somaPorLoja(db, compraDireta, d1),
      // Retirada Depósito: filtro `motivo = 'DEPÓSITO'` — corrigido nesta etapa (o valor
      // persistido tem acento; o literal sem acento nunca batia, causando "Sem dados" mesmo
      // com registros reais — confirmado via consulta direta ao banco). Mesma regra/coluna,
      // não é um valor novo nem uma reclassificação.
      db
        .select({ codigo: unidades.codigo, total: sql<string>`coalesce(sum(${retiradaDeposito.valor}), 0)` })
        .from(retiradaDeposito)
        .innerJoin(unidades, eq(retiradaDeposito.unidadeId, unidades.id))
        .where(and(eq(retiradaDeposito.data, d1), eq(retiradaDeposito.motivo, "DEPÓSITO")))
        .groupBy(unidades.codigo),
      // Reaproveita a mesma camada real já validada em /controles-caixa — apenas resume os totais aqui.
      buscarControlesCaixa(dataReferencia),
      // Formas de Pagamento: mesma janela D-1 do Faturamento (mesma fonte, VENDAS.xlsx).
      db.select({ forma: formasPagamento.forma, valor: formasPagamento.valor }).from(formasPagamento).where(eq(formasPagamento.data, d1)),
    ]);

  const formasPagamentoData: VisaoGeralData["formasPagamento"] =
    formasRows.length > 0
      ? { disponivel: true, buckets: agregarEmBuckets(formasRows.map((r) => ({ forma: r.forma, valor: Number(r.valor) }))) }
      : { disponivel: false };

  const retiradaDepositoPorLoja = new Map(retiradaDepositoLinhas.map((l) => [l.codigo, Number(l.total)]));

  const totalFaturamento = totalDoMapa(faturamentoPorLoja);
  const totalBrindes = totalDoMapa(brindesPorLoja);
  const totalCancSalao = totalDoMapa(cancSalaoPorLoja);
  const totalCancDelivery = totalDoMapa(cancDeliveryPorLoja);
  const totalCompraDireta = totalDoMapa(compraDiretaPorLoja);
  const totalRetiradaDeposito = totalDoMapa(retiradaDepositoPorLoja);

  function percentual(valor: number): number {
    return totalFaturamento > 0 ? (valor / totalFaturamento) * 100 : 0;
  }

  const unidadesComDado = new Set<string>([
    ...faturamentoPorLoja.keys(),
    ...brindesPorLoja.keys(),
    ...cancSalaoPorLoja.keys(),
    ...cancDeliveryPorLoja.keys(),
    ...compraDiretaPorLoja.keys(),
  ]);

  const detalhamentoPorLoja: LinhaDetalhamentoLoja[] = [...unidadesComDado].map((codigo) => {
    const fatLoja = faturamentoPorLoja.get(codigo) ?? 0;
    const percentualLoja = (valor: number) => (fatLoja > 0 ? (valor / fatLoja) * 100 : 0);
    return {
      unidade: codigo as CodigoUnidade,
      faturamento: faturamentoPorLoja.has(codigo) ? { disponivel: true, valor: fatLoja } : { disponivel: false },
      retiradaCompraDireta: compraDiretaPorLoja.has(codigo)
        ? comSemaforo(compraDiretaPorLoja.get(codigo)!, percentualLoja(compraDiretaPorLoja.get(codigo)!), FAIXAS_COMPRA_DIRETA)
        : indisponivel(),
      brindes: brindesPorLoja.has(codigo)
        ? comSemaforo(brindesPorLoja.get(codigo)!, percentualLoja(brindesPorLoja.get(codigo)!), FAIXAS_BRINDES)
        : indisponivel(),
      cancelamentoSalao: cancSalaoPorLoja.has(codigo)
        ? comSemaforo(cancSalaoPorLoja.get(codigo)!, percentualLoja(cancSalaoPorLoja.get(codigo)!), FAIXAS_CANCELAMENTO)
        : indisponivel(),
      cancelamentoDelivery: cancDeliveryPorLoja.has(codigo)
        ? comSemaforo(cancDeliveryPorLoja.get(codigo)!, percentualLoja(cancDeliveryPorLoja.get(codigo)!), FAIXAS_CANCELAMENTO)
        : indisponivel(),
    };
  });

  return {
    ...base,
    faturamento: faturamentoPorLoja.size > 0 ? { disponivel: true, valor: totalFaturamento } : { disponivel: false },
    formasPagamento: formasPagamentoData,
    brindes: brindesPorLoja.size > 0 ? comSemaforo(totalBrindes, percentual(totalBrindes), FAIXAS_BRINDES) : indisponivel(),
    cancelamentoSalao:
      cancSalaoPorLoja.size > 0 ? comSemaforo(totalCancSalao, percentual(totalCancSalao), FAIXAS_CANCELAMENTO) : indisponivel(),
    cancelamentoDelivery:
      cancDeliveryPorLoja.size > 0
        ? comSemaforo(totalCancDelivery, percentual(totalCancDelivery), FAIXAS_CANCELAMENTO)
        : indisponivel(),
    retiradaCompraDireta:
      compraDiretaPorLoja.size > 0
        ? comSemaforo(totalCompraDireta, percentual(totalCompraDireta), FAIXAS_COMPRA_DIRETA)
        : indisponivel(),
    retiradaDeposito:
      retiradaDepositoPorLoja.size > 0 ? { disponivel: true, valorDia: totalRetiradaDeposito } : { disponivel: false },
    fechamento: {
      disponivel: controlesCaixa.fechamento.disponivel,
      caixasAbertos: controlesCaixa.fechamento.caixasEmAberto ?? undefined,
    },
    pdvMaquininha: {
      disponivel: controlesCaixa.pdvMaquininha.disponivel,
      diferenca: controlesCaixa.pdvMaquininha.diferencaRede ?? undefined,
    },
    troco: {
      disponivel: controlesCaixa.troco.disponivel,
      divergencias: controlesCaixa.troco.divergencias ?? undefined,
    },
    conferencia: {
      disponivel: controlesCaixa.conferencia.disponivel,
      percentualConferido: controlesCaixa.conferencia.percentualConferidoRede ?? undefined,
      emAtraso: controlesCaixa.conferencia.totalEmAtraso ?? undefined,
    },
    quebraCaixa: {
      disponivel: controlesCaixa.quebraCaixa.disponivel,
      total: controlesCaixa.quebraCaixa.totalGeral ?? undefined,
    },
    detalhamentoPorLoja,
  };
}
