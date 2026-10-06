"use client";

import { useMemo } from "react";
import type { CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Item, Secao, Situacao, moeda as moedaPainel, pct as pctPainel } from "@/components/ui/PainelAnalitico";
import { PainelLojasComparativo, useComparacaoPeriodo, formatadorDiaPainel } from "./PainelLojasComparativo";
import { semanaRealDoPeriodo } from "@/lib/rules/datas";
import { buscarTrocoIntervalo } from "@/lib/actions/buscarTrocoIntervalo";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";
import {
  ROTULO_SEM_VALOR_CONFERENCIA,
  ROTULO_TIPO_SEM_VALOR,
  caixasComLoja,
  classificarCaixaTroco,
  lojasSemValorDeConferencia,
  rankingFaltasPorLoja,
  resumirTroco,
  tipoSemValorDoCaixa,
  tipoSemValorPorLojaData,
} from "@/lib/services/trocoIndicadores";
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
 *
 * Classificação (ver `trocoIndicadores.ts`; só na camada de cálculo, nada gravado): "Sem valor de conferência
 * registrado" = conferido 0 E informado 0 (marcador operacional INFERIDO — a base não tem campo explícito de
 * conferência realizada); "Conferido" = conferido ≠ 0 E informado ≠ 0 E diferença 0; "Divergência" = diferença ≠ 0.
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
  const caixasLoja = useMemo(() => caixasComLoja(linhas), [linhas]);
  const resumo = useMemo(() => resumirTroco(caixasLoja), [caixasLoja]);
  const rankingFaltas = useMemo(() => rankingFaltasPorLoja(caixasLoja), [caixasLoja]);
  const lojasSemValor = useMemo(() => lojasSemValorDeConferencia(caixasLoja), [caixasLoja]);
  // "Caixas conferidos" = só conferido ≠ 0 e informado ≠ 0 com diferença 0 (os 0/0 NÃO entram).
  const conferidos = resumo.conferidos;
  const comDivergencia = todasCaixas.filter((c) => c.status === "Divergência").length;
  const valorTotalDivergencias = todasCaixas
    .filter((c) => c.status === "Divergência")
    .reduce((s, c) => s + Math.abs(c.diferenca), 0);
  const percentualDivergencia = todasCaixas.length > 0 ? (comDivergencia / todasCaixas.length) * 100 : 0;
  // Valor da falta (só diferença negativa) e caixas sem valor de conferência registrado (0/0).
  const valorEncaminhadoParaQuebra = resumo.faltas.valor;

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Caixas conferidos</p>
              <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">{conferidos}</p>
              <p className="mt-2 text-xs text-foreground/50">Conferido e informado ≠ 0,00 e diferença 0,00 (os 0/0 não entram)</p>
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
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Valor encaminhado para quebra</p>
              <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">{formatadorMoeda.format(valorEncaminhadoParaQuebra)}</p>
              <p className="mt-2 text-xs text-foreground/50">
                Valor da falta (diferença negativa): {resumo.faltas.quantidade} {resumo.faltas.quantidade === 1 ? "ocorrência" : "ocorrências"}; sobras não entram
              </p>
              <p className="mt-1 text-xs text-foreground/50">
                Com plano de ação de quebra registrado: {formatadorMoeda.format(resumo.faltasComPlanoDeQuebra.valor)} ({resumo.faltasComPlanoDeQuebra.quantidade})
              </p>
            </Card>
            <Card>
              <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">{ROTULO_SEM_VALOR_CONFERENCIA}</p>
              <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">{resumo.semValor}</p>
              <p className="mt-2 text-xs text-foreground/50">Conferido e informado = 0,00. Inferência da base — não prova que a conferência não ocorreu</p>
            </Card>
          </div>

          <Secao titulo="Maiores divergências de troco (faltas)">
            {rankingFaltas.length === 0 ? (
              <p className="text-sm text-foreground/45">Nenhuma falta (diferença negativa) no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                      <th className="py-2 pr-4">Ranking</th>
                      <th className="px-3 py-2">Loja</th>
                      <th className="px-3 py-2">Valor da falta</th>
                      <th className="px-3 py-2">Quantidade de ocorrências</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingFaltas.map((l, i) => (
                      <tr key={l.unidade} className="border-b border-ragga-blue/5">
                        <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">{i + 1}º</td>
                        <td className="px-3 font-medium text-ragga-blue-dark">{l.unidade}</td>
                        <td className="px-3 font-semibold text-semaforo-vermelho">{formatadorMoeda.format(l.valorFalta)}</td>
                        <td className="px-3">{l.ocorrencias}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
                      <td className="py-2.5 pr-4" colSpan={2}>TOTAL</td>
                      <td className="px-3">{formatadorMoeda.format(resumo.faltas.valor)}</td>
                      <td className="px-3">{resumo.faltas.quantidade}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[11px] text-foreground/40">Só diferenças negativas (conferido &lt; informado). Sobras positivas não entram. Ordenado pela maior falta financeira.</p>
          </Secao>

          <Secao titulo="Lojas sem valor de conferência registrado">
            {lojasSemValor.length === 0 ? (
              <p className="text-sm text-foreground/45">Nenhum caixa com conferido e informado = 0,00 no período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                      <th className="py-2 pr-4">Loja</th>
                      <th className="px-3 py-2">Caixas sem valor de conferência</th>
                      <th className="px-3 py-2">Total de caixas</th>
                      <th className="px-3 py-2">% sem valor de conferência</th>
                      <th className="px-3 py-2">{ROTULO_TIPO_SEM_VALOR["loja-inteira"]}</th>
                      <th className="px-3 py-2">{ROTULO_TIPO_SEM_VALOR["caixa-isolado"]}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lojasSemValor.map((l) => (
                      <tr key={l.unidade} className="border-b border-ragga-blue/5">
                        <td className="py-2.5 pr-4 font-medium text-ragga-blue-dark">{l.unidade}</td>
                        <td className="px-3 font-semibold">{l.semValor}</td>
                        <td className="px-3">{l.total}</td>
                        <td className="px-3">{pctPainel.format(l.percentual)}%</td>
                        <td className="px-3">{l.caixasEmLojaInteira}</td>
                        <td className="px-3">{l.caixasIsolados}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
                      <td className="py-2.5 pr-4">TOTAL</td>
                      <td className="px-3">{lojasSemValor.reduce((s, l) => s + l.semValor, 0)}</td>
                      <td className="px-3">{lojasSemValor.reduce((s, l) => s + l.total, 0)}</td>
                      <td className="px-3" colSpan={3} />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[11px] text-foreground/40">
              Conferido e informado = 0,00. É uma inferência da estrutura da base (não existe campo explícito de conferência realizada). Loja inteira = todos os caixas da loja na data estão 0/0; caixa isolado = só parte deles. Ordenado pela maior quantidade de caixas.
            </p>
          </Secao>

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
  const tiposSemValor = tipoSemValorPorLojaData(caixas.map((c) => ({ ...c, unidade: loja.unidade })));
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
                {classificarCaixaTroco(caixa) === "sem-valor" ? (
                  <>
                    <StatusBadge tom="warn" texto={ROTULO_SEM_VALOR_CONFERENCIA} />
                    <span className="mt-0.5 block text-[10px] text-foreground/45">
                      {(() => {
                        const t = tipoSemValorDoCaixa({ ...caixa, unidade: loja.unidade }, tiposSemValor);
                        return t ? ROTULO_TIPO_SEM_VALOR[t] : "";
                      })()}
                    </span>
                  </>
                ) : (
                  <StatusBadge tom={TOM_POR_STATUS[caixa.status]} texto={caixa.status} />
                )}
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
