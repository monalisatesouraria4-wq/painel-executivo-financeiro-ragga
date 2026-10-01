"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SemaforoBadge } from "@/components/ui/SemaforoBadge";
import type { CorSemaforo } from "@/lib/rules/semaforos";
import type { DesempenhoCaixaData, IndicadorDesempenho, IndicadorDesempenhoId } from "@/lib/services/desempenhoCaixa";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dataCurta = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

const TEXTO_SEMAFORO: Record<CorSemaforo, string> = { azul: "Excelente", verde: "Bom", amarelo: "Atenção", vermelho: "Crítico" };
const BARRA: Record<CorSemaforo, string> = {
  azul: "bg-semaforo-azul",
  verde: "bg-semaforo-verde",
  amarelo: "bg-semaforo-amarelo",
  vermelho: "bg-semaforo-vermelho",
};

function sinal(n: number): string {
  return n > 0 ? "+" : n < 0 ? "−" : "";
}
function reaisComSinal(n: number): string {
  return `${sinal(n)}${moeda.format(Math.abs(n))}`;
}
function pctComSinal(n: number): string {
  return `${sinal(n)}${pct1.format(Math.abs(n))}%`;
}

/** Valores exibidos de um indicador — rede inteira ou uma única loja (filtro de loja da Visão Geral). */
interface VisaoIndicador {
  disponivel: boolean;
  semBase: boolean;
  semLancamento: boolean;
  valor: number;
  percentual: number | null;
  metaValor: number | null;
  desvioReais: number | null;
  desvioPercentual: number | null;
  semaforo: CorSemaforo | null;
  anterior: number | null;
  variacaoReais: number | null;
  variacaoPercentual: number | null;
}

function visaoDoIndicador(ind: IndicadorDesempenho, loja: string): VisaoIndicador {
  if (loja === "TODAS" || ind.id === "consumoFuncionarios") {
    // Consumo de funcionários não tem limite por loja (quadro não informado): mantém a rede.
    return {
      disponivel: ind.disponivel,
      semBase: ind.semBaseAvaliacao,
      semLancamento: false,
      valor: ind.valor,
      percentual: ind.percentual,
      metaValor: ind.metaValor,
      desvioReais: ind.desvioReais,
      desvioPercentual: ind.desvioPercentual,
      semaforo: ind.semaforo,
      anterior: ind.anterior.valor,
      variacaoReais: ind.variacaoReais,
      variacaoPercentual: ind.variacaoPercentual,
    };
  }
  const l = ind.porLoja.find((x) => x.unidade === loja);
  if (!l) {
    return { disponivel: false, semBase: false, semLancamento: false, valor: 0, percentual: null, metaValor: null, desvioReais: null, desvioPercentual: null, semaforo: null, anterior: null, variacaoReais: null, variacaoPercentual: null };
  }
  const anterior = l.valorAnterior;
  return {
    disponivel: ind.disponivel,
    semBase: l.faturamento === null,
    semLancamento: l.semLancamento,
    valor: l.valor,
    percentual: l.percentual,
    metaValor: l.desvioReais === null ? null : l.valor - l.desvioReais,
    desvioReais: l.desvioReais,
    desvioPercentual: l.desvioPercentual,
    semaforo: l.semaforo,
    anterior,
    variacaoReais: anterior === null ? null : l.valor - anterior,
    variacaoPercentual: anterior && anterior > 0 ? ((l.valor - anterior) / anterior) * 100 : null,
  };
}

function Status({ v }: { v: VisaoIndicador }) {
  if (!v.disponivel) return <span className="text-xs text-foreground/40">Sem dados</span>;
  if (v.semBase) return <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-foreground/60">Sem base para avaliação</span>;
  if (v.semaforo) return <SemaforoBadge cor={v.semaforo} texto={TEXTO_SEMAFORO[v.semaforo]} />;
  return null;
}

interface CardDesempenhoProps {
  titulo: string;
  v: VisaoIndicador;
  textoMeta: string;
  onAbrir?: () => void;
  href?: string;
  extra?: string;
}

function CardDesempenho({ titulo, v, textoMeta, onAbrir, href, extra }: CardDesempenhoProps) {
  const classes =
    "group relative block w-full overflow-hidden rounded-xl border border-ragga-blue/10 bg-white p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ragga-blue";
  const corpo = (
    <>
      <span className={`absolute inset-y-0 left-0 w-1.5 ${v.disponivel && !v.semBase && v.semaforo ? BARRA[v.semaforo] : "bg-ragga-blue/20"}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2 pl-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground/50">{titulo}</p>
        <Status v={v} />
      </div>
      <p className={`mt-2 pl-1 text-[clamp(1.5rem,2.4vw,2.25rem)] font-extrabold leading-none tracking-tight ${v.disponivel ? "text-ragga-blue-dark" : "text-foreground/20"}`}>
        {v.disponivel ? moeda.format(v.valor) : "—"}
      </p>
      {v.disponivel && (
        <p className="mt-1 pl-1 text-xs text-foreground/50">
          {v.semLancamento ? "Sem lançamento no período" : v.percentual !== null ? `${pct.format(v.percentual)}% do faturamento` : "Sem faturamento no período"}
        </p>
      )}
      <dl className="mt-3 space-y-1 pl-1 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-foreground/50">Meta</dt>
          <dd className="text-right font-medium text-ragga-blue-dark">{v.metaValor !== null ? `${moeda.format(v.metaValor)} · ${textoMeta}` : "Meta não definida"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-foreground/50">Desvio</dt>
          <dd className={`text-right font-medium ${v.desvioReais !== null && v.desvioReais > 0 ? "text-semaforo-vermelho" : "text-semaforo-verde"}`}>
            {v.desvioReais !== null && v.desvioPercentual !== null ? `${reaisComSinal(v.desvioReais)} (${pctComSinal(v.desvioPercentual)})` : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-foreground/50">Mês anterior</dt>
          <dd className="text-right font-medium text-ragga-blue-dark">
            {v.anterior === null
              ? "Sem comparação"
              : `${moeda.format(v.anterior)}${v.variacaoPercentual !== null ? ` (${pctComSinal(v.variacaoPercentual)})` : ""}`}
          </dd>
        </div>
      </dl>
      {extra && <p className="mt-2 pl-1 text-xs text-foreground/50">{extra}</p>}
      <p className="mt-3 pl-1 text-xs font-medium text-ragga-blue opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Ver ranking e detalhe →</p>
    </>
  );
  if (href) return <Link href={href} className={classes}>{corpo}</Link>;
  return (
    <button type="button" onClick={onAbrir} className={classes}>
      {corpo}
    </button>
  );
}

interface ConferenciaResumo {
  disponivel: boolean;
  percentualConferido?: number;
  emAtraso?: number;
}

interface PrioridadeItem {
  indicador: IndicadorDesempenhoId;
  tituloIndicador: string;
  unidade: string;
  semaforo: CorSemaforo;
  valor: number;
  desvioReais: number;
  desvioPercentual: number | null;
}

export function DesempenhoCaixa({
  dados,
  carregando,
  loja,
  conferencia,
  hrefIndicador,
  hrefConferencia,
}: {
  dados: DesempenhoCaixaData | null;
  carregando: boolean;
  loja: string;
  conferencia: ConferenciaResumo;
  /** Link para o plano de ação do indicador (Indicadores/Retiradas). */
  hrefIndicador: (id: IndicadorDesempenhoId, loja?: string) => string | null;
  hrefConferencia: string;
}) {
  const [aberto, setAberto] = useState<IndicadorDesempenhoId | null>(null);

  const prioridades = useMemo<PrioridadeItem[]>(() => {
    if (!dados) return [];
    const itens: PrioridadeItem[] = [];
    for (const ind of dados.indicadores) {
      if (ind.id === "consumoFuncionarios") {
        if (ind.disponivel && ind.semaforo === "vermelho" && ind.desvioReais !== null && ind.desvioReais > 0) {
          itens.push({ indicador: ind.id, tituloIndicador: ind.titulo, unidade: "Rede", semaforo: "vermelho", valor: ind.valor, desvioReais: ind.desvioReais, desvioPercentual: ind.desvioPercentual });
        }
        continue;
      }
      for (const l of ind.porLoja) {
        if (l.semLancamento || !l.semaforo || l.desvioReais === null || l.desvioReais <= 0) continue;
        if (l.semaforo !== "vermelho" && l.semaforo !== "amarelo") continue;
        if (loja !== "TODAS" && l.unidade !== loja) continue;
        itens.push({ indicador: ind.id, tituloIndicador: ind.titulo, unidade: l.unidade, semaforo: l.semaforo, valor: l.valor, desvioReais: l.desvioReais, desvioPercentual: l.desvioPercentual });
      }
    }
    return itens.sort((a, b) => (a.semaforo === b.semaforo ? b.desvioReais - a.desvioReais : a.semaforo === "vermelho" ? -1 : 1)).slice(0, 8);
  }, [dados, loja]);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: KeyboardEvent) => e.key === "Escape" && setAberto(null);
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [aberto]);

  if (!dados || !dados.conectado || dados.indicadores.length === 0) {
    return (
      <section className="rounded-2xl border border-ragga-blue/10 bg-white p-6 text-sm text-foreground/50">
        {carregando ? "Carregando performance de caixa..." : "Performance de caixa indisponível: sem dados para esta referência."}
      </section>
    );
  }

  const indicadorAberto = dados.indicadores.find((i) => i.id === aberto) ?? null;
  const textoMetaDe = (ind: IndicadorDesempenho) => (ind.metaPercentual !== null ? `${pct.format(ind.metaPercentual)}%` : "limite");

  return (
    <>
      <section className="rounded-2xl border border-semaforo-vermelho/20 bg-white p-5 sm:p-6">
        <h2 className="mb-3 flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-ragga-blue-dark">
          <span className="h-3.5 w-1 rounded-full bg-semaforo-vermelho" />
          Prioridades de ação
        </h2>
        {prioridades.length === 0 ? (
          <p className="text-sm text-foreground/55">Nenhuma loja fora da meta no período selecionado.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {prioridades.map((p) => (
              <li key={`${p.indicador}-${p.unidade}`}>
                <button
                  type="button"
                  onClick={() => setAberto(p.indicador)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-ragga-blue/10 px-3 py-2 text-left text-sm transition-colors hover:bg-ragga-bg"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ragga-blue-dark">{p.unidade} · {p.tituloIndicador}</span>
                    <span className="block text-xs text-foreground/55">
                      {moeda.format(p.valor)} · {reaisComSinal(p.desvioReais)}{p.desvioPercentual !== null ? ` (${pctComSinal(p.desvioPercentual)})` : ""} sobre a meta
                    </span>
                  </span>
                  <SemaforoBadge cor={p.semaforo} texto={TEXTO_SEMAFORO[p.semaforo]} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-ragga-blue/10 bg-white p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-ragga-blue-dark">
            <span className="h-3.5 w-1 rounded-full bg-ragga-blue" />
            Performance de caixa
          </h2>
          <span className="text-xs text-foreground/50">
            Mês anterior: {dataCurta.format(dados.anteriorInicio)} a {dataCurta.format(dados.anteriorFim)} (mesmos dias)
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {dados.indicadores.map((ind) => {
            const v = visaoDoIndicador(ind, loja);
            const consumoRede = ind.id === "consumoFuncionarios" && loja !== "TODAS";
            return (
              <CardDesempenho
                key={ind.id}
                titulo={ind.titulo}
                v={v}
                textoMeta={textoMetaDe(ind)}
                onAbrir={() => setAberto(ind.id)}
                extra={
                  ind.consumo && ind.disponivel
                    ? `${pct1.format(ind.consumo.percentualUtilizado)}% do limite · ${moeda.format(ind.consumo.mediaPorFuncionarioDia)} por funcionário/dia${consumoRede ? " (dado da rede)" : ""}`
                    : undefined
                }
              />
            );
          })}
          <CardDesempenho
            titulo="Conferência de caixa"
            v={{
              disponivel: conferencia.disponivel,
              semBase: false,
              semLancamento: false,
              valor: 0,
              percentual: null,
              metaValor: null,
              desvioReais: null,
              desvioPercentual: null,
              semaforo: null,
              anterior: null,
              variacaoReais: null,
              variacaoPercentual: null,
            }}
            textoMeta=""
            href={hrefConferencia}
            extra={
              conferencia.disponivel
                ? `${pct1.format(conferencia.percentualConferido ?? 0)}% conferido · ${conferencia.emAtraso ?? 0} em atraso`
                : "Sem dados de conferência"
            }
          />
        </div>
      </section>

      {indicadorAberto && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={(e) => e.target === e.currentTarget && setAberto(null)}>
          <aside className="h-full w-full max-w-xl overflow-y-auto bg-ragga-surface p-6 shadow-xl" role="dialog" aria-label={indicadorAberto.titulo}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-ragga-blue-dark">{indicadorAberto.titulo}</h3>
                <p className="mt-0.5 text-xs text-foreground/55">{indicadorAberto.criterio}</p>
              </div>
              <button type="button" onClick={() => setAberto(null)} className="text-foreground/40 hover:text-foreground" aria-label="Fechar">✕</button>
            </div>

            <p className="mt-4 text-[2rem] font-extrabold leading-none text-ragga-blue-dark">{indicadorAberto.disponivel ? moeda.format(indicadorAberto.valor) : "—"}</p>
            {indicadorAberto.consumo && (
              <div className="mt-3 space-y-1 rounded-lg bg-ragga-bg p-3 text-xs text-foreground/70">
                <p>Limite do período ({indicadorAberto.consumo.dias} {indicadorAberto.consumo.dias === 1 ? "dia" : "dias"}): <b>{moeda.format(indicadorAberto.consumo.limitePeriodo)}</b></p>
                <p>Utilizado: <b>{pct1.format(indicadorAberto.consumo.percentualUtilizado)}%</b> · Média: <b>{moeda.format(indicadorAberto.consumo.mediaPorFuncionarioDia)}</b> por funcionário/dia (referência de {indicadorAberto.consumo.funcionariosReferencia} funcionários)</p>
                {indicadorAberto.consumo.projecaoFechamento !== null && indicadorAberto.consumo.limiteMes !== null && (
                  <p>Projeção de fechamento: <b>{moeda.format(indicadorAberto.consumo.projecaoFechamento)}</b> para um limite de {moeda.format(indicadorAberto.consumo.limiteMes)}</p>
                )}
              </div>
            )}
            {indicadorAberto.nota && <p className="mt-3 text-xs text-foreground/55">{indicadorAberto.nota}</p>}

            {indicadorAberto.porLoja.length > 0 && (
              <>
                <h4 className="mb-2 mt-5 text-sm font-semibold text-ragga-blue-dark">Ranking por loja (maior desvio primeiro)</h4>
                <div className="overflow-x-auto rounded-lg border border-ragga-blue/10">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-ragga-blue/10 text-left uppercase tracking-wide text-foreground/50">
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Loja</th>
                        <th className="px-3 py-2">Valor</th>
                        <th className="px-3 py-2">% fat.</th>
                        <th className="px-3 py-2">Desvio</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...indicadorAberto.porLoja]
                        .sort((a, b) => (b.desvioReais ?? -Infinity) - (a.desvioReais ?? -Infinity))
                        .map((l, i) => (
                          <tr key={l.unidade} className="border-b border-ragga-blue/5 last:border-0">
                            <td className="px-3 py-2 font-bold text-foreground/40">{i + 1}</td>
                            <td className="px-3 py-2 font-medium text-ragga-blue-dark">{l.unidade}</td>
                            <td className="px-3 py-2">{l.semLancamento ? <span className="text-foreground/40">sem lançamento</span> : moeda.format(l.valor)}</td>
                            <td className="px-3 py-2">{l.percentual !== null ? `${pct.format(l.percentual)}%` : "—"}</td>
                            <td className="px-3 py-2">{l.desvioReais !== null ? reaisComSinal(l.desvioReais) : "—"}</td>
                            <td className="px-3 py-2">
                              {l.semaforo ? <SemaforoBadge cor={l.semaforo} texto={TEXTO_SEMAFORO[l.semaforo]} /> : <span className="text-foreground/40">Sem base para avaliação</span>}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <h4 className="mb-2 mt-5 text-sm font-semibold text-ragga-blue-dark">Por motivo</h4>
            {indicadorAberto.porMotivo.length === 0 ? (
              <p className="text-xs text-foreground/50">Sem lançamentos no período.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {indicadorAberto.porMotivo.map((m) => (
                  <li key={m.motivo} className="flex justify-between gap-3 rounded-md px-2 py-1.5 odd:bg-ragga-bg/60">
                    <span className="min-w-0 truncate font-medium text-ragga-blue-dark">{m.motivo}</span>
                    <span className="shrink-0 text-foreground/70">{moeda.format(m.valor)} · {pct1.format(m.participacao)}%</span>
                  </li>
                ))}
              </ul>
            )}

            {hrefIndicador(indicadorAberto.id, loja !== "TODAS" ? loja : undefined) && (
              <Link
                href={hrefIndicador(indicadorAberto.id, loja !== "TODAS" ? loja : undefined)!}
                className="mt-6 inline-block rounded bg-ragga-blue px-4 py-2 text-sm font-medium text-white hover:bg-ragga-blue-dark"
              >
                Abrir plano de ação →
              </Link>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
