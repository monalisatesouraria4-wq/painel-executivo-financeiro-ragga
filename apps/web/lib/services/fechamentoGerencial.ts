import type { CaixaAberturaFechamentoLinha } from "@/lib/services/aberturaFechamento";

/**
 * Regras gerenciais da sub-aba Fechamento (Controles de Caixa). Módulo PURO (sem banco), só lê as linhas que o serviço
 * já devolve — não altera schema, importação nem as fórmulas existentes (Σ DIF. TOTAL por loja continua a mesma).
 *
 * Definições (cada LINHA = um fechamento individual de caixa por operador; não é PDV físico nem movimento isolado):
 *  - Situação OFICIAL = `situacao` da base: "Aberto" | "Fechado" | "Conciliado" (nunca deduzida dos valores numéricos —
 *    a "Dif. conc." de um Fechado vem como 0,00 de preenchimento e não indica conciliação).
 *  - Caixas fechados   = Fechado + Conciliado (fechamento operacional concluído).
 *  - Conciliados       = Conciliado. Pendentes de conciliação = Fechado (fechado, aguardando conferência financeira).
 *  - Em aberto         = Aberto cujo dia de abertura JÁ PASSOU (deveria estar fechado). Aberto do dia atual = "em operação".
 *  - Prazo: o financeiro concilia até a QUARTA-FEIRA os caixas da semana anterior (segunda a domingo); a apresentação é
 *    na quinta. Um Fechado só é "vencido" depois da quarta-feira seguinte à semana do caixa; antes disso está no prazo.
 *  - Data do fechamento: derivada do texto `fechamento` ("DD/MM HH:MM", sem ano) com o ano da data de abertura; nunca
 *    uma data padrão — sem texto reconhecível, sem data.
 */

export type StatusConciliacao = "aberto" | "fechado-pendente" | "conciliado" | "desconhecido";

export function statusConciliacao(l: Pick<CaixaAberturaFechamentoLinha, "situacao">): StatusConciliacao {
  if (l.situacao === "Aberto") return "aberto";
  if (l.situacao === "Fechado") return "fechado-pendente";
  if (l.situacao === "Conciliado") return "conciliado";
  return "desconhecido";
}

// ───────────── datas (AAAA-MM-DD, UTC "puro") ─────────────

const dataUtc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoDe = (d: Date) => d.toISOString().slice(0, 10);
const somaDias = (iso: string, n: number) => {
  const d = dataUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDe(d);
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Hoje no fuso de Brasília (AAAA-MM-DD) — o painel é operado em horário local, não UTC. */
export function hojeBrasilISO(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

export const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Segunda-feira da semana (segunda a domingo) que contém a data. */
export function segundaDaSemana(iso: string): string {
  const dow = dataUtc(iso).getUTCDay(); // 0 = domingo
  return somaDias(iso, dow === 0 ? -6 : 1 - dow);
}
export function domingoDaSemana(iso: string): string {
  return somaDias(segundaDaSemana(iso), 6);
}
/** Último dia do prazo de conciliação do caixa: a quarta-feira seguinte à semana (segunda a domingo) em que ele ocorreu. */
export function prazoConciliacaoISO(dataCaixa: string): string {
  return somaDias(domingoDaSemana(dataCaixa), 3);
}
/** Semana completa (segunda a domingo) imediatamente anterior à semana de `hoje`. */
export function semanaAnterior(hoje: string): { inicio: string; fim: string } {
  const seg = segundaDaSemana(hoje);
  return { inicio: somaDias(seg, -7), fim: somaDias(seg, -1) };
}
/** Semana de `hoje` (segunda a domingo). */
export function semanaDe(dia: string): { inicio: string; fim: string } {
  return { inicio: segundaDaSemana(dia), fim: domingoDaSemana(dia) };
}

const RE_FECHAMENTO = /^(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/;

/**
 * Data real do fechamento individual (AAAA-MM-DD). O texto da base não tem ano: usa o ano da data de abertura (e o ano
 * seguinte se o mês do fechamento for anterior ao da abertura — virada de ano). Devolve `null` (nunca uma data padrão)
 * quando não há texto, o formato não é reconhecido, a data é inválida ou resultaria anterior à abertura.
 */
export function dataFechamentoISO(dataAbertura: string | undefined | null, fechamento: string | null | undefined): string | null {
  if (!dataAbertura || !ISO.test(dataAbertura) || !fechamento) return null;
  const m = RE_FECHAMENTO.exec(fechamento.trim());
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const anoAbertura = Number(dataAbertura.slice(0, 4));
  const mesAbertura = Number(dataAbertura.slice(5, 7));
  const ano = mes < mesAbertura ? anoAbertura + 1 : anoAbertura;
  const iso = `${String(ano).padStart(4, "0")}-${m[2]}-${m[1]}`;
  const d = dataUtc(iso);
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== dia || d.getUTCMonth() + 1 !== mes) return null;
  return iso >= dataAbertura ? iso : null;
}

/** Hora do fechamento (HH:MM) do texto da base, ou `null`. */
export function horaFechamento(fechamento: string | null | undefined): string | null {
  const m = fechamento ? RE_FECHAMENTO.exec(fechamento.trim()) : null;
  return m ? `${m[3]}:${m[4]}` : null;
}

// ───────────── pendências e prazo ─────────────

export type PrazoPendencia = "no-prazo" | "vencida";

/** Prazo de um caixa Fechado (pendente de conciliação); `null` para os demais status ou sem data de referência. */
export function prazoPendencia(l: Pick<CaixaAberturaFechamentoLinha, "situacao" | "data">, hoje: string): { prazo: string; situacao: PrazoPendencia } | null {
  if (statusConciliacao(l) !== "fechado-pendente" || !l.data) return null;
  const prazo = prazoConciliacaoISO(l.data);
  return { prazo, situacao: hoje > prazo ? "vencida" : "no-prazo" };
}

/** Aberto de dia que já passou = deveria estar fechado ("em aberto"); Aberto do dia atual = ainda em operação. */
export function abertoVencido(l: Pick<CaixaAberturaFechamentoLinha, "situacao" | "data">, hoje: string): boolean | null {
  if (statusConciliacao(l) !== "aberto" || !l.data) return null;
  return l.data < hoje;
}

const arred = (v: number) => Math.round(v * 100) / 100;

/** A Dif. total da base difere da soma (Dif. fechamento + Dif. conciliação)? `null` quando não dá para comparar. */
export function totalDifereDaSoma(l: Pick<CaixaAberturaFechamentoLinha, "difFechamento" | "difConciliacao" | "difTotal">): boolean | null {
  if (l.difTotal === null || l.difFechamento === null) return null;
  return Math.abs(arred((l.difFechamento ?? 0) + (l.difConciliacao ?? 0)) - l.difTotal) >= 0.005;
}

export interface ResumoFechamentoGerencial {
  /** Fechamentos individuais (linhas) — não são PDVs distintos nem movimentos. */
  registros: number;
  fechados: number;
  conciliados: number;
  pendentes: number;
  pendentesVencidas: number;
  pendentesNoPrazo: number;
  /** Aberto de dia anterior (deveria estar fechado). */
  emAberto: number;
  /** Aberto do dia atual (ainda operando) — não é atraso. */
  emOperacao: number;
  /** Situação fora de Aberto/Fechado/Conciliado (não deve ocorrer). */
  outrasSituacoes: number;
  /** Σ Dif. fechamento (linhas sem valor não entram). */
  difFechamento: number;
  registrosSemDifFechamento: number;
  /** Σ Dif. total dos registros CONCILIADOS (resultado final após a conciliação, campo DIF. TOTAL da base). */
  difAposConciliacao: number;
  /** Σ Dif. total de todos os registros (a mesma métrica do comparativo por loja). */
  difTotalGeral: number;
  /** Conciliados cuja Dif. total difere de fechamento + conciliação (preservado como na base; apenas sinalizado). */
  totalDifereDaSoma: number;
}

export function resumirFechamentoGerencial(linhas: CaixaAberturaFechamentoLinha[], hoje: string): ResumoFechamentoGerencial {
  const r: ResumoFechamentoGerencial = {
    registros: linhas.length,
    fechados: 0,
    conciliados: 0,
    pendentes: 0,
    pendentesVencidas: 0,
    pendentesNoPrazo: 0,
    emAberto: 0,
    emOperacao: 0,
    outrasSituacoes: 0,
    difFechamento: 0,
    registrosSemDifFechamento: 0,
    difAposConciliacao: 0,
    difTotalGeral: 0,
    totalDifereDaSoma: 0,
  };
  for (const l of linhas) {
    const st = statusConciliacao(l);
    if (st === "conciliado") {
      r.conciliados += 1;
      r.fechados += 1;
      r.difAposConciliacao += l.difTotal ?? 0;
      if (totalDifereDaSoma(l)) r.totalDifereDaSoma += 1;
    } else if (st === "fechado-pendente") {
      r.pendentes += 1;
      r.fechados += 1;
      if (prazoPendencia(l, hoje)?.situacao === "vencida") r.pendentesVencidas += 1;
      else r.pendentesNoPrazo += 1;
    } else if (st === "aberto") {
      if (abertoVencido(l, hoje) === false) r.emOperacao += 1;
      else r.emAberto += 1; // sem data de referência: não há como provar que é do dia atual — conta como em aberto
    } else {
      r.outrasSituacoes += 1;
    }
    if (l.difFechamento === null) r.registrosSemDifFechamento += 1;
    else r.difFechamento += l.difFechamento;
    r.difTotalGeral += l.difTotal ?? 0;
  }
  r.difFechamento = arred(r.difFechamento);
  r.difAposConciliacao = arred(r.difAposConciliacao);
  r.difTotalGeral = arred(r.difTotalGeral);
  return r;
}

export interface PendenciaLoja {
  unidade: string;
  vencidas: number;
  noPrazo: number;
  /** Data (abertura) do caixa vencido mais antigo. */
  maisAntiga: string | null;
}

/** Pendências de conciliação por loja, vencidas primeiro (mais vencidas no topo). */
export function pendenciasPorLoja(linhas: CaixaAberturaFechamentoLinha[], hoje: string): PendenciaLoja[] {
  const m = new Map<string, PendenciaLoja>();
  for (const l of linhas) {
    const p = prazoPendencia(l, hoje);
    if (!p) continue;
    const a = m.get(l.unidade) ?? { unidade: l.unidade, vencidas: 0, noPrazo: 0, maisAntiga: null };
    if (p.situacao === "vencida") {
      a.vencidas += 1;
      if (l.data && (a.maisAntiga === null || l.data < a.maisAntiga)) a.maisAntiga = l.data;
    } else a.noPrazo += 1;
    m.set(l.unidade, a);
  }
  return [...m.values()].sort((a, b) => b.vencidas - a.vencidas || b.noPrazo - a.noPrazo || a.unidade.localeCompare(b.unidade));
}
