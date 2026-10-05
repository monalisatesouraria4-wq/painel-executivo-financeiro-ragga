"use client";

import type { ReactNode } from "react";
import { variacaoCompraDireta } from "@/lib/services/compraDiretaPainel";

/**
 * Primitivos visuais compartilhados pelos painéis analíticos (mesma linguagem de Compra Direta e Brindes):
 * seção, cards, card com hover (tooltip em CSS puro — sem clique, sem modal, sem bloquear o mouse, sem tooltip
 * nativo), linhas de tooltip e formatações de variação. Só apresentação: nenhum cálculo de negócio aqui.
 */

export const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const pct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const sinalMoeda = (delta: number) => `${delta >= 0 ? "+" : "-"}${moeda.format(Math.abs(delta))}`;
export const sinalPct = (atual: number, comparado: number) =>
  comparado !== 0 ? `${atual - comparado >= 0 ? "+" : "-"}${pct.format(Math.abs(((atual - comparado) / comparado) * 100))}%` : "—";
export const sinalPp = (atual: number, comparado: number) => `${atual - comparado >= 0 ? "+" : "-"}${pct.format(Math.abs(atual - comparado))} p.p.`;

export function Secao({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
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

export function ToggleModo({ modo, aoAlterar }: { modo: "valor" | "percentual"; aoAlterar: (m: "valor" | "percentual") => void }) {
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

export function CardGrande({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-ragga-blue/10 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground/45">{titulo}</p>
      {children}
    </div>
  );
}

export function Item({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-foreground/45">{rotulo}</p>
      <p className="mt-0.5 font-semibold tabular-nums text-ragga-blue-dark">{valor}</p>
    </div>
  );
}

/** Card com hover: o tooltip aparece ao passar o mouse (CSS puro). */
export function CardHover({ tooltip, direita = false, children }: { tooltip: ReactNode; direita?: boolean; children: ReactNode }) {
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

export function TooltipComparativo({ periodo, temBase, children }: { periodo: string; temBase: boolean; children: ReactNode }) {
  return (
    <>
      <p className="text-[11px] font-bold uppercase tracking-wide text-ragga-blue">Comparativo com o período comparado</p>
      <p className="mb-1.5 text-foreground/50">Período comparado: {periodo}</p>
      {temBase ? <div className="space-y-0.5">{children}</div> : <p className="text-foreground/60">⚪ Sem base de comparação (sem dados no período comparado).</p>}
    </>
  );
}

export function TipLinha({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-foreground/60">{rotulo}</span>
      <span className="text-right font-semibold tabular-nums text-ragga-blue-dark">{valor}</span>
    </div>
  );
}

/** Variação em duas colunas (R$ e %). Em indicadores "menor é melhor": redução verde, aumento vermelho. */
export function VarCelulas({ atual, anterior, interpretar }: { atual: number; anterior: number; interpretar: boolean }) {
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

/** Variação em p.p. com seta; `interpretar` aplica verde (redução) / vermelho (aumento). */
export function VariacaoPp({ atual, anterior, interpretar = false }: { atual: number; anterior: number; interpretar?: boolean }) {
  const delta = atual - anterior;
  const seta = delta > 0 ? "↑" : delta < 0 ? "↓" : "=";
  const cor = !interpretar || Math.abs(delta) < 0.005 ? "text-foreground/70" : delta < 0 ? "text-semaforo-verde" : "text-semaforo-vermelho";
  return (
    <span className={`font-semibold tabular-nums ${cor}`}>
      {seta} {pct.format(Math.abs(delta))} p.p.
    </span>
  );
}

/** 🟢 Melhorou / 🔴 Piorou / ⚪ Sem alteração / ⚪ Sem base de comparação — menor = melhor (cancelamentos). */
export function Situacao({ atual, anterior, temBase = true }: { atual: number; anterior: number; temBase?: boolean }) {
  if (!temBase) return <span className="whitespace-nowrap text-xs font-semibold text-foreground/45">⚪ Sem base de comparação</span>;
  const { situacao } = variacaoCompraDireta(atual, anterior);
  if (situacao === "sem-alteracao") return <span className="whitespace-nowrap text-xs font-semibold text-foreground/50">⚪ Sem alteração</span>;
  return situacao === "melhorou" ? (
    <span className="whitespace-nowrap text-xs font-semibold text-semaforo-verde">🟢 Melhorou</span>
  ) : (
    <span className="whitespace-nowrap text-xs font-semibold text-semaforo-vermelho">🔴 Piorou</span>
  );
}
