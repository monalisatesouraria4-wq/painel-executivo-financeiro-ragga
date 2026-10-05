"use client";

import { useEffect, useMemo, useState } from "react";
import type { CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Item, Situacao, moeda as moedaPainel, sinalMoeda } from "@/components/ui/PainelAnalitico";
import { PainelLojasComparativo, useComparacaoPeriodo, formatadorDiaPainel } from "./PainelLojasComparativo";
import { dataDMenos2 } from "@/lib/rules/datas";
import { buscarPdvMaquininhaIntervalo } from "@/lib/actions/buscarPdvMaquininhaIntervalo";
import { buscarPdvPorForma } from "@/lib/actions/buscarPdvPorForma";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";
import {
  agregarPdv,
  pdvPorForma,
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
 * Tabela principal POR LOJA com comparativo (REDE → LOJA → forma de pagamento): a regra de data D-2 é aplicada às
 * DUAS pontas de cada período (atual e comparado), exatamente como a aba já fazia; o período comparado é o
 * equivalente anterior do período selecionado. Não há % válido nem classificação por cor para PDV na base de regras
 * (a coluna "% sobre faturamento" foi removida de propósito) — nada disso foi criado.
 */
const TOLERANCIA_DIFERENCA_ZERO = 0.005;
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

  const atualPainel = useMemo(() => recortarLojaPainel(agregarPdv(linhas), lojaFiltro, redePdv), [linhas, lojaFiltro]);
  const comparadoPainel = useMemo(
    () => (comp.dados ? recortarLojaPainel(agregarPdv(comp.dados.pdv.linhas), lojaFiltro, redePdv) : null),
    [comp.dados, lojaFiltro]
  );
  const periodoAtualTxt = `${janela.inicio.getTime() === janela.fim.getTime() ? formatadorDiaPainel.format(janela.inicio) : `${formatadorDiaPainel.format(janela.inicio)} a ${formatadorDiaPainel.format(janela.fim)}`} (dados D-2)`;

  return (
    <div className="space-y-4">
      <p className="text-xs text-foreground/50">Consulta padrão (D-2): {formatadorData.format(dataReferencia)}.</p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
      </div>

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
