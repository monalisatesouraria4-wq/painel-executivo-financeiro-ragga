import { coberturaFaturamentoLoja, type Comparabilidade } from "@/lib/services/brindesAnalise";
import { baseCobreOsPeriodos, variar, type LojaDoMotivo, type MotivoComparado, type SituacaoCancelamentoAnalise } from "@/lib/services/cancelamentoAnalise";
import { situacaoCompraDireta, type CompraDiretaPainelData, type LojaCompraDireta, type PeriodoCompraDireta, type StatusCompraDireta } from "@/lib/services/compraDiretaPainel";
import { coberturaDaBase } from "@/lib/services/resumoSemanal";

/**
 * Leitura gerencial da aba Retirada Compra Direta (resultado → o que gerou as retiradas → lojas → investigar por
 * motivo → detalhamento). Módulo PURO: motivos, lojas e comparações reutilizam `cancelamentoAnalise.ts` (mesma
 * estrutura de período, `PeriodoAnalisavel`); aqui ficam só as partes específicas da Compra Direta:
 *  - cobertura/comparabilidade da base de Compra Direta e do faturamento (rede ou loja);
 *  - linhas por loja com o STATUS existente (`FAIXAS_COMPRA_DIRETA`: até 5% controlado, até 7% atenção, acima crítico);
 *  - visão "por família CMO" — subtotal VISUAL dos motivos cujo texto começa com o prefixo literal `CMO/`;
 *  - Nota Fiscal (ajuste sem saída de caixa) em bloco separado — nunca entra em total, %, ranking ou status.
 *
 * SITUAÇÃO por motivo = regra EXISTENTE da Compra Direta: comparação do VALOR em R$ com o período anterior (menor =
 * melhorou, maior = piorou, diferença < R$ 0,005 = estável — `situacaoCompraDireta`). O % sobre o faturamento (e sua
 * variação em p.p.) é exibido À PARTE e só com cobertura. O status da loja segue as faixas existentes (5% / 7%).
 *
 * Preservado: nomes originais dos motivos (chaves do Plano de Ação e das orientações); `SUPRIMENTO/EMPRÉSTIMO`
 * permanece na retirada real; D-1 aplicado pelo serviço. Dado ausente nunca vira zero: sem cobertura da base ou do
 * faturamento não há percentual, status, variação nem situação. A base não tem quantidade de ocorrências.
 */

const arred = (v: number) => Math.round(v * 100) / 100;

// ───────────── Cobertura / comparabilidade ─────────────

export { baseCobreOsPeriodos };

/** A comparação só vale com registros, base e faturamento (rede ou loja filtrada) completos nos DOIS períodos. */
export function comparabilidadeCompraDireta(d: CompraDiretaPainelData, loja = "TODAS"): Comparabilidade {
  const escopoLoja = loja !== "TODAS";
  const doEscopo = (p: PeriodoCompraDireta) => (escopoLoja ? p.porLoja.find((l) => l.unidade === loja) : p);
  const a = doEscopo(d.atual);
  const c = doEscopo(d.comparacao);
  // Mesma noção de "há dados" da aba: registros de retirada ou de ajuste (Nota Fiscal) no escopo.
  const disponivel = (e: ReturnType<typeof doEscopo>) =>
    escopoLoja ? !!e && ((e as LojaCompraDireta).motivos.length > 0 || (e as LojaCompraDireta).ajustesSemSaida > 0 || (e as LojaCompraDireta).valor > 0) : !!e && (e as PeriodoCompraDireta).disponivel;
  if (!disponivel(a) || !disponivel(c)) return { valida: false, motivo: "Sem registros de Compra Direta em um dos períodos." };
  for (const [rotulo, p, e] of [["atual", d.atual, a], ["comparado", d.comparacao, c]] as const) {
    if (coberturaDaBase(d.cobertura, { inicio: p.inicioOcorrencia, fim: p.fimOcorrencia }) !== "completa") {
      return { valida: false, motivo: `A base de Compra Direta não cobre por inteiro o período ${rotulo}.` };
    }
    if (!e || e.diario.length === 0 || e.diario.some((x) => x.faturamento <= 0)) {
      return { valida: false, motivo: `Faturamento ${escopoLoja ? "da loja " : ""}incompleto no período ${rotulo}: percentuais, status e comparação não são válidos.` };
    }
  }
  return { valida: true, motivo: null };
}

// ───────────── Situação por motivo: valor em R$ (regra existente) ─────────────

/**
 * Situação pelo VALOR em R$ contra o período comparado, com a tolerância e a regra existentes (`situacaoCompraDireta`).
 * `comparado` null (sem base / cobertura incompleta) → "sem-base": nunca zero nem status inventado.
 */
export function situacaoPorValor(atual: number, comparado: number | null): SituacaoCancelamentoAnalise {
  if (comparado === null) return "sem-base";
  const s = situacaoCompraDireta(atual, comparado);
  return s === "sem-alteracao" ? "estavel" : s;
}

/** Motivos (rede/escopo) com a situação decidida pelo valor em R$; % s/ faturamento e p.p. permanecem como calculados. */
export function aplicarSituacaoPorValor(linhas: MotivoComparado[]): MotivoComparado[] {
  return linhas.map((l) => ({ ...l, situacao: situacaoPorValor(l.atual, l.comparado) }));
}

/** Lojas de um motivo com a situação pelo valor em R$ (mesma regra). */
export function aplicarSituacaoPorValorLojas(lojas: LojaDoMotivo[]): LojaDoMotivo[] {
  return lojas.map((l) => ({ ...l, situacao: situacaoPorValor(l.valor, l.comparado) }));
}

// ───────────── Comparativo por loja (status pelas faixas existentes) ─────────────

export type OrdemLojasCompraDireta = "valor" | "percentual" | "variacao" | "loja" | "criticidade";

export interface LinhaLojaCompraDireta {
  unidade: string;
  loja: LojaCompraDireta;
  compLoja: LojaCompraDireta | null;
  /** Retirada real (exclui Nota Fiscal). */
  valor: number;
  faturamento: number;
  /** valor ÷ faturamento × 100 — `null` quando o faturamento da loja não cobre todos os dias. */
  percentual: number | null;
  diasComFaturamento: number;
  diasDoPeriodo: number;
  coberturaParcial: boolean;
  /** Status pelas faixas existentes; só vale com `percentual` válido. */
  status: StatusCompraDireta;
  ajustesSemSaida: number;
  comparavel: boolean;
  comparado: number | null;
  variacaoReais: number | null;
  variacaoPercentual: number | null;
  /** Variação do % sobre o faturamento (p.p.) — exibida à parte, só com cobertura. */
  variacaoPp: number | null;
}

export function linhasLojasCompraDireta(atual: PeriodoCompraDireta, comp: PeriodoCompraDireta, baseCobre: boolean, lojaFiltro = "TODAS"): LinhaLojaCompraDireta[] {
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
        ajustesSemSaida: l.ajustesSemSaida,
        comparavel,
        comparado,
        ...variar(l.valor, comparado),
        variacaoPp: percentual !== null && percentualC !== null ? percentual - percentualC : null,
      };
    });
}

const PESO_STATUS: Record<StatusCompraDireta, number> = { critico: 2, atencao: 1, controlado: 0 };

/** Cada critério é independente (maior valor absoluto não é "pior"); sem dado válido vai por último. */
export function ordenarLojasCompraDireta(linhas: LinhaLojaCompraDireta[], ordem: OrdemLojasCompraDireta): LinhaLojaCompraDireta[] {
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

export interface ContagemStatusValida {
  controlado: number;
  atencao: number;
  critico: number;
  /** Lojas com faturamento em menos dias que o período: ficam fora da classificação. */
  semCobertura: number;
  /** Lojas com cobertura completa (as que entram na classificação). */
  comCobertura: number;
}

/** Contagem de status só com lojas de cobertura completa (o % de uma loja parcial não representa o período). */
export function contagemStatusValida(linhas: LinhaLojaCompraDireta[]): ContagemStatusValida {
  const r: ContagemStatusValida = { controlado: 0, atencao: 0, critico: 0, semCobertura: 0, comCobertura: 0 };
  for (const l of linhas) {
    if (l.coberturaParcial) {
      r.semCobertura++;
      continue;
    }
    r.comCobertura++;
    r[l.status]++;
  }
  return r;
}

// ───────────── Visão "por família CMO" (apenas apresentação) ─────────────

/** Prefixo LITERAL que define a família: todo motivo cujo texto começa com "CMO/". Nada é renomeado nem gravado. */
export const PREFIXO_FAMILIA_CMO = "CMO/";
export const ROTULO_FAMILIA_CMO = "CMO — subtotal da família (motivos “CMO/…”)";

export function ehMotivoFamiliaCMO(motivo: string): boolean {
  return motivo.startsWith(PREFIXO_FAMILIA_CMO);
}

export type LinhaMotivoAgrupada =
  | { tipo: "motivo"; linha: MotivoComparado }
  | {
      tipo: "familia";
      /** Linha de subtotal: SUBSTITUI os componentes no total (os filhos só aparecem ao expandir). */
      subtotal: MotivoComparado;
      filhos: MotivoComparado[];
    };

/**
 * Agrupa os motivos `CMO/…` em UM subtotal; os demais ficam separados. A lista de topo soma o mesmo total da visão por
 * motivo (o subtotal substitui os filhos — nunca é somado a eles). Ordenado pelo valor atual.
 */
export function agruparFamiliaCMO(linhas: MotivoComparado[]): LinhaMotivoAgrupada[] {
  const filhos = linhas.filter((l) => ehMotivoFamiliaCMO(l.motivo));
  const outros = linhas.filter((l) => !ehMotivoFamiliaCMO(l.motivo));
  const topo: { chave: number; item: LinhaMotivoAgrupada }[] = outros.map((l) => ({ chave: l.atual, item: { tipo: "motivo", linha: l } }));

  if (filhos.length > 0) {
    const atual = arred(filhos.reduce((s, f) => s + f.atual, 0));
    const todosComparados = filhos.every((f) => f.comparado !== null);
    const comparado = todosComparados ? arred(filhos.reduce((s, f) => s + (f.comparado ?? 0), 0)) : null;
    const pctFat = filhos.every((f) => f.percentualFaturamento !== null) ? filhos.reduce((s, f) => s + (f.percentualFaturamento ?? 0), 0) : null;
    const pctFatC = comparado !== null && filhos.every((f) => f.percentualFaturamentoComparado !== null) ? filhos.reduce((s, f) => s + (f.percentualFaturamentoComparado ?? 0), 0) : null;
    const subtotal: MotivoComparado = {
      motivo: ROTULO_FAMILIA_CMO,
      atual,
      comparado,
      percentualDoTotal: filhos.reduce((s, f) => s + f.percentualDoTotal, 0),
      ...variar(atual, comparado),
      percentualFaturamento: pctFat,
      percentualFaturamentoComparado: pctFatC,
      variacaoPp: pctFat !== null && pctFatC !== null ? pctFat - pctFatC : null,
      situacao: situacaoPorValor(atual, comparado),
      lojas: [],
    };
    topo.push({ chave: atual, item: { tipo: "familia", subtotal, filhos } });
  }

  return topo
    .sort((a, b) => b.chave - a.chave || nomeDe(a.item).localeCompare(nomeDe(b.item)))
    .map((x) => x.item);
}

const nomeDe = (l: LinhaMotivoAgrupada) => (l.tipo === "motivo" ? l.linha.motivo : l.subtotal.motivo);

// ───────────── Nota Fiscal = ajuste sem saída de caixa (bloco separado) ─────────────

export interface AjusteSemSaidaLoja {
  unidade: string;
  atual: number;
  /** `null` sem base comparável (nunca zero). */
  comparado: number | null;
}

/** Nota Fiscal por loja (fora da retirada real). Só lojas com ajuste no período atual ou no comparado. */
export function ajustesSemSaidaPorLoja(atual: PeriodoCompraDireta, comp: PeriodoCompraDireta, baseCobre: boolean, lojaFiltro = "TODAS"): AjusteSemSaidaLoja[] {
  const codigos = new Set<string>();
  for (const p of [atual, comp]) for (const l of p.porLoja) if (l.ajustesSemSaida !== 0) codigos.add(l.unidade);
  return [...codigos]
    .filter((u) => lojaFiltro === "TODAS" || u === lojaFiltro)
    .map((unidade) => ({
      unidade,
      atual: atual.porLoja.find((l) => l.unidade === unidade)?.ajustesSemSaida ?? 0,
      comparado: baseCobre ? (comp.porLoja.find((l) => l.unidade === unidade)?.ajustesSemSaida ?? 0) : null,
    }))
    .sort((a, b) => b.atual - a.atual || a.unidade.localeCompare(b.unidade));
}
