"use client";

import { Fragment, useState } from "react";
import { Secao, moeda, pct } from "@/components/ui/PainelAnalitico";
import type { LojaNaModalidade, MotivoComparado } from "@/lib/services/brindesAnalise";

/**
 * Seções gerenciais da aba Brindes: "O que gerou os brindes?" (modalidades → submotivos) e "Investigar por modalidade"
 * (lojas dentro da modalidade). Só apresentação: os números vêm de `lib/services/brindesAnalise.ts`.
 */

const sinal = (v: number) => (v > 0 ? "+" : v < 0 ? "-" : "");

/** Variação R$ + %: `interpretar` (modalidade controlável) pinta redução de verde e aumento de vermelho; demais, cinza (factual). */
export function Var({ reais, percentual, interpretar }: { reais: number | null; percentual: number | null; interpretar: boolean }) {
  if (reais === null) return <span className="text-foreground/40">—</span>;
  const cor = !interpretar || Math.abs(reais) < 0.005 ? "text-foreground/70" : reais < 0 ? "text-semaforo-verde" : "text-semaforo-vermelho";
  const seta = reais > 0 ? "↑" : reais < 0 ? "↓" : "=";
  return (
    <span className={`whitespace-nowrap font-semibold tabular-nums ${cor}`}>
      {seta} {moeda.format(Math.abs(reais))}
      {percentual !== null && <span className="ml-1 font-normal">({sinal(percentual)}{pct.format(Math.abs(percentual))}%)</span>}
    </span>
  );
}

export function Barra({ valor }: { valor: number }) {
  return (
    <div className="mt-1 h-1.5 w-full max-w-[140px] overflow-hidden rounded-full bg-ragga-blue/10" aria-hidden>
      <div className="h-full rounded-full bg-ragga-blue" style={{ width: `${Math.min(100, Math.max(0, valor))}%` }} />
    </div>
  );
}

function TagNaoControlavel() {
  return <span className="ml-1.5 inline-block whitespace-nowrap rounded bg-ragga-blue/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ragga-blue">não controlável</span>;
}

export function SecaoMotivos({
  linhas,
  totalAtual,
  totalComparado,
  comparavel,
  motivoSemComparacao,
  periodoAtualTxt,
  periodoCompTxt,
  escopoTxt,
  motivoSelecionado,
  aoInvestigar,
}: {
  linhas: MotivoComparado[];
  totalAtual: number;
  totalComparado: number | null;
  comparavel: boolean;
  motivoSemComparacao: string | null;
  /** Datas de OCORRÊNCIA do período atual / comparado (já com a regra D-1 aplicada). */
  periodoAtualTxt: string;
  periodoCompTxt: string;
  escopoTxt: string;
  motivoSelecionado: string | null;
  aoInvestigar: (motivo: string) => void;
}) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const alternar = (m: string) =>
    setAbertas((a) => {
      const n = new Set(a);
      if (n.has(m)) n.delete(m);
      else n.add(m);
      return n;
    });

  return (
    <Secao titulo="O que gerou os brindes?">
      <p className="mb-3 text-xs text-foreground/55">
        Modalidades que compõem o total de brindes ({escopoTxt}), do maior para o menor valor. Clique na linha para ver os submotivos.
      </p>
      <p className="mb-3 text-xs text-foreground/70">
        <span className="font-semibold text-ragga-blue-dark">Período atual:</span> {periodoAtualTxt} · <span className="font-semibold text-ragga-blue-dark">Comparado:</span> {periodoCompTxt}
        <span className="text-foreground/45"> (datas de ocorrência)</span>
      </p>
      {!comparavel && (
        <p className="mb-3 rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-3 py-2 text-xs text-ragga-blue-dark">
          ⚠ Sem base de comparação válida. {motivoSemComparacao ?? ""} As variações não são exibidas.
        </p>
      )}
      {linhas.length === 0 ? (
        <p className="text-sm text-foreground/45">Sem brindes no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                <th className="py-2 pr-4">Modalidade / submotivo</th>
                <th className="px-3 py-2">Valor (R$)</th>
                <th className="px-3 py-2">Participação no total</th>
                <th className="px-3 py-2">Período comparado</th>
                <th className="px-3 py-2">Variação vs. comparado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {linhas.map((m) => {
                const aberta = abertas.has(m.motivo);
                return (
                  <Fragment key={m.motivo}>
                    <tr onClick={() => alternar(m.motivo)} className="cursor-pointer border-b border-ragga-blue/5 hover:bg-ragga-blue/[0.04]">
                      <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">
                        <span className="mr-1.5 inline-block w-3 text-ragga-blue/45">{aberta ? "▾" : "▸"}</span>
                        {m.motivo}
                        {!m.controlavel && <TagNaoControlavel />}
                      </td>
                      <td className="px-3 font-semibold">{moeda.format(m.atual)}</td>
                      <td className="px-3">
                        {pct.format(m.percentualDoTotal)}%
                        <Barra valor={m.percentualDoTotal} />
                      </td>
                      <td className="px-3 text-foreground/70">{m.comparado === null ? "Sem base" : moeda.format(m.comparado)}</td>
                      <td className="px-3">
                        <Var reais={m.variacaoReais} percentual={m.variacaoPercentual} interpretar={m.controlavel} />
                      </td>
                      <td className="px-3 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            aoInvestigar(m.motivo);
                          }}
                          className={`whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ${motivoSelecionado === m.motivo ? "bg-ragga-blue text-white" : "text-ragga-blue hover:bg-ragga-blue/10"}`}
                        >
                          Ver lojas
                        </button>
                      </td>
                    </tr>
                    {aberta &&
                      m.submotivos.map((s) => (
                        <tr key={`${m.motivo}|${s.submotivo}`} className="border-b border-ragga-blue/5 bg-ragga-bg/60 text-[13px]">
                          <td className="py-2 pl-9 pr-4 text-foreground/80">{s.submotivo}</td>
                          <td className="px-3">{moeda.format(s.atual)}</td>
                          <td className="px-3 text-foreground/60">{pct.format(s.percentualDoMotivo)}% da modalidade</td>
                          <td className="px-3 text-foreground/60">{s.comparado === null ? "Sem base" : moeda.format(s.comparado)}</td>
                          <td className="px-3">
                            <Var reais={s.variacaoReais} percentual={s.variacaoPercentual} interpretar={m.controlavel} />
                          </td>
                          <td />
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
              <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
                <td className="py-2.5 pr-4">TOTAL DE BRINDES</td>
                <td className="px-3">{moeda.format(totalAtual)}</td>
                <td className="px-3">{pct.format(100)}%</td>
                <td className="px-3">{totalComparado === null ? "Sem base" : moeda.format(totalComparado)}</td>
                <td className="px-3">
                  {totalComparado === null ? (
                    <span className="font-normal text-foreground/40">—</span>
                  ) : (
                    <Var reais={Math.round((totalAtual - totalComparado) * 100) / 100} percentual={totalComparado !== 0 ? ((totalAtual - totalComparado) / totalComparado) * 100 : null} interpretar={false} />
                  )}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-foreground/40">
        Variação % sobre o valor do período comparado; verde/vermelho só nas modalidades controláveis (menor = melhor), nas demais é variação factual.
        A quantidade de ocorrências não está disponível: a base registra apenas o valor por loja, dia, motivo e submotivo.
      </p>
    </Secao>
  );
}

export function SecaoModalidade({
  modalidades,
  selecionada,
  aoSelecionar,
  lojas,
  controlavel,
  periodoAtualTxt,
  periodoCompTxt,
  comparavel,
}: {
  modalidades: string[];
  selecionada: string | null;
  aoSelecionar: (m: string) => void;
  lojas: LojaNaModalidade[];
  controlavel: boolean;
  periodoAtualTxt: string;
  periodoCompTxt: string;
  comparavel: boolean;
}) {
  const [ordem, setOrdem] = useState<"valor" | "percentual">("valor");
  const lista = [...lojas].sort((a, b) =>
    ordem === "valor"
      ? b.valor - a.valor || a.unidade.localeCompare(b.unidade)
      : (b.percentualFaturamento ?? Number.NEGATIVE_INFINITY) - (a.percentualFaturamento ?? Number.NEGATIVE_INFINITY) || a.unidade.localeCompare(b.unidade)
  );
  const total = lojas.reduce((s, l) => s + l.valor, 0);

  return (
    <Secao
      titulo="Investigar por modalidade"
      acao={
        <label className="flex items-center gap-2 text-xs font-medium text-ragga-blue-dark">
          Ordenar por
          <select value={ordem} onChange={(e) => setOrdem(e.target.value as "valor" | "percentual")} className="rounded-md border border-ragga-blue/15 bg-white px-2 py-1.5 text-xs">
            <option value="valor">Valor na modalidade</option>
            <option value="percentual">% sobre o faturamento</option>
          </select>
        </label>
      }
    >
      {modalidades.length === 0 ? (
        <p className="text-sm text-foreground/45">Sem brindes no período.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-foreground/70">
            <span className="font-semibold text-ragga-blue-dark">Período atual:</span> {periodoAtualTxt} · <span className="font-semibold text-ragga-blue-dark">Comparado:</span> {periodoCompTxt}
            <span className="text-foreground/45"> (datas de ocorrência)</span>
          </p>
          <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Modalidade">
            {modalidades.map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={selecionada === m}
                onClick={() => aoSelecionar(m)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${selecionada === m ? "border-ragga-blue bg-ragga-blue text-white" : "border-ragga-blue/20 bg-white text-ragga-blue-dark hover:bg-ragga-blue/5"}`}
              >
                {m}
              </button>
            ))}
          </div>
          {lista.length === 0 ? (
            <p className="text-sm text-foreground/45">Nenhuma loja usou esta modalidade no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                    <th className="py-2 pr-4">Loja</th>
                    <th className="px-3 py-2">Valor na modalidade</th>
                    <th className="px-3 py-2">Participação na modalidade</th>
                    <th className="px-3 py-2">Faturamento da loja</th>
                    <th className="px-3 py-2">% s/ faturamento</th>
                    <th className="px-3 py-2">Período comparado</th>
                    <th className="px-3 py-2">Variação</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {lista.map((l) => (
                    <tr key={l.unidade} className="border-b border-ragga-blue/5">
                      <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">{l.unidade}</td>
                      <td className="px-3 font-semibold">{moeda.format(l.valor)}</td>
                      <td className="px-3">
                        {pct.format(l.percentualDaModalidade)}%
                        <Barra valor={l.percentualDaModalidade} />
                      </td>
                      <td className="px-3">{l.faturamento === null ? <span className="text-foreground/40">—</span> : moeda.format(l.faturamento)}</td>
                      <td className="px-3">
                        {l.percentualFaturamento === null ? (
                          <span className="text-xs font-semibold text-semaforo-amarelo">{l.coberturaParcial ? "⚠ faturamento parcial" : "—"}</span>
                        ) : (
                          `${pct.format(l.percentualFaturamento)}%`
                        )}
                      </td>
                      <td className="px-3 text-foreground/70">{l.comparado === null ? "Sem base" : moeda.format(l.comparado)}</td>
                      <td className="px-3">
                        <Var reais={l.variacaoReais} percentual={l.variacaoPercentual} interpretar={controlavel} />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
                    <td className="py-2.5 pr-4">TOTAL DA MODALIDADE</td>
                    <td className="px-3">{moeda.format(total)}</td>
                    <td className="px-3">{pct.format(100)}%</td>
                    <td colSpan={4} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-foreground/40">
            {controlavel
              ? "Modalidade controlável: o valor desta modalidade compõe o % de brindes controláveis sobre o faturamento da loja (a soma de todas as modalidades controláveis = o % do semáforo)."
              : "Modalidade não controlável: o % sobre o faturamento é informativo e não define o semáforo."}{" "}
            {comparavel ? "" : "Sem base de comparação válida. "}Loja com faturamento em menos dias que o período fica sem % e sem comparação.
          </p>
        </>
      )}
    </Secao>
  );
}
