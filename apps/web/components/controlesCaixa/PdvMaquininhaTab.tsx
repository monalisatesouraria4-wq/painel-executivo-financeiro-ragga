"use client";

import { useEffect, useMemo, useState } from "react";
import type { CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Item, Secao, Situacao, moeda as moedaPainel, pct as pctPainel, sinalMoeda } from "@/components/ui/PainelAnalitico";
import { PainelLojasComparativo, useComparacaoPeriodo, formatadorDiaPainel } from "./PainelLojasComparativo";
import { dataDMenos2 } from "@/lib/rules/datas";
import { buscarPdvMaquininhaIntervalo } from "@/lib/actions/buscarPdvMaquininhaIntervalo";
import { buscarPdvPorForma } from "@/lib/actions/buscarPdvPorForma";
import { montarPdvGerencial, type LojaDivergenciaPdv, type SentidoDivergencia } from "@/lib/services/pdvGerencial";
import { periodoAnteriorMesmaDuracao } from "@/lib/services/retiradaDepositoGerencial";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";
import {
  agregarPdv,
  pdvPorForma,
  percentualDivergenciaPdv,
  recortarLojaPainel,
  redePdv,
  type DetalhePdv,
  type MetricaLoja,
  type PdvFormaBruta,
  type PdvFormaLinha,
} from "@/lib/services/controlesLojaPainel";

/**
 * Sub-aba PDV × Maquininha (`renderPdvMaquininha`, linha 2668 do legado).
 * KPIs: Total PDV, Total Maquininha, Diferença. Threshold de "diferença
 * zero" confirmado no legado: Math.abs(diferenca) > 0.005 ? warn : ok
 * (linha 2697) — tolerância de ponto flutuante, não faixa de negócio.
 *
 * Filtro de Loja + Período (item 2 da etapa de revisão) agora vive no
 * componente pai (`ControlesCaixaTabs`, filtro único compartilhado) —
 * em modo "Data de referência" o filtro de loja é aplicado aqui,
 * client-side, sobre `linhas` (recalculando os totais de rede a partir
 * do subconjunto); em modo "Período" o filtro já vem aplicado do
 * servidor e `unidade` chega como `undefined`.
 *
 * Camada gerencial acima da tabela (ranking por divergência, pontos de atenção e comparação da divergência da rede
 * com o período anterior de MESMA duração, terminando na véspera do início) — `lib/services/pdvGerencial.ts`; usa
 * as mesmas linhas da aba e a mesma regra D-2 nas duas pontas do período anterior. Nada financeiro foi alterado.
 *
 * Tabela principal POR LOJA com comparativo (REDE → LOJA → forma de pagamento): a regra de data D-2 é aplicada às
 * DUAS pontas de cada período (atual e comparado), exatamente como a aba já fazia; o período comparado é o
 * equivalente anterior do período selecionado. Não há % válido nem classificação por cor para PDV na base de regras
 * (a coluna "% sobre faturamento" foi removida de propósito) — nada disso foi criado.
 */
const TOLERANCIA_DIFERENCA_ZERO = 0.005;
const pctFormatado = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "-" : ""}${pctPainel.format(Math.abs(v))}%`);

function SentidoBadge({ sentido }: { sentido: SentidoDivergencia }) {
  if (sentido === "falta") return <span className="whitespace-nowrap text-xs font-semibold text-semaforo-vermelho">▼ Negativa (maquininha abaixo do PDV)</span>;
  if (sentido === "sobra") return <span className="whitespace-nowrap text-xs font-semibold text-semaforo-amarelo">▲ Positiva (maquininha acima do PDV)</span>;
  return <span className="whitespace-nowrap text-xs font-semibold text-foreground/45">= Sem diferença</span>;
}

function corDiferenca(l: Pick<LojaDivergenciaPdv, "sentido">) {
  return l.sentido === "falta" ? "text-semaforo-vermelho" : l.sentido === "sobra" ? "text-semaforo-amarelo" : "text-foreground/70";
}
const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

export function PdvMaquininhaTab({
  dados,
  dataReferencia,
  unidade,
  janela,
  lojaFiltro,
}: {
  dados: ControlesCaixaData["pdvMaquininha"];
  dataReferencia: Date;
  unidade?: CodigoUnidade;
  /** Período SELECIONADO (antes do D-2): data de referência (início = fim) ou intervalo escolhido. */
  janela: { inicio: Date; fim: Date };
  lojaFiltro?: CodigoUnidade;
}) {
  const linhas = unidade ? dados.linhas.filter((l) => l.unidade === unidade) : dados.linhas;
  const disponivel = unidade ? linhas.length > 0 : dados.disponivel;
  const totalPdvRede = unidade ? linhas.reduce((s, l) => s + l.totalPdv, 0) : (dados.totalPdvRede ?? 0);
  const totalMaquininhaRede = unidade ? linhas.reduce((s, l) => s + l.totalMaquininha, 0) : (dados.totalMaquininhaRede ?? 0);
  const diferencaRede = unidade ? linhas.reduce((s, l) => s + l.diferenca, 0) : (dados.diferencaRede ?? 0);
  const statusRede = disponivel ? Math.abs(diferencaRede) > TOLERANCIA_DIFERENCA_ZERO : null;
  // % de divergência = (Diferença ÷ Total PDV) × 100, com o MESMO sinal da Diferença exibida (Maquininha − PDV):
  // negativo = a maquininha ficou abaixo do PDV. Sem Total PDV (zero/indisponível) não há percentual válido.
  const percentualDivergencia = disponivel ? percentualDivergenciaPdv(diferencaRede, totalPdvRede) : null;
  const textoPercentualDivergencia =
    percentualDivergencia === null
      ? "—"
      : `${percentualDivergencia > 0 ? "+" : percentualDivergencia < 0 ? "-" : ""}${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(percentualDivergencia))}%`;

  // Período efetivo dos dados (D-2 nas duas pontas) — mesmo deslocamento da consulta da aba.
  const efetivoInicioMs = dataDMenos2(janela.inicio).getTime();
  const efetivoFimMs = dataDMenos2(janela.fim).getTime();
  const chaveEfetiva = `${efetivoInicioMs}|${efetivoFimMs}`;
  const [formasCarregadas, setFormasCarregadas] = useState<{ chave: string; dados: PdvFormaBruta[] } | null>(null);
  useEffect(() => {
    let vivo = true;
    buscarPdvPorForma(new Date(efetivoInicioMs), new Date(efetivoFimMs)).then((r) => {
      if (vivo) setFormasCarregadas({ chave: chaveEfetiva, dados: r });
    });
    return () => {
      vivo = false;
    };
  }, [efetivoInicioMs, efetivoFimMs, chaveEfetiva]);
  // Resultado de um período antigo nunca é mostrado para o período atual (evita misturar detalhe de outra janela).
  const formasAtual = formasCarregadas && formasCarregadas.chave === chaveEfetiva ? formasCarregadas.dados : null;

  const comp = useComparacaoPeriodo(janela, async (ini, fim) => {
    const [pdv, formas] = await Promise.all([
      buscarPdvMaquininhaIntervalo(dataDMenos2(ini), dataDMenos2(fim)),
      buscarPdvPorForma(dataDMenos2(ini), dataDMenos2(fim)),
    ]);
    return { pdv, formas };
  });

  // Período anterior de MESMA duração, terminando na véspera do início (a regra D-2 é aplicada às duas pontas, como na aba).
  const inicioSelMs = janela.inicio.getTime();
  const fimSelMs = janela.fim.getTime();
  const chaveGerencial = `${inicioSelMs}|${fimSelMs}|${lojaFiltro ?? "TODAS"}`;
  const periodoAnterior = useMemo(() => periodoAnteriorMesmaDuracao(new Date(inicioSelMs), new Date(fimSelMs)), [inicioSelMs, fimSelMs]);
  const [anteriorGerencial, setAnteriorGerencial] = useState<{ chave: string; dados: ControlesCaixaData["pdvMaquininha"] } | null>(null);
  useEffect(() => {
    let vivo = true;
    buscarPdvMaquininhaIntervalo(dataDMenos2(periodoAnterior.inicio), dataDMenos2(periodoAnterior.fim), lojaFiltro).then((r) => {
      if (vivo) setAnteriorGerencial({ chave: chaveGerencial, dados: r });
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodoAnterior, lojaFiltro]);
  const linhasAtualGerencial = useMemo(() => (lojaFiltro ? linhas.filter((l) => l.unidade === lojaFiltro) : linhas), [linhas, lojaFiltro]);
  const gerencial = useMemo(
    () =>
      anteriorGerencial && anteriorGerencial.chave === chaveGerencial
        ? montarPdvGerencial(linhasAtualGerencial, anteriorGerencial.dados.linhas)
        : null,
    [linhasAtualGerencial, anteriorGerencial, chaveGerencial]
  );
  const periodoAnteriorTxt = `${formatadorDiaPainel.format(periodoAnterior.inicio)} a ${formatadorDiaPainel.format(periodoAnterior.fim)}`;

  const atualPainel = useMemo(() => recortarLojaPainel(agregarPdv(linhas), lojaFiltro, redePdv), [linhas, lojaFiltro]);
  const comparadoPainel = useMemo(
    () => (comp.dados ? recortarLojaPainel(agregarPdv(comp.dados.pdv.linhas), lojaFiltro, redePdv) : null),
    [comp.dados, lojaFiltro]
  );
  const periodoAtualTxt = `${janela.inicio.getTime() === janela.fim.getTime() ? formatadorDiaPainel.format(janela.inicio) : `${formatadorDiaPainel.format(janela.inicio)} a ${formatadorDiaPainel.format(janela.fim)}`} (dados D-2)`;

  return (
    <div className="space-y-4">
      <p className="text-xs text-foreground/50">Consulta padrão (D-2): {formatadorData.format(dataReferencia)}.</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Total PDV</p>
          <p className={`mt-1 text-2xl font-semibold ${disponivel ? "text-ragga-blue-dark" : "text-foreground/30"}`}>
            {disponivel ? formatadorMoeda.format(totalPdvRede) : "—"}
          </p>
          {!disponivel && <p className="mt-2 text-xs text-foreground/50">Sem dados para o período</p>}
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Total Maquininha</p>
          <p className={`mt-1 text-2xl font-semibold ${disponivel ? "text-ragga-blue-dark" : "text-foreground/30"}`}>
            {disponivel ? formatadorMoeda.format(totalMaquininhaRede) : "—"}
          </p>
          {!disponivel && <p className="mt-2 text-xs text-foreground/50">Sem dados para o período</p>}
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Diferença</p>
          <p className={`mt-1 text-2xl font-semibold ${disponivel ? "text-ragga-blue-dark" : "text-foreground/30"}`}>
            {disponivel ? formatadorMoeda.format(diferencaRede) : "—"}
          </p>
          <div className="mt-2">
            {statusRede !== null ? (
              <StatusBadge tom={statusRede ? "warn" : "ok"} texto={statusRede ? "Divergente" : "Ok"} />
            ) : (
              <p className="text-xs text-foreground/50">Sem dados para o período</p>
            )}
          </div>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">% de divergência</p>
          <p className={`mt-1 text-2xl font-semibold ${percentualDivergencia !== null ? "text-ragga-blue-dark" : "text-foreground/30"}`}>{textoPercentualDivergencia}</p>
          <p className="mt-2 text-xs text-foreground/50">{percentualDivergencia !== null ? "Diferença ÷ Total PDV" : "Sem dados para o período"}</p>
        </Card>
      </div>

      {/* Camada gerencial: ranking por divergência, pontos de atenção e comparação com o período anterior */}
      {gerencial === null ? (
        <p className="text-sm text-foreground/50">Carregando o comparativo do período…</p>
      ) : (
        <>
          <Secao titulo="Ranking de lojas por divergência">
            {gerencial.lojas.length === 0 ? (
              <p className="text-sm text-foreground/45">Sem movimentação de PDV × Maquininha no período selecionado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                      <th className="py-2 pr-4">Ranking</th>
                      <th className="px-3 py-2">Loja</th>
                      <th className="px-3 py-2">Total PDV</th>
                      <th className="px-3 py-2">Total Maquininha</th>
                      <th className="px-3 py-2">Diferença</th>
                      <th className="px-3 py-2">% Divergência</th>
                      <th className="px-3 py-2">Sentido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gerencial.lojas.map((l, i) => (
                      <tr key={l.unidade} className="border-b border-ragga-blue/5">
                        <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">{i + 1}º</td>
                        <td className="px-3 font-medium text-ragga-blue-dark">{l.unidade}</td>
                        <td className="px-3">{formatadorMoeda.format(l.totalPdv)}</td>
                        <td className="px-3">{formatadorMoeda.format(l.totalMaquininha)}</td>
                        <td className={`px-3 font-semibold ${corDiferenca(l)}`}>{formatadorMoeda.format(l.diferenca)}</td>
                        <td className={`px-3 font-semibold ${corDiferenca(l)}`}>{pctFormatado(l.percentual)}</td>
                        <td className="px-3">
                          <SentidoBadge sentido={l.sentido} />
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
                      <td className="py-2.5 pr-4" colSpan={2}>REDE</td>
                      <td className="px-3">{formatadorMoeda.format(gerencial.rede.totalPdv)}</td>
                      <td className="px-3">{formatadorMoeda.format(gerencial.rede.totalMaquininha)}</td>
                      <td className="px-3">{formatadorMoeda.format(gerencial.rede.diferenca)}</td>
                      <td className="px-3">{pctFormatado(gerencial.rede.percentual)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[11px] text-foreground/40">
              Diferença = Maquininha − PDV (com sinal). Ordenado pela gravidade: maior divergência em valor absoluto primeiro (empate: maior % em módulo). Lojas sem movimentação não entram.
            </p>
          </Secao>

          <Secao titulo="Principais pontos de atenção">
            {gerencial.pontosDeAtencao.length === 0 ? (
              <p className="text-sm text-foreground/45">Nenhuma loja com divergência no período.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                {gerencial.pontosDeAtencao.map((l, i) => (
                  <li key={l.unidade} className="rounded-lg border border-semaforo-vermelho/20 bg-semaforo-vermelho/5 px-3 py-2">
                    <p className="text-xs text-foreground/50">{i + 1}ª maior divergência</p>
                    <p className="text-base font-bold text-ragga-blue-dark">{l.unidade}</p>
                    <p className={`text-sm font-semibold tabular-nums ${corDiferenca(l)}`}>{formatadorMoeda.format(l.diferenca)}</p>
                    <p className="text-xs text-foreground/60">{pctFormatado(l.percentual)} do PDV</p>
                    <SentidoBadge sentido={l.sentido} />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-foreground/40">Maiores divergências em valor absoluto (|diferença| acima de R$ 0,005, a tolerância já usada na aba), mantendo o sinal exibido.</p>
          </Secao>

          <Secao titulo="Comparação da divergência da rede com o período anterior">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Item rotulo="Divergência atual" valor={`${formatadorMoeda.format(gerencial.comparacao.atual.diferenca)} (${pctFormatado(gerencial.comparacao.atual.percentual)})`} />
              <Item
                rotulo="Divergência no período anterior"
                valor={
                  gerencial.comparacao.anterior
                    ? `${formatadorMoeda.format(gerencial.comparacao.anterior.diferenca)} (${pctFormatado(gerencial.comparacao.anterior.percentual)})`
                    : "Sem base anterior"
                }
              />
              <Item
                rotulo="Variação em R$ (divergência em módulo)"
                valor={gerencial.comparacao.variacaoReais === null ? "—" : `${gerencial.comparacao.variacaoReais > 0 ? "+" : gerencial.comparacao.variacaoReais < 0 ? "-" : ""}${formatadorMoeda.format(Math.abs(gerencial.comparacao.variacaoReais))}`}
              />
              <Item
                rotulo="Variação %"
                valor={
                  !gerencial.comparacao.temBase
                    ? "Sem base anterior"
                    : gerencial.comparacao.variacaoPercentual === null
                      ? "— (anterior sem divergência)"
                      : pctFormatado(gerencial.comparacao.variacaoPercentual)
                }
              />
            </div>
            <p className="mt-2 text-[11px] text-foreground/40">
              Período atual: {periodoAtualTxt} · Período anterior (mesma duração, termina na véspera do início; regra D-2 aplicada): {periodoAnteriorTxt}. Variação positiva = a divergência (em módulo) aumentou; negativa = diminuiu.
              {gerencial.comparacao.variacaoPp !== null ? ` Variação do % de divergência: ${gerencial.comparacao.variacaoPp > 0 ? "+" : gerencial.comparacao.variacaoPp < 0 ? "-" : ""}${pctPainel.format(Math.abs(gerencial.comparacao.variacaoPp))} p.p. (em módulo).` : ""}
            </p>
          </Secao>
        </>
      )}

      <PainelLojasComparativo<DetalhePdv>
        titulo="🏪 PDV × Maquininha por loja"
        rotuloValor="Diferença"
        periodoAtualTxt={periodoAtualTxt}
        compInicio={comp.compInicio}
        compFim={comp.compFim}
        compManual={comp.compManual}
        setCompManual={comp.setCompManual}
        carregando={comp.pendente}
        atual={atualPainel}
        comparacao={comparadoPainel}
        lojaFiltro={lojaFiltro}
        opcoesOrdem={[
          { id: "valor", rotulo: "Valor (maior divergência primeiro)" },
          { id: "diferenca", rotulo: "Diferença (mais negativa primeiro)" },
          { id: "loja", rotulo: "Loja" },
          { id: "performance", rotulo: "Performance / Status" },
        ]}
        ordemInicial="valor"
        sentidoValor="magnitude"
        colunasExtras={[
          { titulo: "PDV", celula: (l) => formatadorMoeda.format(l.detalhe.totalPdv) },
          { titulo: "Maquininha", celula: (l) => formatadorMoeda.format(l.detalhe.totalMaquininha) },
          {
            titulo: "Divergência",
            celula: (l) => {
              const diverge = Math.abs(l.valor) > TOLERANCIA_DIFERENCA_ZERO;
              return <StatusBadge tom={diverge ? "warn" : "ok"} texto={diverge ? "Divergente" : "Ok"} />;
            },
          },
        ]}
        notaStatus="Diferença = Maquininha − PDV (com sinal). Divergente = |diferença| > R$ 0,005 (regra já existente da aba). Status = distância até zero contra o período comparado (menor = 🟢 melhorou · maior = 🔴 piorou). Não há % válido nem limites por cor para PDV — nenhum foi criado."
        renderDetalhe={(loja, c, temBase, periodoComp) => (
          <DetalhePdvLoja
            loja={loja}
            comparada={c}
            temBase={temBase}
            periodoComp={periodoComp}
            formasAtual={formasAtual}
            formasComparado={comp.dados?.formas ?? null}
          />
        )}
      />
    </div>
  );
}

/** Expansão da loja: PDV × Maquininha por forma de pagamento, atual × comparado (Σ formas = diferença da loja). */
function DetalhePdvLoja({
  loja,
  comparada,
  temBase,
  periodoComp,
  formasAtual,
  formasComparado,
}: {
  loja: MetricaLoja<DetalhePdv>;
  comparada: MetricaLoja<unknown> | null;
  temBase: boolean;
  periodoComp: string;
  formasAtual: PdvFormaBruta[] | null;
  formasComparado: PdvFormaBruta[] | null;
}) {
  const atual = formasAtual ? pdvPorForma(formasAtual, loja.unidade) : null;
  const comp = formasComparado ? pdvPorForma(formasComparado, loja.unidade) : null;
  const mapa = new Map<string, { a?: PdvFormaLinha; c?: PdvFormaLinha }>();
  for (const f of atual ?? []) mapa.set(f.forma, { a: f });
  for (const f of comp ?? []) mapa.set(f.forma, { ...mapa.get(f.forma), c: f });
  const linhas = [...mapa.entries()]
    .map(([forma, v]) => ({ forma, ...v }))
    .sort((x, y) => Math.abs(y.a?.diferenca ?? 0) - Math.abs(x.a?.diferenca ?? 0) || x.forma.localeCompare(y.forma));
  const totA = (atual ?? []).reduce((s, f) => s + f.diferenca, 0);
  const totC = (comp ?? []).reduce((s, f) => s + f.diferenca, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-6">
        <Item rotulo="PDV" valor={moedaPainel.format(loja.detalhe.totalPdv)} />
        <Item rotulo="Maquininha" valor={moedaPainel.format(loja.detalhe.totalMaquininha)} />
        <Item rotulo="Diferença" valor={moedaPainel.format(loja.valor)} />
        <Item rotulo="Comparado" valor={temBase && comparada ? moedaPainel.format(comparada.valor) : "Sem dados"} />
        <Item rotulo="Período comparado" valor={periodoComp} />
        <Item rotulo="Situação" valor={<Situacao atual={loja.grandeza} anterior={comparada?.grandeza ?? 0} temBase={temBase} />} />
      </div>
      <div>
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Por forma de pagamento</p>
        {!formasAtual ? (
          <p className="text-sm text-foreground/45">Carregando...</p>
        ) : linhas.length === 0 ? (
          <p className="text-sm text-foreground/45">Sem dados no período selecionado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                  <th className="py-1 pr-3">Forma</th>
                  <th className="px-2 py-1">PDV</th>
                  <th className="px-2 py-1">Maquininha</th>
                  <th className="px-2 py-1">Diferença</th>
                  <th className="px-2 py-1">Dif. comparada</th>
                  <th className="px-2 py-1">Variação R$</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((f) => (
                  <tr key={f.forma} className="border-t border-ragga-blue/5">
                    <td className="py-1.5 pr-3 font-medium text-ragga-blue-dark">{f.forma}</td>
                    <td className="px-2">{f.a ? formatadorMoeda.format(f.a.pdv) : "—"}</td>
                    <td className="px-2">{f.a ? formatadorMoeda.format(f.a.maquininha) : "—"}</td>
                    <td className={`px-2 ${(f.a?.diferenca ?? 0) < 0 ? "font-semibold text-semaforo-vermelho" : ""}`}>{f.a ? formatadorMoeda.format(f.a.diferenca) : "—"}</td>
                    <td className="px-2">{temBase ? (f.c ? formatadorMoeda.format(f.c.diferenca) : "Sem dados") : "—"}</td>
                    <td className="px-2">{temBase && f.a && f.c ? sinalMoeda(f.a.diferenca - f.c.diferenca) : "—"}</td>
                  </tr>
                ))}
                <tr className="border-t border-ragga-blue/15 font-semibold text-ragga-blue-dark">
                  <td className="py-1.5 pr-3">Total da loja</td>
                  <td colSpan={2} />
                  <td className="px-2">{formatadorMoeda.format(totA)}</td>
                  <td className="px-2">{temBase ? formatadorMoeda.format(totC) : "—"}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
