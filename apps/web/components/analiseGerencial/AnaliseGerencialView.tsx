"use client";

import { useRef, useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { FiltroDataReferencia, paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { PlanoAcaoView } from "@/components/planoAcao/PlanoAcaoView";
import type { AnaliseGerencialData, OrientacaoLinha } from "@/lib/services/analiseGerencial";
import type { ComparativoMensalData, IndicadorMensal } from "@/lib/services/comparativoMensal";
import { rotuloMes } from "@/lib/services/comparativoMensal";
import type { TratativaLinha, NovaTratativaInput } from "@/lib/services/planoAcao";
import { buscarAnaliseGerencialPorData } from "@/lib/actions/buscarAnaliseGerencialPorData";

const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function formatarValor(valor: number): string {
  return formatadorMoeda.format(valor);
}

/** Sparkline compacto (SVG puro, mesma técnica de `components/comparativo/MiniBarChart.tsx`) — só para a coluna "Histórico". */
function Sparkline({ indicador, meses }: { indicador: IndicadorMensal; meses: string[] }) {
  const valores = meses.map((m) => indicador.porMes[m]);
  const disponiveis = valores.filter((v) => v?.disponivel && v.valor !== undefined).map((v) => v!.valor!);
  if (disponiveis.length === 0) return <span className="text-foreground/30">—</span>;
  const max = Math.max(...disponiveis.map(Math.abs), 1);
  const largura = 90;
  const altura = 24;
  const passo = largura / Math.max(1, meses.length - 1);
  const pontos = valores
    .map((v, i) => (v?.disponivel && v.valor !== undefined ? `${i * passo},${altura - (Math.abs(v.valor) / max) * altura}` : null))
    .filter((p): p is string => p !== null);
  return (
    <svg viewBox={`0 0 ${largura} ${altura}`} width={largura} height={altura} className="inline-block align-middle">
      <polyline points={pontos.join(" ")} fill="none" stroke="var(--ragga-blue)" strokeWidth={1.5} opacity={0.7} />
    </svg>
  );
}

/**
 * Seção 1 — Evolução dos Indicadores: mês atual vs anterior, sem
 * qualificar aumento/redução como bom/ruim (nenhuma cor de semáforo
 * aqui). Reaproveita 100% `buscarComparativoMensal()` (mesma fonte da
 * tela Comparativo) — nenhuma consulta/indicador novo.
 */
function SecaoEvolucao({ comparativo }: { comparativo: ComparativoMensalData }) {
  const meses = comparativo.meses;
  const ultimoMes = meses[meses.length - 1];
  const penultimoMes = meses[meses.length - 2];

  const indicadores: { titulo: string; indicador: IndicadorMensal }[] = [
    { titulo: "Faturamento", indicador: comparativo.faturamento },
    { titulo: "Brindes", indicador: comparativo.brindes },
    { titulo: "Cancelamento Salão", indicador: comparativo.cancelamentoSalao },
    { titulo: "Cancelamento Delivery", indicador: comparativo.cancelamentoDelivery },
    { titulo: "Retirada Compra Direta", indicador: comparativo.compraDireta },
    { titulo: "Troco", indicador: comparativo.trocoDiferenca },
    { titulo: "Quebra de Caixa", indicador: comparativo.quebraCaixa },
  ];

  if (meses.length === 0) {
    return <p className="text-sm text-foreground/50">Sem histórico mensal disponível ainda.</p>;
  }

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
            <th className="px-4 py-2">Indicador</th>
            <th className="px-4 py-2">{ultimoMes ? rotuloMes(ultimoMes) : "Mês atual"}</th>
            <th className="px-4 py-2">{penultimoMes ? rotuloMes(penultimoMes) : "Mês anterior"}</th>
            <th className="px-4 py-2">Variação</th>
            <th className="px-4 py-2">Histórico</th>
          </tr>
        </thead>
        <tbody>
          {indicadores.map(({ titulo, indicador }) => {
            const atual = ultimoMes ? indicador.porMes[ultimoMes] : undefined;
            const anterior = penultimoMes ? indicador.porMes[penultimoMes] : undefined;
            const variacao =
              atual?.disponivel && atual.valor !== undefined && anterior?.disponivel && anterior.valor !== undefined && anterior.valor !== 0
                ? ((atual.valor - anterior.valor) / Math.abs(anterior.valor)) * 100
                : null;
            return (
              <tr key={titulo} className="border-b border-ragga-blue/5 last:border-0">
                <td className="px-4 py-2 font-medium text-ragga-blue-dark">{titulo}</td>
                <td className="px-4 py-2">{atual?.disponivel && atual.valor !== undefined ? formatarValor(atual.valor) : "Sem dados"}</td>
                <td className="px-4 py-2">
                  {anterior?.disponivel && anterior.valor !== undefined ? formatarValor(anterior.valor) : "Sem dados"}
                </td>
                <td className="px-4 py-2 text-foreground/60">
                  {variacao !== null ? (
                    <>
                      {variacao >= 0 ? "▲" : "▼"} {formatadorPercentual.format(Math.abs(variacao))}%
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-2">
                  <Sparkline indicador={indicador} meses={meses} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

/** Ícone de severidade — reaproveita a mesma classificação de `dados.atencao` (Crítico/Atenção), sem inventar nova faixa. */
function iconeSeveridade(situacao: string | undefined): string {
  if (situacao === "Crítico") return "🔴";
  if (situacao === "Atenção") return "🟠";
  return "🟠";
}

const MAX_CARDS_ATENCAO = 8;

/**
 * Seção 2 — O que chama atenção: recorte das ocorrências já calculadas
 * em `dados.orientacao` (loja/indicador/motivo/valor/%), priorizando
 * severidade (Crítico primeiro) e valor — sem inventar corte/threshold
 * novo, só uma redução de exibição para não listar dezenas de linhas.
 */
function SecaoAtencao({ dados }: { dados: AnaliseGerencialData }) {
  const situacaoPorChave = new Map(dados.atencao.map((a) => [`${a.indicador}|${a.unidade}`, a.situacao]));
  const relevantes = [...dados.orientacao]
    .map((l) => ({ ...l, situacao: situacaoPorChave.get(`${l.indicador}|${l.unidade}`) }))
    .sort((a, b) => {
      const pesoA = a.situacao === "Crítico" ? 1 : 0;
      const pesoB = b.situacao === "Crítico" ? 1 : 0;
      if (pesoA !== pesoB) return pesoB - pesoA;
      return Math.abs(b.valor) - Math.abs(a.valor);
    })
    .slice(0, MAX_CARDS_ATENCAO);

  if (relevantes.length === 0) {
    return <p className="text-sm text-foreground/50">Nenhuma ocorrência em atenção/crítico para esta referência.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {relevantes.map((l, i) => (
        <Card key={`${l.indicador}-${l.unidade}-${l.motivo}-${i}`}>
          <p className="text-sm font-semibold text-ragga-blue-dark">
            {iconeSeveridade(l.situacao)} {l.unidade}
          </p>
          <p className="text-xs text-foreground/60">{l.indicador}</p>
          <p className="mt-1 text-lg font-semibold text-ragga-blue-dark">{formatarValor(l.valor)}</p>
          <p className="text-xs text-foreground/60">{l.motivo}</p>
          {l.percentualFaturamento !== null && (
            <p className="text-xs text-foreground/50">{formatadorPercentual.format(l.percentualFaturamento)}% do faturamento</p>
          )}
        </Card>
      ))}
    </div>
  );
}

/**
 * Análise Gerencial — tela única (item 9 da etapa de revisão):
 * COMPARAR (Evolução) → IDENTIFICAR (O que chama atenção) → EXPLICAR
 * (Causa/Orientação) → AGIR (Plano de Ação, `PlanoAcaoView` embutido).
 * Nenhum indicador, meta, orientação ou regra de negócio foi inventado —
 * ver `analiseGerencial.server.ts`/`comparativoMensal.server.ts`/
 * `planoAcao.server.ts`.
 */
export function AnaliseGerencialView({
  dadosIniciais,
  comparativo,
  tratativasIniciais,
  dataInicial,
}: {
  dadosIniciais: AnaliseGerencialData;
  comparativo: ComparativoMensalData;
  tratativasIniciais: TratativaLinha[];
  dataInicial: Date;
}) {
  const [dados, setDados] = useState(dadosIniciais);
  const [dataSelecionada, setDataSelecionada] = useState(() => paraInputDate(dataInicial));
  const [pendente, iniciarTransicao] = useTransition();
  const [prefillTratativa, setPrefillTratativa] = useState<Partial<NovaTratativaInput> | null>(null);
  const [tratativaKey, setTratativaKey] = useState(0);
  const planoAcaoRef = useRef<HTMLDivElement>(null);

  function alterarData(novaData: string) {
    setDataSelecionada(novaData);
    iniciarTransicao(async () => {
      const resultado = await buscarAnaliseGerencialPorData(dataDoInput(novaData));
      setDados(resultado);
    });
  }

  function criarTratativaDaOcorrencia(l: OrientacaoLinha) {
    if (!l.unidade) return;
    setPrefillTratativa({
      unidade: l.unidade,
      indicador: l.indicador,
      dataOcorrencia: l.dataOcorrencia,
      problema: l.motivo,
      acao: l.orientacao,
    });
    setTratativaKey((k) => k + 1);
    planoAcaoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="flex-1 space-y-8 px-6 py-6">
      <div className="rounded-lg border border-ragga-blue/10 bg-ragga-surface px-4 py-3">
        <FiltroDataReferencia valor={dataSelecionada} aoAlterar={alterarData} carregando={pendente} />
        {dados.dataAnteriorLabel && (
          <p className="mt-2 text-xs text-foreground/50">Comparação com período anterior: {dados.dataAnteriorLabel}</p>
        )}
      </div>

      {!dados.conectado && (
        <div className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          Banco de dados ainda não conectado (<code>DATABASE_URL</code> não definida) — nenhum valor foi inventado.
        </div>
      )}

      {/* 1. Evolução dos Indicadores */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ragga-blue-dark">1. Evolução dos Indicadores</h2>
        <SecaoEvolucao comparativo={comparativo} />
      </section>

      {dados.conectado && !dados.disponivel && (
        <div className="rounded-lg border border-ragga-blue/15 bg-ragga-bg px-4 py-3 text-sm text-ragga-blue-dark">
          ℹ️ Sem dados para a referência selecionada (seções 2 e 3 abaixo).
        </div>
      )}

      {dados.disponivel && (
        <>
          {/* 2. O que chama atenção */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ragga-blue-dark">2. O que chama atenção?</h2>
            <SecaoAtencao dados={dados} />
          </section>

          {/* 3. Causa / Orientação */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ragga-blue-dark">3. Causa / Orientação</h2>
            <Card className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
                    <th className="px-4 py-2">Loja</th>
                    <th className="px-4 py-2">Indicador</th>
                    <th className="px-4 py-2">Motivo</th>
                    <th className="px-4 py-2">Valor</th>
                    <th className="px-4 py-2">% Faturamento</th>
                    <th className="px-4 py-2">Orientação</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {dados.orientacao.length === 0 ? (
                    <EstadoVazio colSpan={7} texto="Nenhuma ocorrência em atenção/crítico com motivo detalhado para esta referência." />
                  ) : (
                    dados.orientacao.map((l, i) => (
                      <tr key={`${l.indicador}-${l.unidade}-${l.motivo}-${i}`} className="border-b border-ragga-blue/5 last:border-0">
                        <td className="px-4 py-2">{l.unidade ?? "—"}</td>
                        <td className="px-4 py-2 font-medium text-ragga-blue-dark">{l.indicador}</td>
                        <td className="px-4 py-2">
                          {l.motivo}
                          {l.controlavel === false && (
                            <span className="ml-2 rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-foreground/50">
                              Não controlável
                            </span>
                          )}
                          {l.naoNegativo && (
                            <span className="ml-2 rounded bg-ragga-blue/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-ragga-blue-dark">
                              Ocorrência de teste
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">{formatarValor(l.valor)}</td>
                        <td className="px-4 py-2">
                          {l.percentualFaturamento !== null ? `${formatadorPercentual.format(l.percentualFaturamento)}%` : "—"}
                        </td>
                        <td className="px-4 py-2 text-foreground/50">📌 {l.orientacao}</td>
                        <td className="px-4 py-2">
                          {l.unidade && (
                            <button
                              type="button"
                              onClick={() => criarTratativaDaOcorrencia(l)}
                              className="whitespace-nowrap rounded border border-ragga-blue/20 px-2 py-1 text-xs font-medium text-ragga-blue-dark hover:bg-ragga-blue/5"
                            >
                              + Criar tratativa
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </Card>
          </section>
        </>
      )}

      {/* 4. Plano de Ação */}
      <section ref={planoAcaoRef}>
        <h2 className="mb-2 text-sm font-semibold text-ragga-blue-dark">4. Plano de Ação</h2>
        <PlanoAcaoView key={tratativaKey} dadosIniciais={tratativasIniciais} prefill={prefillTratativa} />
      </section>
    </main>
  );
}
