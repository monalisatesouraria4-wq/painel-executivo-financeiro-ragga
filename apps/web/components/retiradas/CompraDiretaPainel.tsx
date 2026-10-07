"use client";

import { Fragment, useRef, useState, useTransition, type ReactNode } from "react";
import { UNIDADES, type CodigoUnidade } from "@painel/shared";
import { SemaforoBadge } from "@/components/ui/SemaforoBadge";
import { GraficoLinhaDiaria, NOME_DIA, diaDaSemana } from "@/components/ui/GraficoLinhaDiaria";
import { PlanoAcaoCelula } from "@/components/indicadores/PlanoAcaoCelula";
import { paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { ehMesCalendarioCompleto, mesAnteriorCompleto } from "@/lib/rules/mesAnterior";
import {
  LIMITE_SAUDAVEL_COMPRA_DIRETA,
  ROTULO_STATUS,
  type CompraDiretaPainelData,
  type DiaCompraDireta,
  type LojaCompraDireta,
  type MotivoCompraDireta,
  type PeriodoCompraDireta,
  type StatusCompraDireta,
  compararMotivos,
  ROTULO_AJUSTE_SEM_SAIDA,
  situacaoCompraDireta,
} from "@/lib/services/compraDiretaPainel";
import { buscarCompraDiretaPainel } from "@/lib/actions/buscarCompraDiretaPainel";
import { BlocoAjustesSemSaida, SecaoMotivosRetirada } from "@/components/retiradas/CompraDiretaAnalise";
import { CelulaComparado, SecaoInvestigarMotivo } from "@/components/indicadores/CancelamentoAnalise";
import {
  baseCobreOsPeriodos,
  compararMotivosCancelados,
  lojasDoMotivo,
  motivosCancelados,
  percentualCancelamentoValido,
} from "@/lib/services/cancelamentoAnalise";
import {
  aplicarSituacaoPorValor,
  aplicarSituacaoPorValorLojas,
  ajustesSemSaidaPorLoja,
  comparabilidadeCompraDireta,
  contagemStatusValida,
  linhasLojasCompraDireta,
  ordenarLojasCompraDireta,
  situacaoPorValor,
  type OrdemLojasCompraDireta,
} from "@/lib/services/compraDiretaAnalise";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function diaMesAno(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Escopo exibido (rede inteira ou uma loja) — mesmos campos nos dois casos. */
interface Escopo {
  disponivel: boolean;
  faturamento: number;
  valor: number;
  percentual: number;
  status: StatusCompraDireta;
  cor: LojaCompraDireta["cor"];
  motivos: MotivoCompraDireta[];
  diario: DiaCompraDireta[];
  /** Ajustes sem saída de caixa ("NOTA FISCAL") — fora de `valor`. */
  ajustesSemSaida: number;
  /** Total lançado = retirada financeira + ajustes sem saída de caixa. */
  totalLancado: number;
}

function escopoDe(periodo: PeriodoCompraDireta, loja: string): Escopo {
  if (loja === "TODAS") return periodo;
  const l = periodo.porLoja.find((x) => x.unidade === loja);
  if (!l) return { disponivel: false, faturamento: 0, valor: 0, percentual: 0, status: "controlado", cor: "verde", motivos: [], diario: [], ajustesSemSaida: 0, totalLancado: 0 };
  return { disponivel: l.valor > 0 || l.motivos.length > 0 || l.ajustesSemSaida > 0, ...l, totalLancado: Math.round((l.valor + l.ajustesSemSaida) * 100) / 100 };
}

type Formato = "moeda" | "pp";

/**
 * Variação entre período atual e comparado. `interpretar` = true só para Compra Direta
 * (e seus motivos / % sobre faturamento): redução = melhora (verde), aumento = piora
 * (vermelho). Faturamento NÃO é interpretado — apenas a variação matemática, em cinza.
 */
function TextoVariacao({ atual, anterior, formato = "moeda", interpretar = false }: { atual: number; anterior: number; formato?: Formato; interpretar?: boolean }) {
  const delta = atual - anterior;
  const seta = delta > 0 ? "↑" : delta < 0 ? "↓" : "=";
  const cor = !interpretar || delta === 0 ? "text-foreground/70" : delta < 0 ? "text-semaforo-verde" : "text-semaforo-vermelho";
  if (formato === "pp") {
    return (
      <span className={`font-semibold tabular-nums ${cor}`}>
        {seta} {pct.format(Math.abs(delta))} p.p.
      </span>
    );
  }
  const p = anterior !== 0 ? (delta / anterior) * 100 : null;
  return (
    <span className={`font-semibold tabular-nums ${cor}`}>
      {seta} {moeda.format(Math.abs(delta))}
      {p !== null && ` (${delta >= 0 ? "+" : "-"}${pct.format(Math.abs(p))}%)`}
    </span>
  );
}

function Situacao({ atual, anterior }: { atual: number; anterior: number }) {
  const situacao = situacaoCompraDireta(atual, anterior);
  if (situacao === "sem-alteracao") return <span className="text-xs font-semibold text-foreground/50">Sem alteração</span>;
  return situacao === "melhorou" ? (
    <span className="whitespace-nowrap text-xs font-semibold text-semaforo-verde">🟢 Melhorou</span>
  ) : (
    <span className="whitespace-nowrap text-xs font-semibold text-semaforo-vermelho">🔴 Piorou</span>
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

/** Evolução diária da Compra Direta: gráfico de linha compartilhado + tooltip de composição por motivo (hover). */
function GraficoDiario({ dias, modo, altura = 230 }: { dias: DiaCompraDireta[]; modo: "valor" | "percentual"; altura?: number }) {
  return (
    <GraficoLinhaDiaria
      dias={dias}
      modo={modo}
      altura={altura}
      metaPercentual={LIMITE_SAUDAVEL_COMPRA_DIRETA}
      rotuloMaior="Maior retirada"
      rotuloMenor="Menor retirada"
      textoAjuda="Passe o mouse sobre um ponto para ver os motivos do dia. Faixas suaves = sábado e domingo. Maior/menor consideram só dias com dado válido; dias sem registro ficam como lacuna na linha (nunca R$ 0 inventado)."
      renderTooltip={(dia, { modo: m, y }) => {
        const motivos = [...dia.motivos].filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor);
        const total = motivos.reduce((t, x) => t + x.valor, 0);
        return (
          <>
            <p className="text-xs font-bold text-ragga-blue">
              📅 {diaMesAno(dia.data)} <span className="font-medium text-foreground/50">({NOME_DIA[diaDaSemana(dia.data)]})</span>
            </p>
            <p className="mt-0.5 text-xs text-foreground/60">
              Total Compra Direta: <span className="text-sm font-extrabold tabular-nums text-ragga-blue-dark">{moeda.format(dia.valor)}</span>
            </p>
            {m === "percentual" && dia.faturamento > 0 && (
              <p className="text-[11px] text-foreground/50">
                {pct.format(y)}% do faturamento do dia ({moeda.format(dia.faturamento)})
              </p>
            )}
            {motivos.length === 0 ? (
              <p className="mt-2 text-xs text-foreground/50">Sem retiradas de Compra Direta neste dia.</p>
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

const ESTILO_CHIP: Record<StatusCompraDireta, { emoji: string; faixa: string; classe: string }> = {
  controlado: { emoji: "🟢", faixa: "até 5%", classe: "border-semaforo-verde/30 bg-semaforo-verde/10" },
  atencao: { emoji: "🟡", faixa: "acima de 5% até 7%", classe: "border-semaforo-amarelo/30 bg-semaforo-amarelo/10" },
  critico: { emoji: "🔴", faixa: "acima de 7%", classe: "border-semaforo-vermelho/30 bg-semaforo-vermelho/10" },
};

type OrdemRanking = OrdemLojasCompraDireta;

function distanciaTexto(percentual: number): string {
  const d = percentual - LIMITE_SAUDAVEL_COMPRA_DIRETA;
  return `${d >= 0 ? "+" : "-"}${pct.format(Math.abs(d))} p.p.`;
}

function CardGrande({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-ragga-blue/10 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground/45">{titulo}</p>
      {children}
    </div>
  );
}

export function CompraDiretaPainel({
  dadosIniciais,
  periodoInicial,
  lojaInicial = "TODAS",
}: {
  dadosIniciais: CompraDiretaPainelData;
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
  const [statusFiltro, setStatusFiltro] = useState<StatusCompraDireta | null>(null);
  const [ordem, setOrdem] = useState<OrdemRanking>("percentual");
  const [lojasAbertas, setLojasAbertas] = useState<Set<string>>(new Set());
  const [motivoSel, setMotivoSel] = useState<string | null>(null);
  const [pendente, iniciarTransicao] = useTransition();
  const ultimaRequisicao = useRef(0);

  const completa = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 2000;

  function carregar(i: string, f: string, ci: string, cf: string) {
    // Valores intermediários da digitação (ano incompleto / início > fim) não consultam o servidor.
    if (![i, f, ci, cf].every(completa) || i > f || ci > cf) return;
    const req = ++ultimaRequisicao.current;
    iniciarTransicao(async () => {
      const r = await buscarCompraDiretaPainel(dataDoInput(i), dataDoInput(f), dataDoInput(ci), dataDoInput(cf));
      if (req === ultimaRequisicao.current) setDados(r);
    });
  }

  function alterarAtual(i: string, f: string) {
    setInicio(i);
    setFim(f);
    let ci = compInicio;
    let cf = compFim;
    // Mês completo selecionado → sugere o mês anterior completo (enquanto o usuário não escolher outro período).
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
  // Comparação só vale com cobertura: a base de Compra Direta cobre os dois períodos e o faturamento (rede ou loja) está
  // completo nos dois. Sem isso: valores absolutos com aviso, nunca % / status / variação inválidos.
  const comparab = comparabilidadeCompraDireta(dados, loja);
  const podeComparar = atual.disponivel && comp.disponivel && comparab.valida;
  const mesCompleto = completa(inicio) && completa(fim) && ehMesCalendarioCompleto(dataDoInput(inicio), dataDoInput(fim));
  const sugestaoMes = mesCompleto ? mesAnteriorCompleto(dataDoInput(inicio), dataDoInput(fim)) : null;
  const compEhSugestao = sugestaoMes && paraInputDate(sugestaoMes.inicio) === compInicio && paraInputDate(sugestaoMes.fim) === compFim;

  const baseCobre = baseCobreOsPeriodos(dados);
  const linhasLojas = linhasLojasCompraDireta(dados.atual, dados.comparacao, baseCobre, loja);
  // Só lojas com faturamento em todos os dias entram na classificação (o % de uma loja parcial não representa o período).
  const contagem = contagemStatusValida(linhasLojas);
  const foraDoLimite = contagem.atencao + contagem.critico;
  const ranking = ordenarLojasCompraDireta(linhasLojas, ordem);
  const rankingVisivel = statusFiltro ? ranking.filter((l) => !l.coberturaParcial && l.status === statusFiltro) : ranking;

  // Motivos ORIGINAIS (retirada real, Nota Fiscal fora) → lojas; mesma base que os cards (reconcilia com o total).
  const linhasMotivos = aplicarSituacaoPorValor(compararMotivosCancelados(dados.atual, dados.comparacao, podeComparar, loja));
  const motivosAtual = motivosCancelados(dados.atual, loja).map((m) => m.motivo);
  const motivoAtivo = motivoSel && motivosAtual.includes(motivoSel) ? motivoSel : (motivosAtual[0] ?? null);
  const lojasMotivo = motivoAtivo ? aplicarSituacaoPorValorLojas(lojasDoMotivo(motivoAtivo, dados.atual, dados.comparacao, baseCobre, loja)) : [];
  function investigarMotivo(m: string) {
    setMotivoSel(m);
    requestAnimationFrame(() => document.getElementById("retirada-motivo")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  const ajustesPorLoja = ajustesSemSaidaPorLoja(dados.atual, dados.comparacao, baseCobre, loja);

  // % sobre o faturamento só com faturamento completo no período (senão null: sem % e sem status).
  const pctAtualValido = percentualCancelamentoValido(dados.atual, loja);
  const pctCompValido = podeComparar ? percentualCancelamentoValido(dados.comparacao, loja) : null;
  const totalSecao = {
    valor: atual.valor,
    comparado: podeComparar ? comp.valor : null,
    percentual: pctAtualValido,
    variacaoPp: pctAtualValido !== null && pctCompValido !== null ? pctAtualValido - pctCompValido : null,
    situacao: situacaoPorValor(atual.valor, podeComparar ? comp.valor : null),
  };

  const inputCls = "rounded-md border border-ragga-blue/15 bg-white px-3 py-2 text-sm focus:border-ragga-blue focus:outline-none focus:ring-1 focus:ring-ragga-blue/40";
  const periodoAtualTxt = `${diaMesAno(inicio)} a ${diaMesAno(fim)}`;
  const periodoCompTxt = `${diaMesAno(compInicio)} a ${diaMesAno(compFim)}`;
  // Datas de OCORRÊNCIA (D-1) — as que de fato foram somadas; usadas nas seções novas para não confundir com a referência.
  const ocorrAtualTxt = `${diaMesAno(dados.atual.inicioOcorrencia)} a ${diaMesAno(dados.atual.fimOcorrencia)}`;
  const ocorrCompTxt = `${diaMesAno(dados.comparacao.inicioOcorrencia)} a ${diaMesAno(dados.comparacao.fimOcorrencia)}`;
  const blocoStatus =
    pctAtualValido !== null ? (
      <>
        <p>
          Meta saudável: {pct.format(LIMITE_SAUDAVEL_COMPRA_DIRETA)}% · Distância: <span className="font-semibold tabular-nums">{distanciaTexto(pctAtualValido)}</span>
        </p>
        <p className="pt-0.5">
          <SemaforoBadge cor={atual.cor} texto={`Status: ${ROTULO_STATUS[atual.status]}`} />
        </p>
      </>
    ) : (
      <p className="text-xs font-semibold text-semaforo-amarelo">⚠ Faturamento incompleto no período: % sobre o faturamento e status não são calculados.</p>
    );

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

      {/* 1) RESULTADO — cards principais */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <CardGrande titulo="Faturamento">
          <p className="mt-1 text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">{atual.disponivel ? moeda.format(atual.faturamento) : "—"}</p>
          {podeComparar ? (
            <div className="mt-2 space-y-0.5 text-xs text-foreground/60">
              <p>
                Comparado: <span className="font-semibold tabular-nums">{moeda.format(comp.faturamento)}</span>
              </p>
              <p>
                Variação: <TextoVariacao atual={atual.faturamento} anterior={comp.faturamento} />
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-foreground/45">{atual.disponivel ? "Sem dados no período comparado" : "Sem dados no período"}</p>
          )}
        </CardGrande>

        <CardGrande titulo="Retirada Compra Direta">
          <p className="mt-1 text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">{atual.disponivel ? moeda.format(atual.valor) : "—"}</p>
          {atual.disponivel ? (
            <div className="mt-2 space-y-0.5 text-xs text-foreground/60">
              <p className="text-foreground/45">Retirada financeira real — exclui Nota Fiscal</p>
              {pctAtualValido !== null && (
                <p>
                  <span className="font-semibold tabular-nums">{pct.format(pctAtualValido)}%</span> do faturamento
                </p>
              )}
              {blocoStatus}
              {podeComparar && (
                <>
                  <p className="pt-1">
                    Comparado: <span className="font-semibold tabular-nums">{moeda.format(comp.valor)}</span>
                  </p>
                  <p>
                    Variação: <TextoVariacao atual={atual.valor} anterior={comp.valor} interpretar />
                  </p>
                </>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-foreground/45">Sem dados no período</p>
          )}
        </CardGrande>

        <CardGrande titulo="% sobre faturamento">
          <p className="mt-1 text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">{atual.disponivel && pctAtualValido !== null ? `${pct.format(pctAtualValido)}%` : "—"}</p>
          {atual.disponivel ? (
            <div className="mt-2 space-y-0.5 text-xs text-foreground/60">
              {blocoStatus}
              {podeComparar && pctAtualValido !== null && pctCompValido !== null && (
                <>
                  <p className="pt-1">
                    Comparado: <span className="font-semibold tabular-nums">{pct.format(pctCompValido)}%</span>
                  </p>
                  <p>
                    Variação: <TextoVariacao atual={pctAtualValido} anterior={pctCompValido} formato="pp" interpretar />
                  </p>
                </>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-foreground/45">Sem dados no período</p>
          )}
        </CardGrande>

        <CardGrande titulo="Ajustes sem saída de caixa">
          <p className="mt-1 text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">{atual.disponivel ? moeda.format(atual.ajustesSemSaida) : "—"}</p>
          {atual.disponivel ? (
            <div className="mt-2 space-y-0.5 text-xs text-foreground/60">
              <p className="text-foreground/45">{ROTULO_AJUSTE_SEM_SAIDA} — não é saída real de caixa</p>
              <p>
                Total lançado em Compra Direta: <span className="font-semibold tabular-nums">{moeda.format(atual.totalLancado)}</span>
              </p>
              {comp.disponivel && (
                <>
                  <p className="pt-1">
                    Comparado: <span className="font-semibold tabular-nums">{moeda.format(comp.ajustesSemSaida)}</span>
                  </p>
                  <p>
                    Variação: <TextoVariacao atual={atual.ajustesSemSaida} anterior={comp.ajustesSemSaida} />
                  </p>
                </>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-foreground/45">Sem dados no período</p>
          )}
        </CardGrande>

        <CardGrande titulo="Lojas fora do limite">
          <p className="mt-1 text-[1.6rem] font-extrabold leading-tight text-ragga-blue-dark">
            {foraDoLimite} de {contagem.comCobertura} {contagem.comCobertura === 1 ? "loja" : "lojas"}
          </p>
          <div className="mt-2 space-y-0.5 text-xs text-foreground/60">
            <p>
              🔴 <span className="font-semibold">{contagem.critico}</span> {contagem.critico === 1 ? "crítico" : "críticos"}
            </p>
            <p>
              🟡 <span className="font-semibold">{contagem.atencao}</span> atenção
            </p>
            <p>
              🟢 <span className="font-semibold">{contagem.controlado}</span> {contagem.controlado === 1 ? "controlada" : "controladas"}
            </p>
            {contagem.semCobertura > 0 && (
              <p className="pt-0.5 font-semibold text-semaforo-amarelo">
                ⚠ {contagem.semCobertura} {contagem.semCobertura === 1 ? "loja sem" : "lojas sem"} faturamento completo no período — fora da classificação
              </p>
            )}
          </div>
        </CardGrande>
      </div>

      {/* 2) O QUE GEROU AS RETIRADAS? — motivos originais (ou subtotal CMO) → lojas; reconcilia com o total dos cards */}
      <SecaoMotivosRetirada
        linhas={linhasMotivos}
        total={totalSecao}
        comparavel={podeComparar}
        motivoSemComparacao={atual.disponivel && comp.disponivel ? comparab.motivo : "Sem registros de Compra Direta em um dos períodos."}
        periodoAtualTxt={ocorrAtualTxt}
        periodoCompTxt={ocorrCompTxt}
        escopoTxt={loja === "TODAS" ? "rede" : loja}
        motivoSelecionado={motivoAtivo}
        aoInvestigar={investigarMotivo}
      />

      {/* Nota Fiscal — ajuste sem saída de caixa, separado da retirada real */}
      <BlocoAjustesSemSaida
        atual={atual.ajustesSemSaida}
        comparado={baseCobre && comp.disponivel ? comp.ajustesSemSaida : null}
        porLoja={ajustesPorLoja}
        escopoTxt={loja === "TODAS" ? "rede" : loja}
      />

      {/* 3) COMPARATIVO DE RETIRADAS POR LOJA — valor absoluto e proporção (% s/ faturamento) lado a lado */}
      <Secao
        titulo="Comparativo de retiradas por loja"
        acao={
          <label className="flex items-center gap-2 text-xs font-medium text-ragga-blue-dark">
            Ordenar por
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as OrdemRanking)} className="rounded-md border border-ragga-blue/15 bg-white px-2 py-1.5 text-xs">
              <option value="valor">Valor retirado (R$)</option>
              <option value="percentual">% sobre o faturamento</option>
              <option value="variacao">Variação vs. período comparado (R$)</option>
              <option value="loja">Loja</option>
              <option value="criticidade">Status (semáforo)</option>
            </select>
          </label>
        }
      >
        <p className="mb-3 text-[11px] text-foreground/45">
          Valor absoluto e proporção são mostrados separadamente: a loja de maior valor não é, por isso, a pior. Status = % da retirada real sobre o faturamento da loja, pelos limites já existentes (até 5% controlado, até 7% atenção, acima crítico); Nota Fiscal fica fora. A situação (melhorou/piorou) por motivo é pelo valor em R$ — veja “O que gerou as retiradas?”.
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {(["controlado", "atencao", "critico"] as const).map((s) => (
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
                {ROTULO_STATUS[s]} — {ESTILO_CHIP[s].faixa}
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
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                <th className="px-5 py-2.5 sm:px-6">Loja</th>
                <th className="px-4 py-2.5">Retirada real</th>
                <th className="px-4 py-2.5">Faturamento da loja</th>
                <th className="px-4 py-2.5">% retirada s/ fat.</th>
                <th className="px-4 py-2.5">Comparado e variação (R$, % do valor)</th>
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rankingVisivel.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-sm text-foreground/45 sm:px-6">
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
                        <td className="px-4 py-3 tabular-nums font-semibold text-foreground/80">{moeda.format(l.valor)}</td>
                        <td className="px-4 py-3 tabular-nums text-foreground/70">{l.diasComFaturamento === 0 ? <span className="text-xs font-semibold text-semaforo-amarelo">Sem faturamento</span> : moeda.format(l.faturamento)}</td>
                        <td className="px-4 py-3 tabular-nums font-semibold text-ragga-blue-dark">
                          {l.percentual === null ? (
                            <span className="text-xs font-semibold text-semaforo-amarelo">
                              ⚠ faturamento em {l.diasComFaturamento} de {l.diasDoPeriodo} dias
                            </span>
                          ) : (
                            `${pct.format(l.percentual)}%`
                          )}
                          {l.percentual !== null && l.variacaoPp !== null && (
                            <span className="block whitespace-nowrap text-[11px] font-normal text-foreground/55">
                              {Math.abs(l.variacaoPp) < 0.005 ? "" : l.variacaoPp > 0 ? "+" : "-"}
                              {pct.format(Math.abs(l.variacaoPp))} p.p. vs. comparado
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          <CelulaComparado comparado={l.comparado} reais={l.variacaoReais} percentual={l.variacaoPercentual} />
                        </td>
                        <td className="px-4 py-3">
                          {l.coberturaParcial ? (
                            <span className="text-xs font-semibold text-semaforo-amarelo">⚠ Cobertura parcial</span>
                          ) : (
                            <SemaforoBadge cor={l.loja.cor} texto={`${ESTILO_CHIP[l.status].emoji} ${ROTULO_STATUS[l.status]}`} />
                          )}
                        </td>
                      </tr>
                      {aberta && (
                        <tr>
                          <td colSpan={6} className="bg-ragga-bg/60 px-5 py-4 sm:px-6">
                            <DetalheLoja loja={l.loja} compLoja={l.compLoja ?? undefined} dataOcorrencia={dataDoInput(dados.atual.fimOcorrencia)} periodoAtual={periodoAtualTxt} periodoComp={periodoCompTxt} />
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
          Comparado: {ocorrCompTxt} (datas de ocorrência). Variação só aparece com a base e o faturamento completos da loja nos dois períodos. Loja com faturamento em menos dias que o período fica sem % e sem status (valores em R$ mantidos).
        </p>
      </Secao>

      {/* 4) INVESTIGAR POR MOTIVO — compara lojas dentro do mesmo motivo ORIGINAL */}
      <div id="retirada-motivo" className="scroll-mt-4">
        <SecaoInvestigarMotivo
          motivos={motivosAtual}
          selecionado={motivoAtivo}
          aoSelecionar={setMotivoSel}
          lojas={lojasMotivo}
          periodoAtualTxt={ocorrAtualTxt}
          periodoCompTxt={ocorrCompTxt}
          comparavel={baseCobre}
          rotulo="Compra Direta"
          textoSemDados="Sem retiradas de Compra Direta no período."
          situacaoPorValor
        />
      </div>

      {/* DETALHAMENTO — comparativo de períodos, evolução diária e Pareto */}
      {/* 2) COMPARAÇÃO */}
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
                <th className="px-3 py-2">Variação</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              <tr className="border-b border-ragga-blue/5">
                <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">Faturamento</td>
                <td className="px-3">{atual.disponivel ? moeda.format(atual.faturamento) : "Sem dados"}</td>
                <td className="px-3">{comp.disponivel ? moeda.format(comp.faturamento) : "Sem dados"}</td>
                <td className="px-3">{podeComparar ? <TextoVariacao atual={atual.faturamento} anterior={comp.faturamento} /> : "—"}</td>
              </tr>
              <tr className="border-b border-ragga-blue/5">
                <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">Compra Direta</td>
                <td className="px-3">{atual.disponivel ? moeda.format(atual.valor) : "Sem dados"}</td>
                <td className="px-3">{comp.disponivel ? moeda.format(comp.valor) : "Sem dados"}</td>
                <td className="px-3">{podeComparar ? <TextoVariacao atual={atual.valor} anterior={comp.valor} interpretar /> : "—"}</td>
              </tr>
              <tr className="border-b border-ragga-blue/5">
                <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">% sobre faturamento</td>
                <td className="px-3">{pctAtualValido !== null ? `${pct.format(pctAtualValido)}%` : atual.disponivel ? "Faturamento incompleto" : "Sem dados"}</td>
                <td className="px-3">{podeComparar && pctCompValido !== null ? `${pct.format(pctCompValido)}%` : comp.disponivel ? "Sem base válida" : "Sem dados"}</td>
                <td className="px-3">{podeComparar && pctAtualValido !== null && pctCompValido !== null ? <TextoVariacao atual={pctAtualValido} anterior={pctCompValido} formato="pp" interpretar /> : "—"}</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">Ajustes sem saída de caixa</td>
                <td className="px-3">{atual.disponivel ? moeda.format(atual.ajustesSemSaida) : "Sem dados"}</td>
                <td className="px-3">{comp.disponivel ? moeda.format(comp.ajustesSemSaida) : "Sem dados"}</td>
                <td className="px-3">{podeComparar ? <TextoVariacao atual={atual.ajustesSemSaida} anterior={comp.ajustesSemSaida} /> : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-foreground/40">
          Compra Direta e % sobre faturamento: redução = melhora (verde), aumento = piora (vermelho). Sem cobertura completa da base e do faturamento, o % e a variação não são exibidos. Faturamento e Ajustes sem saída de caixa (Nota Fiscal): apenas a variação matemática — Nota Fiscal não é retirada financeira.
        </p>
      </Secao>

      {/* Evolução diária */}
      <Secao titulo="Evolução por dia" acao={<ToggleModo modo={modoGrafico} aoAlterar={setModoGrafico} />}>
        <GraficoDiario dias={atual.diario} modo={modoGrafico} />
      </Secao>

      {/* 4) MOTIVO — Pareto (antes do ranking de lojas) */}
      <Secao titulo="Principais motivos da Compra Direta">
        {atual.motivos.length === 0 ? <p className="text-sm text-foreground/45">Sem dados no período.</p> : <TabelaMotivos motivos={atual.motivos} />}
      </Secao>

    </div>
  );
}

function TabelaMotivos({ motivos }: { motivos: MotivoCompraDireta[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
            <th className="py-2 pr-4">Motivo</th>
            <th className="px-3 py-2">Valor</th>
            <th className="px-3 py-2">% do total</th>
            <th className="px-3 py-2">% acumulado</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {motivos.map((m) => (
            <tr key={m.motivo} className="border-b border-ragga-blue/5 last:border-0">
              <td className="py-2.5 pr-4 font-medium text-ragga-blue-dark">{m.motivo}</td>
              <td className="px-3">{moeda.format(m.valor)}</td>
              <td className="px-3">{pct.format(m.percentualDoTotal)}%</td>
              <td className="min-w-[10rem] px-3">
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-ragga-blue/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-ragga-blue to-ragga-blue-dark" style={{ width: `${Math.min(100, m.percentualAcumulado)}%` }} />
                  </div>
                  <span className="w-14 text-right text-xs text-foreground/60">{pct.format(m.percentualAcumulado)}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Expansão da loja: resumo → comparativo → comparativo por motivo (+ orientação) → evolução diária. */
function DetalheLoja({
  loja,
  compLoja,
  dataOcorrencia,
  periodoAtual,
  periodoComp,
}: {
  loja: LojaCompraDireta;
  compLoja?: LojaCompraDireta;
  dataOcorrencia: Date;
  periodoAtual: string;
  periodoComp: string;
}) {
  const [modo, setModo] = useState<"valor" | "percentual">("valor");
  // "Sem dados" no período comparado só quando a loja nem operou (sem faturamento) nem retirou.
  const temComp = !!compLoja && (compLoja.faturamento > 0 || compLoja.valor > 0 || compLoja.ajustesSemSaida > 0);

  const linhasMotivo = compararMotivos(loja.motivos, compLoja?.motivos ?? []);
  const totalAtual = loja.motivos.reduce((s, m) => s + m.valor, 0);
  const totalComp = compLoja?.motivos.reduce((s, m) => s + m.valor, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Resumo da loja</p>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-7">
          <Item rotulo="Faturamento" valor={moeda.format(loja.faturamento)} />
          <Item rotulo="Compra Direta" valor={moeda.format(loja.valor)} />
          <Item rotulo="Ajustes sem saída de caixa" valor={moeda.format(loja.ajustesSemSaida)} />
          <Item rotulo="% sobre faturamento" valor={`${pct.format(loja.percentual)}%`} />
          <Item rotulo="Limite saudável" valor={`${pct.format(LIMITE_SAUDAVEL_COMPRA_DIRETA)}%`} />
          <Item rotulo="Distância do limite" valor={distanciaTexto(loja.percentual)} />
          <Item rotulo="Status" valor={<SemaforoBadge cor={loja.cor} texto={`${ESTILO_CHIP[loja.status].emoji} ${ROTULO_STATUS[loja.status]}`} />} />
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
                  <th className="px-2 py-1">Variação</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-1 pr-3 font-medium text-ragga-blue-dark">Faturamento</td>
                  <td className="px-2">{moeda.format(loja.faturamento)}</td>
                  <td className="px-2">{moeda.format(compLoja.faturamento)}</td>
                  <td className="px-2"><TextoVariacao atual={loja.faturamento} anterior={compLoja.faturamento} /></td>
                </tr>
                <tr>
                  <td className="py-1 pr-3 font-medium text-ragga-blue-dark">Compra Direta</td>
                  <td className="px-2">{moeda.format(loja.valor)}</td>
                  <td className="px-2">{moeda.format(compLoja.valor)}</td>
                  <td className="px-2">
                    <TextoVariacao atual={loja.valor} anterior={compLoja.valor} interpretar /> <Situacao atual={loja.valor} anterior={compLoja.valor} />
                  </td>
                </tr>
                <tr>
                  <td className="py-1 pr-3 font-medium text-ragga-blue-dark">% sobre faturamento</td>
                  <td className="px-2">{pct.format(loja.percentual)}%</td>
                  <td className="px-2">{pct.format(compLoja.percentual)}%</td>
                  <td className="px-2"><TextoVariacao atual={loja.percentual} anterior={compLoja.percentual} formato="pp" interpretar /></td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-foreground/45">Sem dados da loja no período comparado.</p>
        )}
      </div>

      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Comparativo por motivo</p>
        <p className="mb-2 text-[11px] text-foreground/45">
          Participação = valor do motivo ÷ total de Compra Direta da loja no período (não é sobre o faturamento). Valor menor = 🟢 melhorou; maior = 🔴 piorou.
        </p>
        {linhasMotivo.length === 0 && loja.ajustesSemSaida === 0 && (compLoja?.ajustesSemSaida ?? 0) === 0 ? (
          <p className="text-sm text-foreground/45">Sem retiradas nos períodos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                  <th className="py-1 pr-3">Motivo</th>
                  <th className="px-2 py-1">Atual<span className="block font-normal normal-case">valor — participação</span></th>
                  <th className="px-2 py-1">Comparado<span className="block font-normal normal-case">valor — participação</span></th>
                  <th className="px-2 py-1">Variação</th>
                  <th className="px-2 py-1">Situação</th>
                  <th className="px-2 py-1">Ação</th>
                </tr>
              </thead>
              <tbody>
                {linhasMotivo.map((m) => {
                  const va = m.atual?.valor ?? 0;
                  const vc = m.comparado?.valor ?? 0;
                  return (
                    <tr key={m.motivo} className="border-t border-ragga-blue/5 align-top">
                      <td className="py-1.5 pr-3 font-medium text-ragga-blue-dark">{m.motivo}</td>
                      <td className="px-2">
                        {moeda.format(va)}
                        <span className="block text-xs text-foreground/50">{pct.format(m.atual?.percentualDoTotal ?? 0)}%</span>
                      </td>
                      <td className="px-2">
                        {temComp ? moeda.format(vc) : "Sem dados"}
                        {temComp && <span className="block text-xs text-foreground/50">{pct.format(m.comparado?.percentualDoTotal ?? 0)}%</span>}
                      </td>
                      <td className="px-2">{temComp ? <TextoVariacao atual={va} anterior={vc} interpretar /> : "—"}</td>
                      <td className="px-2">{temComp ? <Situacao atual={va} anterior={vc} /> : "—"}</td>
                      <td className="px-2">
                        {va > 0 ? (
                          <PlanoAcaoCelula
                            indicador="Retirada Compra Direta"
                            unidade={loja.unidade as CodigoUnidade}
                            motivo={m.motivo}
                            valor={va}
                            percentualFaturamento={loja.faturamento > 0 ? (va / loja.faturamento) * 100 : 0}
                            dataOcorrencia={dataOcorrencia}
                          />
                        ) : (
                          <span className="text-xs text-foreground/30">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t border-ragga-blue/15 font-semibold text-ragga-blue-dark">
                  <td className="py-1.5 pr-3">Total de retiradas financeiras</td>
                  <td className="px-2">
                    {moeda.format(totalAtual)}
                    <span className="block text-xs font-normal text-foreground/50">{pct.format(loja.motivos.reduce((s, m) => s + m.percentualDoTotal, 0))}%</span>
                  </td>
                  <td className="px-2">
                    {temComp ? moeda.format(totalComp) : "Sem dados"}
                    {temComp && (
                      <span className="block text-xs font-normal text-foreground/50">{pct.format((compLoja?.motivos ?? []).reduce((s, m) => s + m.percentualDoTotal, 0))}%</span>
                    )}
                  </td>
                  <td className="px-2">{temComp ? <TextoVariacao atual={totalAtual} anterior={totalComp} interpretar /> : "—"}</td>
                  <td className="px-2">{temComp ? <Situacao atual={totalAtual} anterior={totalComp} /> : "—"}</td>
                  <td />
                </tr>
                <tr className="border-t border-ragga-blue/10 text-foreground/70">
                  <td className="py-1.5 pr-3 font-medium">{ROTULO_AJUSTE_SEM_SAIDA}</td>
                  <td className="px-2">{moeda.format(loja.ajustesSemSaida)}</td>
                  <td className="px-2">{temComp ? moeda.format(compLoja?.ajustesSemSaida ?? 0) : "Sem dados"}</td>
                  <td className="px-2">{temComp ? <TextoVariacao atual={loja.ajustesSemSaida} anterior={compLoja?.ajustesSemSaida ?? 0} /> : "—"}</td>
                  <td className="px-2 text-xs text-foreground/45">Variação factual</td>
                  <td />
                </tr>
                <tr className="border-t border-ragga-blue/10 font-semibold text-ragga-blue-dark">
                  <td className="py-1.5 pr-3">Total lançado em Compra Direta</td>
                  <td className="px-2">{moeda.format(Math.round((totalAtual + loja.ajustesSemSaida) * 100) / 100)}</td>
                  <td className="px-2">{temComp ? moeda.format(Math.round((totalComp + (compLoja?.ajustesSemSaida ?? 0)) * 100) / 100) : "Sem dados"}</td>
                  <td colSpan={3} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Evolução diária — {loja.unidade}</p>
          <ToggleModo modo={modo} aoAlterar={setModo} />
        </div>
        <GraficoDiario dias={loja.diario} modo={modo} altura={190} />
      </div>
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
