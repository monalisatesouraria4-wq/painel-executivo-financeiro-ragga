"use client";

import { useEffect, useMemo, useState } from "react";
import type { CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Item, Secao, Situacao, moeda as moedaPainel, pct as pctPainel, sinalMoeda } from "@/components/ui/PainelAnalitico";
import { PainelLojasComparativo, useComparacaoPeriodo, formatadorDiaPainel } from "./PainelLojasComparativo";
import { buscarPdvMaquininhaIntervalo } from "@/lib/actions/buscarPdvMaquininhaIntervalo";
import { buscarPdvPorForma } from "@/lib/actions/buscarPdvPorForma";
import { montarPdvGerencial, type LojaDivergenciaPdv, type SentidoDivergencia } from "@/lib/services/pdvGerencial";
import { FORMAS_PDV_POWER_BI, TEXTO_COBERTURA_PDV, avisoComparacaoSemMaquininha, classesPontoDeAtencao, janelaConsultaPdv, OPCOES_ORDEM_RANKING_PDV, ordenarRankingPdv, periodoAnteriorPdv, posicaoPorValorPdv, textoSemMaquininha, type OrdemRankingPdv } from "@/lib/services/pdvEscopo";
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
 * Sub-aba PDV × Maquininha. KPIs: Total PDV, Total Maquininha, Diferença (= Maquininha − PDV) e % de divergência
 * (= Diferença ÷ Total PDV). Threshold de "diferença zero": Math.abs(diferenca) > 0.005 (tolerância de ponto flutuante).
 *
 * PERÍODO LITERAL (sem D-2): a conferência é semanal; a regra D-2 não se aplica a esta aba. O período selecionado no filtro
 * da página (Data de referência ou intervalo) é consultado exatamente como escolhido, nas duas pontas — e o período
 * comparado é o equivalente anterior (mesma quantidade de dias), também sem deslocamento.
 *
 * FORMAS: só Crédito, Débito, Pix e Voucher (extração atual do Power BI) — ver `lib/services/pdvEscopo.ts`. Cards, ranking,
 * painel por loja e detalhe por forma partem da MESMA consulta (mesmo período, mesma loja, mesmas formas); a aba busca os
 * próprios dados (não usa os agregados D-2 da página). Nenhuma fórmula financeira foi alterada.
 */
const TOLERANCIA_DIFERENCA_ZERO = 0.005;
const pctFormatado = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "-" : ""}${pctPainel.format(Math.abs(v))}%`);

/** `quebra`: permite quebrar linha (cards estreitos de "pontos de atenção"); na tabela o selo fica em uma linha só. */
function SentidoBadge({ sentido, quebra = false }: { sentido: SentidoDivergencia; quebra?: boolean }) {
  const base = `${quebra ? "block" : "whitespace-nowrap"} text-xs font-semibold`;
  if (sentido === "falta") return <span className={`${base} text-semaforo-vermelho`}>▼ Negativa (maquininha abaixo do PDV)</span>;
  if (sentido === "sobra") return <span className={`${base} text-semaforo-amarelo`}>▲ Positiva (maquininha acima do PDV)</span>;
  return <span className={`${base} text-foreground/45`}>= Sem diferença</span>;
}

function corDiferenca(l: Pick<LojaDivergenciaPdv, "sentido">) {
  return l.sentido === "falta" ? "text-semaforo-vermelho" : l.sentido === "sobra" ? "text-semaforo-amarelo" : "text-foreground/70";
}
const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const arred2 = (v: number) => Math.round(v * 100) / 100;

export function PdvMaquininhaTab({
  janela,
  lojaFiltro,
}: {
  /** Período SELECIONADO (data de referência = início e fim iguais, ou intervalo escolhido) — consultado LITERALMENTE. */
  janela: { inicio: Date; fim: Date };
  lojaFiltro?: CodigoUnidade;
}) {
  const inicioMs = janela.inicio.getTime();
  const fimMs = janela.fim.getTime();
  const chave = `${inicioMs}|${fimMs}|${lojaFiltro ?? "TODAS"}`;
  const formasEscopo = useMemo(() => [...FORMAS_PDV_POWER_BI], []);

  // Dados do período ATUAL (cards + ranking + painel por loja + detalhe por forma): UMA consulta de período/loja/formas.
  const [carregado, setCarregado] = useState<{ chave: string; pdv: ControlesCaixaData["pdvMaquininha"]; formas: PdvFormaBruta[] } | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    const { inicio, fim } = janelaConsultaPdv({ inicio: new Date(inicioMs), fim: new Date(fimMs) });
    Promise.all([buscarPdvMaquininhaIntervalo(inicio, fim, lojaFiltro, formasEscopo), buscarPdvPorForma(inicio, fim, formasEscopo)])
      .then(([pdv, formas]) => {
        if (vivo) {
          setFalhou(null);
          setCarregado({ chave, pdv, formas });
        }
      })
      .catch(() => {
        if (vivo) setFalhou(chave);
      });
    return () => {
      vivo = false;
    };
  }, [inicioMs, fimMs, lojaFiltro, chave, formasEscopo]);
  // Resultado de um período/loja antigo nunca é mostrado para o filtro atual.
  const atual = carregado && carregado.chave === chave ? carregado : null;
  const linhas = useMemo(() => atual?.pdv.linhas ?? [], [atual]);
  const formasAtual = atual?.formas ?? null;
  const disponivel = linhas.length > 0;
  const totalPdvRede = arred2(linhas.reduce((s, l) => s + l.totalPdv, 0));
  const totalMaquininhaRede = arred2(linhas.reduce((s, l) => s + l.totalMaquininha, 0));
  const diferencaRede = arred2(totalMaquininhaRede - totalPdvRede);
  const statusRede = disponivel ? Math.abs(diferencaRede) > TOLERANCIA_DIFERENCA_ZERO : null;
  // % de divergência = (Diferença ÷ Total PDV) × 100, com o MESMO sinal da Diferença exibida (Maquininha − PDV):
  // negativo = a maquininha ficou abaixo do PDV. Sem Total PDV (zero/indisponível) não há percentual válido.
  const percentualDivergencia = disponivel ? percentualDivergenciaPdv(diferencaRede, totalPdvRede) : null;
  const textoPercentualDivergencia =
    percentualDivergencia === null
      ? "—"
      : `${percentualDivergencia > 0 ? "+" : percentualDivergencia < 0 ? "-" : ""}${new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(percentualDivergencia))}%`;

  // Período comparado (editável) — mesmas formas, mesma agregação, sem D-2.
  const comp = useComparacaoPeriodo(janela, async (ini, fim) => {
    const [pdv, formas] = await Promise.all([buscarPdvMaquininhaIntervalo(ini, fim, undefined, formasEscopo), buscarPdvPorForma(ini, fim, formasEscopo)]);
    return { pdv, formas };
  });

  // Período anterior equivalente (mesma quantidade de dias, termina na véspera do início) para a camada gerencial.
  const periodoAnterior = useMemo(() => periodoAnteriorPdv({ inicio: new Date(inicioMs), fim: new Date(fimMs) }), [inicioMs, fimMs]);
  const [anteriorGerencial, setAnteriorGerencial] = useState<{ chave: string; dados: ControlesCaixaData["pdvMaquininha"] } | null>(null);
  useEffect(() => {
    let vivo = true;
    buscarPdvMaquininhaIntervalo(periodoAnterior.inicio, periodoAnterior.fim, lojaFiltro, formasEscopo).then((r) => {
      if (vivo) setAnteriorGerencial({ chave, dados: r });
    });
    return () => {
      vivo = false;
    };
  }, [periodoAnterior, lojaFiltro, chave, formasEscopo]);
  const gerencial = useMemo(
    () => (atual && anteriorGerencial && anteriorGerencial.chave === chave ? montarPdvGerencial(linhas, anteriorGerencial.dados.linhas) : null),
    [atual, linhas, anteriorGerencial, chave]
  );
  const periodoAnteriorTxt = `${formatadorDiaPainel.format(periodoAnterior.inicio)} a ${formatadorDiaPainel.format(periodoAnterior.fim)}`;

  // Ordenação VISUAL do ranking (não altera totais, cards, filtros nem cálculos; a linha REDE continua fixa no rodapé).
  const [ordemRanking, setOrdemRanking] = useState<OrdemRankingPdv>("valor");
  const lojasOrdenadas = useMemo(() => (gerencial ? ordenarRankingPdv(gerencial.lojas, ordemRanking) : []), [gerencial, ordemRanking]);
  const posicaoPorValor = useMemo(() => (gerencial ? posicaoPorValorPdv(gerencial.lojas) : new Map<string, number>()), [gerencial]);

  const atualPainel = useMemo(() => recortarLojaPainel(agregarPdv(linhas), lojaFiltro, redePdv), [linhas, lojaFiltro]);
  const comparadoPainel = useMemo(
    () => (comp.dados ? recortarLojaPainel(agregarPdv(comp.dados.pdv.linhas), lojaFiltro, redePdv) : null),
    [comp.dados, lojaFiltro]
  );
  const periodoAtualTxt = janela.inicio.getTime() === janela.fim.getTime() ? formatadorDiaPainel.format(janela.inicio) : `${formatadorDiaPainel.format(janela.inicio)} a ${formatadorDiaPainel.format(janela.fim)}`;
  const notaMaquininha = textoSemMaquininha(atual?.pdv.semMaquininha, (v) => formatadorMoeda.format(v));
  // Aviso da comparação semanal: depende do período anterior e dos filtros (some/atualiza junto com eles).
  const avisoComparacao =
    anteriorGerencial && anteriorGerencial.chave === chave
      ? avisoComparacaoSemMaquininha(anteriorGerencial.dados.semMaquininha, (v) => formatadorMoeda.format(v), periodoAnteriorTxt)
      : null;

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-xs text-foreground/50">
        <p>
          Período consultado: <strong className="text-foreground/70">{periodoAtualTxt}</strong> (datas literais, sem deslocamento D-2){lojaFiltro ? ` · loja ${lojaFiltro}` : " · todas as lojas"}.
        </p>
        <p>{TEXTO_COBERTURA_PDV}</p>
        {falhou === chave && <p className="font-semibold text-semaforo-vermelho">Não foi possível carregar PDV × Maquininha para este período. Troque o filtro ou recarregue a página.</p>}
        {!atual && falhou !== chave && <p>Carregando…</p>}
      </div>

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

      {/* Avisos de qualidade dos dados (quando aplicáveis) — logo abaixo dos cards */}
      {notaMaquininha && (
        <p data-aviso="qualidade-periodo" className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-3 py-2 text-xs font-semibold text-ragga-blue-dark">
          ⚠ {notaMaquininha}
        </p>
      )}

      {/* Camada gerencial: pontos de atenção, ranking por divergência e comparação com o período anterior */}
      {gerencial === null ? (
        <p className="text-sm text-foreground/50">Carregando o comparativo do período…</p>
      ) : (
        <>
          <Secao titulo="Principais pontos de atenção">
            {gerencial.pontosDeAtencao.length === 0 ? (
              <p className="text-sm text-foreground/45">Nenhuma loja com divergência no período.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                {gerencial.pontosDeAtencao.map((l, i) => (
                  <li key={l.unidade} className={`rounded-lg border px-3 py-2 ${classesPontoDeAtencao(l.sentido)}`}>
                    <p className="text-xs text-foreground/50">{i + 1}ª maior divergência</p>
                    <p className="text-base font-bold text-ragga-blue-dark">{l.unidade}</p>
                    <p className={`text-sm font-semibold tabular-nums ${corDiferenca(l)}`}>{formatadorMoeda.format(l.diferenca)}</p>
                    <p className="text-xs text-foreground/60">{pctFormatado(l.percentual)} do PDV</p>
                    <SentidoBadge sentido={l.sentido} quebra />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-foreground/40">Maiores divergências em valor absoluto (|diferença| acima de R$ 0,005, a tolerância já usada na aba), mantendo o sinal exibido. A cor só indica o sinal (vermelho = maquininha abaixo do PDV; âmbar = acima) — não é erro comprovado.</p>
          </Secao>

          <Secao
            titulo="Ranking de lojas por divergência"
            acao={
              <label className="flex items-center gap-2 text-xs font-medium text-ragga-blue-dark">
                Ordenar por
                <select value={ordemRanking} onChange={(e) => setOrdemRanking(e.target.value as OrdemRankingPdv)} className="rounded-md border border-ragga-blue/15 bg-white px-2 py-1.5 text-xs">
                  {OPCOES_ORDEM_RANKING_PDV.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
              </label>
            }
          >
            {gerencial.lojas.length === 0 ? (
              <p className="text-sm text-foreground/45">Sem movimentação de PDV × Maquininha no período selecionado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                      <th className="py-2 pr-4" title="Posição pela maior divergência em valor absoluto, em qualquer ordem exibida">Ranking (valor)</th>
                      <th className="px-3 py-2">Loja</th>
                      <th className="px-3 py-2">Total PDV</th>
                      <th className="px-3 py-2">Total Maquininha</th>
                      <th className="px-3 py-2">Diferença</th>
                      <th className="px-3 py-2">% Divergência</th>
                      <th className="px-3 py-2">Sentido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lojasOrdenadas.map((l) => (
                      <tr key={l.unidade} className="border-b border-ragga-blue/5">
                        <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">{posicaoPorValor.get(l.unidade)}º</td>
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
              Diferença = Maquininha − PDV (com sinal). Use “Ordenar por” para mudar só a ordem visual: Loja (A–Z), Valor da divergência (maior |diferença| primeiro) ou % de divergência (maior |%| primeiro), sempre com o sinal original e empate por nome da loja. O “Ranking (valor)” é a posição pelo valor absoluto em qualquer ordem. REDE é o total fixo do rodapé. Lojas sem movimentação não entram.
            </p>
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
            {avisoComparacao && (
              <p role="note" className="mt-3 rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-3 py-2 text-xs text-ragga-blue-dark">
                ⚠ {avisoComparacao}
              </p>
            )}
            <p className="mt-2 text-[11px] text-foreground/40">
              Período atual: {periodoAtualTxt} · Período anterior (mesma quantidade de dias, termina na véspera do início; sem D-2): {periodoAnteriorTxt}. Variação positiva = a divergência (em módulo) aumentou; negativa = diminuiu.
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
