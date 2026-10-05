import { and, between, eq, sql } from "drizzle-orm";
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
import { resumirBrindes, type BrindesDetalhe } from "@/lib/rules/brindes";
import { mesAnteriorCompleto } from "@/lib/rules/mesAnterior";
import type { FormaPagamentoBuckets } from "@/lib/services/fechamentoWhatsapp";

/**
 * Camada de serviço da tela Visão Geral — espelha exatamente os cards e a
 * tabela de `renderVisaoGeral` do painel HTML legado (ver auditoria
 * funcional: hero Faturamento, cards de Indicadores/Retiradas/Controles,
 * tabela "Detalhamento por loja").
 *
 * Todos os blocos (indicadores, Formas de Pagamento, Retiradas, Quebra de
 * Caixa e Controles de Caixa) usam EXATAMENTE o intervalo selecionado — sem
 * D-1, sem D-2, sem "último registro disponível". Sem registro no período, o
 * bloco fica indisponível ("Sem dados"), nunca zero inventado (exceção
 * documentada: Retirada p/ Depósito mostra R$ 0,00 quando a base tem histórico).
 *
 * Brindes: o semáforo é calculado SOMENTE sobre os brindes CONTROLÁVEIS
 * (`lib/rules/brindes.ts`); total e não controláveis seguem disponíveis em
 * `brindes.detalhe`. Formas de Pagamento, Retirada p/ Depósito e Quebra de
 * Caixa trazem também o agrupamento por loja (`porLoja`) para a tela
 * acompanhar o filtro de Loja.
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

/**
 * Brindes: `valor`/`percentualFaturamento`/`semaforo` referem-se SOMENTE aos
 * brindes CONTROLÁVEIS (regra de negócio — ver `lib/rules/brindes.ts`); o total
 * geral e a composição (controláveis × não controláveis) ficam em `detalhe`.
 */
export type IndicadorBrindes = IndicadorComSemaforo & { detalhe?: BrindesDetalhe };

export type { BrindesDetalhe };

export interface LinhaDetalhamentoLoja {
  unidade: CodigoUnidade;
  faturamento: IndicadorSimples;
  retiradaCompraDireta: IndicadorComSemaforo;
  brindes: IndicadorBrindes;
  cancelamentoSalao: IndicadorComSemaforo;
  cancelamentoDelivery: IndicadorComSemaforo;
}

/** Subconjunto da Visão Geral do mês calendário anterior (comparativo dos cards — mesma consulta, mesmas regras). */
export type MesAnteriorVisaoGeral = Pick<
  VisaoGeralData,
  "dataInicio" | "dataFim" | "faturamento" | "brindes" | "cancelamentoSalao" | "cancelamentoDelivery" | "retiradaCompraDireta" | "detalhamentoPorLoja"
  | "retiradaDeposito" | "fechamento" | "pdvMaquininha" | "troco" | "conferencia" | "quebraCaixa"
> & {
  /** Primeira data com registro em cada base — para o comparativo avisar quando o mês anterior não está (totalmente) coberto. */
  coberturaDesde: Record<"retiradaDeposito" | "fechamento" | "pdvMaquininha" | "troco" | "conferencia" | "quebraCaixa", Date | null>;
};

export interface VisaoGeralData {
  /** Mês calendário anterior — só quando o período é um mês completo; senão `null`. */
  mesAnterior: MesAnteriorVisaoGeral | null;
  conectado: boolean;
  /** Início do período consultado — igual a `dataFim` no modo "data única" (ver `modoPeriodo`). */
  dataInicio: Date;
  /** Fim do período consultado — é a data de referência "única" quando `modoPeriodo` é false. */
  dataFim: Date;
  /** true quando `dataInicio !== dataFim` (usuária escolheu um intervalo, não um único dia). */
  modoPeriodo: boolean;
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
  /** `porLoja`: mesma consulta, agrupada por unidade — a tela filtra por Loja sem nova consulta. */
  formasPagamento: { disponivel: boolean; buckets?: FormaPagamentoBuckets; porLoja?: Record<string, FormaPagamentoBuckets> };
  brindes: IndicadorBrindes;
  cancelamentoSalao: IndicadorComSemaforo;
  cancelamentoDelivery: IndicadorComSemaforo;
  retiradaCompraDireta: IndicadorComSemaforo;
  retiradaDeposito: {
    disponivel: boolean;
    valorDia?: number;
    acumuladoCiclo?: number;
    /** Valor por unidade no período (ausente = R$ 0,00 real quando a base tem histórico). */
    porLoja?: Record<string, number>;
    dataRegistro?: Date;
    ultimoRegistroDisponivel?: boolean;
  };
  /**
   * Controles de Caixa: respeitam EXATAMENTE o período/data selecionado
   * (sem "última data disponível", sem D-1/D-2). Sem registro no período:
   * `disponivel: false` ("Sem dados"), nunca zero inventado. Consultas
   * independentes desta camada — não alteram as regras das abas de origem.
   */
  fechamento: { disponivel: boolean; totalCaixasOperados?: number };
  pdvMaquininha: { disponivel: boolean; diferenca?: number };
  troco: { disponivel: boolean; divergencias?: number };
  conferencia: { disponivel: boolean; percentualConferido?: number; emAtraso?: number };
  /** `porLoja`: total por unidade no período (a tela filtra por Loja sem nova consulta). */
  quebraCaixa: { disponivel: boolean; total?: number; porLoja?: Record<string, number> };
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

/**
 * Soma o valor de uma base de fatos por unidade, dentro de [dataInicio, dataFim]
 * (inclusive nas duas pontas). No modo "data única" (item 2 da etapa de
 * período), `dataInicio === dataFim` e o comportamento é idêntico ao `eq()`
 * literal já validado antes — generalização, não uma regra nova. Retorna
 * Map<codigoUnidade, valor somado no intervalo>.
 */
async function somaPorLojaIntervalo(
  db: ReturnType<typeof getDb>,
  tabela: typeof brindes | typeof cancelamentoSalao | typeof cancelamentoDelivery | typeof compraDireta | typeof faturamento,
  dataInicio: Date,
  dataFim: Date
): Promise<Map<string, number>> {
  const linhas = await db
    .select({ codigo: unidades.codigo, total: sql<string>`coalesce(sum(${tabela.valor}), 0)` })
    .from(tabela)
    .innerJoin(unidades, eq(tabela.unidadeId, unidades.id))
    .where(between(tabela.data, dataInicio, dataFim))
    .groupBy(unidades.codigo);

  return new Map(linhas.map((l) => [l.codigo, Number(l.total)]));
}

/** Atalho para uma única data — `somaPorLojaIntervalo` com início = fim. */
async function somaPorLoja(
  db: ReturnType<typeof getDb>,
  tabela: typeof brindes | typeof cancelamentoSalao | typeof cancelamentoDelivery | typeof compraDireta | typeof faturamento,
  data: Date
): Promise<Map<string, number>> {
  return somaPorLojaIntervalo(db, tabela, data, data);
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
 * Controles de Caixa na Visão Geral — todos consultam EXATAMENTE o intervalo
 * [dataInicio, dataFim] selecionado (sem "último registro disponível", sem
 * D-1/D-2). Sem nenhuma linha no intervalo: `disponivel: false` ("Sem dados"),
 * nunca zero inventado. A tela /controles-caixa continua com suas próprias
 * regras de janela (D-1/D-2/semana real/ciclo 16→15), não tocadas aqui.
 */

/**
 * Mesmo conceito do card "Total de Caixas Operados" da aba Controles de
 * Caixa → Fechamento: total de linhas com abertura registrada no período.
 */
async function buscarFechamentoResumo(db: ReturnType<typeof getDb>, dataInicio: Date, dataFim: Date): Promise<VisaoGeralData["fechamento"]> {
  const rows = await db.select({ id: fechamentoCaixa.id }).from(fechamentoCaixa).where(between(fechamentoCaixa.data, dataInicio, dataFim));
  if (rows.length === 0) return { disponivel: false };
  return { disponivel: true, totalCaixasOperados: rows.length };
}

async function buscarPdvMaquininhaResumo(db: ReturnType<typeof getDb>, dataInicio: Date, dataFim: Date): Promise<VisaoGeralData["pdvMaquininha"]> {
  const rows = await db
    .select({ valorPdv: pdvMaquininha.valorPdv, valorMaquininha: pdvMaquininha.valorMaquininha })
    .from(pdvMaquininha)
    .where(between(pdvMaquininha.data, dataInicio, dataFim));
  if (rows.length === 0) return { disponivel: false };
  const totalPdv = rows.reduce((s, r) => s + Number(r.valorPdv), 0);
  const totalMaquininha = rows.reduce((s, r) => s + Number(r.valorMaquininha), 0);
  return { disponivel: true, diferenca: arred(totalMaquininha - totalPdv) };
}

async function buscarTrocoResumo(db: ReturnType<typeof getDb>, dataInicio: Date, dataFim: Date): Promise<VisaoGeralData["troco"]> {
  const rows = await db.select({ diferenca: troco.diferenca }).from(troco).where(between(troco.data, dataInicio, dataFim));
  if (rows.length === 0) return { disponivel: false };
  return { disponivel: true, divergencias: rows.filter((r) => Number(r.diferenca) !== 0).length };
}

async function buscarConferenciaResumo(db: ReturnType<typeof getDb>, dataInicio: Date, dataFim: Date): Promise<VisaoGeralData["conferencia"]> {
  const rows = await db
    .select({ qtdCadastrados: conferencia.qtdCadastrados, qtdConferidos: conferencia.qtdConferidos, emAtraso: conferencia.emAtraso })
    .from(conferencia)
    .where(between(conferencia.data, dataInicio, dataFim));
  if (rows.length === 0) return { disponivel: false };
  const comCadastro = rows.filter((r) => r.qtdCadastrados > 0);
  const percentualConferido =
    comCadastro.length > 0
      ? comCadastro.reduce((s, r) => s + ((r.qtdConferidos ?? 0) / r.qtdCadastrados) * 100, 0) / comCadastro.length
      : 0;
  return { disponivel: true, percentualConferido, emAtraso: rows.filter((r) => r.emAtraso).length };
}

/** Quebra de Caixa no intervalo, total e por unidade (a tela filtra por Loja sem nova consulta). */
async function buscarQuebraCaixaResumo(db: ReturnType<typeof getDb>, dataInicio: Date, dataFim: Date): Promise<VisaoGeralData["quebraCaixa"]> {
  const rows = await db
    .select({ codigo: unidades.codigo, valor: quebraCaixa.valor })
    .from(quebraCaixa)
    .innerJoin(unidades, eq(quebraCaixa.unidadeId, unidades.id))
    .where(between(quebraCaixa.data, dataInicio, dataFim));
  if (rows.length === 0) return { disponivel: false };
  const porLoja: Record<string, number> = {};
  for (const r of rows) porLoja[r.codigo] = (porLoja[r.codigo] ?? 0) + Number(r.valor);
  for (const k of Object.keys(porLoja)) porLoja[k] = arred(porLoja[k]);
  return { disponivel: true, total: arred(rows.reduce((s, r) => s + Number(r.valor), 0)), porLoja };
}

/** Primeira data com registro de uma base (cobertura histórica), ou null se a base está vazia. */
async function primeiraData(
  db: ReturnType<typeof getDb>,
  tabela: typeof fechamentoCaixa | typeof pdvMaquininha | typeof troco | typeof conferencia | typeof quebraCaixa | typeof retiradaDeposito,
  filtro?: ReturnType<typeof eq>
): Promise<Date | null> {
  const consulta = db.select({ min: sql<string | null>`min(${tabela.data})` }).from(tabela);
  const [linha] = await (filtro ? consulta.where(filtro) : consulta);
  return linha?.min ? new Date(linha.min) : null;
}

/**
 * Camada real da Visão Geral — aceita [dataInicio, dataFim]. Modo "data
 * única" (usado desde sempre pela tela, preservado sem nenhuma mudança de
 * comportamento) é só o caso `dataInicio === dataFim`; modo "período" é
 * uma extensão que soma os indicadores dentro do intervalo, em vez de uma
 * regra nova e paralela. `buscarVisaoGeral` (abaixo) continua existindo
 * com a assinatura antiga para não quebrar os chamadores já existentes.
 */
export async function buscarVisaoGeralPeriodo(dataInicio: Date, dataFim: Date, incluirMesAnterior = true): Promise<VisaoGeralData> {
  const conectado = Boolean(process.env.DATABASE_URL);
  const modoPeriodo = dataInicio.getTime() !== dataFim.getTime();

  const base: VisaoGeralData = {
    mesAnterior: null,
    conectado,
    dataInicio,
    dataFim,
    modoPeriodo,
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

  // Comparativo mensal: só para mês calendário completo; mesma função (sem recursão infinita),
  // disparada em paralelo com as consultas abaixo.
  const periodoAnterior = incluirMesAnterior ? mesAnteriorCompleto(dataInicio, dataFim) : null;
  const coberturaPromise = periodoAnterior
    ? Promise.all([
        primeiraData(db, retiradaDeposito, eq(retiradaDeposito.motivo, "DEPÓSITO")),
        primeiraData(db, fechamentoCaixa),
        primeiraData(db, pdvMaquininha),
        primeiraData(db, troco),
        primeiraData(db, conferencia),
        primeiraData(db, quebraCaixa),
      ])
    : Promise.resolve(null);
  const mesAnteriorPromise = periodoAnterior ? buscarVisaoGeralPeriodo(periodoAnterior.inicio, periodoAnterior.fim, false) : Promise.resolve(null);

  // "vs. dia anterior" do card de Faturamento: só faz sentido no modo "data única" (item 4
  // da etapa de período — nunca mostrar uma comparação diária como se fosse de período).
  // DIA CALENDÁRIO literal anterior a `dataFim` — nunca "último registro disponível".
  const diaAnterior = new Date(dataFim);
  diaAnterior.setUTCDate(diaAnterior.getUTCDate() - 1);

  const [
    faturamentoPorLoja,
    brindesLinhas,
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
    somaPorLojaIntervalo(db, faturamento, dataInicio, dataFim),
    // Brindes por loja × motivo: permite separar controláveis × não controláveis (regra nova).
    db
      .select({ codigo: unidades.codigo, motivo: brindes.motivo, motivo2: brindes.motivo2, total: sql<string>`coalesce(sum(${brindes.valor}), 0)` })
      .from(brindes)
      .innerJoin(unidades, eq(brindes.unidadeId, unidades.id))
      .where(between(brindes.data, dataInicio, dataFim))
      .groupBy(unidades.codigo, brindes.motivo, brindes.motivo2),
    somaPorLojaIntervalo(db, cancelamentoSalao, dataInicio, dataFim),
    somaPorLojaIntervalo(db, cancelamentoDelivery, dataInicio, dataFim),
    somaPorLojaIntervalo(db, compraDireta, dataInicio, dataFim),
    // Retirada Depósito: filtro `motivo = 'DEPÓSITO'` — corrigido em etapa anterior (o valor
    // persistido tem acento; o literal sem acento nunca batia, causando "Sem dados" mesmo
    // com registros reais — confirmado via consulta direta ao banco). Mesma regra/coluna,
    // não é um valor novo nem uma reclassificação.
    db
      .select({ codigo: unidades.codigo, total: sql<string>`coalesce(sum(${retiradaDeposito.valor}), 0)` })
      .from(retiradaDeposito)
      .innerJoin(unidades, eq(retiradaDeposito.unidadeId, unidades.id))
      .where(and(between(retiradaDeposito.data, dataInicio, dataFim), eq(retiradaDeposito.motivo, "DEPÓSITO")))
      .groupBy(unidades.codigo),
    // Existência da BASE (não da data) — distingue "base nunca carregada" de "sem retirada
    // nessa data específica" (item 1 desta etapa): só quando a base tem histórico é que a
    // ausência na data selecionada vira R$ 0,00 real; sem nenhum registro em lugar nenhum,
    // continua "Sem dados disponíveis" (nenhuma regra de data alterada).
    db
      .select({ total: sql<string>`count(*)` })
      .from(retiradaDeposito)
      .where(eq(retiradaDeposito.motivo, "DEPÓSITO")),
    // Controles de Caixa: respeitam exatamente o período selecionado (sem fallback para data
    // anterior). Consultas independentes desta camada — não reaproveitam `buscarControlesCaixa`.
    buscarFechamentoResumo(db, dataInicio, dataFim),
    buscarPdvMaquininhaResumo(db, dataInicio, dataFim),
    buscarTrocoResumo(db, dataInicio, dataFim),
    buscarConferenciaResumo(db, dataInicio, dataFim),
    buscarQuebraCaixaResumo(db, dataInicio, dataFim),
    // Formas de Pagamento: mesmo intervalo do Faturamento (mesma fonte, VENDAS.xlsx).
    db
      .select({ codigo: unidades.codigo, forma: formasPagamento.forma, valor: formasPagamento.valor })
      .from(formasPagamento)
      .innerJoin(unidades, eq(formasPagamento.unidadeId, unidades.id))
      .where(between(formasPagamento.data, dataInicio, dataFim)),
    modoPeriodo ? new Map<string, number>() : somaPorLoja(db, faturamento, diaAnterior),
  ]);

  // Formas de Pagamento: consolidado + agrupado por loja (mesma consulta e mesma
  // classificação `agregarEmBuckets`) — a tela escolhe o bucket da Loja filtrada.
  const formasPorLoja: Record<string, FormaPagamentoBuckets> = {};
  {
    const porCodigo = new Map<string, { forma: string; valor: number }[]>();
    for (const r of formasRows) {
      const lista = porCodigo.get(r.codigo) ?? [];
      lista.push({ forma: r.forma, valor: Number(r.valor) });
      porCodigo.set(r.codigo, lista);
    }
    for (const [codigo, lista] of porCodigo) formasPorLoja[codigo] = agregarEmBuckets(lista);
  }
  const formasPagamentoData: VisaoGeralData["formasPagamento"] =
    formasRows.length > 0
      ? {
          disponivel: true,
          buckets: agregarEmBuckets(formasRows.map((r) => ({ forma: r.forma, valor: Number(r.valor) }))),
          porLoja: formasPorLoja,
        }
      : { disponivel: false };

  // Brindes: por loja (resumo controláveis × não controláveis) e consolidado.
  const brindesLinhasPorLoja = new Map<string, { motivo: string; motivo2: string; valor: number }[]>();
  for (const l of brindesLinhas) {
    const lista = brindesLinhasPorLoja.get(l.codigo) ?? [];
    lista.push({ motivo: l.motivo, motivo2: l.motivo2, valor: Number(l.total) });
    brindesLinhasPorLoja.set(l.codigo, lista);
  }

  const retiradaDepositoPorLoja = new Map(retiradaDepositoLinhas.map((l) => [l.codigo, Number(l.total)]));

  const totalRetiradaDeposito = totalDoMapa(retiradaDepositoPorLoja);
  const baseRetiradaDepositoExiste = Number(retiradaDepositoBaseRows[0]?.total ?? 0) > 0;

  const unidadesComDado = new Set<string>([
    ...faturamentoPorLoja.keys(),
    ...brindesLinhasPorLoja.keys(),
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
    const detalheBrindes = resumirBrindes(brindesLinhasPorLoja.get(codigo) ?? []);
    const valorCancSalao = cancSalaoPorLoja.get(codigo) ?? 0;
    const valorCancDelivery = cancDeliveryPorLoja.get(codigo) ?? 0;
    return {
      unidade: codigo as CodigoUnidade,
      faturamento: faturamentoPorLoja.has(codigo) ? { disponivel: true, valor: fatLoja } : { disponivel: false },
      retiradaCompraDireta: comSemaforo(valorCompraDireta, percentualLoja(valorCompraDireta), FAIXAS_COMPRA_DIRETA),
      // Semáforo de Brindes: SOMENTE sobre os controláveis (mesmos thresholds de sempre).
      brindes: { ...comSemaforo(detalheBrindes.controlaveis, percentualLoja(detalheBrindes.controlaveis), FAIXAS_BRINDES), detalhe: detalheBrindes },
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
  const detalheBrindesRede = resumirBrindes(brindesLinhas.map((l) => ({ motivo: l.motivo, motivo2: l.motivo2, valor: Number(l.total) })));
  const cancSalaoTotal = totalDoMapa(cancSalaoPorLoja);
  const cancDeliveryTotal = totalDoMapa(cancDeliveryPorLoja);
  const compraDiretaTotal = totalDoMapa(compraDiretaPorLoja);

  function percentualSobreFaturamento(total: number): number {
    return faturamentoTotal > 0 ? (total / faturamentoTotal) * 100 : 0;
  }

  // "vs. dia anterior" — só no modo "data única" (item 4: nunca uma comparação diária
  // disfarçada de comparação de período). Mesma regra de nunca inventar percentual: só
  // calcula se houver faturamento real nos dois dias.
  const totalFaturamentoDiaAnterior = totalDoMapa(faturamentoDiaAnteriorPorLoja);
  const comparativoDiaAnterior =
    !modoPeriodo && faturamentoDiaAnteriorPorLoja.size > 0 && totalFaturamentoDiaAnterior > 0 && faturamentoPorLoja.size > 0
      ? ((faturamentoTotal - totalFaturamentoDiaAnterior) / totalFaturamentoDiaAnterior) * 100
      : null;

  const dadosMesAnterior = await mesAnteriorPromise;
  const cobertura = await coberturaPromise;
  const mesAnterior: MesAnteriorVisaoGeral | null = dadosMesAnterior
    ? {
        dataInicio: dadosMesAnterior.dataInicio,
        dataFim: dadosMesAnterior.dataFim,
        faturamento: dadosMesAnterior.faturamento,
        brindes: dadosMesAnterior.brindes,
        cancelamentoSalao: dadosMesAnterior.cancelamentoSalao,
        cancelamentoDelivery: dadosMesAnterior.cancelamentoDelivery,
        retiradaCompraDireta: dadosMesAnterior.retiradaCompraDireta,
        detalhamentoPorLoja: dadosMesAnterior.detalhamentoPorLoja,
        // Retirada p/ Depósito: o "R$ 0,00 quando a base tem histórico" não vale para um mês ANTERIOR ao
        // início da base — não houve cobertura, então no comparativo é "Sem dados" (nunca zero inventado).
        retiradaDeposito:
          cobertura && cobertura[0] && cobertura[0].getTime() <= dadosMesAnterior.dataFim.getTime()
            ? dadosMesAnterior.retiradaDeposito
            : { disponivel: false },
        fechamento: dadosMesAnterior.fechamento,
        pdvMaquininha: dadosMesAnterior.pdvMaquininha,
        troco: dadosMesAnterior.troco,
        conferencia: dadosMesAnterior.conferencia,
        quebraCaixa: dadosMesAnterior.quebraCaixa,
        coberturaDesde: {
          retiradaDeposito: cobertura?.[0] ?? null,
          fechamento: cobertura?.[1] ?? null,
          pdvMaquininha: cobertura?.[2] ?? null,
          troco: cobertura?.[3] ?? null,
          conferencia: cobertura?.[4] ?? null,
          quebraCaixa: cobertura?.[5] ?? null,
        },
      }
    : null;

  return {
    ...base,
    mesAnterior,
    faturamento:
      faturamentoPorLoja.size > 0
        ? { disponivel: true, valor: faturamentoTotal, dataRegistro: dataFim, comparativoDiaAnterior }
        : { disponivel: false, comparativoDiaAnterior: null },
    formasPagamento: formasPagamentoData,
    brindes:
      brindesLinhas.length > 0
        ? {
            ...comSemaforo(detalheBrindesRede.controlaveis, percentualSobreFaturamento(detalheBrindesRede.controlaveis), FAIXAS_BRINDES, {
              dataRegistro: dataFim,
            }),
            detalhe: detalheBrindesRede,
          }
        : indisponivel(),
    cancelamentoSalao:
      cancSalaoPorLoja.size > 0
        ? comSemaforo(cancSalaoTotal, percentualSobreFaturamento(cancSalaoTotal), FAIXAS_CANCELAMENTO, { dataRegistro: dataFim })
        : indisponivel(),
    cancelamentoDelivery:
      cancDeliveryPorLoja.size > 0
        ? comSemaforo(cancDeliveryTotal, percentualSobreFaturamento(cancDeliveryTotal), FAIXAS_CANCELAMENTO, { dataRegistro: dataFim })
        : indisponivel(),
    retiradaCompraDireta:
      compraDiretaPorLoja.size > 0
        ? comSemaforo(compraDiretaTotal, percentualSobreFaturamento(compraDiretaTotal), FAIXAS_COMPRA_DIRETA, { dataRegistro: dataFim })
        : indisponivel(),
    // Item 1 desta etapa: a BASE de Retirada Depósito já está carregada — ausência de
    // registro na data/período selecionado é "não houve retirada" (R$ 0,00 real), não "sem
    // dados". Só fica indisponível se a base como um todo nunca teve nenhum registro carregado.
    retiradaDeposito: baseRetiradaDepositoExiste
      ? { disponivel: true, valorDia: totalRetiradaDeposito, porLoja: Object.fromEntries(retiradaDepositoPorLoja), dataRegistro: dataFim }
      : { disponivel: false },
    fechamento: fechamentoResumo,
    pdvMaquininha: pdvMaquininhaResumo,
    troco: trocoResumo,
    conferencia: conferenciaResumo,
    quebraCaixa: quebraCaixaResumo,
    detalhamentoPorLoja,
  };
}

/**
 * Assinatura antiga (modo "data única") — preservada para não quebrar os
 * chamadores existentes (`buscarVisaoGeralPorData`, a página /visao-geral).
 * Delega para `buscarVisaoGeralPeriodo` com início = fim; comportamento
 * idêntico ao de antes desta etapa.
 */
export async function buscarVisaoGeral(dataReferencia: Date): Promise<VisaoGeralData> {
  return buscarVisaoGeralPeriodo(dataReferencia, dataReferencia);
}
