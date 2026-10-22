import { agregarEmBuckets } from "@/lib/rules/formasPagamento";
import { resumirTroco } from "@/lib/services/trocoIndicadores";
import { cicloDaData } from "@/lib/import/periodoAbaQuebra";
import type { FormaPagamentoBuckets } from "@/lib/services/fechamentoWhatsapp";

/**
 * Resumo Semanal EXECUTIVO (tela + imagem + texto para WhatsApp) — módulo PURO (sem banco). Uma única estrutura (`ResumoExecutivo`)
 * alimenta a tela, o texto e a imagem, então os três mostram exatamente os mesmos valores e o mesmo período.
 *
 * Regras: datas de OCORRÊNCIA exatas (semana segunda→domingo, sem D-1/D-2); dado ausente NUNCA vira zero — se a base não cobre a
 * semana por inteiro (menor/maior data da base), o campo é `null` com status "sem-dados" e a nota diz até quando a base vai; zero só
 * quando a base cobre o período e não há lançamento. Compra Direta: "NOTA FISCAL" é ajuste sem saída de caixa — fica FORA do total
 * da retirada e é mostrada à parte. Quebra: total pela data real do lançamento; se a semana cruza o ciclo 16→15, mostra o total por ciclo.
 */

export interface JanelaSemana {
  /** Segunda-feira (AAAA-MM-DD). */
  inicio: string;
  /** Domingo (AAAA-MM-DD). */
  fim: string;
}

export type BaseId = "faturamento" | "formas" | "brindes" | "cancelamentoSalao" | "cancelamentoDelivery" | "compraDireta" | "retiradaDeposito" | "troco" | "quebra";
export interface CoberturaBase { min: string | null; max: string | null }

export interface LinhaMotivo { motivo: string; valor: number }
export interface LinhaTroco { diferenca: number; conferido: number; informado: number }
export interface LinhaQuebra { data: string; motivo: string; valor: number }
export interface LinhaRetirada { unidade: string; valor: number }

/** Linhas brutas (já filtradas na janela) de um período. */
export interface EntradaPeriodo {
  faturamentoTotal: number;
  formas: { forma: string; valor: number }[];
  brindes: LinhaMotivo[];
  cancelamentoSalao: LinhaMotivo[];
  cancelamentoDelivery: LinhaMotivo[];
  compraDireta: LinhaMotivo[];
  retiradaDeposito: LinhaRetirada[];
  troco: LinhaTroco[];
  quebra: LinhaQuebra[];
}

export interface EntradaResumoExecutivo {
  atual: JanelaSemana;
  anterior: JanelaSemana;
  bases: Record<BaseId, CoberturaBase>;
  dadosAtual: EntradaPeriodo;
  dadosAnterior: EntradaPeriodo;
}

// ───────────────────────── formatação ─────────────────────────

const fmtMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtPct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const moedaBR = (v: number) => fmtMoeda.format(Math.round(v * 100) / 100 + 0).replace(/ /g, " ");
export const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const arred = (v: number) => Math.round(v * 100) / 100;

// ───────────────────────── tipos de saída ─────────────────────────

export type StatusCampo = "ok" | "sem-dados";
export interface Campo { valor: number | null; status: StatusCampo; /** Quando "sem-dados": até quando a base tem dados. */ nota?: string }
export type Situacao = "melhorou" | "piorou" | "estavel";
export interface Variacao { reais: number; percentual: number | null; situacao: Situacao }

export type TotalId = "faturamento" | "brindes" | "cancelamentoSalao" | "cancelamentoDelivery" | "cancelamentos" | "compraDireta" | "retiradaDeposito" | "troco" | "quebra";
export interface Total {
  id: TotalId;
  rotulo: string;
  atual: Campo;
  anterior: Campo;
  variacao: Variacao | null;
  /** Faturamento: maior é melhor; os demais (custos/perdas): menor é melhor. */
  melhorQuando: "maior" | "menor";
  /** Texto auxiliar curto (ex.: "Nota Fiscal fora do total"). */
  observacao?: string;
}

export type FormaId = "credito" | "debito" | "pix" | "voucher" | "vendaAPrazo" | "online" | "dinheiro" | "outros";
export interface FormaResumo { id: FormaId; rotulo: string; atual: Campo; anterior: Campo }

export interface DetalheMotivos {
  titulo: string;
  total: Campo;
  /** Ordenado por valor decrescente. */
  motivos: LinhaMotivo[];
  notaFiscal?: number | null;
}
export interface DetalheRetirada { total: Campo; porLoja: { unidade: string; valor: number }[]; lancamentos: number }
export interface DetalheTroco {
  disponivel: boolean;
  nota?: string;
  informado: number | null;
  conferido: number | null;
  caixas: number;
  conferidos: number;
  divergencias: number;
  faltas: { quantidade: number; valor: number };
  sobras: { quantidade: number; valor: number };
  semConferencia: number;
}
export interface CicloQuebra { rotulo: string; inicio: string; fim: string; valor: number; quantidade: number }
export interface DetalheQuebra { total: Campo; quantidade: number; porMotivo: LinhaMotivo[]; porCiclo: CicloQuebra[] }

export interface ResumoExecutivo {
  periodo: { inicio: string; fim: string; rotulo: string };
  anterior: { inicio: string; fim: string; rotulo: string };
  totais: Total[];
  formas: FormaResumo[];
  detalhes: {
    brindes: DetalheMotivos;
    cancelamentoDelivery: DetalheMotivos;
    cancelamentoSalao: DetalheMotivos;
    compraDireta: DetalheMotivos;
    retiradaDeposito: DetalheRetirada;
    troco: DetalheTroco;
    quebra: DetalheQuebra;
  };
  /** Avisos de cobertura/limitação (nada é omitido em silêncio). */
  avisos: string[];
  /** Nenhum dado da semana em nenhuma base. */
  semNenhumDado: boolean;
}

// ───────────────────────── regras auxiliares ─────────────────────────

export function coberturaCompleta(c: CoberturaBase, j: JanelaSemana): boolean {
  return c.min !== null && c.max !== null && c.min <= j.inicio && c.max >= j.fim;
}

const ROTULO_BASE: Record<BaseId, string> = {
  faturamento: "Faturamento",
  formas: "Formas de pagamento",
  brindes: "Brindes",
  cancelamentoSalao: "Cancelamento Salão",
  cancelamentoDelivery: "Cancelamento Delivery",
  compraDireta: "Compra Direta",
  retiradaDeposito: "Retirada Depósito",
  troco: "Troco",
  quebra: "Quebra de Caixa",
};

function campo(valor: number, base: BaseId, bases: Record<BaseId, CoberturaBase>, j: JanelaSemana): Campo {
  if (coberturaCompleta(bases[base], j)) return { valor: arred(valor), status: "ok" };
  const max = bases[base].max;
  return {
    valor: null,
    status: "sem-dados",
    nota: max ? `${ROTULO_BASE[base]}: a base cobre até ${dataBR(max)}` : `${ROTULO_BASE[base]}: base sem dados`,
  };
}

export function variacaoDe(atual: number | null, anterior: number | null, melhorQuando: "maior" | "menor"): Variacao | null {
  if (atual === null || anterior === null) return null;
  const reais = arred(atual - anterior);
  const percentual = anterior !== 0 ? Math.round(((atual - anterior) / Math.abs(anterior)) * 10000) / 100 : null;
  if (Math.abs(reais) < 0.005) return { reais: 0, percentual: percentual === null ? null : 0, situacao: "estavel" };
  const subiu = reais > 0;
  const bom = melhorQuando === "maior" ? subiu : !subiu;
  return { reais, percentual, situacao: bom ? "melhorou" : "piorou" };
}

const somar = (xs: { valor: number }[]) => arred(xs.reduce((s, x) => s + x.valor, 0));

/** Agrupa por motivo (nome exatamente como gravado), soma e ordena por valor decrescente (empate: ordem alfabética). */
export function agruparPorMotivo(linhas: LinhaMotivo[]): LinhaMotivo[] {
  const mapa = new Map<string, number>();
  for (const l of linhas) mapa.set(l.motivo, (mapa.get(l.motivo) ?? 0) + l.valor);
  return [...mapa.entries()]
    .map(([motivo, valor]) => ({ motivo, valor: arred(valor) }))
    .sort((a, b) => b.valor - a.valor || a.motivo.localeCompare(b.motivo, "pt-BR"));
}

const ehNotaFiscal = (motivo: string) => motivo.trim().toUpperCase() === "NOTA FISCAL";

export const ROTULO_NOTA_FISCAL = "Nota Fiscal — ajuste sem saída de caixa";

const ROTULO_FORMA: Record<FormaId, string> = {
  credito: "Crédito",
  debito: "Débito",
  pix: "PIX",
  voucher: "Voucher",
  vendaAPrazo: "Venda a Prazo",
  online: "Online/iFood",
  dinheiro: "Dinheiro",
  outros: "Outros",
};
const ORDEM_FORMAS: FormaId[] = ["credito", "debito", "pix", "voucher", "vendaAPrazo", "online", "dinheiro", "outros"];

export function rotuloSemana(j: JanelaSemana): string {
  return `${dataBR(j.inicio)} a ${dataBR(j.fim)}`;
}

// ───────────────────────── montagem ─────────────────────────

export function montarResumoExecutivo(e: EntradaResumoExecutivo): ResumoExecutivo {
  const { bases } = e;
  const periodos: [JanelaSemana, EntradaPeriodo][] = [[e.atual, e.dadosAtual], [e.anterior, e.dadosAnterior]];
  const avisos: string[] = [];

  const brutosPorBase = (d: EntradaPeriodo): Record<BaseId, number> => ({
    faturamento: d.faturamentoTotal,
    formas: d.formas.reduce((s, f) => s + f.valor, 0),
    brindes: somar(d.brindes),
    cancelamentoSalao: somar(d.cancelamentoSalao),
    cancelamentoDelivery: somar(d.cancelamentoDelivery),
    compraDireta: somar(d.compraDireta.filter((l) => !ehNotaFiscal(l.motivo))),
    retiradaDeposito: somar(d.retiradaDeposito),
    troco: resumirTroco(d.troco.map((t) => ({ ...t, planoDeAcao: null }))).faltas.valor,
    quebra: somar(d.quebra),
  });
  const [valAtual, valAnterior] = [brutosPorBase(e.dadosAtual), brutosPorBase(e.dadosAnterior)];

  const c = (base: BaseId, p: 0 | 1): Campo => campo((p === 0 ? valAtual : valAnterior)[base], base, bases, periodos[p][0]);

  const total = (id: TotalId, rotulo: string, a: Campo, b: Campo, melhorQuando: "maior" | "menor", observacao?: string): Total => ({
    id,
    rotulo,
    atual: a,
    anterior: b,
    variacao: variacaoDe(a.valor, b.valor, melhorQuando),
    melhorQuando,
    observacao,
  });

  const salaoA = c("cancelamentoSalao", 0), salaoB = c("cancelamentoSalao", 1);
  const deliveryA = c("cancelamentoDelivery", 0), deliveryB = c("cancelamentoDelivery", 1);
  const soma2 = (x: Campo, y: Campo): Campo =>
    x.valor !== null && y.valor !== null ? { valor: arred(x.valor + y.valor), status: "ok" } : { valor: null, status: "sem-dados", nota: [x.nota, y.nota].filter(Boolean).join(" · ") };

  const totais: Total[] = [
    total("faturamento", "Faturamento total", c("faturamento", 0), c("faturamento", 1), "maior"),
    total("brindes", "Brindes", c("brindes", 0), c("brindes", 1), "menor"),
    total("cancelamentoSalao", "Cancelamento Salão", salaoA, salaoB, "menor"),
    total("cancelamentoDelivery", "Cancelamento Delivery", deliveryA, deliveryB, "menor"),
    total("cancelamentos", "Total de cancelamentos", soma2(salaoA, deliveryA), soma2(salaoB, deliveryB), "menor", "Salão + Delivery"),
    total("compraDireta", "Retirada de Compra Direta", c("compraDireta", 0), c("compraDireta", 1), "menor", "Sem Nota Fiscal (ajuste sem saída de caixa)"),
    total("retiradaDeposito", "Retirada Depósito", c("retiradaDeposito", 0), c("retiradaDeposito", 1), "menor"),
    total("troco", "Troco (faltas)", c("troco", 0), c("troco", 1), "menor", "Soma das faltas de troco conferidas"),
    total("quebra", "Quebra de Caixa", c("quebra", 0), c("quebra", 1), "menor"),
  ];

  // formas de pagamento
  const bucketsDe = (d: EntradaPeriodo): FormaPagamentoBuckets => agregarEmBuckets(d.formas);
  const bA = bucketsDe(e.dadosAtual), bB = bucketsDe(e.dadosAnterior);
  const formas: FormaResumo[] = ORDEM_FORMAS.map((id) => ({
    id,
    rotulo: ROTULO_FORMA[id],
    atual: campo(bA[id], "formas", bases, e.atual),
    anterior: campo(bB[id], "formas", bases, e.anterior),
  }));

  // detalhes por motivo
  const motivos = (titulo: string, base: BaseId, linhas: LinhaMotivo[], p: 0 | 1 = 0): DetalheMotivos => {
    const reais = base === "compraDireta" ? linhas.filter((l) => !ehNotaFiscal(l.motivo)) : linhas;
    const campoTotal = campo(somar(reais), base, bases, periodos[p][0]);
    const det: DetalheMotivos = { titulo, total: campoTotal, motivos: campoTotal.status === "ok" ? agruparPorMotivo(reais) : [] };
    if (base === "compraDireta") det.notaFiscal = campoTotal.status === "ok" ? somar(linhas.filter((l) => ehNotaFiscal(l.motivo))) : null;
    return det;
  };
  const d = e.dadosAtual;

  // retirada depósito
  const totalRet = c("retiradaDeposito", 0);
  const porLojaMapa = new Map<string, number>();
  for (const l of d.retiradaDeposito) porLojaMapa.set(l.unidade, (porLojaMapa.get(l.unidade) ?? 0) + l.valor);
  const retirada: DetalheRetirada = {
    total: totalRet,
    porLoja: totalRet.status === "ok" ? [...porLojaMapa.entries()].map(([unidade, valor]) => ({ unidade, valor: arred(valor) })).sort((a, b) => b.valor - a.valor || a.unidade.localeCompare(b.unidade, "pt-BR")) : [],
    lancamentos: totalRet.status === "ok" ? d.retiradaDeposito.length : 0,
  };

  // troco: grupos consolidados pela regra do sistema (conferido / divergência / sem valor de conferência; faltas e sobras)
  const trocoOk = coberturaCompleta(bases.troco, e.atual);
  const rt = resumirTroco(d.troco.map((t) => ({ ...t, planoDeAcao: null })));
  const troco: DetalheTroco = trocoOk
    ? {
        disponivel: true,
        informado: arred(d.troco.reduce((s, t) => s + t.informado, 0)),
        conferido: arred(d.troco.reduce((s, t) => s + t.conferido, 0)),
        caixas: rt.total,
        conferidos: rt.conferidos,
        divergencias: rt.divergencias,
        faltas: rt.faltas,
        sobras: rt.sobras,
        semConferencia: rt.semValor,
      }
    : {
        disponivel: false,
        nota: bases.troco.max ? `Troco: a base cobre até ${dataBR(bases.troco.max)}` : "Troco: base sem dados",
        informado: null,
        conferido: null,
        caixas: 0,
        conferidos: 0,
        divergencias: 0,
        faltas: { quantidade: 0, valor: 0 },
        sobras: { quantidade: 0, valor: 0 },
        semConferencia: 0,
      };

  // quebra por ciclo 16→15 (data real do lançamento)
  const totalQuebra = c("quebra", 0);
  const ciclos = new Map<string, CicloQuebra>();
  for (const q of d.quebra) {
    const ci = cicloDaData(new Date(`${q.data}T00:00:00.000Z`));
    const ini = ci.inicio.toISOString().slice(0, 10);
    const fim = ci.fim.toISOString().slice(0, 10);
    const atualC = ciclos.get(ini) ?? { rotulo: `${dm(ini)} a ${dm(fim)}`, inicio: ini, fim, valor: 0, quantidade: 0 };
    atualC.valor = arred(atualC.valor + q.valor);
    atualC.quantidade += 1;
    ciclos.set(ini, atualC);
  }
  const quebra: DetalheQuebra = {
    total: totalQuebra,
    quantidade: totalQuebra.status === "ok" ? d.quebra.length : 0,
    porMotivo: totalQuebra.status === "ok" ? agruparPorMotivo(d.quebra.map((q) => ({ motivo: q.motivo, valor: q.valor }))) : [],
    porCiclo: totalQuebra.status === "ok" ? [...ciclos.values()].sort((a, b) => a.inicio.localeCompare(b.inicio)) : [],
  };

  const resumo: ResumoExecutivo = {
    periodo: { inicio: e.atual.inicio, fim: e.atual.fim, rotulo: rotuloSemana(e.atual) },
    anterior: { inicio: e.anterior.inicio, fim: e.anterior.fim, rotulo: rotuloSemana(e.anterior) },
    totais,
    formas,
    detalhes: {
      brindes: motivos("Brindes por motivo", "brindes", d.brindes),
      cancelamentoDelivery: motivos("Cancelamento Delivery por motivo", "cancelamentoDelivery", d.cancelamentoDelivery),
      cancelamentoSalao: motivos("Cancelamento Salão por motivo", "cancelamentoSalao", d.cancelamentoSalao),
      compraDireta: motivos("Compra Direta por motivo", "compraDireta", d.compraDireta),
      retiradaDeposito: retirada,
      troco,
      quebra,
    },
    avisos,
    semNenhumDado: false,
  };

  // avisos de cobertura (período atual) — um por base indisponível
  const vistos = new Set<string>();
  const indisponiveis: Campo[] = [
    ...totais.map((t) => t.atual),
    formas[0].atual,
  ];
  for (const cmp of indisponiveis) if (cmp.status === "sem-dados" && cmp.nota && !vistos.has(cmp.nota)) { vistos.add(cmp.nota); avisos.push(`${cmp.nota} — não exibido para não mostrar zero onde não há dado.`); }
  if (!troco.disponivel && troco.nota && !vistos.has(troco.nota)) avisos.push(`${troco.nota} — não exibido para não mostrar zero onde não há dado.`);
  resumo.semNenhumDado = totais.every((t) => t.atual.status === "sem-dados") && formas.every((f) => f.atual.status === "sem-dados");
  return resumo;
}

// ───────────────────────── texto para WhatsApp ─────────────────────────

function textoVariacao(t: Total): string {
  const v = t.variacao;
  if (!v) return "";
  const seta = v.reais > 0 ? "▲" : v.reais < 0 ? "▼" : "=";
  const pct = v.percentual === null ? "" : ` (${v.percentual > 0 ? "+" : ""}${fmtPct.format(v.percentual)}%)`;
  const sinal = v.reais > 0 ? "+" : v.reais < 0 ? "-" : "";
  return ` ${seta} ${sinal}${moedaBR(Math.abs(v.reais))}${pct}`;
}
const valorOuSem = (c: Campo) => (c.valor === null ? "Sem dados" : moedaBR(c.valor));

const LIMITE_LINHAS_TEXTO = 15;
function linhasMotivos(motivos: LinhaMotivo[], vazio = "Sem lançamentos na semana"): string[] {
  if (motivos.length === 0) return [`- ${vazio}`];
  const visiveis = motivos.slice(0, LIMITE_LINHAS_TEXTO).map((m) => `- ${m.motivo}: ${moedaBR(m.valor)}`);
  const resto = motivos.slice(LIMITE_LINHAS_TEXTO);
  if (resto.length > 0) visiveis.push(`- Demais ${resto.length} motivos: ${moedaBR(somar(resto))}`);
  return visiveis;
}

/** Texto pronto para copiar/colar no WhatsApp (mesmos dados da tela e da imagem). */
export function textoWhatsappSemanal(r: ResumoExecutivo): string {
  const t = (id: TotalId) => r.totais.find((x) => x.id === id)!;
  const linhaTotal = (icone: string, id: TotalId, rotulo?: string) => `${icone} ${rotulo ?? t(id).rotulo}: *${valorOuSem(t(id).atual)}*${textoVariacao(t(id))}`;
  const det = r.detalhes;
  const secaoMotivos = (icone: string, d: DetalheMotivos): string[] => [
    "",
    `${icone} *${d.titulo}* · ${valorOuSem(d.total)}`,
    ...(d.total.status === "ok" ? linhasMotivos(d.motivos) : ["- Sem dados da base neste período"]),
  ];

  const linhas: string[] = [
    "📊 *RESUMO SEMANAL EXECUTIVO — GRUPO LONDRINO*",
    `📅 Semana: ${r.periodo.rotulo} (segunda a domingo)`,
    `↔️ Comparação com a semana anterior: ${r.anterior.rotulo}`,
    "",
    linhaTotal("💰", "faturamento"),
    linhaTotal("🎁", "brindes"),
    linhaTotal("❌", "cancelamentoSalao", "Cancelamento Salão"),
    linhaTotal("❌", "cancelamentoDelivery", "Cancelamento Delivery"),
    linhaTotal("❌", "cancelamentos", "Total de cancelamentos"),
    linhaTotal("📌", "compraDireta", "Retirada Compra Direta"),
    linhaTotal("🏦", "retiradaDeposito", "Retirada Depósito"),
    linhaTotal("🪙", "troco", "Troco (faltas)"),
    linhaTotal("⚠️", "quebra", "Quebra de Caixa"),
    "",
    "💳 *Formas de pagamento*",
  ];
  const fp = r.formas.filter((f) => f.atual.status !== "ok" || ["credito", "debito", "pix", "voucher", "vendaAPrazo", "online"].includes(f.id) || (f.atual.valor ?? 0) > 0.005);
  if (r.formas[0].atual.status !== "ok") linhas.push(`- Sem dados no período (${r.formas[0].atual.nota ?? "base sem dados"}).`);
  else for (const f of fp) linhas.push(`- ${f.rotulo}: ${moedaBR(f.atual.valor ?? 0)}`);

  linhas.push(...secaoMotivos("🎁", det.brindes));
  linhas.push(...secaoMotivos("❌", det.cancelamentoDelivery));
  linhas.push(...secaoMotivos("❌", det.cancelamentoSalao));
  linhas.push(...secaoMotivos("📌", det.compraDireta));
  if (det.compraDireta.notaFiscal) linhas.push(`- ${ROTULO_NOTA_FISCAL} (fora do total): ${moedaBR(det.compraDireta.notaFiscal)}`);

  linhas.push("", `🏦 *Retirada Depósito* · ${valorOuSem(det.retiradaDeposito.total)}`);
  if (det.retiradaDeposito.total.status !== "ok") linhas.push("- Sem dados da base neste período");
  else if (det.retiradaDeposito.porLoja.length === 0) linhas.push("- Sem lançamentos na semana");
  else for (const l of det.retiradaDeposito.porLoja.slice(0, LIMITE_LINHAS_TEXTO)) linhas.push(`- ${l.unidade}: ${moedaBR(l.valor)}`);
  if (det.retiradaDeposito.porLoja.length > LIMITE_LINHAS_TEXTO) linhas.push(`- Demais ${det.retiradaDeposito.porLoja.length - LIMITE_LINHAS_TEXTO} lojas: ${moedaBR(somar(det.retiradaDeposito.porLoja.slice(LIMITE_LINHAS_TEXTO)))}`);

  linhas.push("", `🪙 *Troco*`);
  const tr = det.troco;
  if (!tr.disponivel) linhas.push(`- Sem dados no período (${tr.nota ?? "base sem dados"}).`);
  else {
    linhas.push(`- Caixas: ${tr.caixas} · conferidos ${tr.conferidos} · com divergência ${tr.divergencias} · sem valor de conferência ${tr.semConferencia}`);
    linhas.push(`- Faltas: ${tr.faltas.quantidade} (${moedaBR(tr.faltas.valor)}) · Sobras: ${tr.sobras.quantidade} (${moedaBR(tr.sobras.valor)})`);
    linhas.push(`- Informado: ${moedaBR(tr.informado ?? 0)} · Conferido: ${moedaBR(tr.conferido ?? 0)}`);
  }

  linhas.push("", `⚠️ *Quebra de Caixa* · ${valorOuSem(det.quebra.total)}`);
  if (det.quebra.total.status !== "ok") linhas.push("- Sem dados da base neste período");
  else if (det.quebra.quantidade === 0) linhas.push("- Sem lançamentos na semana");
  else {
    linhas.push(`- ${det.quebra.quantidade} ${det.quebra.quantidade === 1 ? "lançamento" : "lançamentos"}`);
    if (det.quebra.porCiclo.length > 1) for (const ci of det.quebra.porCiclo) linhas.push(`- Ciclo ${ci.rotulo}: ${moedaBR(ci.valor)} (${ci.quantidade})`);
    linhas.push(...linhasMotivos(det.quebra.porMotivo));
  }

  if (r.avisos.length > 0) linhas.push("", ...r.avisos.map((a) => `ℹ️ ${a}`));
  linhas.push("", "— Gestão Ragga · Financeiro");
  return linhas.join("\n");
}

// ───────────────────────── modelo da imagem ─────────────────────────

export type TomVariacao = "bom" | "ruim" | "neutro";
export interface CartaoImagem { rotulo: string; valor: string; semDados: boolean; variacao: string; tom: TomVariacao; observacao?: string }
export interface LinhaImagem { texto: string; valor?: string; destaque?: boolean }
export interface SecaoImagem { titulo: string; total?: string; linhas: LinhaImagem[]; nota?: string }
export interface ModeloImagem {
  titulo: string;
  grupo: string;
  periodo: string;
  comparacao: string;
  cartoes: CartaoImagem[];
  formas: { rotulo: string; valor: string; semDados: boolean }[];
  notaFormas?: string;
  secoes: SecaoImagem[];
  avisos: string[];
}

function variacaoCurta(t: Total): { texto: string; tom: TomVariacao } {
  const v = t.variacao;
  if (!v) return { texto: t.anterior.status === "sem-dados" ? "sem semana anterior" : "—", tom: "neutro" };
  const seta = v.reais > 0 ? "▲" : v.reais < 0 ? "▼" : "=";
  const pct = v.percentual === null ? "" : ` ${v.percentual > 0 ? "+" : ""}${fmtPct.format(v.percentual)}%`;
  const sinal = v.reais > 0 ? "+" : v.reais < 0 ? "-" : "";
  return { texto: `${seta} ${sinal}${moedaBR(Math.abs(v.reais))}${pct}`, tom: v.situacao === "melhorou" ? "bom" : v.situacao === "piorou" ? "ruim" : "neutro" };
}

/** Limite de linhas por seção na imagem; o excedente é somado em "Demais n" (nunca cortado em silêncio). */
export const LIMITE_LINHAS_IMAGEM = 10;
function linhasImagem(motivos: LinhaMotivo[], vazio: string): LinhaImagem[] {
  if (motivos.length === 0) return [{ texto: vazio }];
  const vis = motivos.slice(0, LIMITE_LINHAS_IMAGEM).map((m) => ({ texto: m.motivo, valor: moedaBR(m.valor) }));
  const resto = motivos.slice(LIMITE_LINHAS_IMAGEM);
  if (resto.length > 0) vis.push({ texto: `Demais ${resto.length} motivos`, valor: moedaBR(somar(resto)) });
  return vis;
}

export function modeloDaImagem(r: ResumoExecutivo): ModeloImagem {
  const det = r.detalhes;
  const ORDEM_CARTOES: TotalId[] = ["faturamento", "brindes", "quebra", "cancelamentoSalao", "cancelamentoDelivery", "cancelamentos", "compraDireta", "retiradaDeposito", "troco"];
  const cartoes: CartaoImagem[] = ORDEM_CARTOES.map((id) => r.totais.find((x) => x.id === id)!).map((t) => {
    const v = variacaoCurta(t);
    return { rotulo: t.rotulo, valor: valorOuSem(t.atual), semDados: t.atual.status === "sem-dados", variacao: t.atual.status === "ok" ? v.texto : "", tom: v.tom, observacao: t.observacao };
  });
  const formasSemDados = r.formas[0].atual.status !== "ok";
  const formas = r.formas
    .filter((f) => ["credito", "debito", "pix", "voucher", "vendaAPrazo", "online"].includes(f.id) || (f.atual.valor ?? 0) > 0.005)
    .map((f) => ({ rotulo: f.rotulo, valor: valorOuSem(f.atual), semDados: f.atual.status !== "ok" }));

  const secMotivos = (d: DetalheMotivos): SecaoImagem => ({
    titulo: d.titulo,
    total: valorOuSem(d.total),
    linhas: d.total.status === "ok" ? linhasImagem(d.motivos, "Sem lançamentos na semana") : [{ texto: "Sem dados da base neste período" }],
    nota: d.notaFiscal ? `${ROTULO_NOTA_FISCAL}: ${moedaBR(d.notaFiscal)} (fora do total)` : undefined,
  });

  const retirada: SecaoImagem = {
    titulo: "Retirada Depósito por loja",
    total: valorOuSem(det.retiradaDeposito.total),
    linhas:
      det.retiradaDeposito.total.status !== "ok"
        ? [{ texto: "Sem dados da base neste período" }]
        : det.retiradaDeposito.porLoja.length === 0
          ? [{ texto: "Sem lançamentos na semana" }]
          : linhasImagem(det.retiradaDeposito.porLoja.map((l) => ({ motivo: l.unidade, valor: l.valor })), ""),
  };

  const tr = det.troco;
  const troco: SecaoImagem = {
    titulo: "Troco",
    total: tr.disponivel ? moedaBR(tr.faltas.valor) + " em faltas" : "Sem dados",
    linhas: !tr.disponivel
      ? [{ texto: tr.nota ?? "Base sem dados" }]
      : [
          { texto: `Caixas conferidos`, valor: String(tr.conferidos) },
          { texto: `Com divergência`, valor: String(tr.divergencias) },
          { texto: `Sem valor de conferência`, valor: String(tr.semConferencia) },
          { texto: `Faltas (${tr.faltas.quantidade})`, valor: moedaBR(tr.faltas.valor) },
          { texto: `Sobras (${tr.sobras.quantidade})`, valor: moedaBR(tr.sobras.valor) },
        ],
  };

  const q = det.quebra;
  const quebra: SecaoImagem = {
    titulo: "Quebra de Caixa (ciclo 16 a 15)",
    total: valorOuSem(q.total),
    linhas:
      q.total.status !== "ok"
        ? [{ texto: "Sem dados da base neste período" }]
        : q.quantidade === 0
          ? [{ texto: "Sem lançamentos na semana" }]
          : [
              ...(q.porCiclo.length > 1 ? q.porCiclo.map((ci) => ({ texto: `Ciclo ${ci.rotulo} (${ci.quantidade})`, valor: moedaBR(ci.valor), destaque: true })) : []),
              ...linhasImagem(q.porMotivo, ""),
            ],
    nota: q.total.status === "ok" && q.quantidade > 0 ? `${q.quantidade} ${q.quantidade === 1 ? "lançamento" : "lançamentos"}` : undefined,
  };

  return {
    titulo: "RESUMO SEMANAL EXECUTIVO",
    grupo: "Grupo Londrino",
    periodo: `Semana de ${r.periodo.rotulo}`,
    comparacao: `vs. semana anterior (${r.anterior.rotulo})`,
    cartoes,
    formas,
    notaFormas: formasSemDados ? `${r.formas[0].atual.nota ?? "Base sem dados"} — não exibido para não mostrar zero onde não há dado.` : undefined,
    secoes: [secMotivos(det.brindes), secMotivos(det.cancelamentoDelivery), secMotivos(det.cancelamentoSalao), secMotivos(det.compraDireta), retirada, troco, quebra],
    avisos: r.avisos,
  };
}
