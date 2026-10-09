"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { moeda, pct } from "@/components/ui/PainelAnalitico";
import type { BarraMotivoQuebra, FatiaLojaQuebra } from "@/lib/services/quebraPainel";

/**
 * Análises visuais da Quebra de Caixa (A: rosca por loja · B: barras horizontais por motivo). Só APRESENTA dados já
 * agregados por `quebraPainel` (mesmo recorte de período/loja da tabela e dos cards) — nenhuma consulta nem regra nova.
 * SVG/CSS puros (o projeto não usa biblioteca de gráficos).
 */

const corDaFatia = (i: number) => `hsl(${Math.round((i * 137.5) % 360)} 55% 48%)`;

const TAMANHO = 180;
const RAIO = 70;
const LARGURA = 28;
const CIRCUNFERENCIA = 2 * Math.PI * RAIO;

function PainelRosca({ fatias, total }: { fatias: FatiaLojaQuebra[]; total: number }) {
  const [ativa, setAtiva] = useState<number | null>(null);
  const fatiaAtiva = ativa !== null ? fatias[ativa] : null;
  const trechos = fatias.map((f, i) => ({
    comprimento: (f.participacao / 100) * CIRCUNFERENCIA,
    inicio: fatias.slice(0, i).reduce((s, x) => s + (x.participacao / 100) * CIRCUNFERENCIA, 0),
  }));

  return (
    <div className="flex flex-col items-center gap-4 @md:flex-row @md:items-start">
      <div className="relative shrink-0" style={{ width: TAMANHO, height: TAMANHO }}>
        <svg viewBox={`0 0 ${TAMANHO} ${TAMANHO}`} width={TAMANHO} height={TAMANHO} role="img" aria-label="Quebra por loja">
          <g transform={`rotate(-90 ${TAMANHO / 2} ${TAMANHO / 2})`}>
            {fatias.map((f, i) => {
              const { comprimento, inicio } = trechos[i];
              return (
                <circle
                  key={f.unidade}
                  cx={TAMANHO / 2}
                  cy={TAMANHO / 2}
                  r={RAIO}
                  fill="none"
                  stroke={corDaFatia(i)}
                  strokeWidth={ativa === i ? LARGURA + 6 : LARGURA}
                  strokeDasharray={`${comprimento} ${CIRCUNFERENCIA - comprimento}`}
                  strokeDashoffset={-inicio}
                  opacity={ativa === null || ativa === i ? 1 : 0.45}
                  onMouseEnter={() => setAtiva(i)}
                  onMouseLeave={() => setAtiva(null)}
                >
                  <title>{`${f.unidade}: ${moeda.format(f.valor)} (${pct.format(f.participacao)}% do total)`}</title>
                </circle>
              );
            })}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          {fatiaAtiva ? (
            <>
              <span className="text-xs font-semibold text-ragga-blue-dark">{fatiaAtiva.unidade}</span>
              <span className="text-sm font-bold tabular-nums text-ragga-blue-dark">{moeda.format(fatiaAtiva.valor)}</span>
              <span className="text-[11px] tabular-nums text-foreground/55">{pct.format(fatiaAtiva.participacao)}%</span>
            </>
          ) : (
            <>
              <span className="text-[11px] uppercase tracking-wide text-foreground/45">Total</span>
              <span className="text-sm font-bold tabular-nums text-ragga-blue-dark">{moeda.format(total)}</span>
            </>
          )}
        </div>
      </div>

      <ul className="w-full min-w-0 flex-1 text-sm tabular-nums">
        {fatias.map((f, i) => (
          <li
            key={f.unidade}
            onMouseEnter={() => setAtiva(i)}
            onMouseLeave={() => setAtiva(null)}
            className={`flex items-center gap-2 border-b border-ragga-blue/5 py-1 last:border-0 ${ativa === i ? "bg-ragga-blue/[0.04]" : ""}`}
          >
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: corDaFatia(i) }} />
            <span className="min-w-0 flex-1 truncate font-medium text-ragga-blue-dark" title={f.unidade}>{f.unidade}</span>
            <span className="shrink-0 whitespace-nowrap text-foreground/80">{moeda.format(f.valor)}</span>
            <span className="w-14 shrink-0 whitespace-nowrap text-right text-foreground/55">{pct.format(f.participacao)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function textoVariacao(b: BarraMotivoQuebra): string {
  if (b.variacaoValor === null) return "—";
  const sinal = b.variacaoValor >= 0 ? "+" : "-";
  const rs = `${sinal}${moeda.format(Math.abs(b.variacaoValor))}`;
  return b.variacaoPercentual === null ? rs : `${rs} (${b.variacaoPercentual >= 0 ? "+" : "-"}${pct.format(Math.abs(b.variacaoPercentual))}%)`;
}

function PainelBarras({ barras, temComparacao }: { barras: BarraMotivoQuebra[]; temComparacao: boolean }) {
  const maximo = Math.max(...barras.map((b) => b.valor), 0);
  return (
    <ul className="min-w-0 space-y-2.5 text-sm">
      {barras.map((b) => (
        <li key={b.motivo} title={`${b.motivo === "" ? "(motivo em branco)" : b.motivo}: ${moeda.format(b.valor)} (${pct.format(b.percentual)}% do total)`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="min-w-0 basis-40 flex-1 break-words text-[13px] font-medium leading-snug text-ragga-blue-dark">
              {b.motivo === "" ? <span className="italic text-foreground/50">(motivo em branco)</span> : b.motivo}
            </span>
            <span className="shrink-0 whitespace-nowrap text-[13px] tabular-nums text-foreground/80">
              {moeda.format(b.valor)} <span className="text-foreground/50">· {pct.format(b.percentual)}%</span>
            </span>
          </div>
          <div className="mt-1 h-2.5 w-full rounded-full bg-ragga-blue/10">
            <div className="h-2.5 rounded-full bg-ragga-blue" style={{ width: `${maximo > 0 ? Math.max((b.valor / maximo) * 100, 1) : 0}%` }} />
          </div>
          {temComparacao && (
            <p className={`mt-0.5 text-[11px] tabular-nums ${b.variacaoValor === null ? "text-foreground/45" : b.variacaoValor > 0 ? "text-semaforo-vermelho" : b.variacaoValor < 0 ? "text-semaforo-verde" : "text-foreground/50"}`}>
              vs. período anterior: {textoVariacao(b)}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function QuebraGraficos({
  fatias,
  barras,
  total,
  temComparacao,
}: {
  fatias: FatiaLojaQuebra[];
  barras: BarraMotivoQuebra[];
  total: number;
  temComparacao: boolean;
}) {
  const vazio = <p className="py-6 text-center text-sm text-foreground/45">Sem dados no período.</p>;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="min-w-0 overflow-hidden @container">
        <h3 className="mb-3 text-sm font-semibold text-ragga-blue-dark">Quebra por loja</h3>
        {fatias.length === 0 || total <= 0 ? vazio : <PainelRosca fatias={fatias} total={total} />}
      </Card>
      <Card className="min-w-0 overflow-hidden @container">
        <h3 className="mb-3 text-sm font-semibold text-ragga-blue-dark">Quebra por motivo</h3>
        {barras.length === 0 || total <= 0 ? vazio : <PainelBarras barras={barras} temComparacao={temComparacao} />}
      </Card>
    </div>
  );
}
