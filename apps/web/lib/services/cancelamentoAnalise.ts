import { UNIDADES } from "@painel/shared";
import { coberturaFaturamentoLoja, type Comparabilidade } from "@/lib/services/brindesAnalise";
import type { CancelamentoPainelData, LojaCancelamento, PeriodoCancelamento, StatusCancelamento } from "@/lib/services/cancelamentoPainel";
import { coberturaDaBase } from "@/lib/services/resumoSemanal";

/**
 * Leitura gerencial da aba Cancelamentos (Salão e Delivery, cada uma com a sua fonte e os seus motivos): resultado →
 * motivos → lojas → investigar por motivo. Módulo PURO: só reorganiza o que `montarPeriodoCancelamento` já calcula
 * (valor, faturamento e % por loja, motivos como estão na base, status por `FAIXAS_CANCELAMENTO`).
 *
 * Regras preservadas: menor = melhorou; melhora/piora pelo % sobre o faturamento (nunca só pelo valor em R$); motivo
 * `TESTE` continua nos totais; datas de ocorrência (D-1 já aplicado pelo serviço). Dado ausente nunca vira zero:
 * sem cobertura da base ou do faturamento (rede ou loja) não há comparação, percentual nem situação.
 * A base só tem valor por loja × dia × motivo — sem horário, canal, autorizador ou submotivo.
 */

/**
 * Forma mínima que as funções de motivo/loja precisam de um período — satisfeita por `PeriodoCancelamento` e por
 * `PeriodoCompraDireta` (mesma estrutura de `montarPeriodoCompraDireta`), o que permite reutilizá-las nas duas abas.
 */
export interface LojaAnalisavel {
  unidade: string;
  faturamento: number;
  valor: number;
  percentual: number;
  motivos: { motivo: string; valor: number }[];
  diario: { faturamento: number }[];
}

export interface PeriodoAnalisavel {
  inicioOcorrencia: string;
  fimOcorrencia: string;
  disponivel: boolean;
  faturamento: number;
  valor: number;
  percentual: number;
  diario: { faturamento: number }[];
  porLoja: LojaAnalisavel[];
}

const arred = (v: number) => Math.round(v * 100) / 100;
const TOLERANCIA = 0.005;
const centavos = (v: number) => Math.round(v * 100);

// ───────────── Cobertura / comparabilidade ─────────────

type EntradaCobertura = Pick<CancelamentoPainelData, "cobertura"> & {
  atual: Pick<PeriodoCancelamento, "inicioOcorrencia" | "fimOcorrencia">;
  comparacao: Pick<PeriodoCancelamento, "inicioOcorrencia" | "fimOcorrencia">;
};

/** A base da fonte cobre por inteiro os dois períodos (a base da comparação por loja/motivo; o faturamento é checado loja a loja). */
export function baseCobreOsPeriodos(d: EntradaCobertura): boolean {
  return [d.atual, d.comparacao].every((p) => coberturaDaBase(d.cobertura, { inicio: p.inicioOcorrencia, fim: p.fimOcorrencia }) === "completa");
}

/** A comparação do período só vale com registros, base e faturamento (rede ou loja filtrada) completos nos DOIS períodos. */
export function comparabilidadeCancelamento(d: CancelamentoPainelData, loja = "TODAS"): Comparabilidade {
  const escopoLoja = loja !== "TODAS";
  const doEscopo = (p: PeriodoCancelamento) => (escopoLoja ? p.porLoja.find((l) => l.unidade === loja) : p);
  const a = doEscopo(d.atual);
  const c = doEscopo(d.comparacao);
  const disponivel = (e: ReturnType<typeof doEscopo>) => (escopoLoja ? !!e && (e as LojaCancelamento).motivos.length > 0 : !!e && (e as PeriodoCancelamento).disponivel);
  if (!disponivel(a) || !disponivel(c)) return { valida: false, motivo: "Sem registros de cancelamento em um dos períodos." };
  for (const [rotulo, p, e] of [["atual", d.atual, a], ["comparado", d.comparacao, c]] as const) {
    if (coberturaDaBase(d.cobertura, { inicio: p.inicioOcorrencia, fim: p.fimOcorrencia }) !== "completa") {
      return { valida: false, motivo: `A base não cobre por inteiro o período ${rotulo}.` };
    }
    if (!e || e.diario.length === 0 || e.diario.some((x) => x.faturamento <= 0)) {
      return { valida: false, motivo: `Faturamento ${escopoLoja ? "da loja " : ""}incompleto no período ${rotulo}: percentuais e comparação não são válidos.` };
    }
  }
  return { valida: true, motivo: null };
}

// ───────────── Situação (pelo % sobre o faturamento) ─────────────

export type SituacaoCancelamentoAnalise = "melhorou" | "piorou" | "estavel" | "sem-ocorrencia" | "sem-base";

export const ROTULO_SITUACAO_CANCELAMENTO: Record<SituacaoCancelamentoAnalise, string> = {
  melhorou: "Melhorou",
  piorou: "Piorou",
  estavel: "Estável",
  "sem-ocorrencia": "Sem ocorrência",
  "sem-base": "Sem base de comparação",
};

/**
 * Menor % sobre o faturamento = melhorou (2 casas). Sem % válido em qualquer ponta → sem base (NÃO cai para o valor em
 * R$). Valor zero nos dois períodos (com base) = sem ocorrência.
 */
export function situacaoPorPercentual(e: {
  valorAtual: number | null;
  valorComparado: number | null;
  percentualAtual: number | null;
  percentualComparado: number | null;
}): SituacaoCancelamentoAnalise {
  if (e.valorAtual === null || e.valorComparado === null || e.percentualAtual === null || e.percentualComparado === null) return "sem-base";
  if (centavos(e.valorAtual) === 0 && centavos(e.valorComparado) === 0) return "sem-ocorrencia";
  const a = centavos(e.percentualAtual);
  const c = centavos(e.percentualComparado);
  return a === c ? "estavel" : a < c ? "melhorou" : "piorou";
}

export function variar(atual: number, comparado: number | null): { variacaoReais: number | null; variacaoPercentual: number | null } {
  if (comparado === null) return { variacaoReais: null, variacaoPercentual: null };
  const delta = arred(atual - comparado);
  return { variacaoReais: delta, variacaoPercentual: Math.abs(comparado) >= TOLERANCIA ? (delta / comparado) * 100 : null };
}

/** Faturamento do escopo (rede ou loja) quando cobre todos os dias do período; senão `null` (sem % válido). */
function faturamentoValido(p: PeriodoAnalisavel, loja: string): number | null {
  if (loja !== "TODAS") {
    const l = p.porLoja.find((x) => x.unidade === loja);
    return l && coberturaFaturamentoLoja(l).completo && l.faturamento > 0 ? l.faturamento : null;
  }
  return p.diario.length > 0 && p.diario.every((d) => d.faturamento > 0) && p.faturamento > 0 ? p.faturamento : null;
}

/** % de cancelamento do escopo (rede ou loja) sobre o faturamento, só com o faturamento completo no período; senão `null`. */
export function percentualCancelamentoValido(p: PeriodoAnalisavel, loja = "TODAS"): number | null {
  const fat = faturamentoValido(p, loja);
  if (fat === null) return null;
  const valor = loja === "TODAS" ? p.valor : (p.porLoja.find((l) => l.unidade === loja)?.valor ?? 0);
  return (valor / fat) * 100;
}

// ───────────── Motivos → lojas ─────────────

export interface LojaNoMotivo {
  unidade: string;
  valor: number;
  /** valor da loja ÷ valor do motivo na rede/escopo × 100. */
  percentualDoMotivo: number;
}

export interface MotivoCancelado {
  /** Exatamente como na base ("MOT 03 - ERRO OPERACIONAL"...). */
  motivo: string;
  valor: number;
  /** valor do motivo ÷ total do escopo × 100. */
  percentualDoTotal: number;
  lojas: LojaNoMotivo[];
}

/** Motivos do escopo — rede ou uma loja — do maior para o menor valor; a soma = total do escopo. */
export function motivosCancelados(p: PeriodoAnalisavel, loja = "TODAS"): MotivoCancelado[] {
  const lojas = p.porLoja.filter((l) => loja === "TODAS" || l.unidade === loja);
  const mapa = new Map<string, Map<string, number>>();
  for (const l of lojas) {
    for (const m of l.motivos) {
      const porLoja = mapa.get(m.motivo) ?? new Map<string, number>();
      porLoja.set(l.unidade, (porLoja.get(l.unidade) ?? 0) + m.valor);
      mapa.set(m.motivo, porLoja);
    }
  }
  const soma = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
  const total = [...mapa.values()].reduce((s, m) => s + soma(m), 0);
  const ordemLoja = new Map<string, number>(UNIDADES.map((u, i) => [u as string, i]));
  return [...mapa.entries()]
    .map(([motivo, m]) => ({ motivo, valor: soma(m), porLoja: m }))
    .filter((x) => Math.abs(x.valor) >= TOLERANCIA)
    .sort((a, b) => b.valor - a.valor || a.motivo.localeCompare(b.motivo))
    .map((x) => ({
      motivo: x.motivo,
      valor: arred(x.valor),
      percentualDoTotal: total > 0 ? (x.valor / total) * 100 : 0,
      lojas: [...x.porLoja.entries()]
        .filter(([, v]) => Math.abs(v) >= TOLERANCIA)
        .sort((a, b) => b[1] - a[1] || (ordemLoja.get(a[0]) ?? 99) - (ordemLoja.get(b[0]) ?? 99))
        .map(([unidade, v]) => ({ unidade, valor: arred(v), percentualDoMotivo: x.valor > 0 ? (v / x.valor) * 100 : 0 })),
    }));
}

export interface LojaMotivoComparada {
  unidade: string;
  atual: number;
  /** `null` = sem base comparável (nunca zero). */
  comparado: number | null;
  percentualDoMotivo: number;
  variacaoReais: number | null;
  variacaoPercentual: number | null;
}

export interface MotivoComparado {
  motivo: string;
  atual: number;
  comparado: number | null;
  percentualDoTotal: number;
  variacaoReais: number | null;
  variacaoPercentual: number | null;
  /** valor do motivo ÷ faturamento do escopo × 100; `null` sem faturamento completo. */
  percentualFaturamento: number | null;
  percentualFaturamentoComparado: number | null;
  /** Variação do % sobre o faturamento, em p.p. */
  variacaoPp: number | null;
  situacao: SituacaoCancelamentoAnalise;
  lojas: LojaMotivoComparada[];
}

/**
 * Une os motivos dos dois períodos (ordem pelo valor ATUAL; os que só existiam no comparado vêm depois, com atual 0).
 * Com comparação inválida, `comparado` é `null`. Com base válida, ausência no comparado = 0 real.
 */
export function compararMotivosCancelados(atual: PeriodoAnalisavel, comp: PeriodoAnalisavel, comparavel: boolean, loja = "TODAS"): MotivoComparado[] {
  const ma = motivosCancelados(atual, loja);
  const mc = motivosCancelados(comp, loja);
  const atualPor = new Map(ma.map((m) => [m.motivo, m]));
  const compPor = new Map(mc.map((m) => [m.motivo, m]));
  const ordem = [...ma.map((m) => m.motivo), ...mc.filter((m) => !atualPor.has(m.motivo)).map((m) => m.motivo)];
  const fatA = faturamentoValido(atual, loja);
  const fatC = faturamentoValido(comp, loja);

  return ordem.map((motivo) => {
    const a = atualPor.get(motivo);
    const c = compPor.get(motivo);
    const va = a?.valor ?? 0;
    const vc = comparavel ? (c?.valor ?? 0) : null;
    const pctA = fatA !== null ? (va / fatA) * 100 : null;
    const pctC = comparavel && fatC !== null && vc !== null ? (vc / fatC) * 100 : null;
    const lojaCompPor = new Map((c?.lojas ?? []).map((l) => [l.unidade, l]));
    const lojaAtualPor = new Map((a?.lojas ?? []).map((l) => [l.unidade, l]));
    const lojasOrdem = [...(a?.lojas ?? []).map((l) => l.unidade), ...(c?.lojas ?? []).filter((l) => !lojaAtualPor.has(l.unidade)).map((l) => l.unidade)];
    return {
      motivo,
      atual: va,
      comparado: vc,
      percentualDoTotal: a?.percentualDoTotal ?? 0,
      ...variar(va, vc),
      percentualFaturamento: pctA,
      percentualFaturamentoComparado: pctC,
      variacaoPp: pctA !== null && pctC !== null ? pctA - pctC : null,
      situacao: situacaoPorPercentual({ valorAtual: va, valorComparado: vc, percentualAtual: pctA, percentualComparado: pctC }),
      lojas: lojasOrdem.map((unidade) => {
        const la = lojaAtualPor.get(unidade)?.valor ?? 0;
        // a loja só tem comparado se a comparação da LOJA for válida (cobertura de faturamento da loja nos dois períodos)
        const lc = comparavel && lojaTemFaturamentoCompleto(atual, comp, unidade) ? (lojaCompPor.get(unidade)?.valor ?? 0) : null;
        return { unidade, atual: la, comparado: lc, percentualDoMotivo: lojaAtualPor.get(unidade)?.percentualDoMotivo ?? 0, ...variar(la, lc) };
      }),
    };
  });
}

function lojaTemFaturamentoCompleto(a: PeriodoAnalisavel, c: PeriodoAnalisavel, unidade: string): boolean {
  return coberturaFaturamentoLoja(a.porLoja.find((l) => l.unidade === unidade)).completo && coberturaFaturamentoLoja(c.porLoja.find((l) => l.unidade === unidade)).completo;
}

// ───────────── Comparativo por loja ─────────────

export type OrdemLojasCancelamento = "valor" | "percentual" | "variacao" | "loja" | "criticidade";

export interface LinhaLojaCancelamento {
  unidade: string;
  loja: LojaCancelamento;
  compLoja: LojaCancelamento | null;
  valor: number;
  faturamento: number;
  /** valor ÷ faturamento × 100 — `null` quando o faturamento da loja não cobre todos os dias. */
  percentual: number | null;
  diasComFaturamento: number;
  diasDoPeriodo: number;
  coberturaParcial: boolean;
  /** Status pelas faixas existentes; só vale com `percentual` válido. */
  status: StatusCancelamento;
  comparavel: boolean;
  comparado: number | null;
  variacaoReais: number | null;
  variacaoPercentual: number | null;
  variacaoPp: number | null;
  situacao: SituacaoCancelamentoAnalise;
}

export function linhasLojasCancelamento(atual: PeriodoCancelamento, comp: PeriodoCancelamento, baseCobre: boolean, lojaFiltro = "TODAS"): LinhaLojaCancelamento[] {
  return atual.porLoja
    .filter((l) => lojaFiltro === "TODAS" || l.unidade === lojaFiltro)
    .map((l) => {
      const c = comp.porLoja.find((x) => x.unidade === l.unidade) ?? null;
      const cobA = coberturaFaturamentoLoja(l);
      const cobC = coberturaFaturamentoLoja(c);
      const comparavel = baseCobre && cobA.completo && cobC.completo;
      const percentual = cobA.completo && l.faturamento > 0 ? l.percentual : null;
      const percentualC = comparavel && c && c.faturamento > 0 ? c.percentual : null;
      const comparado = comparavel && c ? c.valor : null;
      return {
        unidade: l.unidade,
        loja: l,
        compLoja: c,
        valor: l.valor,
        faturamento: l.faturamento,
        percentual,
        diasComFaturamento: cobA.dias,
        diasDoPeriodo: cobA.total,
        coberturaParcial: !cobA.completo,
        status: l.status,
        comparavel,
        comparado,
        ...variar(l.valor, comparado),
        variacaoPp: percentual !== null && percentualC !== null ? percentual - percentualC : null,
        situacao: situacaoPorPercentual({ valorAtual: l.valor, valorComparado: comparado, percentualAtual: percentual, percentualComparado: percentualC }),
      };
    });
}

const PESO_STATUS: Record<StatusCancelamento, number> = { critico: 3, atencao: 2, bom: 1, excelente: 0 };

/** Cada critério é independente (maior valor absoluto não é "pior"); sem dado válido vai por último. */
export function ordenarLojasCancelamento(linhas: LinhaLojaCancelamento[], ordem: OrdemLojasCancelamento): LinhaLojaCancelamento[] {
  const ultimo = (v: number | null) => (v === null ? Number.NEGATIVE_INFINITY : v);
  return [...linhas].sort((a, b) => {
    switch (ordem) {
      case "valor":
        return b.valor - a.valor || a.unidade.localeCompare(b.unidade);
      case "percentual":
        return ultimo(b.percentual) - ultimo(a.percentual) || a.unidade.localeCompare(b.unidade);
      case "variacao":
        return ultimo(b.variacaoReais) - ultimo(a.variacaoReais) || a.unidade.localeCompare(b.unidade);
      case "criticidade":
        return (
          Number(a.coberturaParcial) - Number(b.coberturaParcial) ||
          PESO_STATUS[b.status] - PESO_STATUS[a.status] ||
          ultimo(b.percentual) - ultimo(a.percentual) ||
          a.unidade.localeCompare(b.unidade)
        );
      default:
        return a.unidade.localeCompare(b.unidade);
    }
  });
}

// ───────────── Investigar por motivo ─────────────

export interface LojaDoMotivo {
  unidade: string;
  valor: number;
  percentualDoMotivo: number;
  /** `null` com faturamento parcial da loja. */
  faturamento: number | null;
  percentualFaturamento: number | null;
  coberturaParcial: boolean;
  comparado: number | null;
  variacaoReais: number | null;
  variacaoPercentual: number | null;
  variacaoPp: number | null;
  situacao: SituacaoCancelamentoAnalise;
}

/** Lojas que tiveram o motivo: valor, participação no motivo, faturamento e % s/ faturamento — compara lojas no mesmo motivo. */
export function lojasDoMotivo(motivo: string, atual: PeriodoAnalisavel, comp: PeriodoAnalisavel, baseCobre: boolean, lojaFiltro = "TODAS"): LojaDoMotivo[] {
  const valorNo = (p: PeriodoAnalisavel, u: string) => (p.porLoja.find((l) => l.unidade === u)?.motivos ?? []).filter((m) => m.motivo === motivo).reduce((s, m) => s + m.valor, 0);
  const lojas = atual.porLoja.filter((l) => lojaFiltro === "TODAS" || l.unidade === lojaFiltro);
  const linhas = lojas.map((l) => ({ l, valor: valorNo(atual, l.unidade) })).filter((x) => Math.abs(x.valor) >= TOLERANCIA);
  const totalMotivo = linhas.reduce((s, x) => s + x.valor, 0);
  return linhas
    .map(({ l, valor }) => {
      const cobA = coberturaFaturamentoLoja(l);
      const c = comp.porLoja.find((x) => x.unidade === l.unidade) ?? null;
      const comparavel = baseCobre && cobA.completo && coberturaFaturamentoLoja(c).completo;
      const comparado = comparavel ? arred(valorNo(comp, l.unidade)) : null;
      const pctA = cobA.completo && l.faturamento > 0 ? (valor / l.faturamento) * 100 : null;
      const pctC = comparavel && c && c.faturamento > 0 && comparado !== null ? (comparado / c.faturamento) * 100 : null;
      return {
        unidade: l.unidade,
        valor: arred(valor),
        percentualDoMotivo: totalMotivo > 0 ? (valor / totalMotivo) * 100 : 0,
        faturamento: cobA.completo ? l.faturamento : null,
        percentualFaturamento: pctA,
        coberturaParcial: !cobA.completo,
        comparado,
        ...variar(arred(valor), comparado),
        variacaoPp: pctA !== null && pctC !== null ? pctA - pctC : null,
        situacao: situacaoPorPercentual({ valorAtual: valor, valorComparado: comparado, percentualAtual: pctA, percentualComparado: pctC }),
      };
    })
    .sort((a, b) => b.valor - a.valor || a.unidade.localeCompare(b.unidade));
}
