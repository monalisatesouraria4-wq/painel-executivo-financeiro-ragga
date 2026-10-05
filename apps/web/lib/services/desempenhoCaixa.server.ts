import { between, eq, sql } from "drizzle-orm";
import { UNIDADES } from "@painel/shared";
import {
  classificarSemaforo,
  FAIXAS_BRINDES,
  FAIXAS_CANCELAMENTO,
  FAIXAS_COMPRA_DIRETA,
  type FaixaSemaforo,
} from "@/lib/rules/semaforos";
import { metaDoSemaforo, periodoEquivalenteMesAnterior } from "@/lib/rules/desempenho";
import { classificarBrinde } from "@/lib/rules/brindes";
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
 * Brindes usa a classificação oficial do painel (`classificarBrinde`):
 * o indicador avaliado (valor, % do faturamento, semáforo, ranking) considera
 * SOMENTE os brindes CONTROLÁVEIS; os não controláveis (Aniversariante, Consumo
 * de Funcionários, Empresas Parceiras/Desconto Empresas) ficam no total
 * informado na nota, sem penalizar a loja. Não existe regra paralela de
 * "limite diário de consumo".
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

interface BrindesClassificados {
  controlaveis: LinhaBruta[];
  totalNaoControlaveis: number;
}

/** Brindes por loja × motivo × submotivo, classificados pela regra oficial (controlável × não controlável). */
async function brindesClassificados(db: ReturnType<typeof getDb>, ini: Date, fim: Date): Promise<BrindesClassificados> {
  const linhas = await db
    .select({ codigo: unidades.codigo, motivo: brindes.motivo, motivo2: brindes.motivo2, total: sql<string>`sum(${brindes.valor})` })
    .from(brindes)
    .innerJoin(unidades, eq(brindes.unidadeId, unidades.id))
    .where(between(brindes.data, ini, fim))
    .groupBy(unidades.codigo, brindes.motivo, brindes.motivo2);
  const controlaveis = new Map<string, LinhaBruta>();
  let totalNaoControlaveis = 0;
  for (const l of linhas) {
    const valor = Number(l.total);
    const c = classificarBrinde(l.motivo, l.motivo2);
    if (!c.controlavel) {
      totalNaoControlaveis += valor;
      continue;
    }
    const chave = `${l.codigo}|${c.rotulo}`;
    const atual = controlaveis.get(chave);
    controlaveis.set(chave, { codigo: l.codigo, motivo: c.rotulo, total: (atual?.total ?? 0) + valor });
  }
  return { controlaveis: [...controlaveis.values()], totalNaoControlaveis };
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
      brindesClassificados(db, inicio, fim),
      brindesClassificados(db, equivalente.inicio, equivalente.fim),
      lojaMotivo(db, cancelamentoSalao, inicio, fim),
      lojaMotivo(db, cancelamentoSalao, equivalente.inicio, equivalente.fim),
      lojaMotivo(db, cancelamentoDelivery, inicio, fim),
      lojaMotivo(db, cancelamentoDelivery, equivalente.inicio, equivalente.fim),
      lojaMotivo(db, compraDireta, inicio, fim),
      lojaMotivo(db, compraDireta, equivalente.inicio, equivalente.fim),
      faturamentoPorLoja(db, inicio, fim),
      faturamentoPorLoja(db, equivalente.inicio, equivalente.fim),
    ]);

  const comuns = { fatAtual, fatAnterior };

  base.indicadores = [
    {
      ...montarIndicador({ id: "brindes", titulo: "Brindes (controláveis)", faixas: FAIXAS_BRINDES, atual: brAtual.controlaveis, anterior: brAnt.controlaveis, ...comuns }),
      nota: `Avaliação somente sobre os brindes controláveis. Brindes não controláveis no período: ${brAtual.totalNaoControlaveis.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} (Aniversariante, Consumo de Funcionários e Empresas Parceiras) — fazem parte do total de brindes, mas não penalizam a loja.`,
    },
    montarIndicador({ id: "cancelamentoSalao", titulo: "Cancelamento salão", faixas: FAIXAS_CANCELAMENTO, atual: salaoAtual, anterior: salaoAnt, ...comuns }),
    montarIndicador({ id: "cancelamentoDelivery", titulo: "Cancelamento delivery", faixas: FAIXAS_CANCELAMENTO, atual: deliveryAtual, anterior: deliveryAnt, ...comuns }),
    montarIndicador({ id: "compraDireta", titulo: "Compra direta", faixas: FAIXAS_COMPRA_DIRETA, atual: compraAtual, anterior: compraAnt, ...comuns }),
  ];
  return base;
}

