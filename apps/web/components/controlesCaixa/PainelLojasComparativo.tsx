"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Secao, Item, Situacao, VariacaoPp, moeda, pct, sinalMoeda } from "@/components/ui/PainelAnalitico";
import { dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { periodoComparacaoPadrao } from "@/lib/rules/mesAnterior";
import {
  mapaPorLoja,
  ordenarLojasPainel,
  situacaoLoja,
  type MetricaLoja,
  type OrdemLojasPainel,
  type PainelLojas,
  type SentidoValor,
} from "@/lib/services/controlesLojaPainel";

/**
 * Painel genérico "por loja" (REDE → LOJA → detalhe) das sub-abas Fechamento, PDV × Maquininha e Troco — mesma
 * estrutura/UX da Quebra de Caixa. Só apresentação + período comparado: cada aba decide o que é "valor", "%" e
 * detalhe (ver `controlesLojaPainel.ts`). O período ATUAL é o que a aba já carregou (cards, tabela e detalhe sempre
 * batem); o COMPARADO é o equivalente anterior (mês completo → mês anterior; senão mesma duração imediatamente
 * antes) e pode ser trocado. Status = situação do comparativo (menor divergência = melhorou) — sem meta nova.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const completa = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 2000;
export const diaBR = (isoStr: string) => `${isoStr.slice(8, 10)}/${isoStr.slice(5, 7)}/${isoStr.slice(0, 4)}`;
export const formatadorDiaPainel = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

/**
 * Período comparado + busca. `janela` = período (já na "linguagem" do indicador) cujo equivalente anterior é
 * calculado; `buscar` recebe o período comparado (AAAA-MM-DD → Date UTC) e devolve os dados do indicador.
 */
export function useComparacaoPeriodo<T>(janela: { inicio: Date | null; fim: Date | null }, buscar: (inicio: Date, fim: Date) => Promise<T>) {
  const [compManual, setCompManual] = useState<{ inicio: string; fim: string } | null>(null);
  const [dados, setDados] = useState<T | null>(null);
  const [pendente, iniciarTransicao] = useTransition();
  const ultimaRequisicao = useRef(0);
  const buscarRef = useRef(buscar);
  useEffect(() => {
    buscarRef.current = buscar;
  });

  const padrao = useMemo(() => (janela.inicio && janela.fim ? periodoComparacaoPadrao(janela.inicio, janela.fim) : null), [janela.inicio, janela.fim]);
  const compInicio = compManual?.inicio ?? (padrao ? iso(padrao.inicio) : "");
  const compFim = compManual?.fim ?? (padrao ? iso(padrao.fim) : "");

  useEffect(() => {
    if (!completa(compInicio) || !completa(compFim) || compInicio > compFim) return;
    const req = ++ultimaRequisicao.current;
    iniciarTransicao(async () => {
      const r = await buscarRef.current(dataDoInput(compInicio), dataDoInput(compFim));
      if (req === ultimaRequisicao.current) setDados(r);
    });
  }, [compInicio, compFim]);

  return { compInicio, compFim, compManual, setCompManual, dados, pendente };
}

export interface ColunaExtra<D> {
  titulo: string;
  celula: (l: MetricaLoja<D>) => ReactNode;
}

export function PainelLojasComparativo<D>({
  titulo,
  rotuloValor,
  rotuloPercentual,
  periodoAtualTxt,
  compInicio,
  compFim,
  compManual,
  setCompManual,
  carregando,
  atual,
  comparacao,
  lojaFiltro,
  opcoesOrdem,
  ordemInicial,
  sentidoValor,
  colunasExtras,
  notaStatus,
  notaCobertura,
  renderDetalhe,
}: {
  titulo: string;
  rotuloValor: string;
  /** Presente só quando a aba tem % válido. */
  rotuloPercentual?: string;
  periodoAtualTxt: string;
  compInicio: string;
  compFim: string;
  compManual: { inicio: string; fim: string } | null;
  setCompManual: (v: { inicio: string; fim: string } | null) => void;
  carregando: boolean;
  atual: PainelLojas<D>;
  /** `null` = comparado ainda não carregado. */
  comparacao: PainelLojas<unknown> | null;
  lojaFiltro?: string;
  opcoesOrdem: { id: OrdemLojasPainel; rotulo: string }[];
  ordemInicial: OrdemLojasPainel;
  sentidoValor: SentidoValor;
  colunasExtras?: ColunaExtra<D>[];
  notaStatus: string;
  notaCobertura?: string | null;
  renderDetalhe: (loja: MetricaLoja<D>, comparada: MetricaLoja<unknown> | null, temBase: boolean, periodoComp: string) => ReactNode;
}) {
  const [ordem, setOrdem] = useState<OrdemLojasPainel>(ordemInicial);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const comparadas = mapaPorLoja(comparacao);
  const temBaseRede = !!comparacao && comparacao.disponivel;
  const lojas = ordenarLojasPainel(atual.lojas, comparadas, ordem, sentidoValor);
  const periodoCompTxt = compInicio && compFim ? `${diaBR(compInicio)} a ${diaBR(compFim)}` : "—";
  const temPct = rotuloPercentual !== undefined;
  const nCols = 1 + (colunasExtras?.length ?? 0) + 1 + (temPct ? 1 : 0) + 2 + (temPct ? 1 : 0) + 1 + 1;
  const inputCls = "rounded-md border border-ragga-blue/15 bg-white px-3 py-2 text-sm focus:border-ragga-blue focus:outline-none focus:ring-1 focus:ring-ragga-blue/40";

  function alternar(u: string) {
    setAbertas((a) => {
      const n = new Set(a);
      if (n.has(u)) n.delete(u);
      else n.add(u);
      return n;
    });
  }

  const variacaoRs = (a: number, c: number) => sinalMoeda(a - c);
  const redeComp = comparacao?.rede ?? null;

  return (
    <Secao
      titulo={titulo}
      acao={
        <label className="flex items-center gap-2 text-xs font-medium text-ragga-blue-dark">
          Ordenar por
          <select value={ordem} onChange={(e) => setOrdem(e.target.value as OrdemLojasPainel)} className="rounded-md border border-ragga-blue/15 bg-white px-2 py-1.5 text-xs">
            {opcoesOrdem.map((o) => (
              <option key={o.id} value={o.id}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="text-xs text-foreground/60">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Período atual</p>
          <p className="rounded-md border border-ragga-blue/10 bg-ragga-bg px-3 py-2 text-sm font-medium text-ragga-blue-dark">{periodoAtualTxt}</p>
        </div>
        <div>
          <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
            Comparar com
            {compManual ? (
              <button type="button" onClick={() => setCompManual(null)} className="normal-case tracking-normal text-ragga-blue hover:underline">
                ↺ usar período padrão
              </button>
            ) : (
              <span className="normal-case tracking-normal text-foreground/40">(período anterior equivalente)</span>
            )}
          </p>
          <div className="flex items-center gap-2 text-sm">
            <input type="date" value={compInicio} onChange={(e) => setCompManual({ inicio: e.target.value, fim: compFim })} className={inputCls} />
            <span className="text-foreground/40">até</span>
            <input type="date" value={compFim} onChange={(e) => setCompManual({ inicio: compInicio, fim: e.target.value })} className={inputCls} />
          </div>
        </div>
        {carregando && <span className="pb-2 text-xs text-foreground/50">Carregando comparativo...</span>}
      </div>

      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">{lojaFiltro ? `Loja ${lojaFiltro}` : "Rede"}</p>
      {!atual.disponivel ? (
        <p className="mb-2 text-sm text-foreground/45">Sem dados no período selecionado.</p>
      ) : (
        <div className="mb-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-6">
          <Item rotulo={`${rotuloValor} atual`} valor={moeda.format(atual.rede.valor)} />
          {temPct && <Item rotulo={`${rotuloPercentual} atual`} valor={`${pct.format(atual.rede.percentual ?? 0)}%`} />}
          <Item rotulo="Comparado" valor={temBaseRede && redeComp ? moeda.format(redeComp.valor) : comparacao ? "Sem dados" : "…"} />
          {temPct && <Item rotulo={`${rotuloPercentual} comparado`} valor={temBaseRede && redeComp ? `${pct.format(redeComp.percentual ?? 0)}%` : "—"} />}
          <Item rotulo="Variação R$" valor={temBaseRede && redeComp ? variacaoRs(atual.rede.valor, redeComp.valor) : "—"} />
          {temPct && <Item rotulo="Variação p.p." valor={temBaseRede && redeComp ? <VariacaoPp atual={atual.rede.percentual ?? 0} anterior={redeComp.percentual ?? 0} interpretar /> : "—"} />}
          <Item rotulo="Situação" valor={<Situacao atual={atual.rede.grandeza} anterior={redeComp?.grandeza ?? 0} temBase={temBaseRede} />} />
        </div>
      )}
      {notaCobertura && <p className="mb-3 text-[11px] text-foreground/50">⚠️ {notaCobertura}</p>}

      <div className="-mx-5 overflow-x-auto sm:-mx-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
              <th className="px-5 py-2.5 sm:px-6">Loja</th>
              {colunasExtras?.map((c) => (
                <th key={c.titulo} className="px-3 py-2.5">
                  {c.titulo}
                </th>
              ))}
              <th className="px-3 py-2.5">{rotuloValor}</th>
              {temPct && <th className="px-3 py-2.5">{rotuloPercentual}</th>}
              <th className="px-3 py-2.5">Comparado</th>
              {temPct && <th className="px-3 py-2.5">% comp.</th>}
              <th className="px-3 py-2.5">Variação R$</th>
              {temPct && <th className="px-3 py-2.5">Variação p.p.</th>}
              <th className="px-3 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {lojas.length === 0 ? (
              <tr>
                <td colSpan={nCols} className="px-5 py-6 text-center text-sm text-foreground/45 sm:px-6">
                  Sem dados no período selecionado.
                </td>
              </tr>
            ) : (
              lojas.map((l) => {
                const aberta = abertas.has(l.unidade);
                const c = comparadas?.get(l.unidade) ?? null;
                const temBase = temBaseRede && !!c;
                const negativo = l.valor < 0;
                return (
                  <Fragment key={l.unidade}>
                    <tr onClick={() => alternar(l.unidade)} className="cursor-pointer border-b border-ragga-blue/5 hover:bg-ragga-blue/[0.04]">
                      <td className="px-5 py-3 font-semibold text-ragga-blue-dark sm:px-6">
                        <span className="mr-1.5 inline-block w-3 text-ragga-blue/45">{aberta ? "▾" : "▸"}</span>
                        {l.unidade}
                      </td>
                      {colunasExtras?.map((x) => (
                        <td key={x.titulo} className="px-3 py-3 text-foreground/80">
                          {x.celula(l)}
                        </td>
                      ))}
                      <td className={`px-3 py-3 font-semibold ${negativo ? "text-semaforo-vermelho" : "text-ragga-blue-dark"}`}>{moeda.format(l.valor)}</td>
                      {temPct && <td className="px-3 py-3 font-semibold text-ragga-blue-dark">{pct.format(l.percentual ?? 0)}%</td>}
                      <td className="px-3 py-3 text-foreground/70">{temBase && c ? moeda.format(c.valor) : comparacao ? "Sem dados" : "…"}</td>
                      {temPct && <td className="px-3 py-3 text-foreground/70">{temBase && c ? `${pct.format(c.percentual ?? 0)}%` : "—"}</td>}
                      <td className="px-3 py-3 text-foreground/70">{temBase && c ? variacaoRs(l.valor, c.valor) : "—"}</td>
                      {temPct && <td className="px-3 py-3">{temBase && c ? <VariacaoPp atual={l.percentual ?? 0} anterior={c.percentual ?? 0} interpretar /> : "—"}</td>}
                      <td className="px-3 py-3">
                        <Situacao atual={l.grandeza} anterior={c?.grandeza ?? 0} temBase={temBase && situacaoLoja(l, c) !== "sem-base"} />
                      </td>
                    </tr>
                    {aberta && (
                      <tr>
                        <td colSpan={nCols} className="bg-ragga-bg/60 px-5 py-4 sm:px-6">
                          {renderDetalhe(l, c, temBase, periodoCompTxt)}
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
      <p className="mt-2 text-[11px] text-foreground/40">{notaStatus}</p>
    </Secao>
  );
}
