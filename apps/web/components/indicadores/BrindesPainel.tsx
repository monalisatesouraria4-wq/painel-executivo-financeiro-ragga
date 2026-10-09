"use client";

import { Fragment, useRef, useState, useTransition, type ReactNode } from "react";
import { UNIDADES } from "@painel/shared";
import { SemaforoBadge } from "@/components/ui/SemaforoBadge";
import { GraficoLinhaDiaria, NOME_DIA, diaDaSemana, diaMesAno } from "@/components/ui/GraficoLinhaDiaria";
import { paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { ehMesCalendarioCompleto, mesAnteriorCompleto } from "@/lib/rules/mesAnterior";
import { classificarBrinde } from "@/lib/rules/brindes";
import { compararMotivos, variacaoCompraDireta } from "@/lib/services/compraDiretaPainel";
import {
  LIMITE_ATENCAO_BRINDES,
  LIMITE_SAUDAVEL_BRINDES,
  ROTULO_STATUS_BRINDE,
  type BrindesPainelData,
  type DiaBrindes,
  type LojaBrindes,
  type MotivoBrinde,
  type PeriodoBrindes,
  type StatusBrinde,
} from "@/lib/services/brindesPainel";
import { buscarBrindesPainel } from "@/lib/actions/buscarBrindesPainel";
import { SecaoModalidade, SecaoMotivos } from "@/components/indicadores/BrindesAnalise";
import {
  baseCobreOsPeriodos,
  coberturaFaturamentoLoja,
  comparabilidadeBrindes,
  compararMotivosDetalhados,
  linhasLojasBrindes,
  lojasDaModalidade,
  motivosDetalhados,
  ordenarLojasBrindes,
  type OrdemLojasBrindes,
} from "@/lib/services/brindesAnalise";
import { hojeNegocio, janelaAnterior, somarDias, ultimaSemanaCompleta } from "@/lib/services/resumoSemanal";

/**
 * Painel analítico da aba Brindes (Indicadores) — mesma experiência da Compra Direta. TOTAL de Brindes =
 * controláveis + não controláveis (indicador operacional, variação factual). O SEMÁFORO/status e as leituras de
 * "Melhorou/Piorou" valem SOMENTE para os controláveis (classificação existente em `lib/rules/brindes.ts`,
 * thresholds existentes `FAIXAS_BRINDES`). Não controláveis e total: apenas valores e variações, sem julgamento.
 */

/** Cada refeição de colaborador corresponde a R$ 10,00 (quantidade = valor de "Consumo de Funcionários" ÷ 10). */
const VALOR_POR_REFEICAO = 10;
/** Rótulo do motivo "Consumo de Funcionários" na classificação existente (continua NÃO controlável). */
const MOTIVO_CONSUMO_FUNCIONARIOS = classificarBrinde("BRINDE CONSUMO FUNCIONARIOS").rotulo;
const quantidadeFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Escopo exibido (rede inteira ou uma loja) — mesmos campos nos dois casos. */
interface Escopo {
  disponivel: boolean;
  faturamento: number;
  total: number;
  controlaveis: number;
  naoControlaveis: number;
  percentualTotal: number;
  percentualControlaveis: number;
  percentualNaoControlaveis: number;
  status: StatusBrinde;
  cor: PeriodoBrindes["cor"];
  motivos: MotivoBrinde[];
  diario: DiaBrindes[];
}

function escopoDe(periodo: PeriodoBrindes, loja: string): Escopo {
  if (loja === "TODAS") return periodo;
  const l = periodo.porLoja.find((x) => x.unidade === loja);
  if (!l)
    return {
      disponivel: false,
      faturamento: 0,
      total: 0,
      controlaveis: 0,
      naoControlaveis: 0,
      percentualTotal: 0,
      percentualControlaveis: 0,
      percentualNaoControlaveis: 0,
      status: "excelente",
      cor: "azul",
      motivos: [],
      diario: [],
    };
  return { ...l, disponivel: l.motivos.length > 0 };
}

/** Variação em R$ + % sobre o comparado. `interpretar` = só controláveis: redução verde, aumento vermelho. Demais: cinza (factual). */
function Variacao({ atual, anterior, formato = "moeda", interpretar = false }: { atual: number; anterior: number; formato?: "moeda" | "pp"; interpretar?: boolean }) {
  const delta = atual - anterior;
  const seta = delta > 0 ? "↑" : delta < 0 ? "↓" : "=";
  const cor = !interpretar || Math.abs(delta) < 0.005 ? "text-foreground/70" : delta < 0 ? "text-semaforo-verde" : "text-semaforo-vermelho";
  if (formato === "pp")
    return (
      <span className={`font-semibold tabular-nums ${cor}`}>
        {seta} {pct.format(Math.abs(delta))} p.p.
      </span>
    );
  const p = anterior !== 0 ? (delta / anterior) * 100 : null;
  return (
    <span className={`font-semibold tabular-nums ${cor}`}>
      {seta} {moeda.format(Math.abs(delta))}
      {p !== null && ` (${delta >= 0 ? "+" : "-"}${pct.format(Math.abs(p))}%)`}
    </span>
  );
}

/** Situação: 🟢 Melhorou / 🔴 Piorou / ⚪ Sem alteração / ⚪ Sem base de comparação — só para controláveis; senão "variação factual". */
function Situacao({ atual, anterior, controlavel, temBase = true }: { atual: number; anterior: number; controlavel: boolean; temBase?: boolean }) {
  if (!temBase) return <span className="whitespace-nowrap text-xs font-semibold text-foreground/45">⚪ Sem base de comparação</span>;
  if (!controlavel) return <span className="whitespace-nowrap text-xs text-foreground/40">Variação factual</span>;
  const { situacao } = variacaoCompraDireta(atual, anterior);
  if (situacao === "sem-alteracao") return <span className="whitespace-nowrap text-xs font-semibold text-foreground/50">⚪ Sem alteração</span>;
  return situacao === "melhorou" ? (
    <span className="whitespace-nowrap text-xs font-semibold text-semaforo-verde">🟢 Melhorou</span>
  ) : (
    <span className="whitespace-nowrap text-xs font-semibold text-semaforo-vermelho">🔴 Piorou</span>
  );
}

function TagNaoControlavel() {
  return <span className="ml-1.5 rounded bg-ragga-blue/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ragga-blue">não controlável</span>;
}

/** Variação em duas colunas (R$ e %), com a mesma regra de cor. */
function VarCelulas({ atual, anterior, interpretar }: { atual: number; anterior: number; interpretar: boolean }) {
  const delta = atual - anterior;
  const cor = !interpretar || Math.abs(delta) < 0.005 ? "text-foreground/70" : delta < 0 ? "text-semaforo-verde" : "text-semaforo-vermelho";
  const p = anterior !== 0 ? (delta / anterior) * 100 : null;
  const sinal = delta >= 0 ? "+" : "-";
  return (
    <>
      <td className={`px-3 font-semibold ${cor}`}>
        {sinal}
        {moeda.format(Math.abs(delta))}
      </td>
      <td className={`px-3 font-semibold ${cor}`}>{p === null ? "—" : `${sinal}${pct.format(Math.abs(p))}%`}</td>
    </>
  );
}

function Secao({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-ragga-blue/10 bg-white p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-ragga-blue-dark">
          <span className="h-3.5 w-1 rounded-full bg-ragga-blue" />
          {titulo}
        </h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

function ToggleModo({ modo, aoAlterar }: { modo: "valor" | "percentual"; aoAlterar: (m: "valor" | "percentual") => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-ragga-blue/15 text-xs font-medium">
      {(["valor", "percentual"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => aoAlterar(m)}
          className={`px-3 py-1.5 ${modo === m ? "bg-ragga-blue text-white" : "bg-white text-ragga-blue-dark hover:bg-ragga-blue/5"}`}
        >
          {m === "valor" ? "R$" : "% do faturamento"}
        </button>
      ))}
    </div>
  );
}

/** Card com hover: o tooltip aparece ao passar o mouse (CSS puro — sem clique, sem modal, sem bloquear o mouse, sem tooltip nativo). */
function CardHover({ tooltip, direita = false, children }: { tooltip: ReactNode; direita?: boolean; children: ReactNode }) {
  return (
    <div className="group relative" tabIndex={0}>
      {children}
      <div
        role="tooltip"
        className={`pointer-events-none absolute top-full z-30 mt-2 hidden w-72 max-w-[calc(100vw-3rem)] rounded-xl border border-ragga-blue/15 bg-white p-3 text-xs shadow-[0_12px_32px_-8px_rgba(31,53,112,0.35)] group-focus-within:block group-hover:block ${
          direita ? "right-0" : "left-0"
        }`}
      >
        {tooltip}
      </div>
    </div>
  );
}

function TooltipComparativo({ periodo, temBase, children }: { periodo: string; temBase: boolean; children: ReactNode }) {
  return (
    <>
      <p className="text-[11px] font-bold uppercase tracking-wide text-ragga-blue">Comparativo com o período comparado</p>
      <p className="mb-1.5 text-foreground/50">Período comparado: {periodo}</p>
      {temBase ? <div className="space-y-0.5">{children}</div> : <p className="text-foreground/60">⚪ Sem base de comparação (sem dados no período comparado).</p>}
    </>
  );
}

function TipLinha({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-foreground/60">{rotulo}</span>
      <span className="text-right font-semibold tabular-nums text-ragga-blue-dark">{valor}</span>
    </div>
  );
}

const sinalMoeda = (delta: number) => `${delta >= 0 ? "+" : "-"}${moeda.format(Math.abs(delta))}`;
const sinalPct = (atual: number, comparado: number) =>
  comparado !== 0 ? `${atual - comparado >= 0 ? "+" : "-"}${pct.format(Math.abs(((atual - comparado) / comparado) * 100))}%` : "—";

function CardGrande({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-ragga-blue/10 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground/45">{titulo}</p>
      {children}
    </div>
  );
}

function Item({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-foreground/45">{rotulo}</p>
      <p className="mt-0.5 font-semibold tabular-nums text-ragga-blue-dark">{valor}</p>
    </div>
  );
}

const ESTILO_CHIP: Record<StatusBrinde, { emoji: string; faixa: string; classe: string }> = {
  excelente: { emoji: "🟢", faixa: `até ${pct.format(LIMITE_SAUDAVEL_BRINDES)}%`, classe: "border-semaforo-azul/30 bg-semaforo-azul/10" },
  atencao: { emoji: "🟡", faixa: `acima de ${pct.format(LIMITE_SAUDAVEL_BRINDES)}% até ${pct.format(LIMITE_ATENCAO_BRINDES)}%`, classe: "border-semaforo-amarelo/30 bg-semaforo-amarelo/10" },
  critico: { emoji: "🔴", faixa: `acima de ${pct.format(LIMITE_ATENCAO_BRINDES)}%`, classe: "border-semaforo-vermelho/30 bg-semaforo-vermelho/10" },
};
type OrdemRanking = OrdemLojasBrindes;

function distanciaTexto(percentualControlaveis: number): string {
  const d = percentualControlaveis - LIMITE_SAUDAVEL_BRINDES;
  return `${d >= 0 ? "+" : "-"}${pct.format(Math.abs(d))} p.p.`;
}

function Evolucao({ dias, modo, altura }: { dias: DiaBrindes[]; modo: "valor" | "percentual"; altura?: number }) {
  return (
    <GraficoLinhaDiaria
      dias={dias}
      modo={modo}
      altura={altura}
      rotuloMaior="Maior dia"
      rotuloMenor="Menor dia"
      textoAjuda="A linha representa o TOTAL de Brindes (controláveis + não controláveis). Passe o mouse sobre um ponto para ver a composição do dia. Faixas suaves = sábado e domingo. Maior/menor consideram só dias com dado válido; dias sem registro ficam como lacuna (nunca R$ 0 inventado)."
      renderTooltip={(dia, { modo: m, y }) => {
        const motivos = [...dia.motivos].filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor);
        const total = motivos.reduce((t, x) => t + x.valor, 0);
        const pctDoDia = (v: number) => (total > 0 ? pct.format((v / total) * 100) : pct.format(0));
        return (
          <>
            <p className="text-xs font-bold text-ragga-blue">
              📅 {diaMesAno(dia.data)} <span className="font-medium text-foreground/50">({NOME_DIA[diaDaSemana(dia.data)]})</span>
            </p>
            <p className="mt-0.5 text-xs text-foreground/60">
              🎁 Total de Brindes: <span className="text-sm font-extrabold tabular-nums text-ragga-blue-dark">{moeda.format(dia.valor)}</span>
            </p>
            {m === "percentual" && dia.faturamento > 0 && (
              <p className="text-[11px] text-foreground/50">
                {pct.format(y)}% do faturamento do dia ({moeda.format(dia.faturamento)})
              </p>
            )}
            <p className="mt-1 text-xs tabular-nums text-foreground/70">
              🎯 Controláveis: {moeda.format(dia.controlaveis)} — {pctDoDia(dia.controlaveis)}%
            </p>
            <p className="text-xs tabular-nums text-foreground/70">
              ℹ️ Não controláveis: {moeda.format(dia.naoControlaveis)} — {pctDoDia(dia.naoControlaveis)}%
            </p>
            {motivos.length === 0 ? (
              <p className="mt-2 text-xs text-foreground/50">Sem brindes neste dia.</p>
            ) : (
              <table className="mt-2 w-full text-xs tabular-nums">
                <tbody>
                  {motivos.map((x) => (
                    <tr key={x.motivo}>
                      <td className="py-0.5 pr-2 font-medium text-ragga-blue-dark">
                        {x.motivo}
                        {!x.controlavel && <span className="ml-1 text-[10px] text-foreground/40">ℹ️</span>}
                      </td>
                      <td className="py-0.5 pr-2 text-right">{moeda.format(x.valor)}</td>
                      <td className="py-0.5 text-right text-foreground/60">{pctDoDia(x.valor)}%</td>
                    </tr>
                  ))}
                  <tr className="border-t border-ragga-blue/20 font-bold text-ragga-blue-dark">
                    <td className="pt-1 pr-2">Total</td>
                    <td className="pt-1 pr-2 text-right">{moeda.format(total)}</td>
                    <td className="pt-1 text-right">{pct.format(100)}%</td>
                  </tr>
                </tbody>
              </table>
            )}
          </>
        );
      }}
    />
  );
}

/** Tabela de comparação por motivo (rede/escopo e loja): classifica Melhorou/Piorou só nos controláveis. */
function TabelaComparativoMotivos({
  atual,
  comparado,
  temBase,
  pctControlaveisAtual,
  pctControlaveisComparado,
}: {
  atual: MotivoBrinde[];
  comparado: MotivoBrinde[];
  temBase: boolean;
  /** % de controláveis sobre o faturamento (atual/comparado) — define Melhorou/Piorou da linha "Controláveis". */
  pctControlaveisAtual: number;
  pctControlaveisComparado: number;
}) {
  const linhas = compararMotivos(atual, comparado);
  const totalA = atual.reduce((s, m) => s + m.valor, 0);
  const totalC = comparado.reduce((s, m) => s + m.valor, 0);
  const ctrlA = atual.filter((m) => m.controlavel).reduce((s, m) => s + m.valor, 0);
  const ctrlC = comparado.filter((m) => m.controlavel).reduce((s, m) => s + m.valor, 0);
  if (linhas.length === 0) return <p className="text-sm text-foreground/45">Sem brindes nos períodos.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
            <th className="py-2 pr-4">Motivo</th>
            <th className="px-3 py-2">Atual</th>
            <th className="px-3 py-2">Comparado</th>
            <th className="px-3 py-2">Variação R$</th>
            <th className="px-3 py-2">Variação %</th>
            <th className="px-3 py-2">% do total atual</th>
            <th className="px-3 py-2">% do total comparado</th>
            <th className="px-3 py-2">Situação</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {linhas.map((l) => {
            const controlavel = (l.atual ?? l.comparado)?.controlavel ?? true;
            const va = l.atual?.valor ?? 0;
            const vc = l.comparado?.valor ?? 0;
            return (
              <tr key={l.motivo} className="border-b border-ragga-blue/5">
                <td className="py-2.5 pr-4 font-medium text-ragga-blue-dark">
                  {l.motivo}
                  {!controlavel && <TagNaoControlavel />}
                </td>
                <td className="px-3">{moeda.format(va)}</td>
                <td className="px-3">{temBase ? moeda.format(vc) : "Sem dados"}</td>
                {temBase ? <VarCelulas atual={va} anterior={vc} interpretar={controlavel} /> : (<><td className="px-3">—</td><td className="px-3">—</td></>)}
                <td className="px-3">{pct.format(l.atual?.percentualDoTotal ?? 0)}%</td>
                <td className="px-3">{temBase ? `${pct.format(l.comparado?.percentualDoTotal ?? 0)}%` : "—"}</td>
                <td className="px-3">
                  <Situacao atual={va} anterior={vc} controlavel={controlavel} temBase={temBase} />
                </td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
            <td className="py-2.5 pr-4">TOTAL DE BRINDES</td>
            <td className="px-3">{moeda.format(totalA)}</td>
            <td className="px-3">{temBase ? moeda.format(totalC) : "Sem dados"}</td>
            {temBase ? <VarCelulas atual={totalA} anterior={totalC} interpretar={false} /> : (<><td className="px-3">—</td><td className="px-3">—</td></>)}
            <td className="px-3">{pct.format(100)}%</td>
            <td className="px-3">{temBase ? `${pct.format(100)}%` : "—"}</td>
            <td className="px-3 text-xs font-normal text-foreground/40">Variação factual</td>
          </tr>
          <tr className="font-semibold text-ragga-blue-dark">
            <td className="py-2.5 pr-4">🎯 Controláveis</td>
            <td className="px-3">{moeda.format(ctrlA)}</td>
            <td className="px-3">{temBase ? moeda.format(ctrlC) : "Sem dados"}</td>
            {temBase ? <VarCelulas atual={ctrlA} anterior={ctrlC} interpretar={false} /> : (<><td className="px-3">—</td><td className="px-3">—</td></>)}
            <td className="px-3">{totalA > 0 ? pct.format((ctrlA / totalA) * 100) : pct.format(0)}%</td>
            <td className="px-3">{temBase ? `${totalC > 0 ? pct.format((ctrlC / totalC) * 100) : pct.format(0)}%` : "—"}</td>
            <td className="px-3">
              <Situacao atual={pctControlaveisAtual} anterior={pctControlaveisComparado} controlavel temBase={temBase} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function BrindesPainel({
  dadosIniciais,
  periodoInicial,
  lojaInicial = "TODAS",
}: {
  dadosIniciais: BrindesPainelData;
  periodoInicial: { inicio: string; fim: string; compInicio: string; compFim: string };
  /** Loja pré-selecionada (navegação por ?loja=). */
  lojaInicial?: string;
}) {
  const [dados, setDados] = useState(dadosIniciais);
  const [inicio, setInicio] = useState(periodoInicial.inicio);
  const [fim, setFim] = useState(periodoInicial.fim);
  const [compInicio, setCompInicio] = useState(periodoInicial.compInicio);
  const [compFim, setCompFim] = useState(periodoInicial.compFim);
  const [compManual, setCompManual] = useState(false);
  const [loja, setLoja] = useState(lojaInicial);
  const [modoGrafico, setModoGrafico] = useState<"valor" | "percentual">("valor");
  const [statusFiltro, setStatusFiltro] = useState<StatusBrinde | null>(null);
  const [ordem, setOrdem] = useState<OrdemRanking>("percentual");
  const [lojasAbertas, setLojasAbertas] = useState<Set<string>>(new Set());
  const [modalidadeSel, setModalidadeSel] = useState<string | null>(null);
  const [pendente, iniciarTransicao] = useTransition();
  const ultimaRequisicao = useRef(0);

  const completa = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 2000;

  function carregar(i: string, f: string, ci: string, cf: string) {
    // Valores intermediários da digitação (ano incompleto / início > fim) não consultam o servidor.
    if (![i, f, ci, cf].every(completa) || i > f || ci > cf) return;
    const req = ++ultimaRequisicao.current;
    iniciarTransicao(async () => {
      const r = await buscarBrindesPainel(dataDoInput(i), dataDoInput(f), dataDoInput(ci), dataDoInput(cf));
      if (req === ultimaRequisicao.current) setDados(r);
    });
  }

  function alterarAtual(i: string, f: string) {
    setInicio(i);
    setFim(f);
    let ci = compInicio;
    let cf = compFim;
    if (!compManual && completa(i) && completa(f)) {
      const sugestao = mesAnteriorCompleto(dataDoInput(i), dataDoInput(f));
      if (sugestao) {
        ci = paraInputDate(sugestao.inicio);
        cf = paraInputDate(sugestao.fim);
        setCompInicio(ci);
        setCompFim(cf);
      }
    }
    carregar(i, f, ci, cf);
  }

  function alterarComparacao(ci: string, cf: string) {
    setCompManual(true);
    setCompInicio(ci);
    setCompFim(cf);
    carregar(inicio, fim, ci, cf);
  }

  function usarMesAnterior() {
    const sugestao = mesAnteriorCompleto(dataDoInput(inicio), dataDoInput(fim));
    if (!sugestao) return;
    setCompManual(false);
    const ci = paraInputDate(sugestao.inicio);
    const cf = paraInputDate(sugestao.fim);
    setCompInicio(ci);
    setCompFim(cf);
    carregar(inicio, fim, ci, cf);
  }

  /** Atalho: última semana COMPLETA (seg–dom, ocorrência) × semana completa imediatamente anterior. A aba usa D-1, então a referência é ocorrência + 1 dia. */
  function usarUltimaSemanaCompleta() {
    const sem = ultimaSemanaCompleta(hojeNegocio());
    const ant = janelaAnterior(sem);
    const i = somarDias(sem.inicio, 1);
    const f = somarDias(sem.fim, 1);
    const ci = somarDias(ant.inicio, 1);
    const cf = somarDias(ant.fim, 1);
    setCompManual(true);
    setInicio(i);
    setFim(f);
    setCompInicio(ci);
    setCompFim(cf);
    carregar(i, f, ci, cf);
  }

  function alternarLoja(unidade: string) {
    setLojasAbertas((a) => {
      const n = new Set(a);
      if (n.has(unidade)) n.delete(unidade);
      else n.add(unidade);
      return n;
    });
  }

  const atual = escopoDe(dados.atual, loja);
  const comp = escopoDe(dados.comparacao, loja);
  // Comparação só vale com cobertura: base cobre os dois períodos e o faturamento (rede ou loja) está completo nos dois.
  const comparab = comparabilidadeBrindes(dados, loja);
  const podeComparar = atual.disponivel && comp.disponivel && comparab.valida;
  // Card Faturamento: valor já carregado; "—" se carregando, ausente ou zero; aviso discreto se há dias sem faturamento.
  const faturamentoValido = !pendente && atual.faturamento > 0;
  const coberturaFat = coberturaFaturamentoLoja(atual);
  const faturamentoParcial = faturamentoValido && !coberturaFat.completo && coberturaFat.total > 0;
  const mesCompleto = completa(inicio) && completa(fim) && ehMesCalendarioCompleto(dataDoInput(inicio), dataDoInput(fim));
  const sugestaoMes = mesCompleto ? mesAnteriorCompleto(dataDoInput(inicio), dataDoInput(fim)) : null;
  const compEhSugestao = sugestaoMes && paraInputDate(sugestaoMes.inicio) === compInicio && paraInputDate(sugestaoMes.fim) === compFim;

  const linhasLojas = linhasLojasBrindes(dados.atual, dados.comparacao, baseCobreOsPeriodos(dados), loja);
  // Lojas com faturamento em menos dias que o período não entram na contagem de status (% não representa o período).
  const contagem = linhasLojas
    .filter((l) => !l.coberturaParcial)
    .reduce((c, l) => ({ ...c, [l.status]: c[l.status] + 1 }), { excelente: 0, atencao: 0, critico: 0 } as Record<StatusBrinde, number>);
  const ranking = ordenarLojasBrindes(linhasLojas, ordem);
  const rankingVisivel = statusFiltro ? ranking.filter((l) => !l.coberturaParcial && l.status === statusFiltro) : ranking;

  // Motivos → submotivos e modalidade → lojas (mesma matriz; reconcilia com os totais do escopo).
  const motivosAtual = motivosDetalhados(dados.atual.matriz, loja);
  const motivosComp = motivosDetalhados(dados.comparacao.matriz, loja);
  const linhasMotivos = compararMotivosDetalhados(motivosAtual, motivosComp, podeComparar);
  const modalidades = motivosAtual.map((m) => m.motivo);
  const modalidadeAtiva = modalidadeSel && modalidades.includes(modalidadeSel) ? modalidadeSel : (modalidades[0] ?? null);
  const lojasModalidade = modalidadeAtiva ? lojasDaModalidade(modalidadeAtiva, dados.atual, dados.comparacao, baseCobreOsPeriodos(dados), loja) : [];
  function investigarModalidade(m: string) {
    setModalidadeSel(m);
    requestAnimationFrame(() => document.getElementById("brindes-modalidade")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const inputCls = "rounded-md border border-ragga-blue/15 bg-white px-3 py-2 text-sm focus:border-ragga-blue focus:outline-none focus:ring-1 focus:ring-ragga-blue/40";
  const periodoAtualTxt = `${diaMesAno(inicio)} a ${diaMesAno(fim)}`;
  const periodoCompTxt = `${diaMesAno(compInicio)} a ${diaMesAno(compFim)}`;
  // Datas de OCORRÊNCIA (D-1) — as que de fato foram somadas; usadas nas seções novas para não confundir com a referência.
  const ocorrAtualTxt = `${diaMesAno(dados.atual.inicioOcorrencia)} a ${diaMesAno(dados.atual.fimOcorrencia)}`;
  const ocorrCompTxt = `${diaMesAno(dados.comparacao.inicioOcorrencia)} a ${diaMesAno(dados.comparacao.fimOcorrencia)}`;
  const slot = (v: number, ok: boolean, fmt: (n: number) => string) => (ok ? fmt(v) : "Sem dados");
  // Refeições de colaboradores: dado já existente (motivo "Consumo Funcionários" do escopo/período selecionado) ÷ R$ 10.
  const consumoFuncionarios = atual.motivos.find((m) => m.motivo === MOTIVO_CONSUMO_FUNCIONARIOS)?.valor ?? 0;
  const refeicoes = consumoFuncionarios / VALOR_POR_REFEICAO;
  // Período comparado (só para o hover do card): mesma fonte e mesma conta.
  const consumoFuncionariosComp = comp.motivos.find((m) => m.motivo === MOTIVO_CONSUMO_FUNCIONARIOS)?.valor ?? 0;
  const refeicoesComp = consumoFuncionariosComp / VALOR_POR_REFEICAO;

  const linhasComparativo = [
    { chave: "fat", rotulo: "Faturamento", a: atual.faturamento, c: comp.faturamento, pa: null as number | null, pc: null as number | null, interpretar: false },
    { chave: "total", rotulo: "🎁 Total de Brindes", a: atual.total, c: comp.total, pa: atual.percentualTotal, pc: comp.percentualTotal, interpretar: false },
    { chave: "ctrl", rotulo: "🎯 Brindes Controláveis", a: atual.controlaveis, c: comp.controlaveis, pa: atual.percentualControlaveis, pc: comp.percentualControlaveis, interpretar: false },
    { chave: "nao", rotulo: "ℹ️ Brindes Não Controláveis", a: atual.naoControlaveis, c: comp.naoControlaveis, pa: atual.percentualNaoControlaveis, pc: comp.percentualNaoControlaveis, interpretar: false },
  ];

  return (
    <div className="space-y-5 bg-ragga-bg">
      {/* FILTROS: período atual + período de comparação (livres) + loja */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl border border-ragga-blue/10 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(31,53,112,0.06)]">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Período atual</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input type="date" value={inicio} onChange={(e) => alterarAtual(e.target.value, fim)} className={inputCls} />
            <span className="text-foreground/40">até</span>
            <input type="date" value={fim} onChange={(e) => alterarAtual(inicio, e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
            Comparar com
            {sugestaoMes && !compEhSugestao && (
              <button type="button" onClick={usarMesAnterior} className="normal-case tracking-normal text-ragga-blue hover:underline">
                ↺ usar mês anterior
              </button>
            )}
            {compEhSugestao && <span className="normal-case tracking-normal text-foreground/40">(mês anterior sugerido)</span>}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input type="date" value={compInicio} onChange={(e) => alterarComparacao(e.target.value, compFim)} className={inputCls} />
            <span className="text-foreground/40">até</span>
            <input type="date" value={compFim} onChange={(e) => alterarComparacao(compInicio, e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Loja</p>
          <select value={loja} onChange={(e) => setLoja(e.target.value)} className={inputCls}>
            <option value="TODAS">Todas as lojas</option>
            {UNIDADES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={usarUltimaSemanaCompleta}
          className="rounded-md border border-ragga-blue/20 px-3 py-2 text-sm font-medium text-ragga-blue hover:bg-ragga-blue/5"
          title="Última semana completa (segunda a domingo) comparada com a semana completa imediatamente anterior"
        >
          Última semana completa
        </button>
        {pendente && <span className="pb-2 text-xs text-foreground/50">Carregando...</span>}
      </div>
      <p className="-mt-3 px-1 text-[11px] text-foreground/45">
        Regra D-1 da aba: ocorrências de {diaMesAno(dados.atual.inicioOcorrencia)} a {diaMesAno(dados.atual.fimOcorrencia)} (comparado:{" "}
        {diaMesAno(dados.comparacao.inicioOcorrencia)} a {diaMesAno(dados.comparacao.fimOcorrencia)}).
      </p>

      {dados.conectado && atual.disponivel && comp.disponivel && !comparab.valida && (
        <div className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          ⚠ Comparação com o período comparado não é válida: {comparab.motivo} Variações e comparativos ficam como “Sem base”.
        </div>
      )}

      {!dados.conectado && (
        <div className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          Banco de dados ainda não conectado — nenhum valor foi inventado.
        </div>
      )}

      {/* 1) CARDS PRINCIPAIS — resumo do período ATUAL; a comparação fica no hover (tabela completa mais abaixo). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Faturamento do período: o MESMO `atual.faturamento` (período + loja selecionados) que é o denominador dos percentuais. */}
        <CardGrande titulo="💰 Faturamento do período">
          <p className="mt-1 text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">{faturamentoValido ? moeda.format(atual.faturamento) : "—"}</p>
          {pendente ? (
            <p className="mt-2 text-xs text-foreground/45">Carregando...</p>
          ) : !faturamentoValido ? (
            <p className="mt-2 text-xs text-foreground/45">Sem dados no período</p>
          ) : (
            <div className="mt-2 space-y-0.5 text-xs text-foreground/50">
              <p>Base de cálculo dos percentuais.</p>
              {faturamentoParcial && (
                <p className="font-semibold text-semaforo-amarelo">
                  ⚠ Faturamento incompleto: {coberturaFat.dias} de {coberturaFat.total} dias com faturamento no período.
                </p>
              )}
            </div>
          )}
        </CardGrande>

        <CardHover
          tooltip={
            <TooltipComparativo periodo={periodoCompTxt} temBase={podeComparar}>
              <TipLinha rotulo="Valor comparado" valor={moeda.format(comp.total)} />
              <TipLinha rotulo="Variação" valor={sinalMoeda(atual.total - comp.total)} />
              <TipLinha rotulo="Variação %" valor={sinalPct(atual.total, comp.total)} />
              <p className="pt-1 text-[11px] text-foreground/45">Variação factual (sem melhorou/piorou).</p>
            </TooltipComparativo>
          }
        >
          <CardGrande titulo="🎁 Total de Brindes">
            <p className="mt-1 text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">{atual.disponivel ? moeda.format(atual.total) : "—"}</p>
            {atual.disponivel ? (
              <p className="mt-2 text-sm text-foreground/60">
                <span className="font-semibold tabular-nums">{pct.format(atual.percentualTotal)}%</span> do faturamento
              </p>
            ) : (
              <p className="mt-2 text-xs text-foreground/45">Sem dados no período</p>
            )}
          </CardGrande>
        </CardHover>

        <CardHover
          tooltip={
            <TooltipComparativo periodo={periodoCompTxt} temBase={podeComparar}>
              <TipLinha rotulo="Valor atual" valor={moeda.format(atual.controlaveis)} />
              <TipLinha rotulo="Valor comparado" valor={moeda.format(comp.controlaveis)} />
              <TipLinha rotulo="Variação" valor={`${sinalMoeda(atual.controlaveis - comp.controlaveis)} (${sinalPct(atual.controlaveis, comp.controlaveis)})`} />
              <TipLinha rotulo="% faturamento atual" valor={`${pct.format(atual.percentualControlaveis)}%`} />
              <TipLinha rotulo="% faturamento comparado" valor={`${pct.format(comp.percentualControlaveis)}%`} />
              <TipLinha rotulo="Variação em p.p." valor={`${atual.percentualControlaveis - comp.percentualControlaveis >= 0 ? "+" : "-"}${pct.format(Math.abs(atual.percentualControlaveis - comp.percentualControlaveis))} p.p.`} />
              <div className="flex items-center justify-between pt-1">
                <span className="text-foreground/60">Situação</span>
                <Situacao atual={atual.percentualControlaveis} anterior={comp.percentualControlaveis} controlavel />
              </div>
            </TooltipComparativo>
          }
        >
          <CardGrande titulo="🎯 Brindes controláveis">
            <p className="mt-1 text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">{atual.disponivel ? moeda.format(atual.controlaveis) : "—"}</p>
            {atual.disponivel ? (
              <div className="mt-2 space-y-1 text-sm text-foreground/60">
                <p>
                  <span className="font-semibold tabular-nums">{pct.format(atual.percentualControlaveis)}%</span> do faturamento
                </p>
                <p className="text-xs">Meta: {pct.format(LIMITE_SAUDAVEL_BRINDES)}%</p>
                <p>
                  <SemaforoBadge cor={atual.cor} texto={`Status: ${ROTULO_STATUS_BRINDE[atual.status]}`} />
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-foreground/45">Sem dados no período</p>
            )}
          </CardGrande>
        </CardHover>

        <CardHover
          direita
          tooltip={
            <TooltipComparativo periodo={periodoCompTxt} temBase={podeComparar}>
              <TipLinha rotulo="Valor comparado" valor={moeda.format(comp.naoControlaveis)} />
              <TipLinha rotulo="Variação R$" valor={sinalMoeda(atual.naoControlaveis - comp.naoControlaveis)} />
              <TipLinha rotulo="Variação %" valor={sinalPct(atual.naoControlaveis, comp.naoControlaveis)} />
              <p className="pt-1 text-[11px] text-foreground/45">Variação factual (sem melhorou/piorou).</p>
            </TooltipComparativo>
          }
        >
          <CardGrande titulo="ℹ️ Brindes não controláveis">
            <p className="mt-1 text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">{atual.disponivel ? moeda.format(atual.naoControlaveis) : "—"}</p>
            {atual.disponivel ? (
              <div className="mt-2 space-y-0.5 text-sm text-foreground/60">
                <p>
                  <span className="font-semibold tabular-nums">{atual.total > 0 ? pct.format((atual.naoControlaveis / atual.total) * 100) : pct.format(0)}%</span> do total de brindes
                </p>
                <p>
                  <span className="font-semibold tabular-nums">{pct.format(atual.percentualNaoControlaveis)}%</span> do faturamento
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-foreground/45">Sem dados no período</p>
            )}
          </CardGrande>
        </CardHover>

        <CardHover
          direita
          tooltip={
            <TooltipComparativo periodo={periodoCompTxt} temBase={podeComparar}>
              <TipLinha rotulo="Percentual comparado" valor={`${pct.format(comp.percentualTotal)}%`} />
              <TipLinha rotulo="Variação em p.p." valor={`${atual.percentualTotal - comp.percentualTotal >= 0 ? "+" : "-"}${pct.format(Math.abs(atual.percentualTotal - comp.percentualTotal))} p.p.`} />
            </TooltipComparativo>
          }
        >
          <CardGrande titulo="📊 % Brindes / faturamento">
            <p className="mt-1 text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">{atual.disponivel ? `${pct.format(atual.percentualTotal)}%` : "—"}</p>
            {atual.disponivel ? (
              <div className="mt-2 space-y-0.5 text-sm text-foreground/60">
                <p>Total de Brindes ÷ Faturamento</p>
                <p className="text-xs text-foreground/45">Informativo — não define o semáforo.</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-foreground/45">Sem dados no período</p>
            )}
          </CardGrande>
        </CardHover>

        <CardHover
          tooltip={
            <TooltipComparativo periodo={periodoCompTxt} temBase={podeComparar}>
              <TipLinha rotulo="Refeições comparadas" valor={`${quantidadeFmt.format(refeicoesComp)} ${Math.round(refeicoesComp) === 1 ? "refeição" : "refeições"}`} />
              <TipLinha rotulo="Consumo comparado" valor={moeda.format(consumoFuncionariosComp)} />
              <TipLinha
                rotulo="Variação da quantidade"
                valor={`${Math.round(refeicoes) - Math.round(refeicoesComp) >= 0 ? "+" : "-"}${quantidadeFmt.format(Math.abs(Math.round(refeicoes) - Math.round(refeicoesComp)))} refeições`}
              />
              <TipLinha rotulo="Variação do valor" valor={`${sinalMoeda(consumoFuncionarios - consumoFuncionariosComp)} (${sinalPct(consumoFuncionarios, consumoFuncionariosComp)})`} />
              <p className="pt-1 text-[11px] text-foreground/45">Variação factual (sem melhorou/piorou).</p>
            </TooltipComparativo>
          }
        >
          <CardGrande titulo="🍽️ Refeições de colaboradores">
            <p className="mt-1 text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">
              {atual.disponivel ? `${quantidadeFmt.format(refeicoes)} ${Math.round(refeicoes) === 1 ? "refeição" : "refeições"}` : "—"}
            </p>
            {atual.disponivel ? (
              <div className="mt-2 space-y-0.5 text-xs text-foreground/60">
                <p>
                  <span className="font-semibold tabular-nums">{moeda.format(consumoFuncionarios)}</span> em consumo
                </p>
                <p>Consumo de Funcionários ÷ R$ {VALOR_POR_REFEICAO},00 por refeição (informativo — não entra na performance).</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-foreground/45">Sem dados no período</p>
            )}
          </CardGrande>
        </CardHover>
      </div>

      {/* Explicação escrita (não depende de ícone nem de clique). */}
      <div className="rounded-lg border border-ragga-blue/10 bg-white px-4 py-3">
        <p className="text-sm text-ragga-blue-dark">
          Brindes Controláveis são brindes que podem ser acompanhados e influenciados pela operação da loja. Eles são utilizados para avaliar a performance e definir o semáforo.
        </p>
        <p className="mt-1 text-xs text-foreground/50">Brindes Não Controláveis fazem parte do Total de Brindes, mas não penalizam a loja.</p>
      </div>

      {/* 2) O QUE GEROU OS BRINDES? — modalidades → submotivos (reconcilia com o total dos cards) */}
      <SecaoMotivos
        linhas={linhasMotivos}
        totalAtual={atual.total}
        totalComparado={podeComparar ? comp.total : null}
        comparavel={podeComparar}
        motivoSemComparacao={atual.disponivel && comp.disponivel ? comparab.motivo : "Sem registros de Brindes em um dos períodos."}
        periodoAtualTxt={ocorrAtualTxt}
        periodoCompTxt={ocorrCompTxt}
        escopoTxt={loja === "TODAS" ? "rede" : loja}
        motivoSelecionado={modalidadeAtiva}
        aoInvestigar={investigarModalidade}
      />

      {/* 5) RANKING DE LOJAS */}
      {/* COMPARATIVO DE BRINDES POR LOJA — valor absoluto e proporção (% s/ faturamento) lado a lado, sem julgar só pelo valor. */}
      <Secao
        titulo="Comparativo de brindes por loja"
        acao={
          <label className="flex items-center gap-2 text-xs font-medium text-ragga-blue-dark">
            Ordenar por
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as OrdemRanking)} className="rounded-md border border-ragga-blue/15 bg-white px-2 py-1.5 text-xs">
              <option value="valor">Valor de brindes (R$)</option>
              <option value="percentual">% controláveis sobre o faturamento</option>
              <option value="variacao">Variação vs. período comparado (R$)</option>
              <option value="loja">Loja</option>
              <option value="criticidade">Status (semáforo)</option>
            </select>
          </label>
        }
      >
        <p className="mb-3 text-[11px] text-foreground/45">
          Valor absoluto e proporção são mostrados separadamente: a loja de maior valor não é, por isso, a pior. Status = brindes CONTROLÁVEIS ÷ faturamento (regra existente); o total e os não controláveis não penalizam a loja.
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {(["excelente", "atencao", "critico"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFiltro((a) => (a === s ? null : s))}
              aria-pressed={statusFiltro === s}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-shadow ${ESTILO_CHIP[s].classe} ${statusFiltro === s ? "ring-2 ring-ragga-blue/50" : "hover:shadow-sm"}`}
            >
              <span className="font-bold text-ragga-blue-dark">
                {ESTILO_CHIP[s].emoji} {contagem[s]} {contagem[s] === 1 ? "loja" : "lojas"}
              </span>
              <span className="block text-xs text-foreground/60">
                {ROTULO_STATUS_BRINDE[s]} — {ESTILO_CHIP[s].faixa}
              </span>
            </button>
          ))}
          {statusFiltro && (
            <button type="button" onClick={() => setStatusFiltro(null)} className="self-center text-xs font-semibold text-ragga-blue hover:underline">
              limpar filtro
            </button>
          )}
        </div>

        <div className="-mx-5 overflow-x-auto sm:-mx-6">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                <th className="px-5 py-2.5 sm:px-6">Loja</th>
                <th className="px-4 py-2.5">Total de brindes</th>
                <th className="px-4 py-2.5">Controláveis</th>
                <th className="px-4 py-2.5">Faturamento da loja</th>
                <th className="px-4 py-2.5">% control. s/ fat.</th>
                <th className="px-4 py-2.5">Variação do total (R$ / %)</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rankingVisivel.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-sm text-foreground/45 sm:px-6">
                    Nenhuma loja neste filtro.
                  </td>
                </tr>
              ) : (
                rankingVisivel.map((l) => {
                  const aberta = lojasAbertas.has(l.unidade);
                  return (
                    <Fragment key={l.unidade}>
                      <tr onClick={() => alternarLoja(l.unidade)} className="cursor-pointer border-b border-ragga-blue/5 hover:bg-ragga-blue/[0.04]">
                        <td className="px-5 py-3 font-semibold text-ragga-blue-dark sm:px-6">
                          <span className="mr-1.5 inline-block w-3 text-ragga-blue/45">{aberta ? "▾" : "▸"}</span>
                          {l.unidade}
                        </td>
                        <td className="px-4 py-3 tabular-nums font-semibold text-foreground/80">{moeda.format(l.total)}</td>
                        <td className="px-4 py-3 tabular-nums text-foreground/80">{moeda.format(l.controlaveis)}</td>
                        <td className="px-4 py-3 tabular-nums text-foreground/70">{moeda.format(l.faturamento)}</td>
                        <td className="px-4 py-3 tabular-nums font-semibold text-ragga-blue-dark">
                          {l.percentualControlaveis === null ? (
                            <span className="text-xs font-semibold text-semaforo-amarelo">
                              ⚠ faturamento em {l.diasComFaturamento} de {l.diasDoPeriodo} dias
                            </span>
                          ) : (
                            `${pct.format(l.percentualControlaveis)}%`
                          )}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {l.variacaoReais === null ? (
                            <span className="text-foreground/40">Sem base</span>
                          ) : (
                            <span className="whitespace-nowrap font-semibold text-foreground/75">
                              {l.variacaoReais > 0 ? "↑" : l.variacaoReais < 0 ? "↓" : "="} {moeda.format(Math.abs(l.variacaoReais))}
                              {l.variacaoPercentual !== null && ` (${l.variacaoPercentual >= 0 ? "+" : "-"}${pct.format(Math.abs(l.variacaoPercentual))}%)`}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {l.coberturaParcial ? (
                            <span className="text-xs font-semibold text-semaforo-amarelo">⚠ Cobertura parcial</span>
                          ) : (
                            <SemaforoBadge cor={l.loja.cor} texto={`${ESTILO_CHIP[l.status].emoji} ${ROTULO_STATUS_BRINDE[l.status]}`} />
                          )}
                        </td>
                      </tr>
                      {aberta && (
                        <tr>
                          <td colSpan={7} className="bg-ragga-bg/60 px-5 py-4 sm:px-6">
                            <DetalheLoja loja={l.loja} compLoja={l.compLoja ?? undefined} periodoAtual={periodoAtualTxt} periodoComp={periodoCompTxt} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-foreground/40">
          Variação do total de brindes em relação ao período comparado ({ocorrCompTxt}, datas de ocorrência); só aparece com base e faturamento completos da loja nos dois períodos. Loja com faturamento em menos dias que o período fica sem % e sem status (valores em R$ mantidos).
        </p>
      </Secao>

      {/* 4) INVESTIGAR POR MODALIDADE — compara lojas dentro da mesma modalidade */}
      <div id="brindes-modalidade" className="scroll-mt-4">
        <SecaoModalidade
          modalidades={modalidades}
          selecionada={modalidadeAtiva}
          aoSelecionar={setModalidadeSel}
          lojas={lojasModalidade}
          controlavel={motivosAtual.find((m) => m.motivo === modalidadeAtiva)?.controlavel ?? false}
          periodoAtualTxt={ocorrAtualTxt}
          periodoCompTxt={ocorrCompTxt}
          comparavel={baseCobreOsPeriodos(dados)}
        />
      </div>

      {/* DETALHAMENTO — comparativo completo dos períodos e evolução diária */}
      {/* 2) COMPARATIVO DO PERÍODO */}
      <Secao titulo="Comparativo de períodos">
        <div className="mb-3 grid gap-1 text-xs text-foreground/60 sm:grid-cols-2">
          <p>
            <span className="font-semibold text-ragga-blue-dark">Período atual:</span> {periodoAtualTxt}
          </p>
          <p>
            <span className="font-semibold text-ragga-blue-dark">Período comparado:</span> {periodoCompTxt}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                <th className="py-2 pr-4">Indicador</th>
                <th className="px-3 py-2">Atual</th>
                <th className="px-3 py-2">Comparado</th>
                <th className="px-3 py-2">Variação R$</th>
                <th className="px-3 py-2">Variação %</th>
                <th className="px-3 py-2">% fat. atual</th>
                <th className="px-3 py-2">% fat. comparado</th>
                <th className="px-3 py-2">Situação</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {linhasComparativo.map((r) => (
                <tr key={r.chave} className="border-b border-ragga-blue/5 last:border-0">
                  <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">{r.rotulo}</td>
                  <td className="px-3">{slot(r.a, atual.disponivel, moeda.format)}</td>
                  <td className="px-3">{slot(r.c, comp.disponivel, moeda.format)}</td>
                  {podeComparar ? <VarCelulas atual={r.a} anterior={r.c} interpretar={r.interpretar} /> : (<><td className="px-3">—</td><td className="px-3">—</td></>)}
                  <td className="px-3">{r.pa === null ? "—" : atual.disponivel ? `${pct.format(r.pa)}%` : "—"}</td>
                  <td className="px-3">{r.pc === null ? "—" : comp.disponivel ? `${pct.format(r.pc)}%` : "—"}</td>
                  {/* Controláveis: Melhorou/Piorou pelo % sobre o faturamento (nunca pelo valor em R$). */}
                  <td className="px-3">
                    {r.chave === "fat" ? (
                      <span className="text-xs text-foreground/40">Variação factual</span>
                    ) : (
                      <Situacao
                        atual={r.chave === "ctrl" ? (r.pa ?? 0) : r.a}
                        anterior={r.chave === "ctrl" ? (r.pc ?? 0) : r.c}
                        controlavel={r.chave === "ctrl"}
                        temBase={podeComparar}
                      />
                    )}
                    {r.chave === "ctrl" && podeComparar && (
                      <span className="mt-0.5 block text-[11px] text-foreground/50">
                        % fat.: <Variacao atual={atual.percentualControlaveis} anterior={comp.percentualControlaveis} formato="pp" interpretar />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-foreground/40">
          Melhorou/Piorou vale somente para Brindes Controláveis (menor = 🟢 melhorou, maior = 🔴 piorou). Total de Brindes e Não Controláveis: apenas a variação factual.
        </p>
      </Secao>

      <Secao titulo="📈 Evolução por dia" acao={<ToggleModo modo={modoGrafico} aoAlterar={setModoGrafico} />}>
        <Evolucao dias={atual.diario} modo={modoGrafico} />
      </Secao>

    </div>
  );
}

/** Expansão da loja: resumo → comparativo (total/controláveis/não controláveis) → comparação por motivo → evolução diária. */
function DetalheLoja({ loja, compLoja, periodoAtual, periodoComp }: { loja: LojaBrindes; compLoja?: LojaBrindes; periodoAtual: string; periodoComp: string }) {
  const [modo, setModo] = useState<"valor" | "percentual">("valor");
  // "Sem dados" no período comparado só quando a loja nem operou (sem faturamento) nem teve brindes.
  const temComp = !!compLoja && (compLoja.faturamento > 0 || compLoja.total > 0);

  const linhas = [
    { chave: "total", rotulo: "🎁 Total de Brindes", a: loja.total, c: compLoja?.total ?? 0, interpretar: false },
    { chave: "ctrl", rotulo: "🎯 Brindes Controláveis", a: loja.controlaveis, c: compLoja?.controlaveis ?? 0, interpretar: false },
    { chave: "nao", rotulo: "ℹ️ Brindes Não Controláveis", a: loja.naoControlaveis, c: compLoja?.naoControlaveis ?? 0, interpretar: false },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Resumo da loja</p>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-8">
          <Item rotulo="Faturamento" valor={moeda.format(loja.faturamento)} />
          <Item rotulo="Total de brindes" valor={moeda.format(loja.total)} />
          <Item rotulo="Controláveis" valor={moeda.format(loja.controlaveis)} />
          <Item rotulo="Não controláveis" valor={moeda.format(loja.naoControlaveis)} />
          <Item rotulo="% control. / fat." valor={`${pct.format(loja.percentualControlaveis)}%`} />
          <Item rotulo="% total / fat. (informativo)" valor={`${pct.format(loja.percentualTotal)}%`} />
          <Item rotulo="Limite saudável" valor={`${pct.format(LIMITE_SAUDAVEL_BRINDES)}%`} />
          <Item rotulo="Distância do limite" valor={distanciaTexto(loja.percentualControlaveis)} />
          <Item rotulo="Status" valor={<SemaforoBadge cor={loja.cor} texto={`${ESTILO_CHIP[loja.status].emoji} ${ROTULO_STATUS_BRINDE[loja.status]}`} />} />
        </div>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Comparativo</p>
        {temComp ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                  <th className="py-1 pr-3" />
                  <th className="px-2 py-1">Atual<span className="block font-normal normal-case">{periodoAtual}</span></th>
                  <th className="px-2 py-1">Comparado<span className="block font-normal normal-case">{periodoComp}</span></th>
                  <th className="px-2 py-1">Variação R$</th>
                  <th className="px-2 py-1">Variação %</th>
                  <th className="px-2 py-1">Situação</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((r) => (
                  <tr key={r.chave} className="border-t border-ragga-blue/5">
                    <td className="py-1.5 pr-3 font-medium text-ragga-blue-dark">{r.rotulo}</td>
                    <td className="px-2">{moeda.format(r.a)}</td>
                    <td className="px-2">{moeda.format(r.c)}</td>
                    <VarCelulas atual={r.a} anterior={r.c} interpretar={r.interpretar} />
                    <td className="px-2">
                      <Situacao
                        atual={r.chave === "ctrl" ? loja.percentualControlaveis : r.a}
                        anterior={r.chave === "ctrl" ? (compLoja?.percentualControlaveis ?? 0) : r.c}
                        controlavel={r.chave === "ctrl"}
                      />
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-ragga-blue/5">
                  <td className="py-1.5 pr-3 font-medium text-ragga-blue-dark">% controláveis / faturamento</td>
                  <td className="px-2">{pct.format(loja.percentualControlaveis)}%</td>
                  <td className="px-2">{pct.format(compLoja?.percentualControlaveis ?? 0)}%</td>
                  <td colSpan={2} className="px-2">
                    <Variacao atual={loja.percentualControlaveis} anterior={compLoja?.percentualControlaveis ?? 0} formato="pp" interpretar />
                  </td>
                  <td className="px-2">
                    <Situacao atual={loja.percentualControlaveis} anterior={compLoja?.percentualControlaveis ?? 0} controlavel />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-foreground/45">Sem dados da loja no período comparado.</p>
        )}
      </div>

      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Composição por motivo</p>
        <TabelaComparativoMotivos atual={loja.motivos} comparado={compLoja?.motivos ?? []} temBase={temComp} pctControlaveisAtual={loja.percentualControlaveis} pctControlaveisComparado={compLoja?.percentualControlaveis ?? 0} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Evolução diária — {loja.unidade}</p>
          <ToggleModo modo={modo} aoAlterar={setModo} />
        </div>
        <Evolucao dias={loja.diario} modo={modo} altura={190} />
      </div>
    </div>
  );
}
