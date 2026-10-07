import { coberturaDaBase } from "@/lib/services/resumoSemanal";
import type { BrindesPainelData, LinhaMatrizBrinde, LojaBrindes, PeriodoBrindes, StatusBrinde } from "@/lib/services/brindesPainel";

/**
 * Leitura gerencial da aba Brindes: resultado → motivos (com submotivos) → lojas → modalidade. Módulo PURO: só
 * reorganiza o que `montarPeriodoBrindes` já calcula (matriz loja × modalidade × submotivo, faturamento por loja/dia,
 * status pelos CONTROLÁVEIS ÷ faturamento) — nenhuma regra de classificação ou limite novo.
 *
 * Estrutura real da base: `motivo` (principal) → modalidade pela classificação existente (`classificarBrinde`:
 * Presente, Taxa Extra, Aniversariante, Consumo Funcionários, Empresas Parceiras...) e `motivo2` = submotivo. A base
 * NÃO registra quantidade de ocorrências (coluna `quantidade` vazia): só valor por loja × dia × motivo × submotivo.
 *
 * Comparações só são válidas com cobertura: a base cobre os dois períodos, ambos têm faturamento em todos os dias
 * (rede) e, por loja, a loja tem faturamento em todos os dias. Dado ausente nunca vira zero.
 */

export const ROTULO_SEM_SUBMOTIVO = "Sem submotivo informado";
const arred = (v: number) => Math.round(v * 100) / 100;
const TOLERANCIA = 0.005;

// ───────────── Cobertura / comparabilidade ─────────────

/** Dias com faturamento (> 0) da loja em relação aos dias do período. Parcial ou ausente = % não representa o período. */
export function coberturaFaturamentoLoja(l: { diario: { faturamento: number }[] } | undefined | null): { dias: number; total: number; completo: boolean } {
  if (!l) return { dias: 0, total: 0, completo: false };
  const dias = l.diario.filter((d) => d.faturamento > 0).length;
  return { dias, total: l.diario.length, completo: l.diario.length > 0 && dias === l.diario.length };
}

/** A base de Brindes cobre por inteiro os dois períodos (base da comparação por loja/modalidade; o faturamento é checado loja a loja). */
export function baseCobreOsPeriodos(d: BrindesPainelData): boolean {
  return [d.atual, d.comparacao].every((p) => coberturaDaBase(d.cobertura, { inicio: p.inicioOcorrencia, fim: p.fimOcorrencia }) === "completa");
}

export interface Comparabilidade {
  valida: boolean;
  /** Por que a comparação não vale (quando `valida` é false). */
  motivo: string | null;
}

/** A comparação do período só é apresentada como válida com dados e faturamento completos nos DOIS períodos. */
export function comparabilidadeBrindes(d: BrindesPainelData, loja = "TODAS"): Comparabilidade {
  const escopoLoja = loja !== "TODAS";
  const doEscopo = (p: PeriodoBrindes) => (escopoLoja ? p.porLoja.find((l) => l.unidade === loja) : p);
  const [a, c] = [doEscopo(d.atual), doEscopo(d.comparacao)];
  const disponivel = (x: ReturnType<typeof doEscopo>) => (escopoLoja ? !!x && (x as LojaBrindes).motivos.length > 0 : !!x && (x as PeriodoBrindes).disponivel);
  if (!disponivel(a) || !disponivel(c)) return { valida: false, motivo: "Sem registros de Brindes em um dos períodos." };
  for (const [rotulo, p, e] of [["atual", d.atual, a], ["comparado", d.comparacao, c]] as const) {
    if (coberturaDaBase(d.cobertura, { inicio: p.inicioOcorrencia, fim: p.fimOcorrencia }) !== "completa") {
      return { valida: false, motivo: `A base de Brindes não cobre por inteiro o período ${rotulo}.` };
    }
    if (!e || e.diario.length === 0 || e.diario.some((x) => x.faturamento <= 0)) {
      return { valida: false, motivo: `Faturamento ${escopoLoja ? "da loja " : ""}incompleto no período ${rotulo}: percentuais e comparação não são válidos.` };
    }
  }
  return { valida: true, motivo: null };
}

// ───────────── Motivos → submotivos ─────────────

export interface SubmotivoDetalhado {
  submotivo: string;
  valor: number;
  /** valor do submotivo ÷ valor da modalidade × 100. */
  percentualDoMotivo: number;
}

export interface MotivoDetalhado {
  motivo: string;
  controlavel: boolean;
  valor: number;
  /** valor da modalidade ÷ total de brindes do escopo × 100. */
  percentualDoTotal: number;
  submotivos: SubmotivoDetalhado[];
}

/** Modalidades (e submotivos) do escopo — rede inteira ou uma loja —, maior valor primeiro. Soma = total do escopo. */
export function motivosDetalhados(matriz: LinhaMatrizBrinde[], loja?: string): MotivoDetalhado[] {
  const linhas = loja && loja !== "TODAS" ? matriz.filter((m) => m.unidade === loja) : matriz;
  const mapa = new Map<string, { controlavel: boolean; valor: number; subs: Map<string, number> }>();
  for (const l of linhas) {
    const m = mapa.get(l.motivo) ?? { controlavel: l.controlavel, valor: 0, subs: new Map<string, number>() };
    m.valor += l.valor;
    const chave = l.submotivo || ROTULO_SEM_SUBMOTIVO;
    m.subs.set(chave, (m.subs.get(chave) ?? 0) + l.valor);
    mapa.set(l.motivo, m);
  }
  const total = [...mapa.values()].reduce((s, m) => s + m.valor, 0);
  return [...mapa.entries()]
    .filter(([, m]) => Math.abs(m.valor) >= TOLERANCIA)
    .sort((a, b) => b[1].valor - a[1].valor || a[0].localeCompare(b[0]))
    .map(([motivo, m]) => ({
      motivo,
      controlavel: m.controlavel,
      valor: arred(m.valor),
      percentualDoTotal: total > 0 ? (m.valor / total) * 100 : 0,
      submotivos: [...m.subs.entries()]
        .filter(([, v]) => Math.abs(v) >= TOLERANCIA)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([submotivo, v]) => ({ submotivo, valor: arred(v), percentualDoMotivo: m.valor > 0 ? (v / m.valor) * 100 : 0 })),
    }));
}

export interface SubmotivoComparado {
  submotivo: string;
  atual: number;
  /** `null` = sem base comparável (nunca zero). */
  comparado: number | null;
  percentualDoMotivo: number;
  variacaoReais: number | null;
  variacaoPercentual: number | null;
}

export interface MotivoComparado {
  motivo: string;
  controlavel: boolean;
  atual: number;
  comparado: number | null;
  percentualDoTotal: number;
  variacaoReais: number | null;
  /** (atual − comparado) ÷ comparado × 100; `null` sem base ou comparado zero. */
  variacaoPercentual: number | null;
  submotivos: SubmotivoComparado[];
}

function variar(atual: number, comparado: number | null): { variacaoReais: number | null; variacaoPercentual: number | null } {
  if (comparado === null) return { variacaoReais: null, variacaoPercentual: null };
  const delta = arred(atual - comparado);
  return { variacaoReais: delta, variacaoPercentual: Math.abs(comparado) >= TOLERANCIA ? (delta / comparado) * 100 : null };
}

/**
 * Une as modalidades/submotivos dos dois períodos (ordem pelo valor ATUAL; os que só existiam no comparado vêm depois,
 * com atual 0). Com base inválida, `comparado` fica `null` em tudo. Com base válida, ausência no comparado = 0 real.
 */
export function compararMotivosDetalhados(atual: MotivoDetalhado[], comparado: MotivoDetalhado[], baseValida: boolean): MotivoComparado[] {
  const compPor = new Map(comparado.map((m) => [m.motivo, m]));
  const atualPor = new Map(atual.map((m) => [m.motivo, m]));
  const ordem = [...atual.map((m) => m.motivo), ...comparado.filter((m) => !atualPor.has(m.motivo)).map((m) => m.motivo)];
  return ordem.map((motivo) => {
    const a = atualPor.get(motivo);
    const c = compPor.get(motivo);
    const va = a?.valor ?? 0;
    const vc = baseValida ? (c?.valor ?? 0) : null;
    const subCompPor = new Map((c?.submotivos ?? []).map((s) => [s.submotivo, s]));
    const subAtualPor = new Map((a?.submotivos ?? []).map((s) => [s.submotivo, s]));
    const subOrdem = [...(a?.submotivos ?? []).map((s) => s.submotivo), ...(c?.submotivos ?? []).filter((s) => !subAtualPor.has(s.submotivo)).map((s) => s.submotivo)];
    return {
      motivo,
      controlavel: (a ?? c)!.controlavel,
      atual: va,
      comparado: vc,
      percentualDoTotal: a?.percentualDoTotal ?? 0,
      ...variar(va, vc),
      submotivos: subOrdem.map((submotivo) => {
        const sa = subAtualPor.get(submotivo)?.valor ?? 0;
        const sc = baseValida ? (subCompPor.get(submotivo)?.valor ?? 0) : null;
        return { submotivo, atual: sa, comparado: sc, percentualDoMotivo: subAtualPor.get(submotivo)?.percentualDoMotivo ?? 0, ...variar(sa, sc) };
      }),
    };
  });
}

// ───────────── Comparativo por loja ─────────────

export type OrdemLojasBrindes = "valor" | "percentual" | "variacao" | "loja" | "criticidade";

export interface LinhaLojaBrindes {
  unidade: string;
  loja: LojaBrindes;
  compLoja: LojaBrindes | null;
  total: number;
  controlaveis: number;
  naoControlaveis: number;
  faturamento: number;
  /** controláveis ÷ faturamento (regra existente). `null` quando o faturamento da loja não cobre todos os dias. */
  percentualControlaveis: number | null;
  /** total ÷ faturamento (informativo); `null` com cobertura parcial. */
  percentualTotal: number | null;
  diasComFaturamento: number;
  diasDoPeriodo: number;
  coberturaParcial: boolean;
  status: StatusBrinde;
  /** Comparação da LOJA válida (base + faturamento completo da loja nos dois períodos). */
  comparavel: boolean;
  variacaoReais: number | null;
  variacaoPercentual: number | null;
  /** Variação do % de controláveis sobre o faturamento (p.p.); `null` sem base. */
  variacaoPp: number | null;
}

export function linhasLojasBrindes(atual: PeriodoBrindes, comparacao: PeriodoBrindes, comparacaoRedeValida: boolean, lojaFiltro = "TODAS"): LinhaLojaBrindes[] {
  return atual.porLoja
    .filter((l) => lojaFiltro === "TODAS" || l.unidade === lojaFiltro)
    .map((l) => {
      const c = comparacao.porLoja.find((x) => x.unidade === l.unidade) ?? null;
      const cobA = coberturaFaturamentoLoja(l);
      const cobC = coberturaFaturamentoLoja(c);
      const comparavel = comparacaoRedeValida && cobA.completo && cobC.completo;
      const pctC = l.faturamento > 0 ? l.percentualControlaveis : null;
      const v = variar(l.total, comparavel && c ? c.total : null);
      return {
        unidade: l.unidade,
        loja: l,
        compLoja: c,
        total: l.total,
        controlaveis: l.controlaveis,
        naoControlaveis: l.naoControlaveis,
        faturamento: l.faturamento,
        percentualControlaveis: cobA.completo ? pctC : null,
        percentualTotal: cobA.completo && l.faturamento > 0 ? l.percentualTotal : null,
        diasComFaturamento: cobA.dias,
        diasDoPeriodo: cobA.total,
        coberturaParcial: !cobA.completo,
        status: l.status,
        comparavel,
        ...v,
        variacaoPp: comparavel && c && cobA.completo ? l.percentualControlaveis - c.percentualControlaveis : null,
      };
    });
}

const PESO_STATUS: Record<StatusBrinde, number> = { critico: 2, atencao: 1, excelente: 0 };

/** Ordena sem classificar como "pior" quem tem maior valor absoluto: cada critério é independente; sem dado válido vai por último. */
export function ordenarLojasBrindes(linhas: LinhaLojaBrindes[], ordem: OrdemLojasBrindes): LinhaLojaBrindes[] {
  const ultimo = (v: number | null) => (v === null ? Number.NEGATIVE_INFINITY : v);
  return [...linhas].sort((a, b) => {
    switch (ordem) {
      case "valor":
        return b.total - a.total || a.unidade.localeCompare(b.unidade);
      case "percentual":
        return ultimo(b.percentualControlaveis) - ultimo(a.percentualControlaveis) || a.unidade.localeCompare(b.unidade);
      case "variacao":
        return ultimo(b.variacaoReais) - ultimo(a.variacaoReais) || a.unidade.localeCompare(b.unidade);
      case "criticidade":
        return (
          Number(a.coberturaParcial) - Number(b.coberturaParcial) ||
          PESO_STATUS[b.status] - PESO_STATUS[a.status] ||
          ultimo(b.percentualControlaveis) - ultimo(a.percentualControlaveis) ||
          a.unidade.localeCompare(b.unidade)
        );
      default:
        return a.unidade.localeCompare(b.unidade);
    }
  });
}

// ───────────── Investigar por modalidade ─────────────

export interface LojaNaModalidade {
  unidade: string;
  valor: number;
  /** participação da loja no total da modalidade (rede) × 100. */
  percentualDaModalidade: number;
  faturamento: number | null;
  /** valor da modalidade ÷ faturamento da loja × 100 (parte do % de controláveis, se a modalidade é controlável); `null` com cobertura parcial. */
  percentualFaturamento: number | null;
  coberturaParcial: boolean;
  comparado: number | null;
  variacaoReais: number | null;
  variacaoPercentual: number | null;
}

/** Lojas que usaram a modalidade, com valor, faturamento e % s/ faturamento — compara lojas dentro da mesma modalidade. */
export function lojasDaModalidade(motivo: string, atual: PeriodoBrindes, comparacao: PeriodoBrindes, comparacaoRedeValida: boolean, lojaFiltro = "TODAS"): LojaNaModalidade[] {
  const soma = (p: PeriodoBrindes, u: string) => p.matriz.filter((m) => m.unidade === u && m.motivo === motivo).reduce((s, m) => s + m.valor, 0);
  const lojas = atual.porLoja.filter((l) => lojaFiltro === "TODAS" || l.unidade === lojaFiltro);
  const linhas = lojas.map((l) => ({ l, valor: soma(atual, l.unidade) })).filter((x) => Math.abs(x.valor) >= TOLERANCIA);
  const totalMod = linhas.reduce((s, x) => s + x.valor, 0);
  return linhas
    .map(({ l, valor }) => {
      const cobA = coberturaFaturamentoLoja(l);
      const c = comparacao.porLoja.find((x) => x.unidade === l.unidade) ?? null;
      const comparavel = comparacaoRedeValida && cobA.completo && coberturaFaturamentoLoja(c).completo;
      const comparado = comparavel ? arred(soma(comparacao, l.unidade)) : null;
      return {
        unidade: l.unidade,
        valor: arred(valor),
        percentualDaModalidade: totalMod > 0 ? (valor / totalMod) * 100 : 0,
        faturamento: cobA.completo ? l.faturamento : null,
        percentualFaturamento: cobA.completo && l.faturamento > 0 ? (valor / l.faturamento) * 100 : null,
        coberturaParcial: !cobA.completo,
        comparado,
        ...variar(arred(valor), comparado),
      };
    })
    .sort((a, b) => b.valor - a.valor || a.unidade.localeCompare(b.unidade));
}
