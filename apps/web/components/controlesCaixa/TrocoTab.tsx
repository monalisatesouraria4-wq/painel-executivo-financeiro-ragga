"use client";

import { useMemo } from "react";
import type { CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Item, Situacao, moeda as moedaPainel, pct as pctPainel } from "@/components/ui/PainelAnalitico";
import { PainelLojasComparativo, useComparacaoPeriodo, formatadorDiaPainel } from "./PainelLojasComparativo";
import { semanaRealDoPeriodo } from "@/lib/rules/datas";
import { buscarTrocoIntervalo } from "@/lib/actions/buscarTrocoIntervalo";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";
import { agregarTroco, recortarLojaPainel, redeTroco, type DetalheTroco, type MetricaLoja } from "@/lib/services/controlesLojaPainel";

/**
 * Sub-aba Troco (`renderTroco`, linha 3537 do legado). Conferência
 * semanal, resolvida por `semanaRealDoPeriodo` (reaproveitada tal como
 * já validada — nenhuma regra nova). Status por linha (`statusTroco`,
 * linha 3477, já existente): sem registro → "Conferência não
 * realizada" (âmbar, hoje nunca produzida pelo service — mantido só
 * para não remover um estado já previsto); diferenca===0 → "Conferido"
 * (verde); senão → "Divergência" (vermelho). Nenhum novo limiar/regra de
 * divergência foi criado aqui — a classificação continua vindo de
 * `diferenca === 0`, calculada em lib/services/controlesCaixa.ts.
 *
 * Chave mantida exatamente como já validada e documentada:
 * unidade_id + data + caixa — não alterada aqui.
 */
const TOM_POR_STATUS: Record<string, "ok" | "warn" | "alert"> = {
  "Conferido": "ok",
  "Divergência": "alert",
  "Conferência não realizada": "warn",
};

const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// timeZone: "UTC" — datas desta base são "puras" (meia-noite UTC, sem
// hora real, ver parseDataCelula); sem fixar o fuso, o navegador pode
// exibir o dia anterior dependendo do fuso local do cliente (mesmo
// padrão já aplicado em ConferenciaTab.tsx).
const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

export function TrocoTab({
  dados,
  unidade,
  janela,
  lojaFiltro,
}: {
  dados: ControlesCaixaData["troco"];
  unidade?: CodigoUnidade;
  /** Período SELECIONADO (data de referência: início = fim; ou intervalo escolhido). A aba o expande para semanas reais. */
  janela: { inicio: Date; fim: Date };
  lojaFiltro?: CodigoUnidade;
}) {
  const linhas = unidade ? dados.linhas.filter((l) => l.unidade === unidade) : dados.linhas;
  const disponivel = unidade ? linhas.length > 0 : dados.disponivel;

  // Período EFETIVO do Troco = semanas reais (seg–dom) que contêm as duas pontas — regra já existente da aba. O
  // comparado é o equivalente anterior desse período efetivo (mesmo nº de semanas); a consulta usa a mesma função
  // da aba, que reaplica a mesma expansão para semanas reais.
  const inicioEfetivoMs = semanaRealDoPeriodo(janela.inicio).inicio.getTime();
  const fimEfetivoMs = semanaRealDoPeriodo(janela.fim).fim.getTime();
  const janelaEfetiva = useMemo(() => ({ inicio: new Date(inicioEfetivoMs), fim: new Date(fimEfetivoMs) }), [inicioEfetivoMs, fimEfetivoMs]);
  const comp = useComparacaoPeriodo(janelaEfetiva, (ini, fim) => buscarTrocoIntervalo(ini, fim));
  const atualPainel = useMemo(() => recortarLojaPainel(agregarTroco(linhas), lojaFiltro, redeTroco), [linhas, lojaFiltro]);
  const comparadoPainel = useMemo(
    () => (comp.dados ? recortarLojaPainel(agregarTroco(comp.dados.linhas), lojaFiltro, redeTroco) : null),
    [comp.dados, lojaFiltro]
  );

  const todasCaixas = useMemo(() => linhas.flatMap((l) => l.caixas), [linhas]);
  const conferidos = todasCaixas.filter((c) => c.status === "Conferido").length;
  const comDivergencia = todasCaixas.filter((c) => c.status === "Divergência").length;
  const valorTotalDivergencias = todasCaixas
    .filter((c) => c.status === "Divergência")
    .reduce((s, c) => s + Math.abs(c.diferenca), 0);
  const percentualDivergencia = todasCaixas.length > 0 ? (comDivergencia / todasCaixas.length) * 100 : 0;

  const periodo =
    todasCaixas.length > 0
      ? (() => {
          const datas = todasCaixas.map((c) => c.data.getTime());
          return { inicio: new Date(Math.min(...datas)), fim: new Date(Math.max(...datas)) };
        })()
      : null;

  return (
    <div className="space-y-4">
      {periodo && (
        <p className="text-xs text-foreground/50">
          {periodo.inicio.getTime() === periodo.fim.getTime()
            ? `Data do registro: ${formatadorData.format(periodo.inicio)}`
            : `Semana com dado: ${formatadorData.format(periodo.inicio)} a ${formatadorData.format(periodo.fim)}`}
        </p>
      )}

      {!disponivel ? (
        <p className="text-sm text-foreground/50">Sem dados para o período</p>
      ) : (
        <>
          {/* Resumo */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Caixas conferidos</p>
              <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">{conferidos}</p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Caixas com divergência</p>
              <p className="mt-1 text-2xl font-semibold text-semaforo-vermelho">{comDivergencia}</p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Valor total das divergências</p>
              <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">{formatadorMoeda.format(valorTotalDivergencias)}</p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">% de caixas com divergência</p>
              <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">{formatadorPercentual.format(percentualDivergencia)}%</p>
            </Card>
          </div>

          {/* Tabela principal por loja (REDE → LOJA → caixas) com comparativo */}
          <PainelLojasComparativo<DetalheTroco>
            titulo="🏪 Troco por loja"
            rotuloValor="Valor da divergência"
            rotuloPercentual="% caixas c/ divergência"
            periodoAtualTxt={`${formatadorDiaPainel.format(janelaEfetiva.inicio)} a ${formatadorDiaPainel.format(janelaEfetiva.fim)} (semanas reais)`}
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
              { id: "percentual", rotulo: "Porcentagem" },
              { id: "loja", rotulo: "Loja" },
              { id: "performance", rotulo: "Performance / Status" },
            ]}
            ordemInicial="valor"
            sentidoValor="magnitude"
            colunasExtras={[
              { titulo: "Qtd. caixas", celula: (l) => l.quantidade },
              { titulo: "Com divergência", celula: (l) => l.detalhe.comDivergencia },
            ]}
            notaStatus="Valor da divergência = soma de |diferença| dos caixas em Divergência (diferença ≠ 0, regra existente). % = caixas com divergência ÷ caixas da loja. Status = situação do % contra o período comparado (menor = 🟢 melhorou · maior = 🔴 piorou). Não há meta/limite de Troco cadastrado."
            renderDetalhe={(loja, c, temBase, periodoComp) => <DetalheTrocoLoja loja={loja} comparada={c} temBase={temBase} periodoComp={periodoComp} />}
          />
        </>
      )}
    </div>
  );
}

/** Expansão da loja: resumo comparado + os caixas já exibidos pela aba (Σ divergências = valor da loja). */
function DetalheTrocoLoja({
  loja,
  comparada,
  temBase,
  periodoComp,
}: {
  loja: MetricaLoja<DetalheTroco>;
  comparada: MetricaLoja<unknown> | null;
  temBase: boolean;
  periodoComp: string;
}) {
  const caixas = loja.detalhe.caixas;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-6">
        <Item rotulo="Valor da divergência" valor={moedaPainel.format(loja.valor)} />
        <Item rotulo="% caixas c/ divergência" valor={`${pctPainel.format(loja.percentual ?? 0)}%`} />
        <Item rotulo="Caixas" valor={`${loja.detalhe.comDivergencia} de ${loja.quantidade} com divergência`} />
        <Item rotulo="Comparado" valor={temBase && comparada ? `${moedaPainel.format(comparada.valor)} (${pctPainel.format(comparada.percentual ?? 0)}%)` : "Sem dados"} />
        <Item rotulo="Período comparado" valor={periodoComp} />
        <Item rotulo="Situação" valor={<Situacao atual={loja.grandeza} anterior={comparada?.grandeza ?? 0} temBase={temBase} />} />
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left uppercase tracking-wide text-foreground/50">
            <th className="px-2 py-1">Caixa</th>
            <th className="px-2 py-1">Data</th>
            <th className="px-2 py-1">Conferido</th>
            <th className="px-2 py-1">Informado</th>
            <th className="px-2 py-1">Diferença</th>
            <th className="px-2 py-1">Status</th>
            <th className="px-2 py-1">Operador</th>
            <th className="px-2 py-1">Plano de ação</th>
          </tr>
        </thead>
        <tbody>
          {caixas.map((caixa, i) => (
            <tr key={`${loja.unidade}-${caixa.caixa}-${i}`} className={caixa.status === "Divergência" ? "bg-semaforo-vermelho/10" : "border-b border-ragga-blue/5 last:border-0"}>
              <td className="px-2 py-1.5 font-medium">{caixa.caixa}</td>
              <td className="px-2 py-1.5">{formatadorData.format(caixa.data)}</td>
              <td className="px-2 py-1.5">{formatadorMoeda.format(caixa.conferido)}</td>
              <td className="px-2 py-1.5">{formatadorMoeda.format(caixa.informado)}</td>
              <td className={`px-2 py-1.5 ${caixa.status === "Divergência" ? "font-semibold text-semaforo-vermelho" : ""}`}>{formatadorMoeda.format(caixa.diferenca)}</td>
              <td className="px-2 py-1.5">
                <StatusBadge tom={TOM_POR_STATUS[caixa.status]} texto={caixa.status} />
              </td>
              <td className="px-2 py-1.5">{caixa.operador ?? "—"}</td>
              <td className="px-2 py-1.5">{caixa.planoDeAcao ?? "—"}</td>
            </tr>
          ))}
          <tr className="border-t border-ragga-blue/15 font-semibold text-ragga-blue-dark">
            <td className="px-2 py-1.5" colSpan={4}>
              Divergência líquida (com sinal) · valor da divergência (Σ |dif|) = {formatadorMoeda.format(loja.valor)}
            </td>
            <td className="px-2 py-1.5">{formatadorMoeda.format(loja.detalhe.diferencaLiquida)}</td>
            <td colSpan={3} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
