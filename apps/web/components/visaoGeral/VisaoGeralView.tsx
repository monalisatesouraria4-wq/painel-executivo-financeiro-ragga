"use client";

import { Fragment, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { SemaforoBadge } from "@/components/ui/SemaforoBadge";
import { paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { HistoricoMensalExpandido } from "./HistoricoMensalExpandido";
import { UNIDADES } from "@painel/shared";
import type { CorSemaforo } from "@/lib/rules/semaforos";
import type { VisaoGeralData, MesAnteriorVisaoGeral, IndicadorComSemaforo, IndicadorBrindes, IndicadorSimples, LinhaDetalhamentoLoja } from "@/lib/services/visaoGeral";
import type { FormaPagamentoBuckets } from "@/lib/services/fechamentoWhatsapp";
import { calcularPontosAtencao, compararCriticidade, contarCriticidade } from "@/lib/rules/prioridades";
import { buscarVisaoGeralPorPeriodo } from "@/lib/actions/buscarVisaoGeralPorPeriodo";
import { DesempenhoCaixa } from "./DesempenhoCaixa";
import type { DesempenhoCaixaData, IndicadorDesempenhoId } from "@/lib/services/desempenhoCaixa";
import { buscarDesempenhoCaixa } from "@/lib/actions/buscarDesempenhoCaixa";

// timeZone: "UTC" — `dataReferencia` é uma data "pura" (meia-noite UTC); sem fixar o fuso,
// a formatação usa o fuso local do servidor/navegador e pode exibir o dia anterior (bug real
// encontrado em etapa anterior, ao corrigir a Visão Geral para consultar a data exata sem D-1).
const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const formatadorDataExtenso = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" });
// timeZone: "UTC" — `dataRegistro` vem do banco como data "pura" (meia-noite UTC); sem fixar
// o fuso aqui o navegador poderia exibir o dia anterior dependendo do fuso local do cliente
// (mesmo cuidado já aplicado em outras telas, ex.: ConferenciaTab.tsx).
const formatadorDataRegistro = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Mesmo mapeamento cor→texto já usado em `IndicadorCard.tsx` — não é um rótulo novo. */
const TEXTO_SEMAFORO: Record<CorSemaforo, string> = {
  azul: "Excelente",
  verde: "Bom",
  amarelo: "Atenção",
  vermelho: "Crítico",
};

/**
 * Ícones discretos (SVG inline, sem dependência nova) — puramente
 * decorativos. Não carregam nenhum dado nem lógica.
 */
type NomeIcone =
  | "faturamento"
  | "credito"
  | "debito"
  | "pix"
  | "voucher"
  | "prazo"
  | "online"
  | "dinheiro"
  | "brinde"
  | "cancelSalao"
  | "cancelDelivery"
  | "retirada"
  | "deposito"
  | "fechamento"
  | "pdv"
  | "troco"
  | "conferencia"
  | "quebra"
  | "loja"
  | "alerta"
  | "calendario";

const ICONES: Record<NomeIcone, string> = {
  faturamento: "M3 13.5 8.5 8l3.5 3 6-6.5M13 3h5v5",
  credito: "M2.5 6h15M2.5 6.5A1.5 1.5 0 0 1 4 5h12a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 15H4a1.5 1.5 0 0 1-1.5-1.5v-7ZM5.5 12h3",
  debito: "M2.5 6.5A1.5 1.5 0 0 1 4 5h12a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 15H4a1.5 1.5 0 0 1-1.5-1.5v-7ZM2.5 8.5h15",
  pix: "M10 2.5 15.5 8 10 13.5 4.5 8 10 2.5ZM6 8h.01M14 8h.01",
  voucher: "M3 6.5A1.5 1.5 0 0 1 4.5 5h11A1.5 1.5 0 0 1 17 6.5v1a1.5 1.5 0 0 0 0 3v1A1.5 1.5 0 0 1 15.5 13h-11A1.5 1.5 0 0 1 3 11.5v-1a1.5 1.5 0 0 0 0-3v-1Z",
  prazo: "M10 5.5V10l3 2M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
  online: "M10 2.5c2.2 2.4 2.2 12.6 0 15M10 2.5c-2.2 2.4-2.2 12.6 0 15M3 10h14M3 10a7 7 0 0 0 14 0M3 10a7 7 0 0 1 14 0",
  dinheiro: "M2.5 5.5h15v9h-15v-9ZM10 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z",
  brinde: "M10 6v11M3 9.5h14v3H3v-3ZM4 9.5V17h12V9.5M10 6c-1.3 0-3-1-3-2.3S8 2 9 3s1 2 1 3ZM10 6c1.3 0 3-1 3-2.3S11.3 2 10.3 3s-1 2-1 3Z",
  cancelSalao: "M6.5 6.5l7 7m0-7l-7 7M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z",
  cancelDelivery: "M4 6h9l2.5 4.5V15h-2M4 6l-1 9h2M4 6 3 3M6.5 15a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Zm8 0a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z",
  retirada: "M10 3v10m0 0-3.5-3.5M10 13l3.5-3.5M4 15.5h12",
  deposito: "M10 17V7m0 0 3.5 3.5M10 7 6.5 10.5M4 4.5h12",
  fechamento: "M4 8.5V6a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 16 6v2.5M3 8.5h14v7.5H3V8.5Zm5.5 3.75a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z",
  pdv: "M3 5h14v10H3V5Zm2 2.5h10M5 10h3m-3 2.5h2",
  troco: "M6.5 8.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Zm1-4.5h8a3.5 3.5 0 0 1 3.5 3.5v.2M12.5 15.5h-8A3.5 3.5 0 0 1 1 12v-.2",
  conferencia: "M6 3.5h8A1.5 1.5 0 0 1 15.5 5v11a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 16V5A1.5 1.5 0 0 1 6 3.5Zm1.5 5 1.5 1.5 3-3",
  quebra: "M10 2.5 3 6v4c0 4.2 3 7 7 7.5 4-.5 7-3.3 7-7.5V6l-7-3.5Zm0 4v4m0 3h.01",
  loja: "M3 8.5V16h14V8.5M2.5 6l1-3h13l1 3M2.5 6a2 2 0 0 0 4 0m0 0a2 2 0 0 0 4 0m0 0a2 2 0 0 0 4 0m0 0a2 2 0 0 0 4 0",
  alerta: "M10 3 2 16.5h16L10 3Zm0 5.5v3.5m0 2.5h.01",
  calendario: "M4 4.5h12v12H4v-12Zm0 3.5h12M7 3v3m6-3v3",
};

function Icone({ nome, className = "h-4 w-4" }: { nome: NomeIcone; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={ICONES[nome]} />
    </svg>
  );
}

/**
 * Insight explicativo (item 1 desta etapa) — ícone discreto "ⓘ" com o
 * texto no atributo `title` nativo (mostra no hover/foco do mouse e é
 * lido por leitor de tela, sem precisar de nenhuma biblioteca de
 * tooltip nova). Puramente apresentacional: não calcula nem consulta
 * nada, só explica o número que já está na tela para quem não conhece a
 * operação de caixa.
 */
function InfoInsight({ texto, claro = false }: { texto: string; claro?: boolean }) {
  return (
    <span
      title={texto}
      tabIndex={0}
      className={`inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border text-[10px] font-bold leading-none ${
        claro ? "border-white/40 text-white/70 hover:bg-white/10" : "border-ragga-blue/30 text-ragga-blue/60 hover:bg-ragga-blue/5"
      }`}
      aria-label={texto}
    >
      i
    </span>
  );
}

/** Cores de acento por cor de semáforo — usadas na barra lateral dos cards de indicador. */
const ACENTO_POR_SEMAFORO: Record<CorSemaforo, string> = {
  azul: "bg-semaforo-azul",
  verde: "bg-semaforo-verde",
  amarelo: "bg-semaforo-amarelo",
  vermelho: "bg-semaforo-vermelho",
};

/**
 * Painel de seção (item 3 da etapa de redesign — "cada seção deve
 * parecer uma seção própria do dashboard", não uma pilha de cards
 * brancos soltos). Puramente estrutural/visual: título + conteúdo,
 * variante `operacional` usada só em Controles de Caixa para separar
 * visualmente "indicadores financeiros" de "controle operacional".
 */
function Secao({
  titulo,
  insight,
  acao,
  tom = "clara",
  children,
}: {
  titulo: string;
  insight?: string;
  acao?: ReactNode;
  tom?: "clara" | "operacional";
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border p-5 sm:p-6 ${
        tom === "operacional" ? "border-ragga-blue-dark/10 bg-ragga-blue-dark/[0.035]" : "border-ragga-blue/10 bg-white"
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-ragga-blue-dark">
          <span className="h-3.5 w-1 rounded-full bg-ragga-blue" />
          {titulo}
          {insight && <InfoInsight texto={insight} />}
        </h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

/**
 * Card de indicador com identidade visual Ragga — versão LOCAL a esta
 * tela (não é o `IndicadorCard` compartilhado, para não alterar
 * Indicadores/Retiradas). Puramente apresentacional: recebe os mesmos
 * campos já calculados em `visaoGeral.ts` (disponivel/valor/
 * percentualFaturamento/semaforo/dataRegistro), nenhum cálculo novo. A
 * barra fina no rodapé é só uma leitura visual do `percentualFaturamento`
 * já calculado (capada em 100% da largura) — não é um indicador novo.
 */
function IndicadorVisaoGeral({
  titulo,
  icone,
  dados,
  indisponivelTexto,
  insight,
  modoPeriodo,
}: {
  titulo: string;
  icone: NomeIcone;
  dados: IndicadorComSemaforo;
  indisponivelTexto: string;
  insight?: string;
  modoPeriodo?: boolean;
}) {
  const larguraBarra = dados.disponivel && dados.percentualFaturamento !== undefined ? Math.min(100, dados.percentualFaturamento * 10) : 0;
  return (
    <div className="group relative overflow-hidden rounded-xl border border-ragga-blue/10 bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ragga-blue-dark text-white">
          <Icone nome={icone} className="h-4 w-4" />
        </span>
        {dados.disponivel && dados.semaforo && <SemaforoBadge cor={dados.semaforo} texto={TEXTO_SEMAFORO[dados.semaforo]} />}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/45">
        {titulo}
        {insight && <InfoInsight texto={insight} />}
      </p>
      {dados.disponivel ? (
        <>
          <p className="mt-1 text-[1.65rem] font-extrabold leading-none text-ragga-blue-dark">{formatadorMoeda.format(dados.valor ?? 0)}</p>
          <div className="mt-2 flex items-center justify-between text-xs text-foreground/50">
            <span>{dados.percentualFaturamento !== undefined && `${formatadorPercentual.format(dados.percentualFaturamento)}% do faturamento`}</span>
            {/* No modo período o `dataRegistro` é só o fim do intervalo — mostrar aqui
                confundiria (parece um único dia); o período já está visível no filtro/hero. */}
            {!modoPeriodo && dados.dataRegistro && <span className="text-foreground/35">{formatadorDataRegistro.format(dados.dataRegistro)}</span>}
          </div>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-ragga-bg">
            <div
              className={`h-full rounded-full ${dados.semaforo ? ACENTO_POR_SEMAFORO[dados.semaforo] : "bg-ragga-blue/30"}`}
              style={{ width: `${larguraBarra}%` }}
            />
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-[1.65rem] font-extrabold leading-none text-foreground/20">—</p>
          <p className="mt-2 text-xs text-foreground/45">{indisponivelTexto}</p>
        </>
      )}
    </div>
  );
}

/**
 * Comparativo mensal ao clicar no card (popover compacto). Só apresentação: os
 * valores vêm de `dados` (período atual) e `dados.mesAnterior` (mês calendário
 * anterior, mesma Loja) calculados em `visaoGeral.ts`. Cada popover é uma lista
 * de blocos (ex.: Faturamento + o indicador, ou só a métrica do Controle de
 * Caixa). Tendência apenas ↑/↓ — sem julgar "bom/ruim"; a criticidade segue só
 * nos thresholds existentes. Sem dado em um dos meses: "Sem dados" (nunca zero).
 */
const formatadorMesAno = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

function rotuloMes(data: Date): string {
  const [mes, ano] = formatadorMesAno.format(data).split(" de ");
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)}/${ano}`;
}

interface DadoComparativo {
  disponivel: boolean;
  valor?: number;
  /** % do faturamento (indicadores); ausente quando não se aplica. */
  percentual?: number;
}

type FormatoComparativo = "moeda" | "caixas" | "divergencias" | "percentual";

interface BlocoComparativo {
  titulo?: string;
  atual: DadoComparativo;
  anterior: DadoComparativo;
  formato: FormatoComparativo;
}

function formatarValor(formato: FormatoComparativo, n: number): string {
  switch (formato) {
    case "moeda":
      return formatadorMoeda.format(n);
    case "caixas":
      return `${n} caixas`;
    case "divergencias":
      return `${n} divergência(s)`;
    case "percentual":
      return `${formatadorPercentual.format(n)}%`;
  }
}

function formatarVariacao(formato: FormatoComparativo, delta: number, anterior: number): string {
  const sinal = delta < 0 ? "-" : "+";
  const abs = Math.abs(delta);
  switch (formato) {
    case "moeda": {
      const pct = anterior !== 0 ? ` (${sinal || "+"}${formatadorPercentual.format(Math.abs((delta / anterior) * 100))}%)` : "";
      return `${formatadorMoeda.format(abs)}${pct}`;
    }
    case "caixas":
      return `${abs} caixas`;
    case "divergencias":
      return `${abs} divergência(s)`;
    case "percentual":
      return `${formatadorPercentual.format(abs)} p.p.`;
  }
}

function LinhaComparativo({ rotulo, dado, formato }: { rotulo: string; dado: DadoComparativo; formato: FormatoComparativo }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-foreground/60">{rotulo}</span>
      {dado.disponivel && dado.valor !== undefined ? (
        <span className="text-right font-semibold tabular-nums text-ragga-blue-dark">
          {formatarValor(formato, dado.valor)}
          {dado.percentual !== undefined && (
            <span className="block text-xs font-normal text-foreground/50">{formatadorPercentual.format(dado.percentual)}% do faturamento</span>
          )}
        </span>
      ) : (
        <span className="text-right text-foreground/40">Sem dados</span>
      )}
    </div>
  );
}

function BlocoComparativoView({ bloco, nomeAnterior, nomeAtual }: { bloco: BlocoComparativo; nomeAnterior: string; nomeAtual: string }) {
  const { atual, anterior, formato } = bloco;
  const comparavel = atual.disponivel && anterior.disponivel && atual.valor !== undefined && anterior.valor !== undefined;
  const delta = comparavel ? (atual.valor as number) - (anterior.valor as number) : null;
  const seta = delta === null ? "" : delta > 0 ? "↑" : delta < 0 ? "↓" : "=";
  return (
    <div className="space-y-1.5">
      {bloco.titulo && <p className="text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">{bloco.titulo}</p>}
      <LinhaComparativo rotulo={nomeAnterior} dado={anterior} formato={formato} />
      <LinhaComparativo rotulo={nomeAtual} dado={atual} formato={formato} />
      <div className="flex items-baseline justify-between gap-3 border-t border-ragga-blue/10 pt-1.5">
        <span className="text-foreground/60">Variação</span>
        {delta === null ? (
          <span className="text-foreground/40">—</span>
        ) : (
          <span className="text-right font-bold tabular-nums text-ragga-blue-dark">
            {seta} {formatarVariacao(formato, delta, anterior.valor as number)}
          </span>
        )}
      </div>
    </div>
  );
}

function ComparativoPopover({
  children,
  titulo,
  blocos,
  mesAtual,
  mesAnterior,
  nota,
  href,
  alinharDireita = false,
}: {
  children: ReactNode;
  titulo: string;
  blocos: BlocoComparativo[];
  mesAtual: Date;
  /** Link opcional para o ranking por loja / plano de ação do indicador (Indicadores). */
  href?: string;
  /** `null` = período selecionado não é um mês calendário completo. */
  mesAnterior: Date | null;
  nota?: string;
  alinharDireita?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAberto(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  return (
    <div ref={raiz} className="relative">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={aberto}
        title="Clique para ver o comparativo com o mês anterior"
        onClick={() => setAberto((a) => !a)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setAberto((a) => !a);
          }
        }}
        className="cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ragga-blue/40"
      >
        {children}
      </div>
      {aberto && (
        <div
          role="dialog"
          aria-label={`Comparativo — ${titulo}`}
          className={`absolute top-full z-30 mt-2 w-72 rounded-xl border border-ragga-blue/15 bg-white p-4 text-sm shadow-[0_12px_32px_-8px_rgba(31,53,112,0.35)] ${
            alinharDireita ? "right-0" : "left-0"
          }`}
        >
          <p className="text-[11px] font-bold uppercase tracking-wide text-ragga-blue">
            Comparativo — {mesAnterior ? rotuloMes(mesAnterior) : "mês anterior"}
          </p>
          <p className="mt-0.5 text-xs text-foreground/50">{titulo}</p>
          {mesAnterior === null ? (
            <p className="mt-3 text-xs text-foreground/60">Comparativo mensal disponível para períodos mensais completos.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {blocos.map((b, i) => (
                <BlocoComparativoView
                  key={`${b.titulo ?? "unico"}-${i}`}
                  bloco={b}
                  nomeAnterior={rotuloMes(mesAnterior).split("/")[0]}
                  nomeAtual={rotuloMes(mesAtual).split("/")[0]}
                />
              ))}
              {nota && <p className="text-[11px] text-foreground/45">{nota}</p>}
            </div>
          )}
          {href && (
            <Link href={href} className="mt-3 block text-xs font-semibold text-ragga-blue hover:underline">
              Abrir ranking por loja e plano de ação →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Card de Brindes: semáforo/percentual referem-se SOMENTE aos brindes
 * CONTROLÁVEIS (regra em `lib/rules/brindes.ts`); mostra também o total
 * geral e os não controláveis, com a composição em "Ver composição".
 */
function ListaComposicao({ itens }: { itens: { rotulo: string; valor: number }[] }) {
  if (itens.length === 0) return <p className="text-foreground/40">Sem registros</p>;
  return (
    <>
      {itens.map((i) => (
        <div key={i.rotulo} className="flex justify-between text-foreground/65">
          <span>{i.rotulo}</span>
          <span className="tabular-nums">{formatadorMoeda.format(i.valor)}</span>
        </div>
      ))}
    </>
  );
}

function BrindesCard({ dados, indisponivelTexto, modoPeriodo }: { dados: IndicadorBrindes; indisponivelTexto: string; modoPeriodo?: boolean }) {
  const detalhe = dados.detalhe;
  const larguraBarra = dados.disponivel && dados.percentualFaturamento !== undefined ? Math.min(100, dados.percentualFaturamento * 10) : 0;
  return (
    <div className="group relative overflow-hidden rounded-xl border border-ragga-blue/10 bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ragga-blue-dark text-white">
          <Icone nome="brinde" className="h-4 w-4" />
        </span>
        {dados.disponivel && dados.semaforo && <SemaforoBadge cor={dados.semaforo} texto={TEXTO_SEMAFORO[dados.semaforo]} />}
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/45">
        Brindes controláveis
        <InfoInsight texto="A criticidade de Brindes considera somente os brindes controláveis pela loja (ex.: Presente, Taxa Extra). Aniversariante, Consumo de Funcionários e Empresas Parceiras não entram no semáforo, mas continuam no total e na composição." />
      </p>
      {dados.disponivel && detalhe ? (
        <>
          <p className="mt-1 text-[1.65rem] font-extrabold leading-none text-ragga-blue-dark">{formatadorMoeda.format(detalhe.controlaveis)}</p>
          <p className="mt-2 text-xs text-foreground/50">
            {dados.percentualFaturamento !== undefined && `${formatadorPercentual.format(dados.percentualFaturamento)}% do faturamento (controláveis)`}
          </p>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-ragga-bg">
            <div
              className={`h-full rounded-full ${dados.semaforo ? ACENTO_POR_SEMAFORO[dados.semaforo] : "bg-ragga-blue/30"}`}
              style={{ width: `${larguraBarra}%` }}
            />
          </div>
          <dl className="mt-3 space-y-0.5 text-xs text-foreground/60">
            <div className="flex justify-between">
              <dt>Total de brindes</dt>
              <dd className="tabular-nums">{formatadorMoeda.format(detalhe.total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Controláveis</dt>
              <dd className="tabular-nums">{formatadorMoeda.format(detalhe.controlaveis)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Não controláveis</dt>
              <dd className="tabular-nums">{formatadorMoeda.format(detalhe.naoControlaveis)}</dd>
            </div>
          </dl>
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer font-semibold text-ragga-blue">Ver composição</summary>
            <div className="mt-2 space-y-2">
              <div>
                <p className="font-semibold uppercase tracking-wide text-foreground/45">Não controláveis</p>
                <ListaComposicao itens={detalhe.composicaoNaoControlaveis} />
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wide text-foreground/45">Controláveis</p>
                <ListaComposicao itens={detalhe.composicaoControlaveis} />
              </div>
            </div>
          </details>
          {!modoPeriodo && dados.dataRegistro && <p className="mt-2 text-[11px] text-foreground/35">{formatadorDataRegistro.format(dados.dataRegistro)}</p>}
        </>
      ) : (
        <>
          <p className="mt-1 text-[1.65rem] font-extrabold leading-none text-foreground/20">—</p>
          <p className="mt-2 text-xs text-foreground/45">{indisponivelTexto}</p>
        </>
      )}
    </div>
  );
}

/**
 * Card de Controles de Caixa — mesma família visual, tom "operacional".
 * Mostra o valor do período selecionado; sem registro: "Sem dados no período".
 */
function ControleCard({ titulo, icone, disponivel, valor }: { titulo: string; icone: NomeIcone; disponivel: boolean; valor?: string }) {
  return (
    <div className="rounded-xl border border-ragga-blue-dark/10 bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ragga-blue-dark/15 text-ragga-blue-dark">
        <Icone nome={icone} className="h-4 w-4" />
      </span>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-foreground/45">{titulo}</p>
      {disponivel ? (
        <p className="mt-1 text-lg font-bold text-ragga-blue-dark">{valor}</p>
      ) : (
        <>
          <p className="mt-1 text-lg font-bold text-foreground/20">—</p>
          <p className="mt-1.5 text-xs text-foreground/45">Sem dados no período</p>
        </>
      )}
    </div>
  );
}

/**
 * Célula de indicador percentual + semáforo para "Detalhamento por loja".
 * Usa exatamente o `percentualFaturamento`/`semaforo` já calculados em
 * `visaoGeral.ts` (mesmas faixas de `lib/rules/semaforos.ts` dos cards do
 * topo) — nenhum threshold novo. Sem denominador: "—", sem badge.
 */
function CelulaIndicadorLoja({ indicador }: { indicador: IndicadorComSemaforo }) {
  if (!indicador.disponivel || indicador.percentualFaturamento === undefined) {
    return <span className="text-foreground/35">—</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-foreground/60">{formatadorPercentual.format(indicador.percentualFaturamento)}%</span>
      {indicador.semaforo && <SemaforoBadge cor={indicador.semaforo} texto={TEXTO_SEMAFORO[indicador.semaforo]} />}
    </div>
  );
}

/**
 * Corpo da Visão Geral, extraído para Client Component para ganhar o
 * filtro de "Data de referência" (sempre visível). A data escolhida
 * alimenta `buscarVisaoGeral`, que consulta EXATAMENTE essa data (sem
 * deslocamento D-1 nem fallback para um dia anterior — correção pontual
 * de etapa anterior; ver `lib/services/visaoGeral.ts`).
 *
 * Redesign visual (esta etapa) — "dashboard executivo financeiro da
 * Ragga", não template administrativo genérico: puramente
 * apresentacional, nenhuma consulta/cálculo/regra de data/threshold foi
 * alterado. Estrutura em seções (`Secao`) em vez de cards soltos
 * empilhados; identidade Ragga via a logo oficial (`public/ragga-leaf.png`,
 * asset fornecido pela usuária — nenhuma logo/ícone inventado) e as cores
 * `ragga-blue`/`ragga-blue-dark` já definidas em `globals.css`. Os cards
 * de indicador/controles de caixa (`IndicadorVisaoGeral`/`ControleCard`)
 * são versões locais, só usadas nesta tela, para não afetar o
 * `IndicadorCard` compartilhado por Indicadores/Retiradas.
 */
export function VisaoGeralView({
  dadosIniciais,
  dataInicial,
  dataFimInicial,
  desempenhoInicial = null,
}: {
  dadosIniciais: VisaoGeralData;
  dataInicial: Date;
  dataFimInicial?: Date;
  desempenhoInicial?: DesempenhoCaixaData | null;
}) {
  const [dados, setDados] = useState(dadosIniciais);
  // Filtro de Período (item 2 desta etapa): "data única" é só o caso `dataInicioSel ===
  // dataFimSel` — mesmo padrão inicial de sempre (as duas começam na mesma data), extensão
  // da lógica existente, não um filtro paralelo.
  const [dataInicioSel, setDataInicioSel] = useState(() => paraInputDate(dataInicial));
  const [dataFimSel, setDataFimSel] = useState(() => paraInputDate(dataFimInicial ?? dataInicial));
  const [desempenho, setDesempenho] = useState(desempenhoInicial);
  const [pendente, iniciarTransicao] = useTransition();
  const [lojasExpandidas, setLojasExpandidas] = useState<Set<string>>(new Set());
  const [lojaFiltro, setLojaFiltro] = useState<string>("TODAS");
  const [ordem, setOrdem] = useState<"loja" | "valor" | "percentual" | "criticidade">("loja");
  const [colunaOrdem, setColunaOrdem] = useState<"faturamento" | "retiradaCompraDireta" | "brindes" | "cancelamentoSalao" | "cancelamentoDelivery">("faturamento");
  const [dirDesc, setDirDesc] = useState(false);
  const [pontosAbertos, setPontosAbertos] = useState<Set<string>>(new Set());
  // Período cuja resposta veio com datas diferentes das pedidas (não deveria ocorrer): evita pedir em laço.
  const periodoSemCorrespondencia = useRef<string | null>(null);

  function datasCompletas(v: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 2000;
  }

  function alternarLoja(unidade: string) {
    setLojasExpandidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(unidade)) proximo.delete(unidade);
      else proximo.add(unidade);
      return proximo;
    });
  }

  function alternarPonto(unidade: string) {
    setPontosAbertos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(unidade)) proximo.delete(unidade);
      else proximo.add(unidade);
      return proximo;
    });
  }

  function alterarPeriodo(novoInicio: string, novoFim: string) {
    setDataInicioSel(novoInicio);
    setDataFimSel(novoFim);
  }

  // Sincronização filtro → dados: a busca depende das datas ATUALMENTE selecionadas (estado), não do valor capturado
  // pelo evento. Digitar no campo de data gera valores intermediários (ex.: ano 0002, ou início > fim): só se consulta
  // com as duas datas completas (ano com 4 dígitos) e em ordem. Ao trocar a seleção, a busca anterior é cancelada
  // (`ativo = false`), então uma resposta antiga nunca sobrescreve a mais recente.
  const selecaoValida = datasCompletas(dataInicioSel) && datasCompletas(dataFimSel) && dataInicioSel <= dataFimSel;
  const periodoDosDados = `${paraInputDate(dados.dataInicio)}|${paraInputDate(dados.dataFim)}`;
  const periodoSelecionado = `${dataInicioSel}|${dataFimSel}`;
  // Dados exibidos pertencem a OUTRO período que o selecionado → a tela mostra "atualizando", nunca números antigos.
  const desatualizado = selecaoValida && periodoDosDados !== periodoSelecionado;

  useEffect(() => {
    if (!selecaoValida || periodoSelecionado === periodoDosDados || periodoSelecionado === periodoSemCorrespondencia.current) return;
    let ativo = true;
    iniciarTransicao(async () => {
      const [resultado, resultadoDesempenho] = await Promise.all([
        buscarVisaoGeralPorPeriodo(dataDoInput(dataInicioSel), dataDoInput(dataFimSel)),
        buscarDesempenhoCaixa(dataDoInput(dataInicioSel), dataDoInput(dataFimSel)),
      ]);
      if (!ativo) return;
      // Salvaguarda contra laço: se a resposta vier de um período diferente do pedido, aplica (o cabeçalho mostra o
      // período real) e não pede de novo o mesmo período.
      if (`${paraInputDate(resultado.dataInicio)}|${paraInputDate(resultado.dataFim)}` !== periodoSelecionado) {
        periodoSemCorrespondencia.current = periodoSelecionado;
      }
      setDados(resultado);
      setDesempenho(resultadoDesempenho);
    });
    return () => {
      ativo = false;
    };
    // `iniciarTransicao` é estável; as datas e o período dos dados definem quando buscar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecaoValida, periodoSelecionado, periodoDosDados]);

  /**
   * Filtro de loja (item 2 da etapa de revisão): quando uma loja específica é
   * selecionada, os cards de topo passam a mostrar o valor DAQUELA loja na
   * data de referência selecionada (mesmos números já usados na tabela
   * "Detalhamento por loja" — nenhuma consulta nova). "Todas as lojas" volta
   * ao consolidado de rede. Retirada p/ Depósito e Controles de Caixa não
   * têm quebra por loja disponível nesta etapa — continuam sempre
   * consolidados de rede.
   */
  const linhaLojaFiltro = lojaFiltro !== "TODAS" ? dados.detalhamentoPorLoja.find((l) => l.unidade === lojaFiltro) : undefined;
  const indisponivelLoja: IndicadorComSemaforo = { disponivel: false };
  const indisponivelSimples: IndicadorSimples = { disponivel: false };

  // Seleciona os cards conforme a Loja filtrada; usada para o mês atual E para o mês anterior
  // (o filtro de Loja é aplicado igualmente aos dois períodos no comparativo).
  function cardsDe(d: Pick<MesAnteriorVisaoGeral, "faturamento" | "brindes" | "cancelamentoSalao" | "cancelamentoDelivery" | "retiradaCompraDireta" | "detalhamentoPorLoja">) {
    if (lojaFiltro === "TODAS") {
      return {
        faturamento: d.faturamento as IndicadorSimples,
        brindes: d.brindes,
        cancelamentoSalao: d.cancelamentoSalao,
        cancelamentoDelivery: d.cancelamentoDelivery,
        retiradaCompraDireta: d.retiradaCompraDireta,
      };
    }
    const linha = d.detalhamentoPorLoja.find((l) => l.unidade === lojaFiltro);
    return {
      faturamento: linha?.faturamento ?? indisponivelSimples,
      brindes: (linha?.brindes ?? indisponivelLoja) as IndicadorBrindes,
      cancelamentoSalao: linha?.cancelamentoSalao ?? indisponivelLoja,
      cancelamentoDelivery: linha?.cancelamentoDelivery ?? indisponivelLoja,
      retiradaCompraDireta: linha?.retiradaCompraDireta ?? indisponivelLoja,
    };
  }
  const cardsExibidos = cardsDe(dados);
  const cardsAnterior = dados.mesAnterior ? cardsDe(dados.mesAnterior) : null;

  // --- Comparativo mensal (popover): sempre a MESMA Loja e os mesmos períodos nos dois meses ---
  const dc = (x: { disponivel: boolean; valor?: number; percentualFaturamento?: number }): DadoComparativo => ({
    disponivel: x.disponivel,
    valor: x.valor,
    percentual: x.percentualFaturamento,
  });
  const semDados: DadoComparativo = { disponivel: false };
  const mesAnteriorData = dados.mesAnterior?.dataInicio ?? null;

  function popover(titulo: string, blocos: BlocoComparativo[], no: ReactNode, alinharDireita = false, nota?: string, href?: string) {
    return (
      <ComparativoPopover
        titulo={lojaFiltro === "TODAS" ? titulo : `${titulo} · ${lojaFiltro}`}
        blocos={blocos}
        mesAtual={dados.dataFim}
        mesAnterior={mesAnteriorData}
        alinharDireita={alinharDireita}
        nota={nota}
        href={href}
      >
        {no}
      </ComparativoPopover>
    );
  }

  const blocoFaturamento = (titulo?: string): BlocoComparativo => ({
    titulo,
    atual: dc(cardsExibidos.faturamento),
    anterior: cardsAnterior ? dc(cardsAnterior.faturamento) : semDados,
    formato: "moeda",
  });

  /** Card de indicador/faturamento: bloco do Faturamento (exceto no próprio card de Faturamento) + bloco do indicador. */
  function comparativo(titulo: string, escolher: (c: typeof cardsExibidos) => IndicadorSimples | IndicadorComSemaforo, no: ReactNode, alinharDireita = false, href?: string) {
    const ehFaturamento = escolher(cardsExibidos) === cardsExibidos.faturamento;
    const bloco: BlocoComparativo = {
      titulo: ehFaturamento ? undefined : titulo,
      atual: dc(escolher(cardsExibidos)),
      anterior: cardsAnterior ? dc(escolher(cardsAnterior)) : semDados,
      formato: "moeda",
    };
    return popover(titulo, ehFaturamento ? [bloco] : [blocoFaturamento("Faturamento"), bloco], no, alinharDireita, undefined, href);
  }

  // Navegação para Indicadores (Central de Caixa): a aba aplica D-1 sobre a data de referência, então enviamos o
  // dia seguinte para abrir exatamente o mesmo período mostrado nos cards.
  const diaSeguinte = (valor: string) => paraInputDate(new Date(dataDoInput(valor).getTime() + 86_400_000));
  const parametrosNavegacao = (fonte: string) =>
    `fonte=${fonte}&inicio=${diaSeguinte(dataInicioSel)}&fim=${diaSeguinte(dataFimSel)}${lojaFiltro !== "TODAS" ? `&loja=${encodeURIComponent(lojaFiltro)}` : ""}`;
  const hrefIndicador = (fonte: string) => `/indicadores?${parametrosNavegacao(fonte)}`;
  // Compra Direta vive em Retiradas (sub-aba "Retirada Compra Direta"): mesmo padrão de parâmetros (fonte/inicio/fim/loja).
  const hrefCompraDireta = `/retiradas?${parametrosNavegacao("compraDireta")}`;
  const hrefPlanoAcao = (id: IndicadorDesempenhoId, loja?: string): string | null => {
    const base = id === "compraDireta" ? hrefCompraDireta : hrefIndicador(id);
    return loja ? `${base}&loja=${encodeURIComponent(loja)}` : base;
  };

  // Formas de Pagamento, Retirada p/ Depósito e Quebra de Caixa acompanham a Loja filtrada
  // (mesmo período) — usam o agrupamento por loja devolvido pela mesma consulta do serviço.
  const formasExibidas: FormaPagamentoBuckets | undefined =
    lojaFiltro === "TODAS" ? dados.formasPagamento.buckets : dados.formasPagamento.porLoja?.[lojaFiltro];
  function depositoDe(d: Pick<VisaoGeralData, "retiradaDeposito">): { disponivel: boolean; valor?: number } {
    return lojaFiltro === "TODAS"
      ? { disponivel: d.retiradaDeposito.disponivel, valor: d.retiradaDeposito.valorDia }
      : { disponivel: d.retiradaDeposito.disponivel, valor: d.retiradaDeposito.porLoja?.[lojaFiltro] ?? 0 };
  }
  function quebraDe(d: Pick<VisaoGeralData, "quebraCaixa">): { disponivel: boolean; valor?: number } {
    if (lojaFiltro === "TODAS") return { disponivel: d.quebraCaixa.disponivel, valor: d.quebraCaixa.total };
    const v = d.quebraCaixa.porLoja?.[lojaFiltro];
    return v !== undefined ? { disponivel: true, valor: v } : { disponivel: false };
  }
  const retiradaDepositoExibida = depositoDe(dados);
  const quebraExibida = quebraDe(dados);

  /** Controles de Caixa: métrica principal do card, mês atual × mês anterior (dados reais; "Sem dados" quando ausente). */
  const notaRede = lojaFiltro !== "TODAS" ? "Consolidado da rede (esta base não tem quebra por loja nesta tela)." : undefined;
  const ant = dados.mesAnterior;
  /** Aviso quando a base só passa a ter dados no meio do mês anterior (comparação parcial). */
  function notaCobertura(chave: keyof NonNullable<typeof ant>["coberturaDesde"], comRede = false): string | undefined {
    const desde = ant?.coberturaDesde[chave];
    const parcial =
      ant && desde && desde.getTime() > ant.dataInicio.getTime() && desde.getTime() <= ant.dataFim.getTime()
        ? `Base com dados a partir de ${formatadorDataRegistro.format(desde)} — ${rotuloMes(ant.dataInicio).split("/")[0]} parcial.`
        : undefined;
    return [parcial, comRede ? notaRede : undefined].filter(Boolean).join(" ") || undefined;
  }
  const blocosControle = {
    fechamento: [
      {
        atual: { disponivel: dados.fechamento.disponivel, valor: dados.fechamento.totalCaixasOperados },
        anterior: ant ? { disponivel: ant.fechamento.disponivel, valor: ant.fechamento.totalCaixasOperados } : semDados,
        formato: "caixas",
      },
    ] as BlocoComparativo[],
    pdv: [
      {
        atual: { disponivel: dados.pdvMaquininha.disponivel, valor: dados.pdvMaquininha.diferenca },
        anterior: ant ? { disponivel: ant.pdvMaquininha.disponivel, valor: ant.pdvMaquininha.diferenca } : semDados,
        formato: "moeda",
      },
    ] as BlocoComparativo[],
    troco: [
      {
        atual: { disponivel: dados.troco.disponivel, valor: dados.troco.divergencias },
        anterior: ant ? { disponivel: ant.troco.disponivel, valor: ant.troco.divergencias } : semDados,
        formato: "divergencias",
      },
    ] as BlocoComparativo[],
    conferencia: [
      {
        atual: { disponivel: dados.conferencia.disponivel, valor: dados.conferencia.percentualConferido },
        anterior: ant ? { disponivel: ant.conferencia.disponivel, valor: ant.conferencia.percentualConferido } : semDados,
        formato: "percentual",
      },
    ] as BlocoComparativo[],
    quebra: [
      {
        atual: quebraExibida,
        anterior: ant ? quebraDe(ant) : semDados,
        formato: "moeda",
      },
    ] as BlocoComparativo[],
  };

  const detalhamentoFiltrado: LinhaDetalhamentoLoja[] =
    lojaFiltro === "TODAS" ? dados.detalhamentoPorLoja : linhaLojaFiltro ? [linhaLojaFiltro] : [];

  const detalhamentoExibido = [...detalhamentoFiltrado].sort((a, b) => {
    if (ordem === "criticidade") return compararCriticidade(a, b);
    if (ordem === "loja") return (dirDesc ? -1 : 1) * a.unidade.localeCompare(b.unidade);
    const va = ordem === "valor" ? a[colunaOrdem].valor : (a[colunaOrdem] as IndicadorComSemaforo).percentualFaturamento;
    const vb = ordem === "valor" ? b[colunaOrdem].valor : (b[colunaOrdem] as IndicadorComSemaforo).percentualFaturamento;
    if (va === undefined && vb === undefined) return a.unidade.localeCompare(b.unidade);
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    return (dirDesc ? vb - va : va - vb) || a.unidade.localeCompare(b.unidade);
  });

  // Pontos de Atenção: TOP 5 LOJAS (cada unidade independente) sobre as linhas visíveis (respeita Loja).
  const pontosAtencao = calcularPontosAtencao(detalhamentoFiltrado, 5);
  // Base do percentual das Formas de Pagamento: faturamento bruto do mesmo período/loja do hero.
  const faturamentoBase = cardsExibidos.faturamento.disponivel ? (cardsExibidos.faturamento.valor ?? 0) : 0;

  const textoIndisponivel = dados.conectado ? "Sem dados disponíveis" : "Sem dados para esta referência";
  const textoPeriodo = dados.modoPeriodo
    ? `${formatadorData.format(dados.dataInicio)} até ${formatadorData.format(dados.dataFim)}`
    : formatadorData.format(dados.dataFim);

  return (
    <main className="flex-1 space-y-5 bg-ragga-bg px-6 py-6">
      {/* HEADER — identidade Ragga: logo oficial + detalhe lateral em degradê (item 4). */}
      <div className="flex flex-wrap items-stretch gap-4">
        <span className="hidden w-1 shrink-0 rounded-full bg-gradient-to-b from-ragga-blue to-ragga-blue-dark sm:block" />
        <div className="flex flex-1 flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/ragga-gestao-icone.svg" alt="Ragga Gestão" width={40} height={40} className="shrink-0" priority />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ragga-blue/55">Central de caixa</p>
              <h1 className="mt-0.5 text-[1.75rem] font-extrabold leading-tight text-ragga-blue-dark">Visão Geral</h1>
              <p className="mt-0.5 text-sm capitalize text-foreground/45">
                {desatualizado
                  ? `Período: ${formatadorData.format(dataDoInput(dataInicioSel))} até ${formatadorData.format(dataDoInput(dataFimSel))} — atualizando…`
                  : dados.modoPeriodo
                    ? `Período: ${textoPeriodo}`
                    : formatadorDataExtenso.format(dados.dataFim)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* FILTROS — barra de controle executiva (item 5). Período (item 2 desta etapa):
          Data inicial + Data final — o padrão é as duas iguais (dia único), preservando a
          experiência de sempre; quando ficam diferentes, a tela entra em modo período. */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-ragga-blue/10 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(31,53,112,0.06)]">
        <div className="flex items-center gap-2 text-ragga-blue/50">
          <Icone nome="calendario" className="h-4 w-4" />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-ragga-blue-dark">
          Período
          <input
            type="date"
            value={dataInicioSel}
            onChange={(e) => alterarPeriodo(e.target.value, dataFimSel)}
            className="rounded-md border border-ragga-blue/15 bg-white px-3 py-2 text-sm focus:border-ragga-blue focus:outline-none focus:ring-1 focus:ring-ragga-blue/40"
          />
          <span className="text-foreground/40">até</span>
          <input
            type="date"
            value={dataFimSel}
            onChange={(e) => alterarPeriodo(dataInicioSel, e.target.value)}
            className="rounded-md border border-ragga-blue/15 bg-white px-3 py-2 text-sm focus:border-ragga-blue focus:outline-none focus:ring-1 focus:ring-ragga-blue/40"
          />
          {pendente && <span className="text-xs font-normal text-foreground/50">Carregando...</span>}
        </label>
        <span className="hidden h-6 w-px bg-ragga-blue/10 sm:block" />
        <label className="flex items-center gap-2 text-sm font-medium text-ragga-blue-dark">
          <Icone nome="loja" className="h-4 w-4 text-ragga-blue/50" />
          Loja
          <select
            value={lojaFiltro}
            onChange={(e) => setLojaFiltro(e.target.value)}
            className="rounded-md border border-ragga-blue/15 bg-white px-3 py-2 text-sm focus:border-ragga-blue focus:outline-none focus:ring-1 focus:ring-ragga-blue/40"
          >
            <option value="TODAS">Todas as lojas</option>
            {UNIDADES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>
        {lojaFiltro !== "TODAS" && (
          <span className="rounded-full bg-ragga-blue/10 px-2.5 py-1 text-xs font-semibold text-ragga-blue">Filtrando: {lojaFiltro}</span>
        )}
        {dados.modoPeriodo && (
          <span className="rounded-full bg-ragga-blue/10 px-2.5 py-1 text-xs font-semibold text-ragga-blue">Modo período</span>
        )}
      </div>

      {desatualizado ? (
        <div role="status" aria-live="polite" className="rounded-2xl border border-ragga-blue/10 bg-white px-6 py-16 text-center">
          <p className="text-sm font-semibold text-ragga-blue-dark">
            Atualizando os dados de {formatadorData.format(dataDoInput(dataInicioSel))} até {formatadorData.format(dataDoInput(dataFimSel))}…
          </p>
          <p className="mt-1 text-xs text-foreground/50">Os valores do período anterior foram ocultados para não serem confundidos com este período.</p>
        </div>
      ) : (
      <>
      {!dados.conectado && (
        <div className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          Banco de dados ainda não conectado (<code>DATABASE_URL</code> não definida). Os
          indicadores abaixo ficam pendentes até a carga de dados reais ser autorizada —
          nenhum valor foi inventado.
        </div>
      )}

      {/* KPI PRINCIPAL — Faturamento (item 6): largura total, gradiente da identidade,
          elemento gráfico abstrato discreto (linhas diagonais em baixa opacidade), sem
          exagero. Nenhum dado/cálculo novo, só apresentação. */}
      {comparativo(
        "Faturamento Bruto",
        (c) => c.faturamento,
        (
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-ragga-blue via-ragga-blue to-ragga-blue-dark px-5 py-4 text-white shadow-[0_8px_24px_-8px_rgba(31,53,112,0.45)]">
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07]" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <pattern id="vg-linhas" width="34" height="34" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
              <line x1="0" y1="0" x2="0" y2="34" stroke="white" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#vg-linhas)" />
        </svg>
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/[0.06]" />
        <div className="pointer-events-none absolute -right-6 bottom-0 h-32 w-32 rounded-full bg-white/[0.06]" />

        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-white/65">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10">
              <Icone nome="faturamento" className="h-3.5 w-3.5" />
            </span>
            Faturamento Bruto
            <InfoInsight
              claro
              texto="Faturamento bruto: total de vendas realizadas no período. Não representa necessariamente o valor recebido no banco no mesmo dia."
            />
            {lojaFiltro !== "TODAS" && <span className="rounded-full bg-white/10 px-2 py-0.5 normal-case tracking-normal">{lojaFiltro}</span>}
          </div>
          <span className="text-xs font-medium text-white/60">{textoPeriodo}</span>
        </div>

        {cardsExibidos.faturamento.disponivel ? (
          <>
            <p className="relative mt-2 text-2xl font-extrabold leading-none tracking-tight sm:text-3xl">
              {formatadorMoeda.format(cardsExibidos.faturamento.valor ?? 0)}
            </p>
            {/* "vs. dia anterior": só no modo "data única" e para o consolidado de rede — no
                modo período (item 4 desta etapa) a comparação nem aparece, nunca uma
                comparação diária disfarçada de comparação de período. Comparação usa o dia
                calendário anterior literal, calculado em `buscarVisaoGeralPeriodo`; nunca
                "último registro disponível". */}
            {!dados.modoPeriodo && lojaFiltro === "TODAS" && (
              <p className="relative mt-2 text-sm font-medium text-white/80">
                {dados.faturamento.comparativoDiaAnterior === null ? (
                  <span className="text-white/50">Sem comparação com o dia anterior</span>
                ) : (
                  <span className={dados.faturamento.comparativoDiaAnterior >= 0 ? "text-emerald-300" : "text-rose-300"}>
                    {dados.faturamento.comparativoDiaAnterior >= 0 ? "↑" : "↓"}{" "}
                    {formatadorPercentual.format(Math.abs(dados.faturamento.comparativoDiaAnterior))}% vs. dia anterior
                  </span>
                )}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="relative mt-2 text-2xl font-extrabold leading-none text-white/35 sm:text-3xl">—</p>
            <p className="relative mt-2 text-xs text-white/70">{textoIndisponivel}</p>
          </>
        )}
      </div>
        )
      )}

      {/* FORMAS DE PAGAMENTO — composição do faturamento; mesmo período e MESMA Loja do card acima. */}
      <Secao
        titulo="Formas de Pagamento"
        insight="O prazo de recebimento varia conforme a forma de pagamento: PIX imediato; crédito e débito D+1; voucher D+30; venda a prazo mensal; online/iFood às quartas-feiras."
      >
        {formasExibidas ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {(
              [
                ["Crédito", formasExibidas.credito, "credito"],
                ["Débito", formasExibidas.debito, "debito"],
                ["PIX", formasExibidas.pix, "pix"],
                ["Voucher", formasExibidas.voucher, "voucher"],
                ["Venda a Prazo", formasExibidas.vendaAPrazo, "prazo"],
                ["Online", formasExibidas.online, "online"],
                ["Dinheiro", formasExibidas.dinheiro, "dinheiro"],
              ] as [string, number, NomeIcone][]
            ).map(([label, valor, icone]) => (
              <div key={label} className="rounded-lg border border-ragga-blue/10 bg-ragga-bg/50 p-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-ragga-blue shadow-sm">
                  <Icone nome={icone} className="h-3.5 w-3.5" />
                </span>
                <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">{label}</p>
                <p className="mt-0.5 text-sm font-bold text-ragga-blue-dark">{formatadorMoeda.format(valor)}</p>
                {faturamentoBase > 0 && (
                  <p className="mt-0.5 text-xs text-foreground/50">{formatadorPercentual.format((valor / faturamentoBase) * 100)}% da venda</p>
                )}
              </div>
            ))}
            {formasExibidas.outros > 0.005 && (
              <div className="rounded-lg border border-ragga-blue/10 bg-ragga-bg/50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Outros</p>
                <p className="mt-0.5 text-sm font-bold text-ragga-blue-dark">{formatadorMoeda.format(formasExibidas.outros)}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-foreground/45">Sem dados para esta referência</p>
        )}
      </Secao>

      {/* PONTOS DE ATENÇÃO — TOP 5 lojas que concentram indicadores Críticos/Atenção (semáforos já existentes). */}
      <Secao
        titulo="Pontos de Atenção"
        insight="Lojas que concentram mais indicadores em Crítico e Atenção (Brindes controláveis, Cancelamento Salão, Cancelamento Delivery e Compra Direta), usando os semáforos já existentes. Ordem: mais críticos, depois mais em atenção; empate: maior desvio sobre o limite. Detalhes no ranking por loja abaixo."
      >
        {pontosAtencao.length === 0 ? (
          <p className="text-sm text-foreground/50">Nenhuma loja com indicador em Atenção ou Crítico no período.</p>
        ) : (
          <ol className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pontosAtencao.map((p, i) => {
              const aberto = pontosAbertos.has(p.unidade);
              return (
                <li
                  key={p.unidade}
                  className={`rounded-lg border-l-4 bg-white shadow-sm ${p.criticos > 0 ? "border-l-semaforo-vermelho" : "border-l-semaforo-amarelo"}`}
                >
                  <button
                    type="button"
                    aria-expanded={aberto}
                    onClick={() => alternarPonto(p.unidade)}
                    className="w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-ragga-blue/[0.03]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-foreground/35">{i + 1}º</span>
                      <span className="flex-1 text-base font-bold text-ragga-blue-dark">{p.unidade}</span>
                      <span className="text-ragga-blue/50">{aberto ? "▾" : "▸"}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-foreground/80">
                      {p.criticos > 0 && (
                        <span>
                          🔴 {p.criticos} {p.criticos === 1 ? "crítico" : "críticos"}
                        </span>
                      )}
                      {p.criticos > 0 && p.atencao > 0 && " · "}
                      {p.atencao > 0 && <span>🟡 {p.atencao} atenção</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-foreground/50">{p.indicadores.map((ind) => ind.rotulo).join(" · ")}</p>
                  </button>
                  {aberto && (
                    <div className="space-y-2 border-t border-ragga-blue/10 px-4 py-3">
                      {p.indicadores.map((ind) => (
                        <div key={ind.nome} className="rounded-md bg-ragga-bg/60 px-3 py-2 text-sm">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">{ind.nome}</p>
                          <p className="mt-0.5 font-semibold tabular-nums text-ragga-blue-dark">{formatadorMoeda.format(ind.valor)}</p>
                          <p className="text-xs text-foreground/60">{formatadorPercentual.format(ind.percentual)}% do faturamento</p>
                          <p className="text-xs text-foreground/60">Limite saudável: {formatadorPercentual.format(ind.limite)}%</p>
                          <p className="text-xs text-foreground/60">
                            {ind.distanciaPp >= 0 ? "+" : "-"}
                            {formatadorPercentual.format(Math.abs(ind.distanciaPp))} p.p. {ind.distanciaPp >= 0 ? "acima" : "abaixo"} do limite
                          </p>
                          <p className="mt-1 text-xs font-semibold">{ind.semaforo === "vermelho" ? "🔴 Crítico" : "🟡 Atenção"}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Secao>

      {/* INDICADORES DE PERFORMANCE — Brindes (controláveis), Cancelamentos e Compra Direta. */}
      <Secao titulo="Indicadores de Performance">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {comparativo("Brindes controláveis", (c) => c.brindes, <BrindesCard dados={cardsExibidos.brindes} indisponivelTexto={textoIndisponivel} modoPeriodo={dados.modoPeriodo} />, false, hrefIndicador("brindes"))}
          {comparativo(
            "Cancelamento Salão",
            (c) => c.cancelamentoSalao,
            (
          <IndicadorVisaoGeral
            titulo="Cancelamento Salão"
            icone="cancelSalao"
            dados={cardsExibidos.cancelamentoSalao}
            indisponivelTexto={textoIndisponivel}
            modoPeriodo={dados.modoPeriodo}
            insight="Cancelamentos representam vendas canceladas e devem ser analisados conforme o motivo da ocorrência."
          />
            ),
            false,
            hrefIndicador("cancelamentoSalao")
          )}
          {comparativo(
            "Cancelamento Delivery",
            (c) => c.cancelamentoDelivery,
            (
          <IndicadorVisaoGeral
            titulo="Cancelamento Delivery"
            icone="cancelDelivery"
            dados={cardsExibidos.cancelamentoDelivery}
            indisponivelTexto={textoIndisponivel}
            modoPeriodo={dados.modoPeriodo}
            insight="Cancelamentos representam vendas canceladas e devem ser analisados conforme o motivo da ocorrência."
          />
            ),
            true,
            hrefIndicador("cancelamentoDelivery")
          )}
          {comparativo(
            "Compra Direta",
            (c) => c.retiradaCompraDireta,
            (
          <IndicadorVisaoGeral
            titulo="Compra Direta"
            icone="retirada"
            dados={cardsExibidos.retiradaCompraDireta}
            indisponivelTexto={textoIndisponivel}
            modoPeriodo={dados.modoPeriodo}
            insight="Retirada Compra Direta representa valores retirados do caixa para aquisição/compra direta."
          />
            ),
            true,
            hrefCompraDireta
          )}
        </div>
      </Secao>

      {/* CENTRAL DE CAIXA (Larissa) — performance contra a meta no mês em andamento, mês equivalente anterior e ranking/plano de
          ação. Recolhida por padrão: a leitura principal são os "Indicadores de Performance" acima (uma só versão dos cards).
          Brindes aqui segue a NOSSA regra (somente controláveis). */}
      <details className="group">
        <summary className="cursor-pointer select-none rounded-xl border border-ragga-blue/10 bg-white px-4 py-3 text-[13px] font-bold uppercase tracking-wide text-ragga-blue-dark">
          Central de caixa — performance contra a meta{" "}
          <span className="font-normal normal-case tracking-normal text-foreground/50">(mesmos dias do mês anterior · ranking e plano de ação)</span>
        </summary>
        <div className="mt-3 space-y-5">
          <DesempenhoCaixa
            dados={desempenho}
            carregando={pendente}
            loja={lojaFiltro}
            conferencia={dados.conferencia}
            hrefIndicador={hrefPlanoAcao}
            hrefConferencia="/controles-caixa"
          />
        </div>
      </details>

      {/* RETIRADA P/ DEPÓSITO e QUEBRA DE CAIXA — acompanham período e Loja. */}
      <Secao titulo="Retirada p/ Depósito e Quebra de Caixa">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {popover(
            "Retirada p/ Depósito",
            [
              blocoFaturamento("Faturamento"),
              { titulo: "Retirada p/ Depósito", atual: retiradaDepositoExibida, anterior: ant ? depositoDe(ant) : semDados, formato: "moeda" },
            ],
            (
          <div className="rounded-xl border border-ragga-blue/10 bg-white p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ragga-blue-dark text-white">
              <Icone nome="deposito" className="h-4 w-4" />
            </span>
            <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/45">
              Retirada p/ Depósito
              <InfoInsight texto="Retirada para depósito é uma movimentação de caixa destinada ao depósito bancário, não uma despesa." />
            </p>
            {retiradaDepositoExibida.disponivel ? (
              <p className="mt-1 text-[1.65rem] font-extrabold leading-none text-ragga-blue-dark">{formatadorMoeda.format(retiradaDepositoExibida.valor ?? 0)}</p>
            ) : (
              <>
                <p className="mt-1 text-[1.65rem] font-extrabold leading-none text-foreground/20">—</p>
                <p className="mt-2 text-xs text-foreground/45">{textoIndisponivel}</p>
              </>
            )}
          </div>
            ),
            false,
            notaCobertura("retiradaDeposito")
          )}
          <div className="rounded-xl border border-ragga-blue/10 bg-white p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ragga-blue-dark text-white">
              <Icone nome="quebra" className="h-4 w-4" />
            </span>
            <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/45">
              Quebra de Caixa
              <InfoInsight texto="Quebra de caixa é a divergência confirmada após a conciliação do caixa." />
            </p>
            {quebraExibida.disponivel ? (
              <p className="mt-1 text-[1.65rem] font-extrabold leading-none text-ragga-blue-dark">{formatadorMoeda.format(quebraExibida.valor ?? 0)}</p>
            ) : (
              <>
                <p className="mt-1 text-[1.65rem] font-extrabold leading-none text-foreground/20">—</p>
                <p className="mt-2 text-xs text-foreground/45">{textoIndisponivel}</p>
              </>
            )}
          </div>
        </div>
      </Secao>

      {/* CONTROLES DE CAIXA — período/data selecionado, sem buscar data anterior. */}
      <Secao
        titulo="Controles de Caixa"
        tom="operacional"
        insight="Controles de caixa representam conferências/controles operacionais (abertura, fechamento, troco, PDV × maquininha) — não são faturamento. Mostram exatamente o período selecionado; sem registro no período aparece 'Sem dados'."
        acao={
          <Link href="/controles-caixa" className="text-xs font-semibold text-ragga-blue hover:underline">
            Ver detalhes →
          </Link>
        }
      >
        {lojaFiltro !== "TODAS" && (
          <p className="mb-3 text-xs text-foreground/45">Fechamento, PDV × Maquininha, Troco e Conferência são consolidados da rede (sem quebra por loja nesta tela).</p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {popover(
            "Fechamento",
            blocosControle.fechamento,
            (
          <ControleCard
            titulo="Fechamento"
            icone="fechamento"
            disponivel={dados.fechamento.disponivel}
            valor={`${dados.fechamento.totalCaixasOperados} caixas operados`}
          />
            ),
            false,
            notaCobertura("fechamento", true)
          )}
          {popover(
            "PDV × Maquininha",
            blocosControle.pdv,
            (
          <ControleCard titulo="PDV × Maquininha" icone="pdv" disponivel={dados.pdvMaquininha.disponivel} valor={formatadorMoeda.format(dados.pdvMaquininha.diferenca ?? 0)} />
            ),
            false,
            notaCobertura("pdvMaquininha", true)
          )}
          {popover(
            "Troco",
            blocosControle.troco,
            (
          <ControleCard titulo="Troco" icone="troco" disponivel={dados.troco.disponivel} valor={`${dados.troco.divergencias} divergência(s)`} />
            ),
            false,
            notaCobertura("troco", true)
          )}
          {popover(
            "Conferência",
            blocosControle.conferencia,
            (
          <ControleCard
            titulo="Conferência"
            icone="conferencia"
            disponivel={dados.conferencia.disponivel}
            valor={`${formatadorPercentual.format(dados.conferencia.percentualConferido ?? 0)}% conferido`}
          />
            ),
            true,
            notaCobertura("conferencia", true)
          )}
          {popover(
            "Quebra de Caixa",
            blocosControle.quebra,
            (
          <ControleCard titulo="Quebra de Caixa" icone="quebra" disponivel={quebraExibida.disponivel} valor={formatadorMoeda.format(quebraExibida.valor ?? 0)} />
            ),
            true,
            notaCobertura("quebraCaixa")
          )}
        </div>
      </Secao>

      {/* DETALHAMENTO POR LOJA — expansível, com ordenação (Loja / Valor / Percentual / Performance-Criticidade). */}
      <Secao
        titulo="Ranking de Performance por Loja"
        acao={
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-ragga-blue-dark">
            <label className="flex items-center gap-1.5">
              Ordenar por
              <select
                value={ordem}
                onChange={(e) => {
                  const novo = e.target.value as typeof ordem;
                  setOrdem(novo);
                  if (novo === "percentual" && colunaOrdem === "faturamento") setColunaOrdem("retiradaCompraDireta");
                  setDirDesc(novo !== "loja");
                }}
                className="rounded-md border border-ragga-blue/15 bg-white px-2 py-1.5 text-xs"
              >
                <option value="loja">Loja</option>
                <option value="valor">Valor</option>
                <option value="percentual">Percentual</option>
                <option value="criticidade">Performance / Criticidade</option>
              </select>
            </label>
            {(ordem === "valor" || ordem === "percentual") && (
              <select
                value={colunaOrdem}
                onChange={(e) => setColunaOrdem(e.target.value as typeof colunaOrdem)}
                className="rounded-md border border-ragga-blue/15 bg-white px-2 py-1.5 text-xs"
              >
                {ordem === "valor" && <option value="faturamento">Faturamento</option>}
                <option value="retiradaCompraDireta">Compra Direta</option>
                <option value="brindes">Brindes (controláveis)</option>
                <option value="cancelamentoSalao">Cancel. Salão</option>
                <option value="cancelamentoDelivery">Cancel. Delivery</option>
              </select>
            )}
            {ordem !== "criticidade" && (
              <button
                type="button"
                onClick={() => setDirDesc((d) => !d)}
                className="rounded-md border border-ragga-blue/15 bg-white px-2 py-1.5 text-xs hover:bg-ragga-blue/5"
              >
                {ordem === "loja" ? (dirDesc ? "Z → A ↓" : "A → Z ↑") : dirDesc ? "Maior → menor ↓" : "Menor → maior ↑"}
              </button>
            )}
            {ordem === "criticidade" && <span className="text-foreground/45">Maior → menor criticidade</span>}
          </div>
        }
      >
        <div className="-mx-5 overflow-x-auto sm:-mx-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                <th className="px-5 py-2.5 sm:px-6">Loja</th>
                <th className="px-4 py-2.5">Faturamento</th>
                <th className="px-4 py-2.5">Retirada Compra Direta</th>
                <th className="px-4 py-2.5">Brindes (controláveis)</th>
                <th className="px-4 py-2.5">Cancel. Salão</th>
                <th className="px-4 py-2.5">Cancel. Delivery</th>
              </tr>
            </thead>
            <tbody>
              {detalhamentoExibido.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-sm text-foreground/45 sm:px-6">
                    Sem dados para esta referência.
                  </td>
                </tr>
              ) : (
                detalhamentoExibido.map((linha) => {
                  const crit = contarCriticidade(linha);
                  return (
                    <Fragment key={linha.unidade}>
                      <tr
                        onClick={() => alternarLoja(linha.unidade)}
                        className="cursor-pointer border-b border-ragga-blue/5 transition-colors last:border-0 hover:bg-ragga-blue/[0.04]"
                      >
                        <td className="px-5 py-3 font-semibold text-ragga-blue-dark sm:px-6">
                          <span className="mr-1.5 inline-block w-3 text-ragga-blue/45">{lojasExpandidas.has(linha.unidade) ? "▾" : "▸"}</span>
                          {linha.unidade}
                          {(crit.criticos > 0 || crit.atencao > 0) && (
                            <div className="ml-[1.1rem] mt-0.5 text-[11px] font-normal text-foreground/50">
                              {crit.criticos > 0 && <span className="text-semaforo-vermelho">{crit.criticos} crítico(s)</span>}
                              {crit.criticos > 0 && crit.atencao > 0 && " · "}
                              {crit.atencao > 0 && <span className="text-semaforo-amarelo">{crit.atencao} em atenção</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-foreground/80">
                          {linha.faturamento.valor !== undefined ? formatadorMoeda.format(linha.faturamento.valor) : "—"}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-foreground/80">
                          {linha.retiradaCompraDireta.valor !== undefined ? formatadorMoeda.format(linha.retiradaCompraDireta.valor) : "—"}
                          <div className="mt-0.5 text-xs">
                            <CelulaIndicadorLoja indicador={linha.retiradaCompraDireta} />
                          </div>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-foreground/80">
                          {linha.brindes.valor !== undefined ? formatadorMoeda.format(linha.brindes.valor) : "—"}
                          <div className="mt-0.5 text-xs">
                            <CelulaIndicadorLoja indicador={linha.brindes} />
                          </div>
                          {linha.brindes.detalhe && (
                            <div className="mt-0.5 text-[11px] text-foreground/40">Total {formatadorMoeda.format(linha.brindes.detalhe.total)}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-foreground/80">
                          {linha.cancelamentoSalao.valor !== undefined ? formatadorMoeda.format(linha.cancelamentoSalao.valor) : "—"}
                          <div className="mt-0.5 text-xs">
                            <CelulaIndicadorLoja indicador={linha.cancelamentoSalao} />
                          </div>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-foreground/80">
                          {linha.cancelamentoDelivery.valor !== undefined ? formatadorMoeda.format(linha.cancelamentoDelivery.valor) : "—"}
                          <div className="mt-0.5 text-xs">
                            <CelulaIndicadorLoja indicador={linha.cancelamentoDelivery} />
                          </div>
                        </td>
                      </tr>
                      {lojasExpandidas.has(linha.unidade) && (
                        <tr>
                          <td colSpan={6} className="bg-ragga-bg/60 px-5 py-3 sm:px-6">
                            <HistoricoMensalExpandido unidade={linha.unidade} />
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
      </Secao>
      </>
      )}
    </main>
  );
}
