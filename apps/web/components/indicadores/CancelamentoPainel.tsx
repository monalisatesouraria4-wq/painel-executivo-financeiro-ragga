"use client";

import { Fragment, useRef, useState, useTransition, type ReactNode } from "react";
import { UNIDADES, type CodigoUnidade } from "@painel/shared";
import { SemaforoBadge } from "@/components/ui/SemaforoBadge";
import { GraficoLinhaDiaria, NOME_DIA, diaDaSemana, diaMesAno } from "@/components/ui/GraficoLinhaDiaria";
import { CardGrande, CardHover, Item, Secao, Situacao, TipLinha, ToggleModo, TooltipComparativo, VarCelulas, VariacaoPp, moeda, pct, sinalMoeda, sinalPct, sinalPp } from "@/components/ui/PainelAnalitico";
import { PlanoAcaoCelula } from "./PlanoAcaoCelula";
import { paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { ehMesCalendarioCompleto, mesAnteriorCompleto } from "@/lib/rules/mesAnterior";
import { compararMotivos } from "@/lib/services/compraDiretaPainel";
import {
  LIMITE_ATENCAO_CANCELAMENTO,
  LIMITE_BOM_CANCELAMENTO,
  LIMITE_EXCELENTE_CANCELAMENTO,
  ROTULO_STATUS_CANCELAMENTO,
  type CancelamentoPainelData,
  type DiaCancelamento,
  type FonteCancelamentoPainel,
  type LojaCancelamento,
  type MotivoCancelamento,
  type PeriodoCancelamento,
  type StatusCancelamento,
} from "@/lib/services/cancelamentoPainel";
import { buscarCancelamentoPainel } from "@/lib/actions/buscarCancelamentoPainel";

/**
 * Painel analítico de Cancelamento (hoje usado em Cancelamento Salão) — mesma experiência de Compra Direta e
 * Brindes: cards do período ATUAL (comparação no hover), comparação por motivo, evolução diária (linha, tooltip no
 * hover), ranking de lojas expansível. Cancelamento: menor é melhor. Melhorou/Piorou do INDICADOR GERAL (card, total,
 * loja) é decidido pelo % sobre o faturamento (nunca pela variação em R$); nos MOTIVOS, pelo valor do motivo. Status das lojas pelos
 * thresholds existentes (`FAIXAS_CANCELAMENTO`). A base não tem quantidade de ocorrências — logo, sem quantidade
 * nem ticket médio (nada é inventado).
 */

/** Escopo exibido (rede inteira ou uma loja) — mesmos campos nos dois casos. */
interface Escopo {
  disponivel: boolean;
  faturamento: number;
  valor: number;
  percentual: number;
  status: StatusCancelamento;
  cor: PeriodoCancelamento["cor"];
  motivos: MotivoCancelamento[];
  diario: DiaCancelamento[];
}

function escopoDe(periodo: PeriodoCancelamento, loja: string): Escopo {
  if (loja === "TODAS") return periodo;
  const l = periodo.porLoja.find((x) => x.unidade === loja);
  if (!l) return { disponivel: false, faturamento: 0, valor: 0, percentual: 0, status: "excelente", cor: "azul", motivos: [], diario: [] };
  return { ...l, disponivel: l.motivos.length > 0 };
}

const ESTILO_CHIP: Record<StatusCancelamento, { emoji: string; faixa: string; classe: string }> = {
  excelente: { emoji: "🔵", faixa: `até ${pct.format(LIMITE_EXCELENTE_CANCELAMENTO)}%`, classe: "border-semaforo-azul/30 bg-semaforo-azul/10" },
  bom: { emoji: "🟢", faixa: `acima de ${pct.format(LIMITE_EXCELENTE_CANCELAMENTO)}% até ${pct.format(LIMITE_BOM_CANCELAMENTO)}%`, classe: "border-semaforo-verde/30 bg-semaforo-verde/10" },
  atencao: { emoji: "🟡", faixa: `acima de ${pct.format(LIMITE_BOM_CANCELAMENTO)}% até ${pct.format(LIMITE_ATENCAO_CANCELAMENTO)}%`, classe: "border-semaforo-amarelo/30 bg-semaforo-amarelo/10" },
  critico: { emoji: "🔴", faixa: `acima de ${pct.format(LIMITE_ATENCAO_CANCELAMENTO)}%`, classe: "border-semaforo-vermelho/30 bg-semaforo-vermelho/10" },
};
const PESO_STATUS: Record<StatusCancelamento, number> = { critico: 3, atencao: 2, bom: 1, excelente: 0 };
type OrdemRanking = "valor" | "percentual" | "loja" | "criticidade";

function Evolucao({ dias, modo, rotulo, altura }: { dias: DiaCancelamento[]; modo: "valor" | "percentual"; rotulo: string; altura?: number }) {
  return (
    <GraficoLinhaDiaria
      dias={dias}
      modo={modo}
      altura={altura}
      rotuloMaior="Maior dia"
      rotuloMenor="Menor dia"
      textoAjuda={`A linha representa o TOTAL de ${rotulo}. Passe o mouse sobre um ponto para ver a composição do dia. Faixas suaves = sábado e domingo. Maior/menor consideram só dias com dado válido; dias sem registro ficam como lacuna (nunca R$ 0 inventado).`}
      renderTooltip={(dia, { modo: m, y }) => {
        const motivos = [...dia.motivos].filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor);
        const total = motivos.reduce((t, x) => t + x.valor, 0);
        return (
          <>
            <p className="text-xs font-bold text-ragga-blue">
              📅 {diaMesAno(dia.data)} <span className="font-medium text-foreground/50">({NOME_DIA[diaDaSemana(dia.data)]})</span>
            </p>
            <p className="mt-0.5 text-xs text-foreground/60">
              ❌ Total Cancelamentos: <span className="text-sm font-extrabold tabular-nums text-ragga-blue-dark">{moeda.format(dia.valor)}</span>
            </p>
            {m === "percentual" && dia.faturamento > 0 && (
              <p className="text-[11px] text-foreground/50">
                {pct.format(y)}% do faturamento do dia ({moeda.format(dia.faturamento)})
              </p>
            )}
            {motivos.length === 0 ? (
              <p className="mt-2 text-xs text-foreground/50">Sem cancelamentos neste dia.</p>
            ) : (
              <table className="mt-2 w-full text-xs tabular-nums">
                <tbody>
                  {motivos.map((x) => (
                    <tr key={x.motivo}>
                      <td className="py-0.5 pr-2 font-medium text-ragga-blue-dark">{x.motivo}</td>
                      <td className="py-0.5 pr-2 text-right">{moeda.format(x.valor)}</td>
                      <td className="py-0.5 text-right text-foreground/60">{pct.format((x.valor / total) * 100)}%</td>
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

/** Comparação por motivo (rede/escopo ou loja): menor cancelamento = 🟢 Melhorou; maior = 🔴 Piorou; igual = ⚪. */
function TabelaComparativoMotivos({
  atual,
  comparado,
  temBase,
  renderAcao,
  pctAtual,
  pctComparado,
}: {
  atual: MotivoCancelamento[];
  comparado: MotivoCancelamento[];
  temBase: boolean;
  renderAcao?: (motivo: string, valor: number) => ReactNode;
  /** % de cancelamentos sobre o faturamento (atual/comparado) — define Melhorou/Piorou da linha TOTAL (indicador geral). */
  pctAtual: number;
  pctComparado: number;
}) {
  const linhas = compararMotivos(atual, comparado);
  const totalA = atual.reduce((s, m) => s + m.valor, 0);
  const totalC = comparado.reduce((s, m) => s + m.valor, 0);
  if (linhas.length === 0) return <p className="text-sm text-foreground/45">Sem cancelamentos nos períodos.</p>;
  const semBase = (
    <>
      <td className="px-3">—</td>
      <td className="px-3">—</td>
    </>
  );
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
            {renderAcao && <th className="px-3 py-2">Ação</th>}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {linhas.map((l) => {
            const va = l.atual?.valor ?? 0;
            const vc = l.comparado?.valor ?? 0;
            return (
              <tr key={l.motivo} className="border-b border-ragga-blue/5">
                <td className="py-2.5 pr-4 font-medium text-ragga-blue-dark">{l.motivo}</td>
                <td className="px-3">{moeda.format(va)}</td>
                <td className="px-3">{temBase ? moeda.format(vc) : "Sem dados"}</td>
                {temBase ? <VarCelulas atual={va} anterior={vc} interpretar /> : semBase}
                <td className="px-3">{pct.format(l.atual?.percentualDoTotal ?? 0)}%</td>
                <td className="px-3">{temBase ? `${pct.format(l.comparado?.percentualDoTotal ?? 0)}%` : "—"}</td>
                <td className="px-3">
                  <Situacao atual={va} anterior={vc} temBase={temBase} />
                </td>
                {renderAcao && <td className="px-3">{va > 0 ? renderAcao(l.motivo, va) : <span className="text-xs text-foreground/30">—</span>}</td>}
              </tr>
            );
          })}
          <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
            <td className="py-2.5 pr-4">TOTAL</td>
            <td className="px-3">{moeda.format(totalA)}</td>
            <td className="px-3">{temBase ? moeda.format(totalC) : "Sem dados"}</td>
            {temBase ? <VarCelulas atual={totalA} anterior={totalC} interpretar={false} /> : semBase}
            <td className="px-3">{pct.format(100)}%</td>
            <td className="px-3">{temBase ? `${pct.format(100)}%` : "—"}</td>
            <td className="px-3">
              <Situacao atual={pctAtual} anterior={pctComparado} temBase={temBase} />
            </td>
            {renderAcao && <td />}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function CancelamentoPainel({
  fonte,
  rotulo,
  indicadorOrientacao,
  explicacao,
  dadosIniciais,
  periodoInicial,
  lojaInicial = "TODAS",
  tituloCard = "Total de cancelamentos",
  cardDetalhado = false,
  textoSemDados = "Sem dados no período",
}: {
  fonte: FonteCancelamentoPainel;
  /** Ex.: "Cancelamento Salão". */
  rotulo: string;
  /** Nome do indicador no catálogo de orientações existente (ex.: "Cancelamento Salão"). */
  indicadorOrientacao: string;
  explicacao: string;
  dadosIniciais: CancelamentoPainelData;
  periodoInicial: { inicio: string; fim: string; compInicio: string; compFim: string };
  /** Loja pré-selecionada (navegação por ?loja=). */
  lojaInicial?: string;
  /** Título do 1º card (Salão: "Total de cancelamentos"; Delivery: o nome do indicador). */
  tituloCard?: string;
  /** true: 1º card com status e tooltips com % do faturamento / percentual atual (padrão do Delivery). */
  cardDetalhado?: boolean;
  /** Mensagem quando o banco está conectado mas não há registros no período. */
  textoSemDados?: string;
}) {
  const [dados, setDados] = useState(dadosIniciais);
  const [inicio, setInicio] = useState(periodoInicial.inicio);
  const [fim, setFim] = useState(periodoInicial.fim);
  const [compInicio, setCompInicio] = useState(periodoInicial.compInicio);
  const [compFim, setCompFim] = useState(periodoInicial.compFim);
  const [compManual, setCompManual] = useState(false);
  const [loja, setLoja] = useState(lojaInicial);
  const [modoGrafico, setModoGrafico] = useState<"valor" | "percentual">("valor");
  const [statusFiltro, setStatusFiltro] = useState<StatusCancelamento | null>(null);
  const [ordem, setOrdem] = useState<OrdemRanking>("percentual");
  const [lojasAbertas, setLojasAbertas] = useState<Set<string>>(new Set());
  const [pendente, iniciarTransicao] = useTransition();
  const ultimaRequisicao = useRef(0);

  const completa = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 2000;

  function carregar(i: string, f: string, ci: string, cf: string) {
    // Valores intermediários da digitação (ano incompleto / início > fim) não consultam o servidor.
    if (![i, f, ci, cf].every(completa) || i > f || ci > cf) return;
    const req = ++ultimaRequisicao.current;
    iniciarTransicao(async () => {
      const r = await buscarCancelamentoPainel(fonte, dataDoInput(i), dataDoInput(f), dataDoInput(ci), dataDoInput(cf));
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
  const podeComparar = atual.disponivel && comp.disponivel;
  const mesCompleto = completa(inicio) && completa(fim) && ehMesCalendarioCompleto(dataDoInput(inicio), dataDoInput(fim));
  const sugestaoMes = mesCompleto ? mesAnteriorCompleto(dataDoInput(inicio), dataDoInput(fim)) : null;
  const compEhSugestao = sugestaoMes && paraInputDate(sugestaoMes.inicio) === compInicio && paraInputDate(sugestaoMes.fim) === compFim;

  const lojasEscopo = dados.atual.porLoja.filter((l) => loja === "TODAS" || l.unidade === loja);
  const contagem = lojasEscopo.reduce((c, l) => ({ ...c, [l.status]: c[l.status] + 1 }), { excelente: 0, bom: 0, atencao: 0, critico: 0 } as Record<StatusCancelamento, number>);

  const ranking = [...lojasEscopo].sort((a, b) => {
    switch (ordem) {
      case "valor":
        return b.valor - a.valor || a.unidade.localeCompare(b.unidade);
      case "loja":
        return a.unidade.localeCompare(b.unidade);
      case "criticidade":
        return PESO_STATUS[b.status] - PESO_STATUS[a.status] || b.percentual - a.percentual || a.unidade.localeCompare(b.unidade);
      default:
        return b.percentual - a.percentual || a.unidade.localeCompare(b.unidade);
    }
  });
  const rankingVisivel = statusFiltro ? ranking.filter((l) => l.status === statusFiltro) : ranking;

  const inputCls = "rounded-md border border-ragga-blue/15 bg-white px-3 py-2 text-sm focus:border-ragga-blue focus:outline-none focus:ring-1 focus:ring-ragga-blue/40";
  const periodoAtualTxt = `${diaMesAno(inicio)} a ${diaMesAno(fim)}`;
  const periodoCompTxt = `${diaMesAno(compInicio)} a ${diaMesAno(compFim)}`;

  return (
    <div className="space-y-5 bg-ragga-bg">
      {/* FILTROS: período atual + período de comparação (livres) + loja */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl border border-ragga-blue/10 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(31,53,112,0.06)]">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Período atual</p>
          <div className="flex items-center gap-2 text-sm">
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
          <div className="flex items-center gap-2 text-sm">
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
        {pendente && <span className="pb-2 text-xs text-foreground/50">Carregando...</span>}
      </div>
      <p className="-mt-3 px-1 text-[11px] text-foreground/45">
        Regra D-1 da aba: ocorrências de {diaMesAno(dados.atual.inicioOcorrencia)} a {diaMesAno(dados.atual.fimOcorrencia)} (comparado:{" "}
        {diaMesAno(dados.comparacao.inicioOcorrencia)} a {diaMesAno(dados.comparacao.fimOcorrencia)}).
      </p>

      {!dados.conectado && (
        <div className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          Banco de dados ainda não conectado — nenhum valor foi inventado.
        </div>
      )}

      {/* 1) CARDS — situação do período ATUAL; comparação no hover */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CardHover
          tooltip={
            <TooltipComparativo periodo={periodoCompTxt} temBase={podeComparar}>
              <TipLinha rotulo="Valor atual" valor={moeda.format(atual.valor)} />
              <TipLinha rotulo="Valor comparado" valor={moeda.format(comp.valor)} />
              <TipLinha rotulo="Variação R$" valor={sinalMoeda(atual.valor - comp.valor)} />
              <TipLinha rotulo="Variação %" valor={sinalPct(atual.valor, comp.valor)} />
              {cardDetalhado && (
                <>
                  <TipLinha rotulo="% do faturamento atual" valor={`${pct.format(atual.percentual)}%`} />
                  <TipLinha rotulo="% do faturamento comparado" valor={`${pct.format(comp.percentual)}%`} />
                  <TipLinha rotulo="Variação em p.p." valor={sinalPp(atual.percentual, comp.percentual)} />
                </>
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="text-foreground/60">Situação</span>
                <Situacao atual={atual.percentual} anterior={comp.percentual} />
              </div>
            </TooltipComparativo>
          }
        >
          <CardGrande titulo={`❌ ${tituloCard}`}>
            <p className="mt-1 text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">{atual.disponivel ? moeda.format(atual.valor) : "—"}</p>
            {atual.disponivel ? (
              <div className="mt-2 space-y-1 text-sm text-foreground/60">
                <p>
                  <span className="font-semibold tabular-nums">{pct.format(atual.percentual)}%</span> do faturamento
                </p>
                {cardDetalhado && (
                  <p>
                    <SemaforoBadge cor={atual.cor} texto={`Status: ${ROTULO_STATUS_CANCELAMENTO[atual.status]}`} />
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs text-foreground/45">{textoSemDados}</p>
            )}
          </CardGrande>
        </CardHover>

        <CardHover
          tooltip={
            <TooltipComparativo periodo={periodoCompTxt} temBase={podeComparar}>
              {cardDetalhado && <TipLinha rotulo="Percentual atual" valor={`${pct.format(atual.percentual)}%`} />}
              <TipLinha rotulo="Percentual comparado" valor={`${pct.format(comp.percentual)}%`} />
              <TipLinha rotulo="Variação em p.p." valor={sinalPp(atual.percentual, comp.percentual)} />
              <div className="flex items-center justify-between pt-1">
                <span className="text-foreground/60">Situação</span>
                <Situacao atual={atual.percentual} anterior={comp.percentual} />
              </div>
            </TooltipComparativo>
          }
        >
          <CardGrande titulo="📊 % Cancelamentos / faturamento">
            <p className="mt-1 text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">{atual.disponivel ? `${pct.format(atual.percentual)}%` : "—"}</p>
            {atual.disponivel ? (
              <div className="mt-2 space-y-0.5 text-sm text-foreground/60">
                <p>Total de cancelamentos ÷ Faturamento</p>
                <p className="text-xs text-foreground/45">Informativo.</p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-foreground/45">{textoSemDados}</p>
            )}
          </CardGrande>
        </CardHover>
      </div>

      {/* Explicação escrita (não depende de ícone nem de clique). */}
      <div className="rounded-lg border border-ragga-blue/10 bg-white px-4 py-3">
        <p className="text-sm text-ragga-blue-dark">{explicacao}</p>
        <p className="mt-1 text-xs text-foreground/50">
          A quantidade de ocorrências e o ticket médio não estão disponíveis nesta base (o registro é agregado por loja, dia e motivo), por isso não são exibidos.
        </p>
      </div>

      {/* 2) COMPARAÇÃO POR MOTIVO */}
      <Secao titulo="📋 Comparação por motivo">
        <div className="mb-3 grid gap-1 text-xs text-foreground/60 sm:grid-cols-2">
          <p>
            <span className="font-semibold text-ragga-blue-dark">Período atual:</span> {periodoAtualTxt}
          </p>
          <p>
            <span className="font-semibold text-ragga-blue-dark">Período comparado:</span> {periodoCompTxt}
          </p>
        </div>
        <TabelaComparativoMotivos atual={atual.motivos} comparado={comp.motivos} temBase={comp.disponivel} pctAtual={atual.percentual} pctComparado={comp.percentual} />
        <p className="mt-2 text-[11px] text-foreground/40">
          Percentual sobre o valor do período comparado; participação = motivo ÷ total de cancelamentos do período. Motivos: 🟢 redução = melhorou · 🔴 aumento = piorou · ⚪ sem alteração. A linha TOTAL segue o % sobre o faturamento.
        </p>
      </Secao>

      {/* 3) EVOLUÇÃO POR DIA */}
      <Secao titulo="📈 Evolução por dia" acao={<ToggleModo modo={modoGrafico} aoAlterar={setModoGrafico} />}>
        <Evolucao dias={atual.diario} modo={modoGrafico} rotulo={rotulo} />
      </Secao>

      {/* 4) RANKING DE LOJAS */}
      <Secao
        titulo={`🏪 Ranking de ${rotulo.toLowerCase()} por loja`}
        acao={
          <label className="flex items-center gap-2 text-xs font-medium text-ragga-blue-dark">
            Ordenar por
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as OrdemRanking)} className="rounded-md border border-ragga-blue/15 bg-white px-2 py-1.5 text-xs">
              <option value="valor">Valor</option>
              <option value="percentual">Porcentagem</option>
              <option value="loja">Loja</option>
              <option value="criticidade">Performance / Criticidade</option>
            </select>
          </label>
        }
      >
        <p className="mb-3 text-[11px] text-foreground/45">Status = % de cancelamentos sobre o faturamento da loja, pelos limites já existentes do indicador.</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {(["excelente", "bom", "atencao", "critico"] as const).map((s) => (
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
                {ROTULO_STATUS_CANCELAMENTO[s]} — {ESTILO_CHIP[s].faixa}
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                <th className="px-5 py-2.5 sm:px-6">Loja</th>
                <th className="px-4 py-2.5">Total cancelamentos</th>
                <th className="px-4 py-2.5">% canc. / fat.</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rankingVisivel.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-center text-sm text-foreground/45 sm:px-6">
                    Nenhuma loja neste filtro.
                  </td>
                </tr>
              ) : (
                rankingVisivel.map((l) => {
                  const aberta = lojasAbertas.has(l.unidade);
                  const compLoja = dados.comparacao.porLoja.find((x) => x.unidade === l.unidade);
                  return (
                    <Fragment key={l.unidade}>
                      <tr onClick={() => alternarLoja(l.unidade)} className="cursor-pointer border-b border-ragga-blue/5 hover:bg-ragga-blue/[0.04]">
                        <td className="px-5 py-3 font-semibold text-ragga-blue-dark sm:px-6">
                          <span className="mr-1.5 inline-block w-3 text-ragga-blue/45">{aberta ? "▾" : "▸"}</span>
                          {l.unidade}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-foreground/80">{moeda.format(l.valor)}</td>
                        <td className="px-4 py-3 tabular-nums font-semibold text-ragga-blue-dark">{pct.format(l.percentual)}%</td>
                        <td className="px-4 py-3">
                          <SemaforoBadge cor={l.cor} texto={`${ESTILO_CHIP[l.status].emoji} ${ROTULO_STATUS_CANCELAMENTO[l.status]}`} />
                        </td>
                      </tr>
                      {aberta && (
                        <tr>
                          <td colSpan={4} className="bg-ragga-bg/60 px-5 py-4 sm:px-6">
                            <DetalheLoja
                              loja={l}
                              compLoja={compLoja}
                              rotulo={rotulo}
                              indicadorOrientacao={indicadorOrientacao}
                              dataOcorrencia={dataDoInput(dados.atual.fimOcorrencia)}
                              periodoAtual={periodoAtualTxt}
                              periodoComp={periodoCompTxt}
                            />
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
    </div>
  );
}

/** Expansão da loja: resumo → comparativo → comparação por motivo (+ orientação) → evolução diária. */
function DetalheLoja({
  loja,
  compLoja,
  rotulo,
  indicadorOrientacao,
  dataOcorrencia,
  periodoAtual,
  periodoComp,
}: {
  loja: LojaCancelamento;
  compLoja?: LojaCancelamento;
  rotulo: string;
  indicadorOrientacao: string;
  dataOcorrencia: Date;
  periodoAtual: string;
  periodoComp: string;
}) {
  const [modo, setModo] = useState<"valor" | "percentual">("valor");
  // "Sem dados" no período comparado só quando a loja nem operou (sem faturamento) nem teve cancelamentos.
  const temComp = !!compLoja && (compLoja.faturamento > 0 || compLoja.valor > 0);

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Resumo da loja</p>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Item rotulo="Faturamento" valor={moeda.format(loja.faturamento)} />
          <Item rotulo="Total cancelamentos" valor={moeda.format(loja.valor)} />
          <Item rotulo="% sobre faturamento" valor={`${pct.format(loja.percentual)}%`} />
          <Item rotulo="Status" valor={<SemaforoBadge cor={loja.cor} texto={`${ESTILO_CHIP[loja.status].emoji} ${ROTULO_STATUS_CANCELAMENTO[loja.status]}`} />} />
        </div>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Comparativo</p>
        {temComp && compLoja ? (
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
                <tr className="border-t border-ragga-blue/5">
                  <td className="py-1.5 pr-3 font-medium text-ragga-blue-dark">Faturamento</td>
                  <td className="px-2">{moeda.format(loja.faturamento)}</td>
                  <td className="px-2">{moeda.format(compLoja.faturamento)}</td>
                  <VarCelulas atual={loja.faturamento} anterior={compLoja.faturamento} interpretar={false} />
                  <td className="px-2 text-xs text-foreground/40">Variação factual</td>
                </tr>
                <tr className="border-t border-ragga-blue/5">
                  <td className="py-1.5 pr-3 font-medium text-ragga-blue-dark">❌ Total de cancelamentos</td>
                  <td className="px-2">{moeda.format(loja.valor)}</td>
                  <td className="px-2">{moeda.format(compLoja.valor)}</td>
                  <VarCelulas atual={loja.valor} anterior={compLoja.valor} interpretar={false} />
                  <td className="px-2">
                    <Situacao atual={loja.percentual} anterior={compLoja.percentual} />
                  </td>
                </tr>
                <tr className="border-t border-ragga-blue/5">
                  <td className="py-1.5 pr-3 font-medium text-ragga-blue-dark">% sobre faturamento</td>
                  <td className="px-2">{pct.format(loja.percentual)}%</td>
                  <td className="px-2">{pct.format(compLoja.percentual)}%</td>
                  <td colSpan={2} className="px-2">
                    <VariacaoPp atual={loja.percentual} anterior={compLoja.percentual} interpretar />
                  </td>
                  <td className="px-2">
                    <Situacao atual={loja.percentual} anterior={compLoja.percentual} />
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
        <TabelaComparativoMotivos
          atual={loja.motivos}
          comparado={compLoja?.motivos ?? []}
          temBase={temComp}
          pctAtual={loja.percentual}
          pctComparado={compLoja?.percentual ?? 0}
          renderAcao={(motivo, valor) => (
            <PlanoAcaoCelula
              indicador={indicadorOrientacao}
              unidade={loja.unidade as CodigoUnidade}
              motivo={motivo}
              valor={valor}
              percentualFaturamento={loja.faturamento > 0 ? (valor / loja.faturamento) * 100 : 0}
              dataOcorrencia={dataOcorrencia}
            />
          )}
        />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Evolução diária — {loja.unidade}</p>
          <ToggleModo modo={modo} aoAlterar={setModo} />
        </div>
        <Evolucao dias={loja.diario} modo={modo} rotulo={rotulo} altura={190} />
      </div>
    </div>
  );
}
