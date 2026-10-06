"use client";

import { Fragment, useMemo, useRef, useState, useEffect, useTransition } from "react";
import { Secao, Item, VarCelulas, VariacaoPp, moeda, pct } from "@/components/ui/PainelAnalitico";
import { dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { periodoComparacaoPadrao } from "@/lib/rules/mesAnterior";
import type { QuebraDetalheLinha } from "@/lib/services/controlesCaixa";
import {
  agregarQuebra,
  ordenarLojasQuebra,
  recortarLoja,
  situacaoLojaQuebra,
  situacaoQuebraDetalhada,
  type LojaQuebra,
  type SituacaoQuebraDetalhada,
  type MotivoQuebra,
  type OperadorQuebra,
  type OrdemQuebra,
  type PeriodoQuebra,
  type QuebraComparativoDados,
} from "@/lib/services/quebraPainel";
import { buscarQuebraComparativo } from "@/lib/actions/buscarQuebraComparativo";

/**
 * Análise de Quebra de Caixa por LOJA (REDE → LOJA → OPERADOR/MOTIVO), com comparativo de período — substitui o
 * "Consolidado por Operador" como tabela principal. O período ATUAL é exatamente o que a aba já carregou (mesmos
 * dados dos cards e do detalhamento por lançamento → os totais sempre batem); o período COMPARADO segue a lógica
 * dos demais indicadores (mês anterior se o período for um mês completo; senão o período imediatamente anterior de
 * mesma duração) e pode ser trocado. Não existe semáforo/meta de Quebra: o Status é a situação do comparativo
 * (loja/rede pelo % sobre o faturamento; operadores/motivos pelo valor — menor = melhorou).
 */

const formatadorDia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const completa = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 2000;
const diaBR = (isoStr: string) => `${isoStr.slice(8, 10)}/${isoStr.slice(5, 7)}/${isoStr.slice(0, 4)}`;

type OrdemUI = OrdemQuebra;

/** Selo da situação do comparativo de Quebra: Melhorou / Piorou / Estável / Sem ocorrência / Sem base de comparação. */
function SituacaoQuebraBadge({ situacao }: { situacao: SituacaoQuebraDetalhada }) {
  if (situacao === "melhorou") return <span className="whitespace-nowrap text-xs font-semibold text-semaforo-verde">🟢 Melhorou</span>;
  if (situacao === "piorou") return <span className="whitespace-nowrap text-xs font-semibold text-semaforo-vermelho">🔴 Piorou</span>;
  if (situacao === "estavel") return <span className="whitespace-nowrap text-xs font-semibold text-foreground/55">⚪ Estável</span>;
  if (situacao === "sem-ocorrencia") return <span className="whitespace-nowrap text-xs font-semibold text-foreground/45">⚪ Sem ocorrência</span>;
  return <span className="whitespace-nowrap text-xs font-semibold text-foreground/45">⚪ Sem base de comparação</span>;
}

/** Situação por VALOR (operador e motivo): `temBase` = a base cobre o período comparado; ausente no comparado = R$ 0,00. */
function situacaoPorValor(atual: number, comparado: number, temBase: boolean): SituacaoQuebraDetalhada {
  return situacaoQuebraDetalhada({ valorAtual: atual, valorComparado: temBase ? comparado : null, metricaAtual: atual, metricaComparada: temBase ? comparado : null, baseValida: temBase });
}

function chaveOperador(o: { operador: string; cpf: string }) {
  return `${o.cpf}||${o.operador}`;
}

export function QuebraLojasPainel({
  detalhadoAtual,
  janela,
  lojaFiltro,
}: {
  detalhadoAtual: QuebraDetalheLinha[];
  janela: { inicio: Date | null; fim: Date | null };
  /** Loja selecionada no filtro da aba (mostra só ela). */
  lojaFiltro?: string;
}) {
  const [compManual, setCompManual] = useState<{ inicio: string; fim: string } | null>(null);
  const [dados, setDados] = useState<QuebraComparativoDados | null>(null);
  const [ordem, setOrdem] = useState<OrdemUI>("valor");
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [pendente, iniciarTransicao] = useTransition();
  const ultimaRequisicao = useRef(0);

  // Período comparado efetivo: escolhido pelo usuário ou o padrão dos demais indicadores.
  const padrao = useMemo(() => (janela.inicio && janela.fim ? periodoComparacaoPadrao(janela.inicio, janela.fim) : null), [janela.inicio, janela.fim]);
  const compInicio = compManual?.inicio ?? (padrao ? iso(padrao.inicio) : "");
  const compFim = compManual?.fim ?? (padrao ? iso(padrao.fim) : "");
  const janelaInicioIso = janela.inicio ? iso(janela.inicio) : "";
  const janelaFimIso = janela.fim ? iso(janela.fim) : "";

  useEffect(() => {
    if (!janelaInicioIso || !janelaFimIso || !completa(compInicio) || !completa(compFim) || compInicio > compFim) return;
    const req = ++ultimaRequisicao.current;
    iniciarTransicao(async () => {
      const r = await buscarQuebraComparativo(dataDoInput(janelaInicioIso), dataDoInput(janelaFimIso), dataDoInput(compInicio), dataDoInput(compFim));
      if (req === ultimaRequisicao.current) setDados(r);
    });
  }, [janelaInicioIso, janelaFimIso, compInicio, compFim]);

  const atual: PeriodoQuebra = useMemo(
    () =>
      recortarLoja(
        agregarQuebra(
          detalhadoAtual.map((d) => ({ unidade: d.unidade, operador: d.operador, cpf: d.cpf, motivo: d.motivo, valor: d.valor })),
          dados?.faturamentoAtual ?? {}
        ),
        lojaFiltro
      ),
    [detalhadoAtual, dados, lojaFiltro]
  );
  const comparacao: PeriodoQuebra | null = useMemo(
    () => (dados ? recortarLoja(agregarQuebra(dados.comparacao.linhas, dados.comparacao.faturamento), lojaFiltro) : null),
    [dados, lojaFiltro]
  );

  if (!janela.inicio || !janela.fim) {
    return (
      <Secao titulo="Quebra por loja">
        <p className="text-sm text-foreground/45">Sem dados no período.</p>
      </Secao>
    );
  }

  // Base válida: o período comparado tem registros de Quebra OU a base de Quebra o cobre (começa até o fim dele) — nesse
  // caso, ausência de quebra é "sem ocorrência" real, não falta de dado.
  const temBaseRede = !!comparacao && (comparacao.disponivel || (!!dados && dados.quebraDesde !== null && dados.quebraDesde <= compFim));
  const lojasOrdenadas = ordenarLojasQuebra(atual.porLoja, comparacao, ordem, temBaseRede);
  const periodoAtualTxt = `${formatadorDia.format(janela.inicio)} a ${formatadorDia.format(janela.fim)}`;
  const periodoCompTxt = compInicio && compFim ? `${diaBR(compInicio)} a ${diaBR(compFim)}` : "—";
  const quebraDesde = dados?.quebraDesde ?? null;
  const notaCobertura =
    quebraDesde && compInicio && quebraDesde > compInicio
      ? quebraDesde > compFim
        ? `A base de Quebra só tem dados a partir de ${diaBR(quebraDesde)} — não há registros no período comparado.`
        : `A base de Quebra só tem dados a partir de ${diaBR(quebraDesde)} — o período comparado está parcial.`
      : null;

  function alternar(u: string) {
    setAbertas((a) => {
      const n = new Set(a);
      if (n.has(u)) n.delete(u);
      else n.add(u);
      return n;
    });
  }

  const inputCls = "rounded-md border border-ragga-blue/15 bg-white px-3 py-2 text-sm focus:border-ragga-blue focus:outline-none focus:ring-1 focus:ring-ragga-blue/40";

  return (
    <div className="space-y-5">
      <Secao
        titulo="🏪 Quebra de caixa por loja"
        acao={
          <label className="flex items-center gap-2 text-xs font-medium text-ragga-blue-dark">
            Ordenar por
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as OrdemUI)} className="rounded-md border border-ragga-blue/15 bg-white px-2 py-1.5 text-xs">
              <option value="valor">Valor</option>
              <option value="percentual">Porcentagem</option>
              <option value="loja">Loja</option>
              <option value="performance">Performance / Status</option>
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
                <span className="normal-case tracking-normal text-foreground/40">(período anterior sugerido)</span>
              )}
            </p>
            <div className="flex items-center gap-2 text-sm">
              <input type="date" value={compInicio} onChange={(e) => setCompManual({ inicio: e.target.value, fim: compFim })} className={inputCls} />
              <span className="text-foreground/40">até</span>
              <input type="date" value={compFim} onChange={(e) => setCompManual({ inicio: compInicio, fim: e.target.value })} className={inputCls} />
            </div>
          </div>
          {pendente && <span className="pb-2 text-xs text-foreground/50">Carregando comparativo...</span>}
        </div>

        {/* REDE (ou a loja filtrada) */}
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">{lojaFiltro ? `Loja ${lojaFiltro}` : "Rede"}</p>
        {!atual.disponivel ? (
          <p className="mb-4 text-sm text-foreground/45">Sem dados no período.</p>
        ) : (
          <div className="mb-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-7">
            <Item rotulo="Quebra atual" valor={moeda.format(atual.valor)} />
            <Item rotulo="% do faturamento" valor={`${pct.format(atual.percentual)}%`} />
            <Item rotulo="Quebra comparada" valor={temBaseRede && comparacao ? moeda.format(comparacao.valor) : dados ? "Sem dados" : "…"} />
            <Item rotulo="% comparado" valor={temBaseRede && comparacao ? `${pct.format(comparacao.percentual)}%` : "—"} />
            <Item rotulo="Variação R$" valor={temBaseRede && comparacao ? `${atual.valor - comparacao.valor >= 0 ? "+" : "-"}${moeda.format(Math.abs(atual.valor - comparacao.valor))}` : "—"} />
            <Item rotulo="Variação p.p." valor={temBaseRede && comparacao ? <VariacaoPp atual={atual.percentual} anterior={comparacao.percentual} interpretar /> : "—"} />
            <Item
              rotulo="Situação"
              valor={
                <SituacaoQuebraBadge
                  situacao={situacaoQuebraDetalhada({
                    valorAtual: atual.valor,
                    valorComparado: temBaseRede && comparacao ? comparacao.valor : null,
                    metricaAtual: atual.percentual,
                    metricaComparada: temBaseRede && comparacao ? comparacao.percentual : null,
                    baseValida: temBaseRede,
                  })}
                />
              }
            />
          </div>
        )}
        {notaCobertura && <p className="mb-3 text-[11px] text-foreground/50">⚠️ {notaCobertura}</p>}

        <div className="-mx-5 overflow-x-auto sm:-mx-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                <th className="px-5 py-2.5 sm:px-6">Loja</th>
                <th className="px-3 py-2.5">Quebra</th>
                <th className="px-3 py-2.5">% fat.</th>
                <th className="px-3 py-2.5">Comparado</th>
                <th className="px-3 py-2.5">% comp.</th>
                <th className="px-3 py-2.5">Variação R$</th>
                <th className="px-3 py-2.5">Variação p.p.</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {lojasOrdenadas.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-6 text-center text-sm text-foreground/45 sm:px-6">
                    Sem dados no período.
                  </td>
                </tr>
              ) : (
                lojasOrdenadas.map((l) => {
                  const aberta = abertas.has(l.unidade);
                  const c = comparacao?.porLoja.find((x) => x.unidade === l.unidade) ?? null;
                  const temBase = temBaseRede && !!c;
                  const dRs = c ? l.valor - c.valor : 0;
                  return (
                    <Fragment key={l.unidade}>
                      <tr onClick={() => alternar(l.unidade)} className="cursor-pointer border-b border-ragga-blue/5 hover:bg-ragga-blue/[0.04]">
                        <td className="px-5 py-3 font-semibold text-ragga-blue-dark sm:px-6">
                          <span className="mr-1.5 inline-block w-3 text-ragga-blue/45">{aberta ? "▾" : "▸"}</span>
                          {l.unidade}
                        </td>
                        <td className="px-3 py-3 text-foreground/80">{moeda.format(l.valor)}</td>
                        <td className="px-3 py-3 font-semibold text-ragga-blue-dark">{pct.format(l.percentual)}%</td>
                        <td className="px-3 py-3 text-foreground/70">{temBase && c ? moeda.format(c.valor) : dados ? "Sem dados" : "…"}</td>
                        <td className="px-3 py-3 text-foreground/70">{temBase && c ? `${pct.format(c.percentual)}%` : "—"}</td>
                        <td className="px-3 py-3 text-foreground/70">{temBase ? `${dRs >= 0 ? "+" : "-"}${moeda.format(Math.abs(dRs))}` : "—"}</td>
                        <td className="px-3 py-3">{temBase && c ? <VariacaoPp atual={l.percentual} anterior={c.percentual} interpretar /> : "—"}</td>
                        <td className="px-3 py-3">
                          <SituacaoQuebraBadge situacao={situacaoLojaQuebra(l, c, temBaseRede)} />
                        </td>
                      </tr>
                      {aberta && (
                        <tr>
                          <td colSpan={8} className="bg-ragga-bg/60 px-5 py-4 sm:px-6">
                            <DetalheLoja loja={l} compLoja={c} temBase={temBase} periodoAtual={periodoAtualTxt} periodoComp={periodoCompTxt} />
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
        <p className="mt-2 text-[11px] text-foreground/40">
          Status = situação do % de quebra sobre o faturamento contra o período comparado: 🟢 Melhorou (diminuiu) · 🔴 Piorou (aumentou) · ⚪ Estável (igual no arredondamento) · ⚪ Sem ocorrência (nenhuma quebra nos dois períodos) · ⚪ Sem base de comparação. Não há meta/limite de Quebra cadastrado.
        </p>
      </Secao>

      <Secao titulo="📋 Comparação por motivo">
        <TabelaMotivos atual={atual.motivos} comparado={comparacao?.motivos ?? []} temBase={temBaseRede} />
      </Secao>
    </div>
  );
}

function TabelaMotivos({ atual, comparado, temBase }: { atual: MotivoQuebra[]; comparado: MotivoQuebra[]; temBase: boolean }) {
  const mapa = new Map<string, { a?: MotivoQuebra; c?: MotivoQuebra }>();
  for (const m of atual) mapa.set(m.motivo, { a: m });
  for (const m of comparado) mapa.set(m.motivo, { ...mapa.get(m.motivo), c: m });
  const linhas = [...mapa.entries()]
    .map(([motivo, v]) => ({ motivo, ...v }))
    .sort((x, y) => (y.a?.valor ?? 0) - (x.a?.valor ?? 0) || (y.c?.valor ?? 0) - (x.c?.valor ?? 0) || x.motivo.localeCompare(y.motivo));
  const totA = atual.reduce((s, m) => s + m.valor, 0);
  const totC = comparado.reduce((s, m) => s + m.valor, 0);
  if (linhas.length === 0) return <p className="text-sm text-foreground/45">Sem dados no período.</p>;
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
            <th className="px-3 py-2">% do total</th>
            <th className="px-3 py-2">Comparado</th>
            <th className="px-3 py-2">% comparado</th>
            <th className="px-3 py-2">Variação R$</th>
            <th className="px-3 py-2">Variação %</th>
            <th className="px-3 py-2">Situação</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {linhas.map((l) => {
            const va = l.a?.valor ?? 0;
            const vc = l.c?.valor ?? 0;
            return (
              <tr key={l.motivo} className="border-b border-ragga-blue/5">
                <td className="py-2.5 pr-4 font-medium text-ragga-blue-dark">{l.motivo === "" ? <span className="italic text-foreground/50">(motivo em branco)</span> : l.motivo}</td>
                <td className="px-3">{moeda.format(va)}</td>
                <td className="px-3">{pct.format(l.a?.percentualDoTotal ?? 0)}%</td>
                <td className="px-3">{temBase ? moeda.format(vc) : "Sem dados"}</td>
                <td className="px-3">{temBase ? `${pct.format(l.c?.percentualDoTotal ?? 0)}%` : "—"}</td>
                {temBase ? <VarCelulas atual={va} anterior={vc} interpretar /> : semBase}
                <td className="px-3">
                  <SituacaoQuebraBadge situacao={situacaoPorValor(va, vc, temBase)} />
                </td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
            <td className="py-2.5 pr-4">TOTAL</td>
            <td className="px-3">{moeda.format(totA)}</td>
            <td className="px-3">{pct.format(100)}%</td>
            <td className="px-3">{temBase ? moeda.format(totC) : "Sem dados"}</td>
            <td className="px-3">{temBase ? `${pct.format(100)}%` : "—"}</td>
            {temBase ? <VarCelulas atual={totA} anterior={totC} interpretar /> : semBase}
            <td className="px-3">
              <SituacaoQuebraBadge situacao={situacaoPorValor(totA, totC, temBase)} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Expansão da loja: resumo → operadores (quem mais contribuiu) → motivos, sempre atual × comparado. */
function DetalheLoja({
  loja,
  compLoja,
  temBase,
  periodoAtual,
  periodoComp,
}: {
  loja: LojaQuebra;
  compLoja: LojaQuebra | null;
  temBase: boolean;
  periodoAtual: string;
  periodoComp: string;
}) {
  const mapa = new Map<string, { a?: OperadorQuebra; c?: OperadorQuebra }>();
  for (const o of loja.operadores) mapa.set(chaveOperador(o), { a: o });
  for (const o of compLoja?.operadores ?? []) mapa.set(chaveOperador(o), { ...mapa.get(chaveOperador(o)), c: o });
  const operadores = [...mapa.values()]
    .map((v) => ({ ref: (v.a ?? v.c) as OperadorQuebra, ...v }))
    .sort((x, y) => (y.a?.valor ?? 0) - (x.a?.valor ?? 0) || (y.c?.valor ?? 0) - (x.c?.valor ?? 0) || x.ref.operador.localeCompare(y.ref.operador));
  const totOpA = loja.operadores.reduce((s, o) => s + o.valor, 0);
  const totOpC = compLoja?.operadores.reduce((s, o) => s + o.valor, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Resumo da loja</p>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-6">
          <Item rotulo="Faturamento" valor={moeda.format(loja.faturamento)} />
          <Item rotulo="Quebra" valor={moeda.format(loja.valor)} />
          <Item rotulo="% do faturamento" valor={`${pct.format(loja.percentual)}%`} />
          <Item rotulo="Registros" valor={String(loja.quantidade)} />
          <Item rotulo="Comparado" valor={temBase && compLoja ? `${moeda.format(compLoja.valor)} (${pct.format(compLoja.percentual)}%)` : "Sem dados"} />
          <Item rotulo="Período comparado" valor={periodoComp} />
        </div>
        <p className="mt-1 text-[11px] text-foreground/45">Período atual: {periodoAtual}</p>
      </div>

      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Operadores (quem mais contribuiu para a quebra da loja)</p>
        {operadores.length === 0 ? (
          <p className="text-sm text-foreground/45">Sem registros nos períodos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                  <th className="py-1 pr-3">Operador</th>
                  <th className="px-2 py-1">CPF</th>
                  <th className="px-2 py-1">Registros</th>
                  <th className="px-2 py-1">Quebra</th>
                  <th className="px-2 py-1">% da loja</th>
                  <th className="px-2 py-1">Comparado</th>
                  <th className="px-2 py-1">Variação R$</th>
                  <th className="px-2 py-1">Variação %</th>
                  <th className="px-2 py-1">Situação</th>
                </tr>
              </thead>
              <tbody>
                {operadores.map((o) => {
                  const va = o.a?.valor ?? 0;
                  const vc = o.c?.valor ?? 0;
                  return (
                    <tr key={chaveOperador(o.ref)} className="border-t border-ragga-blue/5">
                      <td className="py-1.5 pr-3 font-medium text-ragga-blue-dark">{o.ref.operador}</td>
                      <td className="px-2 text-foreground/50">{o.ref.cpf}</td>
                      <td className="px-2">{o.a?.quantidade ?? 0}</td>
                      <td className="px-2">{moeda.format(va)}</td>
                      <td className="px-2">{pct.format(o.a?.percentualDaLoja ?? 0)}%</td>
                      <td className="px-2">{temBase ? moeda.format(vc) : "Sem dados"}</td>
                      {temBase ? (
                        <VarCelulas atual={va} anterior={vc} interpretar />
                      ) : (
                        <>
                          <td className="px-3">—</td>
                          <td className="px-3">—</td>
                        </>
                      )}
                      <td className="px-2">
                        <SituacaoQuebraBadge situacao={situacaoPorValor(va, vc, temBase)} />
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t border-ragga-blue/15 font-semibold text-ragga-blue-dark">
                  <td className="py-1.5 pr-3">Total dos operadores</td>
                  <td />
                  <td className="px-2">{loja.quantidade}</td>
                  <td className="px-2">{moeda.format(totOpA)}</td>
                  <td className="px-2">{pct.format(100)}%</td>
                  <td className="px-2">{temBase ? moeda.format(totOpC) : "Sem dados"}</td>
                  <td colSpan={2} />
                  <td className="px-2">
                    <SituacaoQuebraBadge situacao={situacaoLojaQuebra(loja, compLoja, temBase)} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Composição por motivo</p>
        <TabelaMotivos atual={loja.motivos} comparado={compLoja?.motivos ?? []} temBase={temBase} />
      </div>
    </div>
  );
}
