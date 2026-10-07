"use client";

import { Fragment, useState } from "react";
import { Secao, moeda, pct } from "@/components/ui/PainelAnalitico";
import { Barra, Var } from "@/components/indicadores/BrindesAnalise";
import { BadgeSituacao, CelulaComparado, type TotalCancelamento } from "@/components/indicadores/CancelamentoAnalise";
import { agruparFamiliaCMO, type AjusteSemSaidaLoja } from "@/lib/services/compraDiretaAnalise";
import type { MotivoComparado } from "@/lib/services/cancelamentoAnalise";
import { ROTULO_AJUSTE_SEM_SAIDA } from "@/lib/services/compraDiretaPainel";

/**
 * Seções gerenciais da aba Retirada Compra Direta: "O que gerou as retiradas?" (por motivo ou por família CMO) e o
 * bloco separado de Nota Fiscal (ajuste sem saída de caixa). Só apresentação: números de `compraDiretaAnalise.ts` e
 * `cancelamentoAnalise.ts`. A situação (melhorou/piorou) é pelo % sobre o faturamento; sem cobertura, "Sem base".
 * Os motivos mantêm o texto original da base. O subtotal da família CMO substitui os componentes (nunca soma com eles).
 */

type Visao = "motivo" | "familia";

const TH = "px-2 py-2";
const TD = "px-2";

export function SecaoMotivosRetirada({
  linhas,
  total,
  comparavel,
  motivoSemComparacao,
  periodoAtualTxt,
  periodoCompTxt,
  escopoTxt,
  motivoSelecionado,
  aoInvestigar,
}: {
  /** Motivos ORIGINAIS da retirada real (Nota Fiscal fora), na ordem do valor atual. */
  linhas: MotivoComparado[];
  total: TotalCancelamento;
  comparavel: boolean;
  motivoSemComparacao: string | null;
  /** Datas de OCORRÊNCIA (D-1 já aplicado) dos dois períodos. */
  periodoAtualTxt: string;
  periodoCompTxt: string;
  escopoTxt: string;
  motivoSelecionado: string | null;
  aoInvestigar: (motivo: string) => void;
}) {
  const [visao, setVisao] = useState<Visao>("motivo");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternar = (k: string) =>
    setAbertos((a) => {
      const n = new Set(a);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const grupos = agruparFamiliaCMO(linhas);

  /** Linha de um motivo ORIGINAL (com "Ver lojas" e expansão por loja). `nivel` 1 = filho da família CMO. */
  const renderMotivo = (m: MotivoComparado, nivel: 0 | 1) => {
    const chave = `${nivel}|${m.motivo}`;
    const aberto = abertos.has(chave);
    const selecionado = motivoSelecionado === m.motivo;
    return (
      <Fragment key={chave}>
        <tr onClick={() => alternar(chave)} className={`cursor-pointer border-b border-ragga-blue/5 align-top hover:bg-ragga-blue/[0.04] ${nivel === 1 ? "bg-ragga-bg/40" : ""}`}>
          <td className={`py-2.5 pr-2 font-semibold text-ragga-blue-dark ${nivel === 1 ? "pl-7" : ""}`}>
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
          <td className={`${TD} py-2.5`}>
            <CelulaPercentual percentual={m.percentualFaturamento} variacaoPp={m.variacaoPp} />
          </td>
          <td className={`${TD} py-2.5`}>
            <BadgeSituacao situacao={m.situacao} />
          </td>
          <td className={`${TD} py-2.5`}>
            <CelulaComparado comparado={m.comparado} reais={m.variacaoReais} percentual={m.variacaoPercentual} />
          </td>
        </tr>
        {aberto &&
          m.lojas.map((l) => (
            <tr key={`${chave}|${l.unidade}`} className="border-b border-ragga-blue/5 bg-ragga-bg/60 align-top text-[13px]">
              <td className={`py-2 pr-2 text-foreground/80 ${nivel === 1 ? "pl-14" : "pl-9"}`}>{l.unidade}</td>
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
  };

  return (
    <Secao
      titulo="O que gerou as retiradas?"
      acao={
        <div className="flex overflow-hidden rounded-md border border-ragga-blue/15 text-xs font-medium" role="group" aria-label="Visualização dos motivos">
          {(
            [
              ["motivo", "Por motivo"],
              ["familia", "Por família CMO"],
            ] as const
          ).map(([v, rotulo]) => (
            <button
              key={v}
              type="button"
              aria-pressed={visao === v}
              onClick={() => setVisao(v)}
              className={`px-3 py-1.5 ${visao === v ? "bg-ragga-blue text-white" : "bg-white text-ragga-blue-dark hover:bg-ragga-blue/5"}`}
            >
              {rotulo}
            </button>
          ))}
        </div>
      }
    >
      <p className="mb-2 text-xs text-foreground/55">
        Motivos que compõem a retirada real de Compra Direta ({escopoTxt}), do maior para o menor valor, com os nomes exatamente como estão na base. Clique na linha para ver as lojas.
        {visao === "familia" && " Na visão por família, o subtotal CMO substitui os motivos “CMO/…” (clique nele para ver os componentes); os demais motivos continuam separados."}
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
        <p className="text-sm text-foreground/45">Sem retiradas de Compra Direta no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                <th className="min-w-[190px] py-2 pr-2">Motivo / loja</th>
                <th className={TH}>Valor (R$)</th>
                <th className={TH}>Participação na retirada real</th>
                <th className={TH}>% s/ fatur.</th>
                <th className={TH}>Situação (pelo valor em R$)</th>
                <th className={TH}>Comparado e variação (R$, % do valor)</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {visao === "motivo"
                ? linhas.map((m) => renderMotivo(m, 0))
                : grupos.map((g) => {
                    if (g.tipo === "motivo") return renderMotivo(g.linha, 0);
                    const chave = "familia-cmo";
                    const aberto = abertos.has(chave);
                    const s = g.subtotal;
                    return (
                      <Fragment key={chave}>
                        <tr onClick={() => alternar(chave)} className="cursor-pointer border-b border-ragga-blue/5 bg-ragga-blue/[0.03] align-top hover:bg-ragga-blue/[0.06]">
                          <td className="py-2.5 pr-2 font-semibold text-ragga-blue-dark">
                            <span className="mr-1.5 inline-block w-3 text-ragga-blue/45">{aberto ? "▾" : "▸"}</span>
                            {s.motivo}
                            <p className="mt-1 pl-[18px] text-[11px] font-normal text-foreground/50">
                              {g.filhos.length} {g.filhos.length === 1 ? "motivo" : "motivos"} · subtotal visual (substitui os componentes no total)
                            </p>
                          </td>
                          <td className={`${TD} py-2.5 font-semibold`}>{moeda.format(s.atual)}</td>
                          <td className={`${TD} py-2.5`}>
                            {pct.format(s.percentualDoTotal)}%
                            <Barra valor={s.percentualDoTotal} />
                          </td>
                          <td className={`${TD} py-2.5`}>
                            <CelulaPercentual percentual={s.percentualFaturamento} variacaoPp={s.variacaoPp} />
                          </td>
                          <td className={`${TD} py-2.5`}>
                            <BadgeSituacao situacao={s.situacao} />
                          </td>
                          <td className={`${TD} py-2.5`}>
                            <CelulaComparado comparado={s.comparado} reais={s.variacaoReais} percentual={s.variacaoPercentual} />
                          </td>
                        </tr>
                        {aberto && g.filhos.map((f) => renderMotivo(f, 1))}
                      </Fragment>
                    );
                  })}
              <tr className="border-t-2 border-ragga-blue/20 align-top font-bold text-ragga-blue-dark">
                <td className="py-2.5 pr-2">TOTAL DE RETIRADAS REAIS</td>
                <td className={`${TD} py-2.5`}>{moeda.format(total.valor)}</td>
                <td className={`${TD} py-2.5`}>{pct.format(100)}%</td>
                <td className={`${TD} py-2.5`}>
                  <CelulaPercentual percentual={total.percentual} variacaoPp={total.variacaoPp} />
                </td>
                <td className={`${TD} py-2.5 font-normal`}>
                  <BadgeSituacao situacao={total.situacao} />
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
        A situação (melhorou/piorou) segue a regra da Compra Direta: valor em R$ menor que o do período comparado = melhorou, maior = piorou, diferença abaixo de R$ 0,005 = estável. O % sobre o faturamento e sua variação em p.p. aparecem à parte, só com faturamento completo. “SUPRIMENTO/EMPRÉSTIMO” permanece na retirada real. Nota Fiscal não entra nesta tabela (veja o bloco abaixo). A quantidade de ocorrências não está disponível: a base registra apenas o valor por loja, dia e motivo.
      </p>
    </Secao>
  );
}

/** % sobre o faturamento (só com cobertura) e, abaixo, a variação em p.p. contra o período comparado (só com base válida). */
function CelulaPercentual({ percentual, variacaoPp }: { percentual: number | null; variacaoPp: number | null }) {
  if (percentual === null) return <span className="text-foreground/40">—</span>;
  return (
    <span className="flex flex-col leading-tight">
      <span>{pct.format(percentual)}%</span>
      {variacaoPp !== null && (
        <span className="whitespace-nowrap text-[11px] font-normal text-foreground/55">
          {Math.abs(variacaoPp) < 0.005 ? "" : variacaoPp > 0 ? "+" : "-"}
          {pct.format(Math.abs(variacaoPp))} p.p.
        </span>
      )}
    </span>
  );
}

/** Nota Fiscal = ajuste sem saída de caixa: separada da retirada real, sem % nem ranking, só variação factual. */
export function BlocoAjustesSemSaida({
  atual,
  comparado,
  porLoja,
  escopoTxt,
}: {
  atual: number;
  /** `null` sem base comparável. */
  comparado: number | null;
  porLoja: AjusteSemSaidaLoja[];
  escopoTxt: string;
}) {
  return (
    <Secao titulo="Ajustes sem saída de caixa (Nota Fiscal)">
      <p className="mb-3 text-xs text-foreground/55">
        {ROTULO_AJUSTE_SEM_SAIDA} — fora da retirada real, do % sobre o faturamento, dos rankings e do status ({escopoTxt}). Aparece aqui só para rastreabilidade; a variação é factual.
      </p>
      {atual === 0 && (comparado ?? 0) === 0 && porLoja.length === 0 ? (
        <p className="text-sm text-foreground/45">Nenhum ajuste sem saída de caixa no período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm tabular-nums">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                <th className="py-2 pr-2">Loja</th>
                <th className={TH}>Atual</th>
                <th className={TH}>Comparado e variação</th>
              </tr>
            </thead>
            <tbody>
              {porLoja.map((l) => (
                <tr key={l.unidade} className="border-b border-ragga-blue/5 align-top">
                  <td className="py-2 pr-2 font-semibold text-ragga-blue-dark">{l.unidade}</td>
                  <td className={TD}>{moeda.format(l.atual)}</td>
                  <td className={TD}>
                    <CelulaComparado comparado={l.comparado} reais={l.comparado === null ? null : Math.round((l.atual - l.comparado) * 100) / 100} percentual={l.comparado === null || l.comparado === 0 ? null : ((l.atual - l.comparado) / l.comparado) * 100} />
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
                <td className="py-2 pr-2">TOTAL DE AJUSTES</td>
                <td className={TD}>{moeda.format(atual)}</td>
                <td className={`${TD} font-normal`}>
                  {comparado === null ? (
                    <span className="text-foreground/45">Sem base</span>
                  ) : (
                    <div className="flex flex-col items-start gap-0.5 leading-tight">
                      <span className="text-foreground/70">{moeda.format(comparado)}</span>
                      <Var reais={Math.round((atual - comparado) * 100) / 100} percentual={comparado === 0 ? null : ((atual - comparado) / comparado) * 100} interpretar={false} />
                    </div>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Secao>
  );
}
