"use client";

import { Fragment, useState } from "react";
import { Secao, moeda, pct } from "@/components/ui/PainelAnalitico";
import { Barra, Var } from "@/components/indicadores/BrindesAnalise";
import { ROTULO_SITUACAO_CANCELAMENTO, type LojaDoMotivo, type MotivoComparado, type SituacaoCancelamentoAnalise } from "@/lib/services/cancelamentoAnalise";

/**
 * Seções gerenciais da aba Cancelamentos: "O que gerou os cancelamentos?" (motivos → lojas) e "Investigar por motivo"
 * (lojas dentro do motivo). Só apresentação: os números vêm de `lib/services/cancelamentoAnalise.ts`. Melhora/piora
 * pelo % sobre o faturamento (menor = melhor); sem cobertura, "Sem base" — nunca zero.
 *
 * Disposição: a SITUAÇÃO vem logo depois dos valores proporcionais e o "Ver lojas" fica sob o nome do motivo (sempre
 * visível, à esquerda); o período comparado e a variação compartilham a última coluna — cabe em ~900 px sem rolagem.
 */

const COR: Record<SituacaoCancelamentoAnalise, string> = {
  melhorou: "bg-semaforo-verde/10 text-semaforo-verde",
  piorou: "bg-semaforo-vermelho/10 text-semaforo-vermelho",
  estavel: "bg-foreground/5 text-foreground/60",
  "sem-ocorrencia": "bg-foreground/5 text-foreground/50",
  "sem-base": "bg-foreground/5 text-foreground/45",
};
const ICONE: Record<SituacaoCancelamentoAnalise, string> = { melhorou: "▼", piorou: "▲", estavel: "=", "sem-ocorrencia": "○", "sem-base": "?" };
const sinal = (v: number) => (v > 0 ? "+" : v < 0 ? "-" : "");

export function BadgeSituacao({ situacao, pp }: { situacao: SituacaoCancelamentoAnalise; pp?: number | null }) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${COR[situacao]}`}>
        {ICONE[situacao]} {ROTULO_SITUACAO_CANCELAMENTO[situacao]}
      </span>
      {pp !== null && pp !== undefined && situacao !== "sem-base" && situacao !== "sem-ocorrencia" && (
        <span className="whitespace-nowrap text-[11px] tabular-nums text-foreground/55">
          {Math.abs(pp) < 0.005 ? "" : sinal(pp)}
          {pct.format(Math.abs(pp))} p.p. s/ fat.
        </span>
      )}
    </span>
  );
}

/** Valor do período comparado e, logo abaixo, a variação em R$ (e % do valor). `null` = sem base comparável (nunca zero). */
export function CelulaComparado({ comparado, reais, percentual }: { comparado: number | null; reais: number | null; percentual: number | null }) {
  if (comparado === null) return <span className="text-foreground/45">Sem base</span>;
  return (
    <div className="flex flex-col items-start gap-0.5 leading-tight">
      <span className="text-foreground/70">{moeda.format(comparado)}</span>
      <Var reais={reais} percentual={percentual} interpretar={false} />
    </div>
  );
}

export interface TotalCancelamento {
  valor: number;
  comparado: number | null;
  percentual: number | null;
  variacaoPp: number | null;
  situacao: SituacaoCancelamentoAnalise;
}

const TH = "px-2 py-2";
const TD = "px-2";

export function SecaoMotivosCancelamento({
  linhas,
  total,
  comparavel,
  motivoSemComparacao,
  periodoAtualTxt,
  periodoCompTxt,
  escopoTxt,
  rotulo,
  motivoSelecionado,
  aoInvestigar,
}: {
  linhas: MotivoComparado[];
  total: TotalCancelamento;
  comparavel: boolean;
  motivoSemComparacao: string | null;
  /** Datas de OCORRÊNCIA (D-1 já aplicado) dos dois períodos. */
  periodoAtualTxt: string;
  periodoCompTxt: string;
  escopoTxt: string;
  rotulo: string;
  motivoSelecionado: string | null;
  aoInvestigar: (motivo: string) => void;
}) {
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternar = (m: string) =>
    setAbertos((a) => {
      const n = new Set(a);
      if (n.has(m)) n.delete(m);
      else n.add(m);
      return n;
    });

  return (
    <Secao titulo="O que gerou os cancelamentos?">
      <p className="mb-2 text-xs text-foreground/55">
        Motivos que compõem o total de {rotulo} ({escopoTxt}), do maior para o menor valor, com os nomes exatamente como estão na base. Clique na linha para ver as lojas.
      </p>
      <p className="mb-3 text-xs text-foreground/70">
        <span className="font-semibold text-ragga-blue-dark">Período atual:</span> {periodoAtualTxt} · <span className="font-semibold text-ragga-blue-dark">Comparado:</span> {periodoCompTxt}
        <span className="text-foreground/45"> (datas de ocorrência)</span>
      </p>
      {!comparavel && (
        <p className="mb-3 rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-3 py-2 text-xs text-ragga-blue-dark">
          ⚠ Sem base de comparação válida. {motivoSemComparacao ?? ""} As variações e situações não são exibidas.
        </p>
      )}
      {linhas.length === 0 ? (
        <p className="text-sm text-foreground/45">Sem cancelamentos no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                <th className="min-w-[190px] py-2 pr-2">Motivo / loja</th>
                <th className={TH}>Valor (R$)</th>
                <th className={TH}>Participação no total</th>
                <th className={TH}>% s/ fatur.</th>
                <th className={TH}>Situação (pelo % s/ fat.)</th>
                <th className={TH}>Comparado e variação (R$, % do valor)</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {linhas.map((m) => {
                const aberto = abertos.has(m.motivo);
                const selecionado = motivoSelecionado === m.motivo;
                return (
                  <Fragment key={m.motivo}>
                    <tr onClick={() => alternar(m.motivo)} className="cursor-pointer border-b border-ragga-blue/5 align-top hover:bg-ragga-blue/[0.04]">
                      <td className="py-2.5 pr-2 font-semibold text-ragga-blue-dark">
                        <span className="mr-1.5 inline-block w-3 text-ragga-blue/45">{aberto ? "▾" : "▸"}</span>
                        {m.motivo}
                        <div className="mt-1 pl-[18px]">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              aoInvestigar(m.motivo);
                            }}
                            className={`whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${selecionado ? "bg-ragga-blue text-white" : "bg-ragga-blue/10 text-ragga-blue hover:bg-ragga-blue/20"}`}
                          >
                            Ver lojas →
                          </button>
                        </div>
                      </td>
                      <td className={`${TD} py-2.5 font-semibold`}>{moeda.format(m.atual)}</td>
                      <td className={`${TD} py-2.5`}>
                        {pct.format(m.percentualDoTotal)}%
                        <Barra valor={m.percentualDoTotal} />
                      </td>
                      <td className={`${TD} py-2.5`}>{m.percentualFaturamento === null ? <span className="text-foreground/40">—</span> : `${pct.format(m.percentualFaturamento)}%`}</td>
                      <td className={`${TD} py-2.5`}>
                        <BadgeSituacao situacao={m.situacao} pp={m.variacaoPp} />
                      </td>
                      <td className={`${TD} py-2.5`}>
                        <CelulaComparado comparado={m.comparado} reais={m.variacaoReais} percentual={m.variacaoPercentual} />
                      </td>
                    </tr>
                    {aberto &&
                      m.lojas.map((l) => (
                        <tr key={`${m.motivo}|${l.unidade}`} className="border-b border-ragga-blue/5 bg-ragga-bg/60 align-top text-[13px]">
                          <td className="py-2 pl-9 pr-2 text-foreground/80">{l.unidade}</td>
                          <td className={TD}>{moeda.format(l.atual)}</td>
                          <td className={`${TD} text-foreground/60`}>{pct.format(l.percentualDoMotivo)}% do motivo</td>
                          <td colSpan={2} />
                          <td className={TD}>
                            <CelulaComparado comparado={l.comparado} reais={l.variacaoReais} percentual={l.variacaoPercentual} />
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
              <tr className="border-t-2 border-ragga-blue/20 align-top font-bold text-ragga-blue-dark">
                <td className="py-2.5 pr-2">TOTAL — {rotulo.toUpperCase()}</td>
                <td className={`${TD} py-2.5`}>{moeda.format(total.valor)}</td>
                <td className={`${TD} py-2.5`}>{pct.format(100)}%</td>
                <td className={`${TD} py-2.5`}>{total.percentual === null ? <span className="font-normal text-foreground/40">—</span> : `${pct.format(total.percentual)}%`}</td>
                <td className={`${TD} py-2.5 font-normal`}>
                  <BadgeSituacao situacao={total.situacao} pp={total.variacaoPp} />
                </td>
                <td className={`${TD} py-2.5 font-normal`}>
                  <CelulaComparado
                    comparado={total.comparado}
                    reais={total.comparado === null ? null : Math.round((total.valor - total.comparado) * 100) / 100}
                    percentual={total.comparado === null || total.comparado === 0 ? null : ((total.valor - total.comparado) / total.comparado) * 100}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[11px] text-foreground/40">
        A situação (melhorou/piorou) é decidida pelo % sobre o faturamento — menor = melhorou —, nunca só pelo valor em R$; a variação em R$ é factual. Todos os motivos da base entram nos totais, inclusive “TESTE”. A quantidade de ocorrências não está disponível: a base registra apenas o valor por loja, dia e motivo.
      </p>
    </Secao>
  );
}

export function SecaoInvestigarMotivo({
  motivos,
  selecionado,
  aoSelecionar,
  lojas,
  periodoAtualTxt,
  periodoCompTxt,
  comparavel,
  rotulo,
}: {
  motivos: string[];
  selecionado: string | null;
  aoSelecionar: (m: string) => void;
  lojas: LojaDoMotivo[];
  periodoAtualTxt: string;
  periodoCompTxt: string;
  comparavel: boolean;
  rotulo: string;
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
      titulo="Investigar por motivo"
      acao={
        <label className="flex items-center gap-2 text-xs font-medium text-ragga-blue-dark">
          Ordenar por
          <select value={ordem} onChange={(e) => setOrdem(e.target.value as "valor" | "percentual")} className="rounded-md border border-ragga-blue/15 bg-white px-2 py-1.5 text-xs">
            <option value="valor">Valor no motivo</option>
            <option value="percentual">% sobre o faturamento</option>
          </select>
        </label>
      }
    >
      {motivos.length === 0 ? (
        <p className="text-sm text-foreground/45">Sem cancelamentos no período.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-foreground/70">
            <span className="font-semibold text-ragga-blue-dark">Período atual:</span> {periodoAtualTxt} · <span className="font-semibold text-ragga-blue-dark">Comparado:</span> {periodoCompTxt}
            <span className="text-foreground/45"> (datas de ocorrência)</span>
          </p>
          <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Motivo">
            {motivos.map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={selecionado === m}
                onClick={() => aoSelecionar(m)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${selecionado === m ? "border-ragga-blue bg-ragga-blue text-white" : "border-ragga-blue/20 bg-white text-ragga-blue-dark hover:bg-ragga-blue/5"}`}
              >
                {m}
              </button>
            ))}
          </div>
          {lista.length === 0 ? (
            <p className="text-sm text-foreground/45">Nenhuma loja teve este motivo no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                    <th className="py-2 pr-2">Loja</th>
                    <th className={TH}>Valor no motivo</th>
                    <th className={TH}>Participação no motivo</th>
                    <th className={TH}>Faturamento da loja</th>
                    <th className={TH}>% s/ fatur.</th>
                    <th className={TH}>Situação (pelo % s/ fat.)</th>
                    <th className={TH}>Comparado e variação (R$, % do valor)</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {lista.map((l) => (
                    <tr key={l.unidade} className="border-b border-ragga-blue/5 align-top">
                      <td className="py-2.5 pr-2 font-semibold text-ragga-blue-dark">{l.unidade}</td>
                      <td className={`${TD} py-2.5 font-semibold`}>{moeda.format(l.valor)}</td>
                      <td className={`${TD} py-2.5`}>
                        {pct.format(l.percentualDoMotivo)}%
                        <Barra valor={l.percentualDoMotivo} />
                      </td>
                      <td className={`${TD} py-2.5`}>{l.faturamento === null ? <span className="text-foreground/40">—</span> : moeda.format(l.faturamento)}</td>
                      <td className={`${TD} py-2.5`}>
                        {l.percentualFaturamento === null ? (
                          <span className="text-xs font-semibold text-semaforo-amarelo">{l.coberturaParcial ? "⚠ fatur. parcial" : "—"}</span>
                        ) : (
                          `${pct.format(l.percentualFaturamento)}%`
                        )}
                      </td>
                      <td className={`${TD} py-2.5`}>
                        <BadgeSituacao situacao={l.situacao} pp={l.variacaoPp} />
                      </td>
                      <td className={`${TD} py-2.5`}>
                        <CelulaComparado comparado={l.comparado} reais={l.variacaoReais} percentual={l.variacaoPercentual} />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
                    <td className="py-2.5 pr-2">TOTAL DO MOTIVO</td>
                    <td className={`${TD} py-2.5`}>{moeda.format(total)}</td>
                    <td className={`${TD} py-2.5`}>{pct.format(100)}%</td>
                    <td colSpan={4} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-foreground/40">
            Lojas comparadas dentro do mesmo motivo de {rotulo}; valor absoluto e proporção aparecem separados (a loja de maior valor não é, por isso, a pior). A situação é pelo % sobre o faturamento.
            {comparavel ? "" : " Sem base de comparação válida: variações e situações não são exibidas."} Loja com faturamento em menos dias que o período fica sem % e sem comparação (valor em R$ mantido).
          </p>
        </>
      )}
    </Secao>
  );
}
