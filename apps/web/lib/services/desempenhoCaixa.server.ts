import { between, eq, sql } from "drizzle-orm";
import { UNIDADES } from "@painel/shared";
import {
  classificarSemaforo,
  FAIXAS_BRINDES,
  FAIXAS_CANCELAMENTO,
  FAIXAS_COMPRA_DIRETA,
  type FaixaSemaforo,
} from "@/lib/rules/semaforos";
import {
  CONSUMO_FUNCIONARIOS_REDE,
  CONSUMO_LIMITE_DIARIO_REDE,
  diasNoPeriodo,
  ehConsumoFuncionarios,
  metaDoSemaforo,
  periodoEquivalenteMesAnterior,
  projecaoDeFechamento,
} from "@/lib/rules/desempenho";
import { getDb } from "@/lib/db/client";
import { unidades, faturamento, brindes, cancelamentoSalao, cancelamentoDelivery, compraDireta } from "@/lib/db/schema";
import type {
  DesempenhoCaixaData,
  IndicadorDesempenho,
  IndicadorDesempenhoId,
  LinhaLojaDesempenho,
  MotivoDesempenho,
} from "./desempenhoCaixa";

/**
 * Performance de Caixa — consulta real ao Postgres. Mesmas tabelas e
 * mesmos semáforos já usados na Visão Geral/Indicadores (nenhum valor
 * novo no banco). Janela = EXATAMENTE o período escolhido (sem D-1), como
 * a Visão Geral. Cada indicador sai de UMA consulta (loja × motivo); os
 * cards, o ranking e o detalhamento por motivo são todos derivados dela,
 * então os totais sempre batem.
 *
 * Brindes é separado em "consumo de funcionários" e "brindes a clientes"
 * pelo motivo — as duas partes somam exatamente o total antigo de
 * Brindes, sem dupla contagem.
 */

interface LinhaBruta {
  codigo: string;
  motivo: string;
  total: number;
}

type TabelaFato = typeof brindes | typeof cancelamentoSalao | typeof cancelamentoDelivery | typeof compraDireta;

async function lojaMotivo(db: ReturnType<typeof getDb>, tabela: TabelaFato, ini: Date, fim: Date): Promise<LinhaBruta[]> {
  const linhas = await db
    .select({ codigo: unidades.codigo, motivo: tabela.motivo, total: sql<string>`sum(${tabela.valor})` })
    .from(tabela)
    .innerJoin(unidades, eq(tabela.unidadeId, unidades.id))
    .where(between(tabela.data, ini, fim))
    .groupBy(unidades.codigo, tabela.motivo);
  return linhas.map((l) => ({ codigo: l.codigo, motivo: l.motivo, total: Number(l.total) }));
}

async function faturamentoPorLoja(db: ReturnType<typeof getDb>, ini: Date, fim: Date): Promise<Map<string, number>> {
  const linhas = await db
    .select({ codigo: unidades.codigo, total: sql<string>`coalesce(sum(${faturamento.valor}), 0)` })
    .from(faturamento)
    .innerJoin(unidades, eq(faturamento.unidadeId, unidades.id))
    .where(between(faturamento.data, ini, fim))
    .groupBy(unidades.codigo);
  return new Map(linhas.map((l) => [l.codigo, Number(l.total)]));
}

function somaPorLoja(linhas: LinhaBruta[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const l of linhas) mapa.set(l.codigo, (mapa.get(l.codigo) ?? 0) + l.total);
  return mapa;
}

function total(mapa: Map<string, number>): number {
  let t = 0;
  for (const v of mapa.values()) t += v;
  return t;
}

function variacao(atual: number, anterior: number | null): { reais: number | null; percentual: number | null } {
  if (anterior === null) return { reais: null, percentual: null };
  return { reais: atual - anterior, percentual: anterior > 0 ? ((atual - anterior) / anterior) * 100 : null };
}

interface EntradaIndicador {
  id: IndicadorDesempenhoId;
  titulo: string;
  faixas: FaixaSemaforo[];
  atual: LinhaBruta[];
  anterior: LinhaBruta[];
  fatAtual: Map<string, number>;
  fatAnterior: Map<string, number>;
}

function montarIndicador(e: EntradaIndicador): IndicadorDesempenho {
  const meta = metaDoSemaforo(e.faixas);
  const criterio = `Meta: até ${meta.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}% do faturamento (limite Excelente/Bom do semáforo)`;
  const disponivel = e.atual.length > 0;
  const valorPorLoja = somaPorLoja(e.atual);
  const valorAnteriorPorLoja = somaPorLoja(e.anterior);
  const valor = total(valorPorLoja);
  const fat = total(e.fatAtual);
  const anteriorTotal = e.anterior.length > 0 ? total(valorAnteriorPorLoja) : null;
  const semBaseAvaliacao = disponivel && fat <= 0;
  const percentual = disponivel && fat > 0 ? (valor / fat) * 100 : null;
  const metaValor = fat > 0 ? (meta / 100) * fat : null;
  const v = variacao(valor, anteriorTotal);

  const porLoja: LinhaLojaDesempenho[] = UNIDADES.map((unidade) => {
    const valorLoja = valorPorLoja.get(unidade) ?? 0;
    const fatLoja = e.fatAtual.get(unidade) ?? 0;
    const pct = fatLoja > 0 ? (valorLoja / fatLoja) * 100 : null;
    const metaLoja = fatLoja > 0 ? (meta / 100) * fatLoja : null;
    return {
      unidade,
      valor: valorLoja,
      semLancamento: !valorPorLoja.has(unidade),
      faturamento: fatLoja > 0 ? fatLoja : null,
      percentual: pct,
      semaforo: pct === null ? null : classificarSemaforo(pct, e.faixas),
      desvioReais: metaLoja === null ? null : valorLoja - metaLoja,
      desvioPercentual: metaLoja ? ((valorLoja - metaLoja) / metaLoja) * 100 : null,
      valorAnterior: e.anterior.length > 0 ? (valorAnteriorPorLoja.get(unidade) ?? 0) : null,
    };
  }).filter((l) => !l.semLancamento || l.faturamento !== null);

  const motivos = new Map<string, number>();
  for (const l of e.atual) motivos.set(l.motivo, (motivos.get(l.motivo) ?? 0) + l.total);
  const porMotivo: MotivoDesempenho[] = [...motivos.entries()]
    .map(([motivo, valorMotivo]) => ({ motivo, valor: valorMotivo, participacao: valor > 0 ? (valorMotivo / valor) * 100 : 0 }))
    .sort((a, b) => b.valor - a.valor);

  return {
    id: e.id,
    titulo: e.titulo,
    criterio,
    disponivel,
    semBaseAvaliacao,
    valor,
    faturamento: fat > 0 ? fat : null,
    percentual,
    metaPercentual: meta,
    metaValor,
    desvioReais: metaValor === null ? null : valor - metaValor,
    desvioPercentual: metaValor ? ((valor - metaValor) / metaValor) * 100 : null,
    semaforo: percentual === null ? null : classificarSemaforo(percentual, e.faixas),
    anterior: { valor: anteriorTotal },
    variacaoReais: v.reais,
    variacaoPercentual: v.percentual,
    porLoja,
    porMotivo,
  };
}

function montarConsumo(
  atual: LinhaBruta[],
  anterior: LinhaBruta[],
  fatAtual: Map<string, number>,
  inicio: Date,
  fim: Date
): IndicadorDesempenho {
  const disponivel = atual.length > 0;
  const valor = atual.reduce((s, l) => s + l.total, 0);
  const anteriorTotal = anterior.length > 0 ? anterior.reduce((s, l) => s + l.total, 0) : null;
  const dias = diasNoPeriodo(inicio, fim);
  const limitePeriodo = CONSUMO_LIMITE_DIARIO_REDE * dias;
  const fat = total(fatAtual);
  const projecao = projecaoDeFechamento(inicio, fim, valor);
  const diasMes = new Date(Date.UTC(fim.getUTCFullYear(), fim.getUTCMonth() + 1, 0)).getUTCDate();
  const v = variacao(valor, anteriorTotal);

  const motivos = new Map<string, number>();
  for (const l of atual) motivos.set(l.motivo, (motivos.get(l.motivo) ?? 0) + l.total);

  return {
    id: "consumoFuncionarios",
    titulo: "Consumo de funcionários",
    criterio: `Limite: R$ 10,00 por funcionário por dia (${CONSUMO_FUNCIONARIOS_REDE} funcionários = R$ 4.800,00/dia na rede)`,
    disponivel,
    semBaseAvaliacao: false,
    valor,
    faturamento: fat > 0 ? fat : null,
    percentual: disponivel && fat > 0 ? (valor / fat) * 100 : null,
    metaPercentual: null,
    metaValor: limitePeriodo,
    desvioReais: valor - limitePeriodo,
    desvioPercentual: ((valor - limitePeriodo) / limitePeriodo) * 100,
    semaforo: disponivel ? (valor <= limitePeriodo ? "verde" : "vermelho") : null,
    anterior: { valor: anteriorTotal },
    variacaoReais: v.reais,
    variacaoPercentual: v.percentual,
    porLoja: [],
    porMotivo: [...motivos.entries()]
      .map(([motivo, valorMotivo]) => ({ motivo, valor: valorMotivo, participacao: valor > 0 ? (valorMotivo / valor) * 100 : 0 }))
      .sort((a, b) => b.valor - a.valor),
    consumo: {
      limiteDiario: CONSUMO_LIMITE_DIARIO_REDE,
      dias,
      limitePeriodo,
      percentualUtilizado: (valor / limitePeriodo) * 100,
      mediaPorFuncionarioDia: valor / (CONSUMO_FUNCIONARIOS_REDE * dias),
      funcionariosReferencia: CONSUMO_FUNCIONARIOS_REDE,
      projecaoFechamento: projecao,
      limiteMes: projecao === null ? null : CONSUMO_LIMITE_DIARIO_REDE * diasMes,
    },
    nota: "Limite por loja indisponível: o quadro de funcionários por loja não foi informado (o limite não é dividido igualmente entre as unidades).",
  };
}

export async function buscarDesempenhoCaixa(inicio: Date, fim: Date): Promise<DesempenhoCaixaData> {
  const equivalente = periodoEquivalenteMesAnterior(inicio, fim);
  const base: DesempenhoCaixaData = {
    conectado: Boolean(process.env.DATABASE_URL),
    dataInicio: inicio,
    dataFim: fim,
    anteriorInicio: equivalente.inicio,
    anteriorFim: equivalente.fim,
    indicadores: [],
  };
  if (!base.conectado) return base;

  const db = getDb();
  const [brAtual, brAnt, salaoAtual, salaoAnt, deliveryAtual, deliveryAnt, compraAtual, compraAnt, fatAtual, fatAnterior] =
    await Promise.all([
      lojaMotivo(db, brindes, inicio, fim),
      lojaMotivo(db, brindes, equivalente.inicio, equivalente.fim),
      lojaMotivo(db, cancelamentoSalao, inicio, fim),
      lojaMotivo(db, cancelamentoSalao, equivalente.inicio, equivalente.fim),
      lojaMotivo(db, cancelamentoDelivery, inicio, fim),
      lojaMotivo(db, cancelamentoDelivery, equivalente.inicio, equivalente.fim),
      lojaMotivo(db, compraDireta, inicio, fim),
      lojaMotivo(db, compraDireta, equivalente.inicio, equivalente.fim),
      faturamentoPorLoja(db, inicio, fim),
      faturamentoPorLoja(db, equivalente.inicio, equivalente.fim),
    ]);

  const clientes = (l: LinhaBruta[]) => l.filter((x) => !ehConsumoFuncionarios(x.motivo));
  const funcionarios = (l: LinhaBruta[]) => l.filter((x) => ehConsumoFuncionarios(x.motivo));
  const comuns = { fatAtual, fatAnterior };

  base.indicadores = [
    montarConsumo(funcionarios(brAtual), funcionarios(brAnt), fatAtual, inicio, fim),
    montarIndicador({ id: "brindes", titulo: "Brindes", faixas: FAIXAS_BRINDES, atual: clientes(brAtual), anterior: clientes(brAnt), ...comuns }),
    montarIndicador({ id: "cancelamentoSalao", titulo: "Cancelamento salão", faixas: FAIXAS_CANCELAMENTO, atual: salaoAtual, anterior: salaoAnt, ...comuns }),
    montarIndicador({ id: "cancelamentoDelivery", titulo: "Cancelamento delivery", faixas: FAIXAS_CANCELAMENTO, atual: deliveryAtual, anterior: deliveryAnt, ...comuns }),
    montarIndicador({ id: "compraDireta", titulo: "Compra direta", faixas: FAIXAS_COMPRA_DIRETA, atual: compraAtual, anterior: compraAnt, ...comuns }),
  ];
  return base;
}

