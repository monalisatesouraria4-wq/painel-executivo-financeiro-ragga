"use client";

import { Fragment, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { SemaforoBadge } from "@/components/ui/SemaforoBadge";
import { PlanoAcaoCelula } from "./PlanoAcaoCelula";
import type { CorSemaforo, FaixaSemaforo } from "@/lib/rules/semaforos";
import type { IndicadorData } from "@/lib/services/indicadores";

/** Mesmo rótulo textual já usado em components/ui/IndicadorCard.tsx (Visão Geral) — consistência entre telas. */
const TEXTO_SEMAFORO: Record<CorSemaforo, string> = {
  azul: "Excelente",
  verde: "Bom",
  amarelo: "Atenção",
  vermelho: "Crítico",
};

const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Legenda visual de semáforo (item 3 da etapa de revisão). As cores/faixas
 * vêm de `config.faixas` (os MESMOS limites já usados por
 * `classificarSemaforo`); o texto exato de cada faixa é o mesmo
 * `config.semaforoLegend` já existente e usado logo abaixo dos KPIs —
 * nenhum número novo, só uma repetição visual em badges coloridos.
 */
function LegendaSemaforo({ faixas, legendaTexto }: { faixas: FaixaSemaforo[]; legendaTexto: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/60">
      <span className="font-medium">🎯 Meta / Semáforo:</span>
      {faixas.map((f) => (
        <SemaforoBadge key={f.cor} cor={f.cor} texto={TEXTO_SEMAFORO[f.cor]} />
      ))}
      <span className="text-foreground/40">({legendaTexto})</span>
    </div>
  );
}

/**
 * Corpo compartilhado de `createIndicatorController`/`render()` do
 * legado (linhas 2898-3134): KPIs, legenda de semáforo, tabela por
 * Motivo (com Submotivo expansível quando a fonte tem) e tabela "Por
 * unidade". Usado tanto por Indicadores (3 fontes, com sub-abas) quanto
 * por Retiradas > Compra Direta (1 fonte, sem sub-abas de fonte) —
 * exatamente como o legado reaproveita a mesma fábrica
 * `createIndicatorController` para as duas telas. O filtro de Loja +
 * Período (item 2 da etapa de revisão) agora vive UMA vez só no
 * componente pai (`IndicadoresTabs`/`RetiradasTabs`, `FiltroLojaPeriodo`)
 * e já chega aqui aplicado em `dados` — nenhum filtro duplicado por card.
 */
export function IndicadorPainel({ dados, dataOcorrencia }: { dados: IndicadorData; dataOcorrencia?: Date | null }) {
  const [motivosExpandidos, setMotivosExpandidos] = useState<Set<string>>(new Set());

  const { config } = dados;
  const [ordem, setOrdem] = useState<"pct" | "valor" | "loja">("pct");
  const [somenteAcao, setSomenteAcao] = useState(false);

  const lojasEmAcao = dados.porFilial.filter((l) => l.semaforo === "vermelho" || l.semaforo === "amarelo").length;
  // Ranking: por padrão do pior para o melhor (% do faturamento); a ordem canônica das lojas continua disponível.
  const ranking = useMemo(() => {
    const base = somenteAcao ? dados.porFilial.filter((l) => l.semaforo === "vermelho" || l.semaforo === "amarelo") : [...dados.porFilial];
    if (ordem === "pct") base.sort((a, b) => b.percentualFaturamento - a.percentualFaturamento);
    else if (ordem === "valor") base.sort((a, b) => b.valor - a.valor);
    return base;
  }, [dados.porFilial, ordem, somenteAcao]);

  function alternarMotivo(motivo: string) {
    setMotivosExpandidos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(motivo)) proximo.delete(motivo);
      else proximo.add(motivo);
      return proximo;
    });
  }

  return (
    <div className="space-y-4">
      <LegendaSemaforo faixas={config.faixas} legendaTexto={config.semaforoLegend} />

      {!dados.conectado && (
        <div className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          Banco de dados ainda não conectado (<code>DATABASE_URL</code> não definida). Os
          indicadores abaixo ficam pendentes até a carga de dados reais ser autorizada —
          nenhum valor foi inventado.
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">{config.label}</p>
          {dados.disponivel ? (
            <>
              <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">{formatadorMoeda.format(dados.totalIndicador ?? 0)}</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-foreground/60">
                  {formatadorPercentual.format(dados.percentualFaturamento ?? 0)}% do faturamento
                </span>
                {dados.semaforo && <SemaforoBadge cor={dados.semaforo} texto={TEXTO_SEMAFORO[dados.semaforo]} />}
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-2xl font-semibold text-foreground/30">—</p>
              <p className="mt-2 text-xs text-foreground/50">Aguardando conexão com dados reais</p>
            </>
          )}
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Faturamento do período</p>
          {dados.disponivel ? (
            <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">{formatadorMoeda.format(dados.faturamentoPeriodo ?? 0)}</p>
          ) : (
            <>
              <p className="mt-1 text-2xl font-semibold text-foreground/30">—</p>
              <p className="mt-2 text-xs text-foreground/50">Aguardando conexão com dados reais</p>
            </>
          )}
        </Card>
      </div>

      {/* Legenda de semáforo */}
      <p className="text-xs text-foreground/50">{config.semaforoLegend}</p>

      {/* Tabela por Motivo */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-ragga-blue-dark">
          {config.label} por motivo{config.hasSubmotivo ? " (Motivo > Submotivo)" : ""}
        </h3>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
                <th className="px-4 py-2">Motivo</th>
                <th className="px-4 py-2">Valor</th>
                <th className="px-4 py-2">% do faturamento</th>
              </tr>
            </thead>
            <tbody>
              {dados.porMotivo.length === 0 ? (
                <EstadoVazio colSpan={3} />
              ) : (
                dados.porMotivo.map((linha) => (
                  <Fragment key={linha.motivo}>
                    <tr
                      onClick={() => config.hasSubmotivo && alternarMotivo(linha.motivo)}
                      className={`border-b border-ragga-blue/5 last:border-0 ${config.hasSubmotivo ? "cursor-pointer hover:bg-ragga-bg" : ""}`}
                    >
                      <td className="px-4 py-2 font-medium text-ragga-blue-dark">{linha.motivo}</td>
                      <td className="px-4 py-2">{formatadorMoeda.format(linha.valor)}</td>
                      <td className="px-4 py-2">{formatadorPercentual.format(linha.percentualFaturamento)}%</td>
                    </tr>
                    {config.hasSubmotivo &&
                      motivosExpandidos.has(linha.motivo) &&
                      linha.submotivos.map((sub) => (
                        <tr key={`${linha.motivo}-${sub.submotivo}`} className="bg-ragga-bg/50 text-xs">
                          <td className="px-8 py-2" colSpan={3}>
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="font-medium">{sub.submotivo}</span>
                              <span>Valor: {formatadorMoeda.format(sub.valor)}</span>
                              <span>Ocorrências: {sub.ocorrencias}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </section>

      {/* Ranking por loja */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ragga-blue-dark">Ranking por loja · {config.label}</h3>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-foreground/50">Ordenar:</span>
            {([
              ["pct", "% do faturamento"],
              ["valor", "Valor (R$)"],
              ["loja", "Ordem das lojas"],
            ] as const).map(([chave, rotulo]) => (
              <button
                key={chave}
                type="button"
                onClick={() => setOrdem(chave)}
                className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${
                  ordem === chave ? "border-ragga-blue bg-ragga-blue text-white" : "border-ragga-blue/20 text-ragga-blue-dark hover:bg-ragga-bg"
                }`}
              >
                {rotulo}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSomenteAcao((v) => !v)}
              aria-pressed={somenteAcao}
              className={`rounded-full border px-2.5 py-1 font-medium transition-colors ${
                somenteAcao ? "border-semaforo-vermelho bg-semaforo-vermelho text-white" : "border-semaforo-vermelho/40 text-semaforo-vermelho hover:bg-semaforo-vermelho/10"
              }`}
            >
              Só com plano de ação ({lojasEmAcao})
            </button>
          </div>
        </div>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
                <th className="px-4 py-2">#</th>
                <th className="px-4 py-2">Filial</th>
                <th className="px-4 py-2">Valor</th>
                <th className="px-4 py-2">Faturamento</th>
                <th className="px-4 py-2">% fat.</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Plano de ação</th>
              </tr>
            </thead>
            <tbody>
              {ranking.length === 0 ? (
                <EstadoVazio colSpan={7} />
              ) : (
                ranking.map((linha, i) => {
                  const precisaAcao = linha.semaforo === "vermelho" || linha.semaforo === "amarelo";
                  return (
                    <tr
                      key={linha.unidade}
                      className={`border-b border-ragga-blue/5 last:border-0 ${linha.semaforo === "vermelho" ? "bg-semaforo-vermelho/[0.04]" : ""}`}
                    >
                      <td className="px-4 py-2 text-xs font-bold text-foreground/40">{ordem === "loja" ? "–" : i + 1}</td>
                      <td className="px-4 py-2 font-medium text-ragga-blue-dark">{linha.unidade}</td>
                      <td className="px-4 py-2 font-semibold">{formatadorMoeda.format(linha.valor)}</td>
                      <td className="px-4 py-2 text-foreground/60">{formatadorMoeda.format(linha.faturamento)}</td>
                      <td className="px-4 py-2">{formatadorPercentual.format(linha.percentualFaturamento)}%</td>
                      <td className="px-4 py-2">
                        <SemaforoBadge cor={linha.semaforo} texto={TEXTO_SEMAFORO[linha.semaforo]} />
                      </td>
                      <td className="px-4 py-2">
                        <PlanoAcaoCelula
                          indicador={config.label}
                          unidade={linha.unidade}
                          motivo={linha.motivoPrincipal}
                          valor={linha.valor}
                          percentualFaturamento={linha.percentualFaturamento}
                          dataOcorrencia={dataOcorrencia ?? null}
                          destaque={precisaAcao}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </Card>
      </section>

    </div>
  );
}
