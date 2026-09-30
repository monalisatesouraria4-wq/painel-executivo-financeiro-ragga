import { and, eq, lte, sql } from "drizzle-orm";
import type { CodigoUnidade } from "@painel/shared";
import { classificarSemaforo, FAIXAS_BRINDES, FAIXAS_CANCELAMENTO, FAIXAS_COMPRA_DIRETA, type CorSemaforo } from "@/lib/rules/semaforos";
import { getDb } from "@/lib/db/client";
import {
  unidades,
  faturamento,
  brindes,
  cancelamentoSalao,
  cancelamentoDelivery,
  compraDireta,
  retiradaDeposito,
  formasPagamento,
  fechamentoCaixa,
  pdvMaquininha,
  troco,
  conferencia,
  quebraCaixa,
} from "@/lib/db/schema";
import { agregarEmBuckets } from "@/lib/rules/formasPagamento";
import type { FormaPagamentoBuckets } from "@/lib/services/fechamentoWhatsapp";

/**
 * Camada de serviço da tela Visão Geral — espelha exatamente os cards e a
 * tabela de `renderVisaoGeral` do painel HTML legado (ver auditoria
 * funcional: hero Faturamento, cards de Indicadores/Retiradas/Controles,
 * tabela "Detalhamento por loja").
 *
 * Regra HÍBRIDA (correção desta etapa) — duas categorias de card:
 *
 * 1. Indicadores financeiros/operacionais (Faturamento, Formas de
 *    Pagamento, Brindes, Cancelamento Salão, Cancelamento Delivery,
 *    Retirada Compra Direta, Retirada p/ Depósito): usam EXATAMENTE a
 *    `dataReferencia` selecionada no filtro — sem D-1, sem D-2, sem
 *    fallback. Sem registro na data exata, o card fica indisponível
 *    ("Sem dados"), nunca busca um dia anterior nem mostra R$ 0,00.
 *
 * 2. Controles de Caixa (Fechamento/PDV×Maquininha/Troco/Conferência/
 *    Quebra) — EXCEÇÃO: cada card busca sua própria "última data
 *    disponível <= dataReferencia" (`ultimaDataAte`, MAX(data) real da
 *    tabela — nunca uma subtração de dias fixa), e mostra os dados
 *    exatamente dessa data. Cada bloco pode ter uma data diferente;
 *    `dataRegistro` no retorno informa qual foi usada, para a tela
 *    exibir "Último registro: DD/MM" quando diferir da data
 *    selecionada. Consultas independentes desta camada (funções
 *    `buscar*Resumo` abaixo) — não reaproveitam `buscarControlesCaixa`
 *    nem suas regras de janela (D-1/D-2/semana real/ciclo 16→15), que
 *    continuam intocadas na tela /controles-caixa.
 *
 * Sem `DATABASE_URL`, retorna `disponivel: false` em tudo — nenhum dado
 * inventado.
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
  /** Data real do registro usado (pode ser diferente de D-1 quando `ultimoRegistroDisponivel` é true). */
  dataRegistro?: Date;
  /** true = não havia dado em D-1; mostrando o último registro real disponível daquele indicador. */
  ultimoRegistroDisponivel?: boolean;
}

export interface IndicadorSimples {
  disponivel: boolean;
  valor?: number;
  dataRegistro?: Date;
  ultimoRegistroDisponivel?: boolean;
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
  faturamento: IndicadorSimples & {
    qtdVendas?: number;
    /**
     * Comparação "vs. dia anterior" do card de Faturamento (item 2 desta
     * etapa) — percentual de variação contra o DIA CALENDÁRIO
     * imediatamente anterior à `dataReferencia` (literal, nunca "último
     * registro disponível"). `null` quando não há faturamento nesse dia
     * anterior (ou quando o dia atual também não tem), para nunca
     * inventar percentual — a tela mostra "Sem comparação" nesse caso.
     */
    comparativoDiaAnterior: number | null;
  };
  formasPagamento: { disponivel: boolean; buckets?: FormaPagamentoBuckets };
  brindes: IndicadorComSemaforo;
  cancelamentoSalao: IndicadorComSemaforo;
  cancelamentoDelivery: IndicadorComSemaforo;
  retiradaCompraDireta: IndicadorComSemaforo;
  retiradaDeposito: {
    disponivel: boolean;
    valorDia?: number;
    acumuladoCiclo?: number;
    dataRegistro?: Date;
    ultimoRegistroDisponivel?: boolean;
  };
  /**
   * Controles de Caixa (item 2 da correção híbrida): EXCEÇÃO à regra de
   * "data exata" acima — cada card busca sua própria "última data
   * disponível <= data de referência selecionada", nunca a data exata
   * nem D-1/D-2 fixo. `dataRegistro` informa qual foi essa data real
   * (mostrado como "Último registro: DD/MM" quando difere da data
   * selecionada). Consultas independentes desta camada — não reaproveitam
   * `buscarControlesCaixa`/regras de semana real/ciclo 16→15 da tela
   * /controles-caixa, que continuam intocadas.
   */
  fechamento: { disponivel: boolean; totalCaixasOperados?: number; dataRegistro?: Date };
  pdvMaquininha: { disponivel: boolean; diferenca?: number; dataRegistro?: Date };
  troco: { disponivel: boolean; divergencias?: number; dataRegistro?: Date };
  conferencia: { disponivel: boolean; percentualConferido?: number; emAtraso?: number; dataRegistro?: Date };
  quebraCaixa: { disponivel: boolean; total?: number; dataRegistro?: Date };
  detalhamentoPorLoja: LinhaDetalhamentoLoja[];
}

function indisponivel(): IndicadorComSemaforo {
  return { disponivel: false };
}

/** Aplica o semáforo correto (reaproveitando `lib/rules/semaforos.ts`) quando o percentual estiver disponível. */
export function comSemaforo(
  valor: number,
  percentualFaturamento: number,
  faixas: Parameters<typeof classificarSemaforo>[1],
  opts?: { dataRegistro?: Date; ultimoRegistroDisponivel?: boolean }
): IndicadorComSemaforo {
  return {
    disponivel: true,
    valor,
    percentualFaturamento,
    semaforo: classificarSemaforo(percentualFaturamento, faixas),
    ...opts,
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

function arred(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * "Última data disponível <= data de referência" (item 2 da correção
 * híbrida) — MAX(data) real da tabela, nunca uma subtração de dias. Usada
 * só pelos 5 cards resumidos de Controles de Caixa na Visão Geral; a
 * tela /controles-caixa continua com suas próprias regras de janela
 * (D-1/D-2/semana real/ciclo 16→15), não tocadas aqui.
 */
async function ultimaDataAte(
  db: ReturnType<typeof getDb>,
  tabela: typeof fechamentoCaixa | typeof pdvMaquininha | typeof troco | typeof conferencia | typeof quebraCaixa,
  dataLimite: Date
): Promise<Date | null> {
  const [{ maxData }] = await db
    .select({ maxData: sql<string | null>`max(${tabela.data})` })
    .from(tabela)
    .where(lte(tabela.data, dataLimite));
  return maxData ? new Date(maxData) : null;
}

/**
 * Mesmo conceito do card "Total de Caixas Operados" da aba Controles de
 * Caixa → Fechamento (`FechamentoTab.tsx`/`aberturaFechamento.server.ts`:
 * total de linhas com abertura registrada na data — não "caixas
 * atualmente em aberto"). Rótulo corrigido nesta etapa para a Visão
 * Geral consumir o mesmo total, sem recalcular nada de novo.
 */
async function buscarFechamentoResumo(db: ReturnType<typeof getDb>, dataLimite: Date): Promise<VisaoGeralData["fechamento"]> {
  const dataRegistro = await ultimaDataAte(db, fechamentoCaixa, dataLimite);
  if (!dataRegistro) return { disponivel: false };
  const rows = await db.select({ situacao: fechamentoCaixa.situacao }).from(fechamentoCaixa).where(eq(fechamentoCaixa.data, dataRegistro));
  return { disponivel: true, totalCaixasOperados: rows.length, dataRegistro };
}

async function buscarPdvMaquininhaResumo(db: ReturnType<typeof getDb>, dataLimite: Date): Promise<VisaoGeralData["pdvMaquininha"]> {
  const dataRegistro = await ultimaDataAte(db, pdvMaquininha, dataLimite);
  if (!dataRegistro) return { disponivel: false };
  const rows = await db
    .select({ valorPdv: pdvMaquininha.valorPdv, valorMaquininha: pdvMaquininha.valorMaquininha })
    .from(pdvMaquininha)
    .where(eq(pdvMaquininha.data, dataRegistro));
  const totalPdv = rows.reduce((s, r) => s + Number(r.valorPdv), 0);
  const totalMaquininha = rows.reduce((s, r) => s + Number(r.valorMaquininha), 0);
  return { disponivel: true, diferenca: arred(totalMaquininha - totalPdv), dataRegistro };
}

async function buscarTrocoResumo(db: ReturnType<typeof getDb>, dataLimite: Date): Promise<VisaoGeralData["troco"]> {
  const dataRegistro = await ultimaDataAte(db, troco, dataLimite);
  if (!dataRegistro) return { disponivel: false };
  const rows = await db.select({ diferenca: troco.diferenca }).from(troco).where(eq(troco.data, dataRegistro));
  return { disponivel: true, divergencias: rows.filter((r) => Number(r.diferenca) !== 0).length, dataRegistro };
}

async function buscarConferenciaResumo(db: ReturnType<typeof getDb>, dataLimite: Date): Promise<VisaoGeralData["conferencia"]> {
  const dataRegistro = await ultimaDataAte(db, conferencia, dataLimite);
  if (!dataRegistro) return { disponivel: false };
  const rows = await db
    .select({ qtdCadastrados: conferencia.qtdCadastrados, qtdConferidos: conferencia.qtdConferidos, emAtraso: conferencia.emAtraso })
    .from(conferencia)
    .where(eq(conferencia.data, dataRegistro));
  const comCadastro = rows.filter((r) => r.qtdCadastrados > 0);
  const percentualConferido =
    comCadastro.length > 0
      ? comCadastro.reduce((s, r) => s + ((r.qtdConferidos ?? 0) / r.qtdCadastrados) * 100, 0) / comCadastro.length
      : 0;
  return { disponivel: true, percentualConferido, emAtraso: rows.filter((r) => r.emAtraso).length, dataRegistro };
}

async function buscarQuebraCaixaResumo(db: ReturnType<typeof getDb>, dataLimite: Date): Promise<VisaoGeralData["quebraCaixa"]> {
  const dataRegistro = await ultimaDataAte(db, quebraCaixa, dataLimite);
  if (!dataRegistro) return { disponivel: false };
  const rows = await db.select({ valor: quebraCaixa.valor }).from(quebraCaixa).where(eq(quebraCaixa.data, dataRegistro));
  return { disponivel: true, total: arred(rows.reduce((s, r) => s + Number(r.valor), 0)), dataRegistro };
}

export async function buscarVisaoGeral(dataReferencia: Date): Promise<VisaoGeralData> {
  const conectado = Boolean(process.env.DATABASE_URL);

  const base: VisaoGeralData = {
    conectado,
    dataReferencia,
    faturamento: { disponivel: false, comparativoDiaAnterior: null },
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

  // "vs. dia anterior" do card de Faturamento (item 2 desta etapa): DIA CALENDÁRIO literal
  // anterior a `dataReferencia` — nunca "último registro disponível", nunca D-1 aplicado ao
  // resto da tela. Só usado para essa comparação pontual do hero.
  const diaAnterior = new Date(dataReferencia);
  diaAnterior.setUTCDate(diaAnterior.getUTCDate() - 1);

  const [
    faturamentoPorLoja,
    brindesPorLoja,
    cancSalaoPorLoja,
    cancDeliveryPorLoja,
    compraDiretaPorLoja,
    retiradaDepositoLinhas,
    retiradaDepositoBaseRows,
    fechamentoResumo,
    pdvMaquininhaResumo,
    trocoResumo,
    conferenciaResumo,
    quebraCaixaResumo,
    formasRows,
    faturamentoDiaAnteriorPorLoja,
  ] = await Promise.all([
    somaPorLoja(db, faturamento, dataReferencia),
    somaPorLoja(db, brindes, dataReferencia),
    somaPorLoja(db, cancelamentoSalao, dataReferencia),
    somaPorLoja(db, cancelamentoDelivery, dataReferencia),
    somaPorLoja(db, compraDireta, dataReferencia),
    // Retirada Depósito: filtro `motivo = 'DEPÓSITO'` — corrigido em etapa anterior (o valor
    // persistido tem acento; o literal sem acento nunca batia, causando "Sem dados" mesmo
    // com registros reais — confirmado via consulta direta ao banco). Mesma regra/coluna,
    // não é um valor novo nem uma reclassificação.
    db
      .select({ codigo: unidades.codigo, total: sql<string>`coalesce(sum(${retiradaDeposito.valor}), 0)` })
      .from(retiradaDeposito)
      .innerJoin(unidades, eq(retiradaDeposito.unidadeId, unidades.id))
      .where(and(eq(retiradaDeposito.data, dataReferencia), eq(retiradaDeposito.motivo, "DEPÓSITO")))
      .groupBy(unidades.codigo),
    // Existência da BASE (não da data) — distingue "base nunca carregada" de "sem retirada
    // nessa data específica" (item 1 desta etapa): só quando a base tem histórico é que a
    // ausência na data selecionada vira R$ 0,00 real; sem nenhum registro em lugar nenhum,
    // continua "Sem dados disponíveis" (nenhuma regra de data alterada).
    db
      .select({ total: sql<string>`count(*)` })
      .from(retiradaDeposito)
      .where(eq(retiradaDeposito.motivo, "DEPÓSITO")),
    // Controles de Caixa (item 2 da correção híbrida): EXCEÇÃO — cada card busca sua própria
    // "última data disponível <= dataReferencia" (consultas independentes desta camada, ver
    // funções acima; não reaproveitam `buscarControlesCaixa`/regras de semana real/ciclo 16→15
    // da tela /controles-caixa, que continuam intocadas).
    buscarFechamentoResumo(db, dataReferencia),
    buscarPdvMaquininhaResumo(db, dataReferencia),
    buscarTrocoResumo(db, dataReferencia),
    buscarConferenciaResumo(db, dataReferencia),
    buscarQuebraCaixaResumo(db, dataReferencia),
    // Formas de Pagamento: mesma data exata do Faturamento (mesma fonte, VENDAS.xlsx).
    db.select({ forma: formasPagamento.forma, valor: formasPagamento.valor }).from(formasPagamento).where(eq(formasPagamento.data, dataReferencia)),
    somaPorLoja(db, faturamento, diaAnterior),
  ]);

  const formasPagamentoData: VisaoGeralData["formasPagamento"] =
    formasRows.length > 0
      ? { disponivel: true, buckets: agregarEmBuckets(formasRows.map((r) => ({ forma: r.forma, valor: Number(r.valor) }))) }
      : { disponivel: false };

  const retiradaDepositoPorLoja = new Map(retiradaDepositoLinhas.map((l) => [l.codigo, Number(l.total)]));

  const totalRetiradaDeposito = totalDoMapa(retiradaDepositoPorLoja);
  const baseRetiradaDepositoExiste = Number(retiradaDepositoBaseRows[0]?.total ?? 0) > 0;

  // "vs. dia anterior": só calcula se houver faturamento real nos dois dias (dia atual e o
  // dia calendário anterior) — nunca inventa percentual sobre um lado ausente/zero.
  const totalFaturamentoDiaAnterior = totalDoMapa(faturamentoDiaAnteriorPorLoja);
  const comparativoDiaAnterior =
    faturamentoDiaAnteriorPorLoja.size > 0 && totalFaturamentoDiaAnterior > 0 && faturamentoPorLoja.size > 0
      ? ((totalDoMapa(faturamentoPorLoja) - totalFaturamentoDiaAnterior) / totalFaturamentoDiaAnterior) * 100
      : null;

  const unidadesComDado = new Set<string>([
    ...faturamentoPorLoja.keys(),
    ...brindesPorLoja.keys(),
    ...cancSalaoPorLoja.keys(),
    ...cancDeliveryPorLoja.keys(),
    ...compraDiretaPorLoja.keys(),
  ]);

  // `unidadesComDado` já é a prova de existência: uma loja só entra nesse conjunto se
  // apareceu em pelo menos uma das 5 bases naquela data (item da correção de "zero vs.
  // sem dados" desta etapa). Por isso, para as 4 colunas de contagem de eventos (Brindes,
  // Cancelamentos, Compra Direta), a AUSÊNCIA da loja no mapa específico daquele indicador
  // não significa "sem dado" — significa "zero ocorrências reais" (ex.: loja operou e
  // vendeu naquele dia, mas não teve nenhum brinde) — mostra R$ 0,00/0,00%/semáforo
  // normalmente, nunca "—". "—" fica reservado só para quando a loja não tem NENHUM
  // registro em nenhuma das 5 bases naquela data (não entra em `unidadesComDado`).
  // Faturamento continua exigindo seu próprio registro (não é uma contagem de eventos —
  // não existe "faturamento zero real" sem um lançamento correspondente).
  const detalhamentoPorLoja: LinhaDetalhamentoLoja[] = [...unidadesComDado].map((codigo) => {
    const fatLoja = faturamentoPorLoja.get(codigo) ?? 0;
    const percentualLoja = (valor: number) => (fatLoja > 0 ? (valor / fatLoja) * 100 : 0);
    const valorCompraDireta = compraDiretaPorLoja.get(codigo) ?? 0;
    const valorBrindes = brindesPorLoja.get(codigo) ?? 0;
    const valorCancSalao = cancSalaoPorLoja.get(codigo) ?? 0;
    const valorCancDelivery = cancDeliveryPorLoja.get(codigo) ?? 0;
    return {
      unidade: codigo as CodigoUnidade,
      faturamento: faturamentoPorLoja.has(codigo) ? { disponivel: true, valor: fatLoja } : { disponivel: false },
      retiradaCompraDireta: comSemaforo(valorCompraDireta, percentualLoja(valorCompraDireta), FAIXAS_COMPRA_DIRETA),
      brindes: comSemaforo(valorBrindes, percentualLoja(valorBrindes), FAIXAS_BRINDES),
      cancelamentoSalao: comSemaforo(valorCancSalao, percentualLoja(valorCancSalao), FAIXAS_CANCELAMENTO),
      cancelamentoDelivery: comSemaforo(valorCancDelivery, percentualLoja(valorCancDelivery), FAIXAS_CANCELAMENTO),
    };
  });

  // --- Cards de topo: EXATAMENTE a data de referência selecionada, sem fallback ---
  // Todos os indicadores usam a mesma `dataReferencia`, então o percentual
  // sobre faturamento sempre compara valores da mesma data (nunca cruza
  // datas diferentes). Se não houver registro na data exata, o card fica
  // indisponível — nenhuma busca automática por um dia anterior.
  const faturamentoTotal = totalDoMapa(faturamentoPorLoja);
  const brindesTotal = totalDoMapa(brindesPorLoja);
  const cancSalaoTotal = totalDoMapa(cancSalaoPorLoja);
  const cancDeliveryTotal = totalDoMapa(cancDeliveryPorLoja);
  const compraDiretaTotal = totalDoMapa(compraDiretaPorLoja);

  function percentualSobreFaturamento(total: number): number {
    return faturamentoTotal > 0 ? (total / faturamentoTotal) * 100 : 0;
  }

  return {
    ...base,
    faturamento:
      faturamentoPorLoja.size > 0
        ? { disponivel: true, valor: faturamentoTotal, dataRegistro: dataReferencia, comparativoDiaAnterior }
        : { disponivel: false, comparativoDiaAnterior: null },
    formasPagamento: formasPagamentoData,
    brindes:
      brindesPorLoja.size > 0
        ? comSemaforo(brindesTotal, percentualSobreFaturamento(brindesTotal), FAIXAS_BRINDES, { dataRegistro: dataReferencia })
        : indisponivel(),
    cancelamentoSalao:
      cancSalaoPorLoja.size > 0
        ? comSemaforo(cancSalaoTotal, percentualSobreFaturamento(cancSalaoTotal), FAIXAS_CANCELAMENTO, { dataRegistro: dataReferencia })
        : indisponivel(),
    cancelamentoDelivery:
      cancDeliveryPorLoja.size > 0
        ? comSemaforo(cancDeliveryTotal, percentualSobreFaturamento(cancDeliveryTotal), FAIXAS_CANCELAMENTO, { dataRegistro: dataReferencia })
        : indisponivel(),
    retiradaCompraDireta:
      compraDiretaPorLoja.size > 0
        ? comSemaforo(compraDiretaTotal, percentualSobreFaturamento(compraDiretaTotal), FAIXAS_COMPRA_DIRETA, { dataRegistro: dataReferencia })
        : indisponivel(),
    // Item 1 desta etapa: a BASE de Retirada Depósito já está carregada — ausência de
    // registro na data selecionada é "não houve retirada" (R$ 0,00 real), não "sem dados".
    // Só fica indisponível se a base como um todo nunca teve nenhum registro carregado.
    retiradaDeposito: baseRetiradaDepositoExiste
      ? { disponivel: true, valorDia: totalRetiradaDeposito, dataRegistro: dataReferencia }
      : { disponivel: false },
    fechamento: fechamentoResumo,
    pdvMaquininha: pdvMaquininhaResumo,
    troco: trocoResumo,
    conferencia: conferenciaResumo,
    quebraCaixa: quebraCaixaResumo,
    detalhamentoPorLoja,
  };
}
