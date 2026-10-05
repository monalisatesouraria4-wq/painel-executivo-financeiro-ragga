import { UNIDADES } from "@painel/shared";
import { situacaoQuebra, type SituacaoQuebra } from "@/lib/services/quebraPainel";
import type { CaixaAberturaFechamentoLinha } from "@/lib/services/aberturaFechamento";
import type { PdvMaquininhaLinha, TrocoCaixaLinha, TrocoLinha } from "@/lib/services/controlesCaixa";

/**
 * Análise por LOJA (REDE → LOJA → detalhe) das sub-abas Fechamento, PDV × Maquininha e Troco de Controles de Caixa.
 * Módulo PURO (sem banco): só AGREGA e COMPARA os dados que cada aba já carrega — nenhuma regra de cálculo, de data
 * ou de importação foi alterada, e nenhum limite/meta foi criado.
 *
 * O que significa cada coluna (sempre as definições já existentes de cada aba):
 * - Fechamento: valor = Σ `difFechamento` (mesmo número do card "Diferença nos fechamentos realizados pelo operador"),
 *   COM sinal. Não existe % sobre faturamento nessa aba → sem coluna de %.
 * - PDV × Maquininha: valor = diferença = Maquininha − PDV (como na tabela atual), COM sinal. Sem % (não há regra
 *   percentual confiável — a coluna antiga foi removida de propósito).
 * - Troco: valor = Σ |diferença| dos caixas em "Divergência" (card "Valor total das divergências"); % = caixas com
 *   divergência ÷ caixas da loja (card "% de caixas com divergência").
 *
 * Situação (Melhorou/Piorou/Sem alteração) contra o período comparado, sem meta nova: o ideal já adotado nas três abas
 * é "sem divergência" (Troco: `diferenca === 0`; PDV: `|dif| > 0,005` = Divergente), então MENOR divergência = melhorou.
 * Fechamento/PDV comparam a distância até zero (|valor|) — o sinal do valor nunca é escondido na exibição; Troco compara
 * o % de caixas com divergência (normaliza pelo nº de caixas).
 */

export interface MetricaLoja<D = unknown> {
  unidade: string;
  /** Valor exibido (com sinal, quando aplicável). */
  valor: number;
  /** % exibido — `null` quando a aba não tem % válido. */
  percentual: number | null;
  /** Grandeza usada na SITUAÇÃO (menor = melhor): |valor| ou o %. */
  grandeza: number;
  /** Quantidade de registros que compõem o valor (caixas/lançamentos) — só informativa. */
  quantidade: number;
  detalhe: D;
}

export interface PainelLojas<D = unknown> {
  /** false = nenhum registro no período ("Sem dados no período selecionado."). */
  disponivel: boolean;
  rede: MetricaLoja<null>;
  lojas: MetricaLoja<D>[];
}

function arred(v: number): number {
  return Math.round(v * 100) / 100;
}

function porLojaOrdenada<T extends { unidade: string }>(itens: T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const i of itens) {
    const lista = mapa.get(i.unidade) ?? [];
    lista.push(i);
    mapa.set(i.unidade, lista);
  }
  const ordenado = new Map<string, T[]>();
  for (const u of UNIDADES) if (mapa.has(u)) ordenado.set(u, mapa.get(u)!);
  for (const [u, l] of mapa) if (!ordenado.has(u)) ordenado.set(u, l); // unidade fora da lista oficial: não some
  return ordenado;
}

const redeVazia: MetricaLoja<null> = { unidade: "REDE", valor: 0, percentual: null, grandeza: 0, quantidade: 0, detalhe: null };

// ---------------------------------------------------------------- Fechamento

export function agregarFechamento(linhas: CaixaAberturaFechamentoLinha[]): PainelLojas<CaixaAberturaFechamentoLinha[]> {
  const lojas: MetricaLoja<CaixaAberturaFechamentoLinha[]>[] = [...porLojaOrdenada(linhas)].map(([unidade, ls]) => {
    const valor = arred(ls.reduce((s, l) => s + (l.difFechamento ?? 0), 0));
    return { unidade, valor, percentual: null, grandeza: Math.abs(valor), quantidade: ls.length, detalhe: ls };
  });
  if (lojas.length === 0) return { disponivel: false, rede: redeVazia, lojas };
  const valor = arred(lojas.reduce((s, l) => s + l.valor, 0));
  return {
    disponivel: true,
    rede: { unidade: "REDE", valor, percentual: null, grandeza: Math.abs(valor), quantidade: linhas.length, detalhe: null },
    lojas,
  };
}

// ---------------------------------------------------------------- PDV × Maquininha

export interface DetalhePdv {
  totalPdv: number;
  totalMaquininha: number;
}

export function agregarPdv(linhas: PdvMaquininhaLinha[]): PainelLojas<DetalhePdv> {
  const lojas: MetricaLoja<DetalhePdv>[] = [...porLojaOrdenada(linhas)].map(([unidade, ls]) => {
    const totalPdv = arred(ls.reduce((s, l) => s + l.totalPdv, 0));
    const totalMaquininha = arred(ls.reduce((s, l) => s + l.totalMaquininha, 0));
    const valor = arred(totalMaquininha - totalPdv);
    return { unidade, valor, percentual: null, grandeza: Math.abs(valor), quantidade: ls.length, detalhe: { totalPdv, totalMaquininha } };
  });
  if (lojas.length === 0) return { disponivel: false, rede: redeVazia, lojas };
  const valor = arred(lojas.reduce((s, l) => s + l.detalhe.totalMaquininha, 0) - lojas.reduce((s, l) => s + l.detalhe.totalPdv, 0));
  return {
    disponivel: true,
    rede: { unidade: "REDE", valor, percentual: null, grandeza: Math.abs(valor), quantidade: lojas.length, detalhe: null },
    lojas,
  };
}

/** Linha bruta de PDV × Maquininha por forma de pagamento (detalhe da expansão). */
export interface PdvFormaBruta {
  unidade: string;
  forma: string;
  valorPdv: number;
  valorMaquininha: number;
}

export interface PdvFormaLinha {
  forma: string;
  pdv: number;
  maquininha: number;
  /** Maquininha − PDV (mesma convenção da tabela da aba). */
  diferenca: number;
}

/** Soma por forma de pagamento de UMA loja; Σ diferenças = diferença da loja. */
export function pdvPorForma(linhas: PdvFormaBruta[], unidade: string): PdvFormaLinha[] {
  const mapa = new Map<string, { pdv: number; maq: number }>();
  for (const l of linhas) {
    if (l.unidade !== unidade) continue;
    const m = mapa.get(l.forma) ?? { pdv: 0, maq: 0 };
    m.pdv += l.valorPdv;
    m.maq += l.valorMaquininha;
    mapa.set(l.forma, m);
  }
  return [...mapa.entries()]
    .map(([forma, m]) => ({ forma, pdv: arred(m.pdv), maquininha: arred(m.maq), diferenca: arred(m.maq - m.pdv) }))
    .sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca) || a.forma.localeCompare(b.forma));
}

// ---------------------------------------------------------------- Troco

export interface DetalheTroco {
  caixas: TrocoCaixaLinha[];
  comDivergencia: number;
  /** Σ das diferenças COM sinal (informativo — o valor da coluna é Σ |diferença| das divergências). */
  diferencaLiquida: number;
}

export function agregarTroco(linhas: TrocoLinha[]): PainelLojas<DetalheTroco> {
  const itens = linhas.flatMap((l) => l.caixas.map((c) => ({ unidade: l.unidade as string, c })));
  const lojas: MetricaLoja<DetalheTroco>[] = [...porLojaOrdenada(itens)].map(([unidade, its]) => {
    const caixas = its.map((i) => i.c);
    const divergentes = caixas.filter((c) => c.status === "Divergência");
    const valor = arred(divergentes.reduce((s, c) => s + Math.abs(c.diferenca), 0));
    const percentual = caixas.length > 0 ? (divergentes.length / caixas.length) * 100 : 0;
    return {
      unidade,
      valor,
      percentual,
      grandeza: percentual,
      quantidade: caixas.length,
      detalhe: { caixas, comDivergencia: divergentes.length, diferencaLiquida: arred(caixas.reduce((s, c) => s + c.diferenca, 0)) },
    };
  });
  if (lojas.length === 0) return { disponivel: false, rede: redeVazia, lojas };
  const totalCaixas = lojas.reduce((s, l) => s + l.quantidade, 0);
  const comDiv = lojas.reduce((s, l) => s + l.detalhe.comDivergencia, 0);
  const percentual = totalCaixas > 0 ? (comDiv / totalCaixas) * 100 : 0;
  return {
    disponivel: true,
    rede: { unidade: "REDE", valor: arred(lojas.reduce((s, l) => s + l.valor, 0)), percentual, grandeza: percentual, quantidade: totalCaixas, detalhe: null },
    lojas,
  };
}

// ---------------------------------------------------------------- filtro de loja / comparação / ordenação

/** Filtro de loja: mantém só essa loja e recalcula a REDE a partir dela (rede = soma das lojas exibidas). */
export function recortarLojaPainel<D>(
  painel: PainelLojas<D>,
  loja: string | undefined,
  recalcularRede: (lojas: MetricaLoja<D>[]) => MetricaLoja<null>
): PainelLojas<D> {
  if (!loja) return painel;
  const lojas = painel.lojas.filter((l) => l.unidade === loja);
  if (lojas.length === 0) return { disponivel: false, rede: redeVazia, lojas: [] };
  return { disponivel: true, rede: recalcularRede(lojas), lojas };
}

export function redeFechamento(lojas: MetricaLoja<CaixaAberturaFechamentoLinha[]>[]): MetricaLoja<null> {
  const valor = arred(lojas.reduce((s, l) => s + l.valor, 0));
  return { unidade: "REDE", valor, percentual: null, grandeza: Math.abs(valor), quantidade: lojas.reduce((s, l) => s + l.quantidade, 0), detalhe: null };
}

export function redePdv(lojas: MetricaLoja<DetalhePdv>[]): MetricaLoja<null> {
  const valor = arred(lojas.reduce((s, l) => s + l.detalhe.totalMaquininha, 0) - lojas.reduce((s, l) => s + l.detalhe.totalPdv, 0));
  return { unidade: "REDE", valor, percentual: null, grandeza: Math.abs(valor), quantidade: lojas.length, detalhe: null };
}

export function redeTroco(lojas: MetricaLoja<DetalheTroco>[]): MetricaLoja<null> {
  const totalCaixas = lojas.reduce((s, l) => s + l.quantidade, 0);
  const comDiv = lojas.reduce((s, l) => s + l.detalhe.comDivergencia, 0);
  const percentual = totalCaixas > 0 ? (comDiv / totalCaixas) * 100 : 0;
  return { unidade: "REDE", valor: arred(lojas.reduce((s, l) => s + l.valor, 0)), percentual, grandeza: percentual, quantidade: totalCaixas, detalhe: null };
}

/**
 * Situação da loja contra o período comparado. Loja sem registros no período comparado = SEM BASE (ausência de
 * registro não é zero) — nunca se inventa um zero para gerar status.
 */
export function situacaoLoja(atual: MetricaLoja<unknown>, comparada: MetricaLoja<unknown> | null | undefined): SituacaoQuebra {
  if (!comparada) return "sem-base";
  return situacaoQuebra(atual.grandeza, comparada.grandeza);
}

export type OrdemLojasPainel = "loja" | "valor" | "percentual" | "diferenca" | "performance";

/**
 * Sentido do "Valor" no ranking:
 * - "negativo-primeiro": menor valor com sinal primeiro (Fechamento: as maiores diferenças NEGATIVAS no topo);
 * - "magnitude": maior |valor| primeiro (PDV e Troco: maiores divergências).
 */
export type SentidoValor = "negativo-primeiro" | "magnitude";

const PESO_SITUACAO: Record<SituacaoQuebra, number> = { piorou: 3, "sem-alteracao": 2, "sem-base": 1, melhorou: 0 };

export function ordenarLojasPainel<D>(
  lojas: MetricaLoja<D>[],
  comparadas: Map<string, MetricaLoja<unknown>> | null,
  ordem: OrdemLojasPainel,
  sentidoValor: SentidoValor
): MetricaLoja<D>[] {
  const comp = (u: string) => comparadas?.get(u) ?? null;
  const delta = (l: MetricaLoja<D>) => {
    const c = comp(l.unidade);
    return c ? l.grandeza - c.grandeza : 0;
  };
  const porValor = (a: MetricaLoja<D>, b: MetricaLoja<D>) => (sentidoValor === "negativo-primeiro" ? a.valor - b.valor : Math.abs(b.valor) - Math.abs(a.valor));
  return [...lojas].sort((a, b) => {
    switch (ordem) {
      case "loja":
        return a.unidade.localeCompare(b.unidade);
      case "valor":
        return porValor(a, b) || a.unidade.localeCompare(b.unidade);
      case "percentual":
        return (b.percentual ?? -1) - (a.percentual ?? -1) || a.unidade.localeCompare(b.unidade);
      case "diferenca":
        return a.valor - b.valor || a.unidade.localeCompare(b.unidade);
      default: {
        const sa = situacaoLoja(a, comp(a.unidade));
        const sb = situacaoLoja(b, comp(b.unidade));
        return PESO_SITUACAO[sb] - PESO_SITUACAO[sa] || delta(b) - delta(a) || porValor(a, b) || a.unidade.localeCompare(b.unidade);
      }
    }
  });
}

export function mapaPorLoja(painel: PainelLojas<unknown> | null): Map<string, MetricaLoja<unknown>> | null {
  if (!painel || !painel.disponivel) return null;
  return new Map(painel.lojas.map((l) => [l.unidade, l]));
}
