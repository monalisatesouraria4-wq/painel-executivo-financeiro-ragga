"use client";

import { Fragment, useState, useTransition, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { SemaforoBadge } from "@/components/ui/SemaforoBadge";
import { paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { HistoricoMensalExpandido } from "./HistoricoMensalExpandido";
import { UNIDADES } from "@painel/shared";
import type { CorSemaforo } from "@/lib/rules/semaforos";
import type { VisaoGeralData, IndicadorComSemaforo, IndicadorSimples } from "@/lib/services/visaoGeral";
import { buscarVisaoGeralPorPeriodo } from "@/lib/actions/buscarVisaoGeralPorPeriodo";

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
 * Card de Controles de Caixa — mesma família visual do card acima, tom
 * "operacional" (ícone em contorno em vez de preenchido, sem semáforo/
 * percentual — só ícone + valor + "Último registro"). Nenhum valor/regra
 * de data é calculado aqui, só apresentação.
 */
function ControleCard({
  titulo,
  icone,
  disponivel,
  valor,
  dataRegistro,
}: {
  titulo: string;
  icone: NomeIcone;
  disponivel: boolean;
  valor?: string;
  dataRegistro?: Date;
}) {
  return (
    <div className="rounded-xl border border-ragga-blue-dark/10 bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ragga-blue-dark/15 text-ragga-blue-dark">
        <Icone nome={icone} className="h-4 w-4" />
      </span>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-foreground/45">{titulo}</p>
      {disponivel ? (
        <>
          <p className="mt-1 text-lg font-bold text-ragga-blue-dark">{valor}</p>
          {dataRegistro && <p className="mt-1.5 text-[11px] text-foreground/40">Último registro: {formatadorDataRegistro.format(dataRegistro)}</p>}
        </>
      ) : (
        <>
          <p className="mt-1 text-lg font-bold text-foreground/20">—</p>
          <p className="mt-1.5 text-xs text-foreground/45">Sem dados</p>
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
export function VisaoGeralView({ dadosIniciais, dataInicial }: { dadosIniciais: VisaoGeralData; dataInicial: Date }) {
  const [dados, setDados] = useState(dadosIniciais);
  // Filtro de Período (item 2 desta etapa): "data única" é só o caso `dataInicioSel ===
  // dataFimSel` — mesmo padrão inicial de sempre (as duas começam na mesma data), extensão
  // da lógica existente, não um filtro paralelo.
  const [dataInicioSel, setDataInicioSel] = useState(() => paraInputDate(dataInicial));
  const [dataFimSel, setDataFimSel] = useState(() => paraInputDate(dataInicial));
  const [pendente, iniciarTransicao] = useTransition();
  const [lojasExpandidas, setLojasExpandidas] = useState<Set<string>>(new Set());
  const [lojaFiltro, setLojaFiltro] = useState<string>("TODAS");

  function alternarLoja(unidade: string) {
    setLojasExpandidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(unidade)) proximo.delete(unidade);
      else proximo.add(unidade);
      return proximo;
    });
  }

  function alterarPeriodo(novoInicio: string, novoFim: string) {
    setDataInicioSel(novoInicio);
    setDataFimSel(novoFim);
    iniciarTransicao(async () => {
      const resultado = await buscarVisaoGeralPorPeriodo(dataDoInput(novoInicio), dataDoInput(novoFim));
      setDados(resultado);
    });
  }

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

  const cardsExibidos =
    lojaFiltro === "TODAS"
      ? {
          faturamento: dados.faturamento as IndicadorSimples,
          brindes: dados.brindes,
          cancelamentoSalao: dados.cancelamentoSalao,
          cancelamentoDelivery: dados.cancelamentoDelivery,
          retiradaCompraDireta: dados.retiradaCompraDireta,
        }
      : {
          faturamento: linhaLojaFiltro?.faturamento ?? indisponivelSimples,
          brindes: linhaLojaFiltro?.brindes ?? indisponivelLoja,
          cancelamentoSalao: linhaLojaFiltro?.cancelamentoSalao ?? indisponivelLoja,
          cancelamentoDelivery: linhaLojaFiltro?.cancelamentoDelivery ?? indisponivelLoja,
          retiradaCompraDireta: linhaLojaFiltro?.retiradaCompraDireta ?? indisponivelLoja,
        };

  const detalhamentoExibido = lojaFiltro === "TODAS" ? dados.detalhamentoPorLoja : linhaLojaFiltro ? [linhaLojaFiltro] : [];

  const indicadoresComAlerta = [
    { titulo: "Brindes", dados: cardsExibidos.brindes },
    { titulo: "Cancelamento Salão", dados: cardsExibidos.cancelamentoSalao },
    { titulo: "Cancelamento Delivery", dados: cardsExibidos.cancelamentoDelivery },
    { titulo: "Retirada Compra Direta", dados: cardsExibidos.retiradaCompraDireta },
  ].filter((i) => i.dados.disponivel && (i.dados.semaforo === "vermelho" || i.dados.semaforo === "amarelo"));

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
            <Image src="/ragga-leaf.png" alt="Ragga" width={40} height={40} className="shrink-0" priority />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ragga-blue/55">Painel executivo</p>
              <h1 className="mt-0.5 text-[1.75rem] font-extrabold leading-tight text-ragga-blue-dark">Visão Geral</h1>
              <p className="mt-0.5 text-sm capitalize text-foreground/45">
                {dados.modoPeriodo ? `Período: ${textoPeriodo}` : formatadorDataExtenso.format(dados.dataFim)}
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
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-ragga-blue via-ragga-blue to-ragga-blue-dark p-6 text-white shadow-[0_8px_24px_-8px_rgba(31,53,112,0.45)] sm:p-9">
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
            <p className="relative mt-4 text-[2.75rem] font-extrabold leading-none tracking-tight sm:text-6xl">
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
            <p className="relative mt-4 text-[2.75rem] font-extrabold leading-none text-white/35 sm:text-6xl">—</p>
            <p className="relative mt-2 text-xs text-white/70">{textoIndisponivel}</p>
          </>
        )}
      </div>

      {/* ALERTAS — painel de atenção gerencial (item 7). */}
      {indicadoresComAlerta.length > 0 && (
        <Secao titulo="Alertas">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {indicadoresComAlerta.map((item) => {
              const critico = item.dados.semaforo === "vermelho";
              return (
                <div
                  key={item.titulo}
                  className={`flex items-center gap-3 rounded-lg border-l-4 bg-white px-4 py-3 text-sm shadow-sm ${
                    critico ? "border-l-semaforo-vermelho" : "border-l-semaforo-amarelo"
                  }`}
                >
                  <span className={critico ? "text-semaforo-vermelho" : "text-semaforo-amarelo"}>
                    <Icone nome="alerta" className="h-4 w-4" />
                  </span>
                  <span className="flex-1 font-medium text-ragga-blue-dark">{item.titulo}</span>
                  <SemaforoBadge
                    cor={item.dados.semaforo ?? "amarelo"}
                    texto={`${formatadorPercentual.format(item.dados.percentualFaturamento ?? 0)}%`}
                  />
                </div>
              );
            })}
          </div>
        </Secao>
      )}

      {/* FORMAS DE PAGAMENTO — composição financeira (item 8). */}
      <Secao
        titulo="Formas de Pagamento"
        insight="O prazo de recebimento varia conforme a forma de pagamento: PIX imediato; crédito e débito D+1; voucher D+30; venda a prazo mensal; online/iFood às quartas-feiras."
      >
        {dados.formasPagamento.disponivel && dados.formasPagamento.buckets ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {(
              [
                ["Crédito", dados.formasPagamento.buckets.credito, "credito"],
                ["Débito", dados.formasPagamento.buckets.debito, "debito"],
                ["PIX", dados.formasPagamento.buckets.pix, "pix"],
                ["Voucher", dados.formasPagamento.buckets.voucher, "voucher"],
                ["Venda a Prazo", dados.formasPagamento.buckets.vendaAPrazo, "prazo"],
                ["Online", dados.formasPagamento.buckets.online, "online"],
                ["Dinheiro", dados.formasPagamento.buckets.dinheiro, "dinheiro"],
              ] as [string, number, NomeIcone][]
            ).map(([label, valor, icone]) => (
              <div key={label} className="rounded-lg border border-ragga-blue/10 bg-ragga-bg/50 p-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-ragga-blue shadow-sm">
                  <Icone nome={icone} className="h-3.5 w-3.5" />
                </span>
                <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">{label}</p>
                <p className="mt-0.5 text-sm font-bold text-ragga-blue-dark">{formatadorMoeda.format(valor)}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-foreground/45">Sem dados para esta referência</p>
        )}
      </Secao>

      {/* INDICADORES (item 9). */}
      <Secao titulo="Indicadores">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <IndicadorVisaoGeral
            titulo="Brindes"
            icone="brinde"
            dados={cardsExibidos.brindes}
            indisponivelTexto={textoIndisponivel}
            modoPeriodo={dados.modoPeriodo}
            insight="Brindes representam concessões/descontos registrados nas vendas — não é automaticamente saída de dinheiro do caixa."
          />
          <IndicadorVisaoGeral
            titulo="Cancelamento Salão"
            icone="cancelSalao"
            dados={cardsExibidos.cancelamentoSalao}
            indisponivelTexto={textoIndisponivel}
            modoPeriodo={dados.modoPeriodo}
            insight="Cancelamentos representam vendas canceladas e devem ser analisados conforme o motivo da ocorrência."
          />
          <IndicadorVisaoGeral
            titulo="Cancelamento Delivery"
            icone="cancelDelivery"
            dados={cardsExibidos.cancelamentoDelivery}
            indisponivelTexto={textoIndisponivel}
            modoPeriodo={dados.modoPeriodo}
            insight="Cancelamentos representam vendas canceladas e devem ser analisados conforme o motivo da ocorrência."
          />
        </div>
      </Secao>

      {/* RETIRADAS (item 10) — regra do R$ 0,00 para Retirada Depósito preservada (não
          alterada nesta etapa, só o visual do card). */}
      <Secao titulo="Retiradas">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <IndicadorVisaoGeral
            titulo="Retirada Compra Direta"
            icone="retirada"
            dados={cardsExibidos.retiradaCompraDireta}
            indisponivelTexto={textoIndisponivel}
            modoPeriodo={dados.modoPeriodo}
            insight="Retirada Compra Direta representa valores retirados do caixa para aquisição/compra direta."
          />
          <div className="group relative overflow-hidden rounded-xl border border-ragga-blue/10 bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ragga-blue-dark text-white">
              <Icone nome="deposito" className="h-4 w-4" />
            </span>
            <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/45">
              Retirada p/ Depósito
              <InfoInsight texto="Retirada para depósito é uma movimentação de caixa destinada ao depósito bancário, não uma despesa." />
            </p>
            {dados.retiradaDeposito.disponivel ? (
              <>
                <p className="mt-1 text-[1.65rem] font-extrabold leading-none text-ragga-blue-dark">
                  {formatadorMoeda.format(dados.retiradaDeposito.valorDia ?? 0)}
                </p>
                {!dados.modoPeriodo && dados.retiradaDeposito.dataRegistro && (
                  <p className="mt-2 text-xs text-foreground/40">{formatadorDataRegistro.format(dados.retiradaDeposito.dataRegistro)}</p>
                )}
              </>
            ) : (
              <>
                <p className="mt-1 text-[1.65rem] font-extrabold leading-none text-foreground/20">—</p>
                <p className="mt-2 text-xs text-foreground/45">{textoIndisponivel}</p>
              </>
            )}
          </div>
        </div>
      </Secao>

      {/* CONTROLES DE CAIXA (item 11) — tom "operacional" para se diferenciar visualmente
          dos indicadores financeiros acima (item 3: seções distintas do dashboard). */}
      <Secao
        titulo="Controles de Caixa"
        tom="operacional"
        insight="Controles de caixa representam conferências/controles operacionais (abertura, fechamento, troco, PDV × maquininha) — não são faturamento."
        acao={
          <Link href="/controles-caixa" className="text-xs font-semibold text-ragga-blue hover:underline">
            Ver detalhes →
          </Link>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <ControleCard
            titulo="Fechamento"
            icone="fechamento"
            disponivel={dados.fechamento.disponivel}
            valor={`${dados.fechamento.totalCaixasOperados} caixas operados`}
            dataRegistro={dados.fechamento.dataRegistro}
          />
          <ControleCard
            titulo="PDV × Maquininha"
            icone="pdv"
            disponivel={dados.pdvMaquininha.disponivel}
            valor={formatadorMoeda.format(dados.pdvMaquininha.diferenca ?? 0)}
            dataRegistro={dados.pdvMaquininha.dataRegistro}
          />
          <ControleCard
            titulo="Troco"
            icone="troco"
            disponivel={dados.troco.disponivel}
            valor={`${dados.troco.divergencias} divergência(s)`}
            dataRegistro={dados.troco.dataRegistro}
          />
          <ControleCard
            titulo="Conferência"
            icone="conferencia"
            disponivel={dados.conferencia.disponivel}
            valor={`${formatadorPercentual.format(dados.conferencia.percentualConferido ?? 0)}% conferido`}
            dataRegistro={dados.conferencia.dataRegistro}
          />
          <ControleCard
            titulo="Quebra de Caixa"
            icone="quebra"
            disponivel={dados.quebraCaixa.disponivel}
            valor={formatadorMoeda.format(dados.quebraCaixa.total ?? 0)}
            dataRegistro={dados.quebraCaixa.dataRegistro}
          />
        </div>
      </Secao>

      {/* DETALHAMENTO POR LOJA (item 12). */}
      <Secao titulo="Detalhamento por loja">
        <div className="-mx-5 overflow-x-auto sm:-mx-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                <th className="px-5 py-2.5 sm:px-6">Loja</th>
                <th className="px-4 py-2.5">Faturamento</th>
                <th className="px-4 py-2.5">Retirada Compra Direta</th>
                <th className="px-4 py-2.5">Brindes</th>
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
                detalhamentoExibido.map((linha) => (
                  <Fragment key={linha.unidade}>
                    <tr
                      onClick={() => alternarLoja(linha.unidade)}
                      className="cursor-pointer border-b border-ragga-blue/5 transition-colors last:border-0 hover:bg-ragga-blue/[0.04]"
                    >
                      <td className="px-5 py-3 font-semibold text-ragga-blue-dark sm:px-6">
                        <span className="mr-1.5 inline-block w-3 text-ragga-blue/45">{lojasExpandidas.has(linha.unidade) ? "▾" : "▸"}</span>
                        {linha.unidade}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-foreground/80">
                        {linha.faturamento.valor !== undefined ? formatadorMoeda.format(linha.faturamento.valor) : "—"}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-foreground/80">
                        {linha.retiradaCompraDireta.valor !== undefined
                          ? formatadorMoeda.format(linha.retiradaCompraDireta.valor)
                          : "—"}
                        <div className="mt-0.5 text-xs">
                          <CelulaIndicadorLoja indicador={linha.retiradaCompraDireta} />
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-foreground/80">
                        {linha.brindes.valor !== undefined ? formatadorMoeda.format(linha.brindes.valor) : "—"}
                        <div className="mt-0.5 text-xs">
                          <CelulaIndicadorLoja indicador={linha.brindes} />
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-foreground/80">
                        {linha.cancelamentoSalao.valor !== undefined
                          ? formatadorMoeda.format(linha.cancelamentoSalao.valor)
                          : "—"}
                        <div className="mt-0.5 text-xs">
                          <CelulaIndicadorLoja indicador={linha.cancelamentoSalao} />
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-foreground/80">
                        {linha.cancelamentoDelivery.valor !== undefined
                          ? formatadorMoeda.format(linha.cancelamentoDelivery.valor)
                          : "—"}
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </Secao>
    </main>
  );
}
