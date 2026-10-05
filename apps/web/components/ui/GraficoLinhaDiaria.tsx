"use client";

import { useState, type ReactNode } from "react";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const moedaCompacta = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const NOME_DIA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const diaDaSemana = (iso: string) => new Date(`${iso}T00:00:00.000Z`).getUTCDay();
const ehFimDeSemana = (iso: string) => {
  const d = diaDaSemana(iso);
  return d === 0 || d === 6;
};
export const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const diaMesAno = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const rotuloDia = (iso: string) => `${NOME_DIA[diaDaSemana(iso)]} ${diaMes(iso)}`;

export interface PontoDiario {
  /** AAAA-MM-DD */
  data: string;
  valor: number;
  faturamento: number;
}

/**
 * Evolução diária em LINHA (SVG, sem dependência) — componente compartilhado pelos painéis de Compra Direta e
 * Brindes. Eixo X = datas reais do período; eixo Y = R$ (ou % do faturamento). Maior dia em vermelho, menor em
 * verde, demais pontos em azul. Sábados/domingos com faixa suave ("Sáb"/"Dom"). Só entram na linha os dias com
 * dado válido (faturamento ou valor registrado): dias sem registro ficam como lacuna, nunca R$ 0 inventado. Tooltip
 * no HOVER (sem clique, sem bloquear o mouse, sem tooltip nativo duplicado), com conteúdo definido por quem usa.
 */
export function GraficoLinhaDiaria<T extends PontoDiario>({
  dias,
  modo,
  altura = 230,
  metaPercentual,
  rotuloMaior = "Maior valor",
  rotuloMenor = "Menor valor",
  textoAjuda,
  renderTooltip,
}: {
  dias: T[];
  modo: "valor" | "percentual";
  altura?: number;
  /** Linha de referência no modo % (meta saudável já existente do indicador). */
  metaPercentual?: number;
  rotuloMaior?: string;
  rotuloMenor?: string;
  textoAjuda: string;
  /** Conteúdo do tooltip do dia (hover). `y` = valor plotado (R$ ou %). */
  renderTooltip: (dia: T, ctx: { modo: "valor" | "percentual"; y: number }) => ReactNode;
}) {
  // Dia sob o mouse (hover) — o tooltip aparece na hora, sem clique.
  const [selecionado, setSelecionado] = useState<string | null>(null);
  if (dias.length === 0) return <p className="text-sm text-foreground/45">Sem dados no período.</p>;

  const pontos = dias.map((d) => {
    const valido = modo === "valor" ? d.faturamento > 0 || d.valor > 0 : d.faturamento > 0;
    return { ...d, valido, y: modo === "valor" ? d.valor : d.faturamento > 0 ? (d.valor / d.faturamento) * 100 : 0 };
  });
  const validos = pontos.filter((p) => p.valido);
  if (validos.length === 0) return <p className="text-sm text-foreground/45">Sem dados válidos no período.</p>;

  const maior = validos.reduce((a, b) => (b.y > a.y ? b : a));
  const menor = validos.reduce((a, b) => (b.y < a.y ? b : a));
  const mesmo = maior.data === menor.data;

  const fmtY = (v: number) => (modo === "valor" ? moeda.format(v) : `${pct.format(v)}%`);
  const fmtEixo = (v: number) => (modo === "valor" ? moedaCompacta.format(v) : `${pct.format(v)}%`);

  const topoDado = Math.max(...validos.map((p) => p.y), modo === "percentual" && metaPercentual ? metaPercentual : 0, 1) * 1.08;
  const L = 720;
  const esq = 54;
  const dir = 14;
  const topo = 26;
  const rodape = 30;
  const areaH = altura - topo - rodape;
  const passo = (L - esq - dir) / pontos.length;
  const xDe = (i: number) => esq + (i + 0.5) * passo;
  const yDe = (v: number) => topo + areaH - (v / topoDado) * areaH;
  const cadaTick = Math.max(1, Math.ceil(pontos.length / 8));
  const mostrarSiglaFds = passo >= 14;

  // Segmentos contínuos (quebra a linha nos dias sem dado válido).
  const segmentos: string[] = [];
  let atual: string[] = [];
  pontos.forEach((p, i) => {
    if (p.valido) atual.push(`${atual.length === 0 ? "M" : "L"}${xDe(i).toFixed(1)},${yDe(p.y).toFixed(1)}`);
    else if (atual.length > 0) {
      segmentos.push(atual.join(" "));
      atual = [];
    }
  });
  if (atual.length > 0) segmentos.push(atual.join(" "));

  const indiceSel = selecionado ? pontos.findIndex((p) => p.data === selecionado && p.valido) : -1;
  const diaSel = indiceSel >= 0 ? pontos[indiceSel] : null;

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <p className="text-foreground/45">Período inicial</p>
          <p className="font-semibold text-ragga-blue-dark">{diaMesAno(pontos[0].data)}</p>
        </div>
        <div>
          <p className="text-foreground/45">Período final</p>
          <p className="font-semibold text-ragga-blue-dark">{diaMesAno(pontos[pontos.length - 1].data)}</p>
        </div>
        <div>
          <p className="text-foreground/45">
            🔴 {rotuloMaior} · {rotuloDia(maior.data)}
          </p>
          <p className="font-semibold text-semaforo-vermelho">{fmtY(maior.y)}</p>
        </div>
        <div>
          <p className="text-foreground/45">
            🟢 {rotuloMenor} · {mesmo ? "—" : rotuloDia(menor.data)}
          </p>
          <p className="font-semibold text-semaforo-verde">{mesmo ? "—" : fmtY(menor.y)}</p>
        </div>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${L} ${altura}`} className="w-full" role="img" aria-label="Evolução diária (linha)">
          {/* faixas de fim de semana */}
          {pontos.map((p, i) =>
            ehFimDeSemana(p.data) ? (
              <g key={`fds-${p.data}`}>
                <rect x={esq + i * passo} y={topo} width={passo} height={areaH} className="fill-ragga-blue/[0.06]" />
                {mostrarSiglaFds && (
                  <text x={xDe(i)} y={topo - 8} textAnchor="middle" fontSize="8.5" className="fill-ragga-blue/50">
                    {diaDaSemana(p.data) === 6 ? "Sáb" : "Dom"}
                  </text>
                )}
              </g>
            ) : null
          )}
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={esq} x2={L - dir} y1={yDe(topoDado * f)} y2={yDe(topoDado * f)} className="stroke-ragga-blue/10" />
              <text x={esq - 6} y={yDe(topoDado * f) + 3} textAnchor="end" fontSize="10" className="fill-foreground/45">
                {fmtEixo(topoDado * f)}
              </text>
            </g>
          ))}
          {modo === "percentual" && metaPercentual !== undefined && (
            <g>
              <line x1={esq} x2={L - dir} y1={yDe(metaPercentual)} y2={yDe(metaPercentual)} strokeDasharray="5 4" className="stroke-semaforo-amarelo" />
              <text x={L - dir} y={yDe(metaPercentual) - 4} textAnchor="end" fontSize="10" className="fill-semaforo-amarelo">
                meta saudável {pct.format(metaPercentual)}%
              </text>
            </g>
          )}
          {segmentos.map((d, i) => (
            <path key={i} d={d} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-ragga-blue" />
          ))}
          {pontos.map((p, i) => {
            if (!p.valido) return null;
            const ehMaior = p.data === maior.data;
            const ehMenor = !mesmo && p.data === menor.data;
            return (
              <g key={p.data} className="cursor-crosshair" onMouseEnter={() => setSelecionado(p.data)} onMouseLeave={() => setSelecionado((a) => (a === p.data ? null : a))}>
                <circle cx={xDe(i)} cy={yDe(p.y)} r={10} fill="transparent" />
                <circle
                  cx={xDe(i)}
                  cy={yDe(p.y)}
                  r={ehMaior || ehMenor ? 5 : 2.8}
                  className={ehMaior ? "fill-semaforo-vermelho stroke-white" : ehMenor ? "fill-semaforo-verde stroke-white" : "fill-ragga-blue stroke-white"}
                  strokeWidth={ehMaior || ehMenor ? 1.5 : 1}
                />
                {(ehMaior || ehMenor) && (
                  <text
                    x={xDe(i)}
                    y={ehMaior ? yDe(p.y) - 9 : yDe(p.y) + 17}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="700"
                    className={ehMaior ? "fill-semaforo-vermelho" : "fill-semaforo-verde"}
                  >
                    {fmtEixo(p.y)}
                  </text>
                )}
              </g>
            );
          })}
          {pontos.map((p, i) =>
            i === pontos.length - 1 || (i % cadaTick === 0 && pontos.length - 1 - i >= cadaTick * 0.7) ? (
              <text key={`x-${p.data}`} x={xDe(i)} y={altura - 10} textAnchor="middle" fontSize="10" className="fill-foreground/50">
                {diaMes(p.data)}
              </text>
            ) : null
          )}
        </svg>
        {diaSel && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-30 mt-3 w-64 max-w-full rounded-xl border border-ragga-blue/15 bg-white p-3 text-sm shadow-[0_12px_32px_-8px_rgba(31,53,112,0.35)]"
            style={{
              // centralizado no ponto e limitado às bordas do gráfico (não vaza em telas estreitas)
              left: `clamp(0px, calc(${(xDe(indiceSel) / L) * 100}% - 8rem), calc(100% - 16rem))`,
              top: `${(yDe(diaSel.y) / altura) * 100}%`,
            }}
          >
            {renderTooltip(diaSel as unknown as T, { modo, y: diaSel.y })}
          </div>
        )}
      </div>
      <p className="mt-1 text-[11px] text-foreground/40">{textoAjuda}</p>
    </div>
  );
}
