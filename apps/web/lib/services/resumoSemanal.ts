import { UNIDADES } from "@painel/shared";
import { agregarQuebra, type LinhaQuebraBruta } from "@/lib/services/quebraPainel";
import { montarPeriodoBrindes, type LinhaBrindeDia } from "@/lib/services/brindesPainel";
import { montarPeriodoCancelamento } from "@/lib/services/cancelamentoPainel";
import { diasDoIntervalo, montarPeriodoCompraDireta, type LinhaCompraDiretaDia, type LinhaFaturamentoDia } from "@/lib/services/compraDiretaPainel";
import { semanaRealDoPeriodo } from "@/lib/rules/datas";

/**
 * Resumo Semanal Executivo — módulo PURO (sem banco). Só COMPÕE os agregadores já existentes dos painéis:
 * `montarPeriodoBrindes` (controláveis × não controláveis via `classificarBrinde`), `montarPeriodoCancelamento`
 * (salão e delivery), `montarPeriodoCompraDireta` (NOTA FISCAL fica fora da saída real de caixa) e `agregarQuebra`.
 * Nenhuma regra de negócio nova e nenhum limite novo: melhorou/piorou/estável segue a regra de cada indicador
 * (menor = melhorou) e, quando há faturamento válido nos dois períodos, a decisão é pelo % sobre o faturamento
 * (nunca só pelo valor absoluto).
 *
 * Semana = segunda a domingo COMPLETOS, em datas de OCORRÊNCIA exatas (sem deslocamento D-1/D-2): a semana
 * "28/09 a 04/10" soma exatamente os registros desses sete dias. Semana incompleta nunca é oferecida nem aceita.
 *
 * Dados ausentes NUNCA viram zero: se a base de um indicador não cobre o período por inteiro, o valor é `null` e
 * a tela mostra o aviso. Um dia sem linha numa base que cobre o período é "sem ocorrência" (mesma premissa dos
 * painéis existentes).
 */

export type IndicadorId = "brindes" | "cancelamentos" | "compraDireta" | "quebra";

export const ROTULO_INDICADOR: Record<IndicadorId, string> = {
  brindes: "Brindes",
  cancelamentos: "Cancelamentos (salão + delivery)",
  compraDireta: "Retirada de Compra Direta",
  quebra: "Quebra de Caixa",
};

export const ORDEM_INDICADORES: IndicadorId[] = ["brindes", "cancelamentos", "compraDireta", "quebra"];

/** Quantidade de lojas destacadas em cada critério da área de atenção (ranking, não é limite financeiro). */
export const TOP_ATENCAO = 3;
export const MAX_SEMANAS = 8;

// ───────────────────────── Datas (todas AAAA-MM-DD, UTC) ─────────────────────────

const paraData = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
export const isoDe = (d: Date) => d.toISOString().slice(0, 10);

export function somarDias(iso: string, dias: number): string {
  const d = paraData(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return isoDe(d);
}

const ISO_VALIDO = /^\d{4}-\d{2}-\d{2}$/;
function dataIsoValida(iso: string): boolean {
  return ISO_VALIDO.test(iso) && isoDe(paraData(iso)) === iso;
}

/** Data de hoje no fuso do negócio (America/Sao_Paulo), em AAAA-MM-DD — independe do fuso do servidor. */
export function hojeNegocio(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

export interface Janela {
  /** Segunda-feira (AAAA-MM-DD). */
  inicio: string;
  /** Domingo (AAAA-MM-DD). */
  fim: string;
}

/** Última semana COMPLETA: a semana real que contém "hoje" está em andamento, então vale a anterior a ela. */
export function ultimaSemanaCompleta(hoje: string): Janela {
  const segundaAtual = isoDe(semanaRealDoPeriodo(paraData(hoje)).inicio);
  const inicio = somarDias(segundaAtual, -7);
  return { inicio, fim: somarDias(inicio, 6) };
}

/** Semanas completas disponíveis, da mais recente para a mais antiga. */
export function semanasDisponiveis(hoje: string, quantidade = 26): Janela[] {
  const ultima = ultimaSemanaCompleta(hoje);
  return Array.from({ length: quantidade }, (_, i) => {
    const inicio = somarDias(ultima.inicio, -7 * i);
    return { inicio, fim: somarDias(inicio, 6) };
  });
}

/** Janela de `semanas` semanas inteiras terminando na semana que começa em `segundaFinal`. */
export function janelaDeSemanas(segundaFinal: string, semanas: number): Janela {
  return { inicio: somarDias(segundaFinal, -7 * (semanas - 1)), fim: somarDias(segundaFinal, 6) };
}

export const numeroDeDias = (j: Janela) => diasDoIntervalo(j.inicio, j.fim).length;

/** Período imediatamente anterior, de MESMA duração, terminando na véspera do início (nunca sobrepõe o atual). */
export function janelaAnterior(j: Janela): Janela {
  const dias = numeroDeDias(j);
  return { inicio: somarDias(j.inicio, -dias), fim: somarDias(j.inicio, -1) };
}

/** `null` = válida; caso contrário, o motivo da recusa. Garante segunda→domingo, só semanas fechadas e N semanas inteiras. */
export function validarJanela(j: Janela, hoje: string): string | null {
  if (!dataIsoValida(j.inicio) || !dataIsoValida(j.fim)) return "Datas inválidas.";
  if (paraData(j.inicio).getUTCDay() !== 1) return "A semana deve começar na segunda-feira.";
  if (paraData(j.fim).getUTCDay() !== 0) return "A semana deve terminar no domingo.";
  const dias = numeroDeDias(j);
  if (dias < 7 || dias % 7 !== 0) return "O período deve ter semanas completas (segunda a domingo).";
  if (dias / 7 > MAX_SEMANAS) return `O período deve ter no máximo ${MAX_SEMANAS} semanas.`;
  if (j.fim > ultimaSemanaCompleta(hoje).fim) return "A semana selecionada ainda não terminou: só semanas completas podem ser analisadas.";
  return null;
}

export function validarPar(atual: Janela, comparacao: Janela, hoje: string): string | null {
  const a = validarJanela(atual, hoje);
  if (a) return a;
  const c = validarJanela(comparacao, hoje);
  if (c) return `Período de comparação: ${c}`;
  if (numeroDeDias(atual) !== numeroDeDias(comparacao)) return "Os dois períodos devem ter a mesma duração.";
  if (!(comparacao.fim < atual.inicio || comparacao.inicio > atual.fim)) return "Os períodos não podem se sobrepor.";
  return null;
}

// ───────────────────────── Cobertura de dados ─────────────────────────

export type StatusCobertura = "completa" | "parcial" | "sem-dados";

export interface BaseCobertura {
  /** Menor e maior data de ocorrência existentes na base (todas as importações). */
  min: string | null;
  max: string | null;
}

/** A base cobre o período por inteiro quando começa até o início e vai até o fim (ou além). */
export function coberturaDaBase(base: BaseCobertura, j: Janela): StatusCobertura {
  if (!base.min || !base.max) return "sem-dados";
  if (base.max < j.inicio || base.min > j.fim) return "sem-dados";
  return base.min <= j.inicio && base.max >= j.fim ? "completa" : "parcial";
}

/** Faturamento (denominador): completo = há registro em TODOS os dias do período. */
export function coberturaFaturamento(datasComFaturamento: Iterable<string>, j: Janela): StatusCobertura {
  const dias = diasDoIntervalo(j.inicio, j.fim);
  const tem = new Set(datasComFaturamento);
  const n = dias.filter((d) => tem.has(d)).length;
  return n === 0 ? "sem-dados" : n === dias.length ? "completa" : "parcial";
}

// ───────────────────────── Comparação ─────────────────────────

export type SituacaoSemanal = "melhorou" | "piorou" | "estavel" | "sem-ocorrencia" | "sem-base";

export const ROTULO_SITUACAO: Record<SituacaoSemanal, string> = {
  melhorou: "Melhorou",
  piorou: "Piorou",
  estavel: "Estável",
  "sem-ocorrencia": "Sem ocorrência",
  "sem-base": "Sem base de comparação",
};

const centavos = (v: number) => Math.round(v * 100);

/**
 * Menor = melhorou para os quatro indicadores. Com % válido nos dois períodos decide pelo % sobre o faturamento
 * (2 casas, como a Quebra); sem ele, pelo valor em R$ (centavos). `null` em qualquer ponta = sem base.
 */
export function situacaoSemanal(e: {
  valorAtual: number | null;
  valorAnterior: number | null;
  percentualAtual: number | null;
  percentualAnterior: number | null;
}): { situacao: SituacaoSemanal; base: "percentual" | "valor" | null } {
  if (e.valorAtual === null || e.valorAnterior === null) return { situacao: "sem-base", base: null };
  if (centavos(e.valorAtual) === 0 && centavos(e.valorAnterior) === 0) return { situacao: "sem-ocorrencia", base: null };
  const usaPercentual = e.percentualAtual !== null && e.percentualAnterior !== null;
  const a = centavos(usaPercentual ? e.percentualAtual! : e.valorAtual);
  const c = centavos(usaPercentual ? e.percentualAnterior! : e.valorAnterior);
  const base = usaPercentual ? "percentual" : "valor";
  if (a === c) return { situacao: "estavel", base };
  return { situacao: a < c ? "melhorou" : "piorou", base };
}

// ───────────────────────── Estruturas de saída ─────────────────────────

export interface DetalheIndicador {
  rotulo: string;
  valor: number;
  /** true = informativo e FORA do valor principal (ex.: NOTA FISCAL na Compra Direta). */
  foraDoTotal?: boolean;
}

export interface CelulaPeriodo {
  /** `null` = sem dado válido (base não cobre o período) — nunca zero. */
  valor: number | null;
  /** Valor que decide a situação (Brindes: só controláveis, regra existente; demais = valor). */
  valorDecisivo: number | null;
  faturamento: number | null;
  /** valorDecisivo ÷ faturamento × 100 (a métrica que define a situação); `null` sem faturamento válido. */
  percentual: number | null;
  /** valor total ÷ faturamento × 100 (igual a `percentual`, exceto em Brindes, onde `percentual` = só controláveis). */
  percentualTotal: number | null;
  detalhes: DetalheIndicador[];
}

export interface Variacao {
  situacao: SituacaoSemanal;
  /** Em que métrica a situação foi decidida. */
  base: "percentual" | "valor" | null;
  variacaoReais: number | null;
  /** (atual − anterior) ÷ anterior × 100; `null` quando o anterior é zero ou não existe. */
  variacaoPercentual: number | null;
  /** Variação do % sobre o faturamento, em pontos percentuais; `null` sem % nos dois períodos. */
  variacaoPp: number | null;
}

export interface LojaIndicador extends Variacao {
  unidade: string;
  /** true = a loja tem faturamento em menos dias que o período em ao menos um dos dois: sem % nem situação (R$ preservado). */
  coberturaParcial: boolean;
  atual: CelulaPeriodo;
  anterior: CelulaPeriodo;
}

export interface IndicadorSemanal extends Variacao {
  id: IndicadorId;
  rotulo: string;
  atual: CelulaPeriodo;
  anterior: CelulaPeriodo;
  coberturaAtual: StatusCobertura;
  coberturaAnterior: StatusCobertura;
  porLoja: LojaIndicador[];
  /** Só Quebra: dias do período sem NENHUM registro (lidos como "sem ocorrência"; a importação completa não é verificável). */
  diasSemRegistro?: { atual: number; anterior: number; dias: number };
}

export type MotivoAtencao = "maior-percentual" | "maior-valor" | "piora";

export interface PontoAtencao {
  indicador: IndicadorId;
  motivo: MotivoAtencao;
  /** Posição no ranking do critério (1 = pior). */
  posicao: number;
}

export interface LojaResumo {
  unidade: string;
  porIndicador: Record<IndicadorId, LojaIndicador | null>;
  atencao: PontoAtencao[];
}

export interface AvisoCobertura {
  indicador: IndicadorId | "faturamento";
  periodo: "atual" | "comparacao";
  status: Exclude<StatusCobertura, "completa">;
  mensagem: string;
}

export interface AvisoLojaParcial {
  unidade: string;
  periodo: "atual" | "comparacao";
  diasComFaturamento: number;
  dias: number;
}

export interface ResumoSemanal {
  atual: Janela;
  comparacao: Janela;
  semanas: number;
  indicadores: IndicadorSemanal[];
  lojas: LojaResumo[];
  avisos: AvisoCobertura[];
  /** Lojas com faturamento em menos dias que o período: excluídas dos rankings proporcionais (valores absolutos mantidos). */
  avisosLojas: AvisoLojaParcial[];
  coberturaFaturamento: { atual: StatusCobertura; comparacao: StatusCobertura };
}

export interface LinhaQuebraDia extends LinhaQuebraBruta {
  data: string;
}

export interface EntradaResumoSemanal {
  atual: Janela;
  comparacao: Janela;
  faturamento: LinhaFaturamentoDia[];
  brindes: LinhaBrindeDia[];
  cancelamentoSalao: LinhaCompraDiretaDia[];
  cancelamentoDelivery: LinhaCompraDiretaDia[];
  compraDireta: LinhaCompraDiretaDia[];
  quebra: LinhaQuebraDia[];
  /** min/max de data de cada base inteira (não só da janela). */
  bases: Record<Exclude<IndicadorId, "cancelamentos"> | "cancelamentoSalao" | "cancelamentoDelivery" | "faturamento", BaseCobertura>;
}

// ───────────────────────── Montagem ─────────────────────────

const arred = (v: number) => Math.round(v * 100) / 100;
const noJanela = <T extends { data: string }>(linhas: T[], j: Janela) => linhas.filter((l) => l.data >= j.inicio && l.data <= j.fim);

interface BrutoLoja {
  valor: number;
  valorDecisivo: number;
  detalhes: DetalheIndicador[];
}

const SEM_DADO: CelulaPeriodo = { valor: null, valorDecisivo: null, faturamento: null, percentual: null, percentualTotal: null, detalhes: [] };

function celula(bruto: BrutoLoja | null, faturamento: number | null, faturamentoValido: boolean): CelulaPeriodo {
  if (!bruto) return { ...SEM_DADO, faturamento: faturamentoValido ? faturamento : null };
  const fat = faturamentoValido && faturamento !== null && faturamento > 0 ? faturamento : null;
  return {
    valor: arred(bruto.valor),
    valorDecisivo: arred(bruto.valorDecisivo),
    faturamento: faturamentoValido ? faturamento : null,
    percentual: fat !== null ? (bruto.valorDecisivo / fat) * 100 : null,
    percentualTotal: fat !== null ? (bruto.valor / fat) * 100 : null,
    detalhes: bruto.detalhes.map((d) => ({ ...d, valor: arred(d.valor) })),
  };
}

function variacao(atual: CelulaPeriodo, anterior: CelulaPeriodo): Variacao {
  const { situacao, base } = situacaoSemanal({
    valorAtual: atual.valorDecisivo,
    valorAnterior: anterior.valorDecisivo,
    percentualAtual: atual.percentual,
    percentualAnterior: anterior.percentual,
  });
  const delta = atual.valor !== null && anterior.valor !== null ? arred(atual.valor - anterior.valor) : null;
  return {
    situacao,
    base,
    variacaoReais: delta,
    variacaoPercentual: delta !== null && anterior.valor !== null && centavos(anterior.valor) !== 0 ? (delta / anterior.valor) * 100 : null,
    variacaoPp: atual.percentual !== null && anterior.percentual !== null ? atual.percentual - anterior.percentual : null,
  };
}

function somar(a: BrutoLoja | undefined, b: BrutoLoja | undefined, detalhes: DetalheIndicador[] = []): BrutoLoja {
  return { valor: (a?.valor ?? 0) + (b?.valor ?? 0), valorDecisivo: (a?.valorDecisivo ?? 0) + (b?.valorDecisivo ?? 0), detalhes };
}

/** Valores por loja de UM indicador em UM período, reutilizando o agregador existente do painel correspondente. */
function brutoPorLoja(id: IndicadorId, e: EntradaResumoSemanal, j: Janela, fat: LinhaFaturamentoDia[], fatPorLoja: Record<string, number>): Map<string, BrutoLoja> {
  const mapa = new Map<string, BrutoLoja>();
  if (id === "brindes") {
    const p = montarPeriodoBrindes(j.inicio, j.fim, fat, noJanela(e.brindes, j));
    for (const l of p.porLoja) {
      mapa.set(l.unidade, {
        valor: l.total,
        valorDecisivo: l.controlaveis,
        detalhes: [
          { rotulo: "Controláveis", valor: l.controlaveis },
          { rotulo: "Não controláveis", valor: l.naoControlaveis },
        ],
      });
    }
  } else if (id === "cancelamentos") {
    const s = montarPeriodoCancelamento(j.inicio, j.fim, fat, noJanela(e.cancelamentoSalao, j));
    const d = montarPeriodoCancelamento(j.inicio, j.fim, fat, noJanela(e.cancelamentoDelivery, j));
    const codigos = new Set([...s.porLoja.map((l) => l.unidade), ...d.porLoja.map((l) => l.unidade)]);
    for (const u of codigos) {
      const vs = s.porLoja.find((l) => l.unidade === u)?.valor ?? 0;
      const vd = d.porLoja.find((l) => l.unidade === u)?.valor ?? 0;
      mapa.set(u, { valor: vs + vd, valorDecisivo: vs + vd, detalhes: [{ rotulo: "Salão", valor: vs }, { rotulo: "Delivery", valor: vd }] });
    }
  } else if (id === "compraDireta") {
    const p = montarPeriodoCompraDireta(j.inicio, j.fim, fat, noJanela(e.compraDireta, j));
    for (const l of p.porLoja) {
      mapa.set(l.unidade, {
        valor: l.valor,
        valorDecisivo: l.valor,
        detalhes: [{ rotulo: "Nota Fiscal (ajuste sem saída de caixa)", valor: l.ajustesSemSaida, foraDoTotal: true }],
      });
    }
  } else {
    const p = agregarQuebra(noJanela(e.quebra, j), fatPorLoja);
    for (const l of p.porLoja) mapa.set(l.unidade, { valor: l.valor, valorDecisivo: l.valor, detalhes: [{ rotulo: "Ocorrências", valor: l.quantidade }] });
  }
  return mapa;
}

function somarDetalhes(brutos: Iterable<BrutoLoja>): DetalheIndicador[] {
  const mapa = new Map<string, DetalheIndicador>();
  for (const b of brutos) {
    for (const d of b.detalhes) {
      const a = mapa.get(d.rotulo);
      mapa.set(d.rotulo, { ...d, valor: (a?.valor ?? 0) + d.valor });
    }
  }
  return [...mapa.values()];
}

export function montarResumoSemanal(e: EntradaResumoSemanal): ResumoSemanal {
  const periodos = { atual: e.atual, comparacao: e.comparacao } as const;
  const fatDe = (j: Janela) => noJanela(e.faturamento, j);
  const fatPorLojaDe = (linhas: LinhaFaturamentoDia[]) => {
    const r: Record<string, number> = {};
    for (const l of linhas) r[l.codigo] = (r[l.codigo] ?? 0) + l.valor;
    return r;
  };

  const fatLinhas = { atual: fatDe(e.atual), comparacao: fatDe(e.comparacao) };
  const fatLoja = { atual: fatPorLojaDe(fatLinhas.atual), comparacao: fatPorLojaDe(fatLinhas.comparacao) };
  const fatRede = {
    atual: Object.values(fatLoja.atual).reduce((s, v) => s + v, 0),
    comparacao: Object.values(fatLoja.comparacao).reduce((s, v) => s + v, 0),
  };
  const diasPeriodo = { atual: numeroDeDias(e.atual), comparacao: numeroDeDias(e.comparacao) };
  const diasFatLoja = (linhas: LinhaFaturamentoDia[]) => {
    const m = new Map<string, Set<string>>();
    for (const l of linhas) m.set(l.codigo, (m.get(l.codigo) ?? new Set()).add(l.data));
    return m;
  };
  const diasLoja = { atual: diasFatLoja(fatLinhas.atual), comparacao: diasFatLoja(fatLinhas.comparacao) };
  const lojaParcial = (p: "atual" | "comparacao", u: string) => {
    const n = diasLoja[p].get(u)?.size ?? 0;
    return n > 0 && n < diasPeriodo[p];
  };
  const covFat = {
    atual: coberturaFaturamento(fatLinhas.atual.map((l) => l.data), e.atual),
    comparacao: coberturaFaturamento(fatLinhas.comparacao.map((l) => l.data), e.comparacao),
  };

  const avisos: AvisoCobertura[] = [];
  for (const p of ["atual", "comparacao"] as const) {
    if (covFat[p] !== "completa") {
      avisos.push({
        indicador: "faturamento",
        periodo: p,
        status: covFat[p],
        mensagem:
          covFat[p] === "sem-dados"
            ? "Sem faturamento no período: os percentuais sobre o faturamento não são calculados."
            : "Faturamento incompleto no período: os percentuais sobre o faturamento não são calculados.",
      });
    }
  }

  const indicadores: IndicadorSemanal[] = ORDEM_INDICADORES.map((id) => {
    const cobertura = (p: "atual" | "comparacao"): StatusCobertura => {
      const j = periodos[p];
      if (id === "cancelamentos") {
        const s = coberturaDaBase(e.bases.cancelamentoSalao, j);
        const d = coberturaDaBase(e.bases.cancelamentoDelivery, j);
        return s === "completa" && d === "completa" ? "completa" : s === "sem-dados" && d === "sem-dados" ? "sem-dados" : "parcial";
      }
      return coberturaDaBase(e.bases[id], j);
    };
    const cov = { atual: cobertura("atual"), comparacao: cobertura("comparacao") };
    for (const p of ["atual", "comparacao"] as const) {
      if (cov[p] !== "completa") {
        avisos.push({
          indicador: id,
          periodo: p,
          status: cov[p],
          mensagem:
            cov[p] === "sem-dados"
              ? `${ROTULO_INDICADOR[id]}: a base não tem dados neste período.`
              : `${ROTULO_INDICADOR[id]}: a base cobre só parte deste período — resultado não exibido para não induzir a erro.`,
        });
      }
    }

    const brutos = {
      atual: cov.atual === "completa" ? brutoPorLoja(id, e, e.atual, fatLinhas.atual, fatLoja.atual) : null,
      comparacao: cov.comparacao === "completa" ? brutoPorLoja(id, e, e.comparacao, fatLinhas.comparacao, fatLoja.comparacao) : null,
    };

    const celulaRede = (p: "atual" | "comparacao"): CelulaPeriodo => {
      const mapa = brutos[p];
      if (!mapa) return { ...SEM_DADO };
      const lista = [...mapa.values()];
      const total = somar(undefined, undefined, somarDetalhes(lista));
      total.valor = lista.reduce((s, b) => s + b.valor, 0);
      total.valorDecisivo = lista.reduce((s, b) => s + b.valorDecisivo, 0);
      return celula(total, fatRede[p], covFat[p] === "completa");
    };
    const atual = celulaRede("atual");
    const anterior = celulaRede("comparacao");

    const codigos = new Set<string>([
      ...(brutos.atual?.keys() ?? []),
      ...(brutos.comparacao?.keys() ?? []),
      ...Object.keys(fatLoja.atual),
      ...Object.keys(fatLoja.comparacao),
    ]);
    const porLoja: LojaIndicador[] = UNIDADES.filter((u) => codigos.has(u)).map((unidade) => {
      const celulaLoja = (p: "atual" | "comparacao") => {
        const mapa = brutos[p];
        if (!mapa) return { ...SEM_DADO };
        // Base cobre o período e a loja não tem linha: sem ocorrência (zero real), não ausência de dado.
        return celula(mapa.get(unidade) ?? { valor: 0, valorDecisivo: 0, detalhes: [] }, fatLoja[p][unidade] ?? 0, covFat[p] === "completa" && !lojaParcial(p, unidade));
      };
      const a = celulaLoja("atual");
      const c = celulaLoja("comparacao");
      const v = variacao(a, c);
      // Loja sem faturamento próprio em um dos períodos (com o faturamento da rede completo) não tem base comparável:
      // não é classificada como melhora/piora.
      const semBaseLoja = covFat.atual === "completa" && covFat.comparacao === "completa" && ((fatLoja.atual[unidade] ?? 0) <= 0 || (fatLoja.comparacao[unidade] ?? 0) <= 0);
      const coberturaParcial = lojaParcial("atual", unidade) || lojaParcial("comparacao", unidade);
      const semBase = semBaseLoja || coberturaParcial;
      return { unidade, atual: a, anterior: c, coberturaParcial, ...(semBase ? { ...v, situacao: "sem-base" as const, base: null, variacaoPp: null } : v) };
    });

    const diasSem = (linhas: { data: string }[], j: Janela) => {
      const com = new Set(linhas.filter((l) => l.data >= j.inicio && l.data <= j.fim).map((l) => l.data));
      return numeroDeDias(j) - com.size;
    };
    return {
      id,
      rotulo: ROTULO_INDICADOR[id],
      ...(id === "quebra" && cov.atual === "completa" && cov.comparacao === "completa"
        ? { diasSemRegistro: { atual: diasSem(e.quebra, e.atual), anterior: diasSem(e.quebra, e.comparacao), dias: numeroDeDias(e.atual) } }
        : {}),
      atual,
      anterior,
      coberturaAtual: cov.atual,
      coberturaAnterior: cov.comparacao,
      porLoja,
      ...variacao(atual, anterior),
    };
  });

  return {
    atual: e.atual,
    comparacao: e.comparacao,
    semanas: numeroDeDias(e.atual) / 7,
    indicadores,
    lojas: montarLojas(indicadores),
    avisos,
    avisosLojas: (["atual", "comparacao"] as const).flatMap((p) =>
      UNIDADES.filter((u) => lojaParcial(p, u)).map((u) => ({ unidade: u as string, periodo: p, diasComFaturamento: diasLoja[p].get(u)!.size, dias: diasPeriodo[p] }))
    ),
    coberturaFaturamento: covFat,
  };
}

/**
 * Área de atenção por loja — só rankings, nenhum limite novo:
 *  - maior-percentual: top 3 lojas pelo % sobre o faturamento no período atual (proporcional; lojas com faturamento
 *    em menos dias que o período ficam de fora dos rankings proporcionais);
 *  - maior-valor: top 3 lojas pelo valor em R$ (destaque descritivo; NÃO define piora);
 *  - piora: top 3 lojas entre as que PIOROU (decidido pelo %, ou pelo valor se não houver %), pela maior piora.
 * Só entram indicadores com base completa no período atual.
 */
function montarLojas(indicadores: IndicadorSemanal[]): LojaResumo[] {
  const codigos = new Set(indicadores.flatMap((i) => i.porLoja.map((l) => l.unidade)));
  const atencao = new Map<string, PontoAtencao[]>([...codigos].map((u) => [u, []]));
  const ordem = new Map<string, number>(UNIDADES.map((u, i) => [u as string, i]));

  for (const ind of indicadores) {
    if (ind.coberturaAtual !== "completa") continue;
    const topo = (
      lojas: LojaIndicador[],
      motivo: MotivoAtencao,
      chave: (l: LojaIndicador) => number | null
    ) => {
      lojas
        .map((l) => ({ l, k: chave(l) }))
        .filter((x): x is { l: LojaIndicador; k: number } => x.k !== null && x.k > 0)
        .sort((a, b) => b.k - a.k || (ordem.get(a.l.unidade) ?? 99) - (ordem.get(b.l.unidade) ?? 99))
        .slice(0, TOP_ATENCAO)
        .forEach((x, i) => atencao.get(x.l.unidade)?.push({ indicador: ind.id, motivo, posicao: i + 1 }));
    };
    topo(ind.porLoja.filter((l) => !l.coberturaParcial), "maior-percentual", (l) => l.atual.percentual);
    topo(ind.porLoja, "maior-valor", (l) => l.atual.valor);
    topo(
      ind.porLoja.filter((l) => l.situacao === "piorou" && !l.coberturaParcial),
      "piora",
      (l) => (l.base === "percentual" ? l.variacaoPp : l.variacaoReais)
    );
  }

  return [...codigos]
    .sort((a, b) => (atencao.get(b)?.length ?? 0) - (atencao.get(a)?.length ?? 0) || (ordem.get(a) ?? 99) - (ordem.get(b) ?? 99))
    .map((unidade) => ({
      unidade,
      atencao: atencao.get(unidade) ?? [],
      porIndicador: Object.fromEntries(
        indicadores.map((i) => [i.id, i.porLoja.find((l) => l.unidade === unidade) ?? null])
      ) as Record<IndicadorId, LojaIndicador | null>,
    }));
}
