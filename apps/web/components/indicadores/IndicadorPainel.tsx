"use client";

import { Fragment, useState } from "react";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { SemaforoBadge } from "@/components/ui/SemaforoBadge";
import type { CorSemaforo } from "@/lib/rules/semaforos";
import type { IndicadorData, ModoPeriodo } from "@/lib/services/indicadores";
import { UNIDADES } from "@painel/shared";

/** Mesmo rótulo textual já usado em components/ui/IndicadorCard.tsx (Visão Geral) — consistência entre telas. */
const TEXTO_SEMAFORO: Record<CorSemaforo, string> = {
  azul: "Excelente",
  verde: "Bom",
  amarelo: "Atenção",
  vermelho: "Crítico",
};

const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MODOS_PERIODO: { id: ModoPeriodo; nome: string }[] = [
  { id: "dia", nome: "Dia" },
  { id: "semana", nome: "Semana" },
  { id: "mes", nome: "Mês" },
  { id: "personalizado", nome: "Personalizado" },
];

/**
 * Corpo compartilhado de `createIndicatorController`/`render()` do
 * legado (linhas 2898-3134): filtro de período (Dia/Semana/Mês/
 * Personalizado), filtro de loja, KPIs, legenda de semáforo, tabela por
 * Motivo (com Submotivo expansível quando a fonte tem) e tabela "Por
 * unidade". Usado tanto por Indicadores (3 fontes, com sub-abas) quanto
 * por Retiradas > Compra Direta (1 fonte, sem sub-abas de fonte) —
 * exatamente como o legado reaproveita a mesma fábrica
 * `createIndicatorController` para as duas telas.
 */
export function IndicadorPainel({ dados }: { dados: IndicadorData }) {
  const [modoPeriodo, setModoPeriodo] = useState<ModoPeriodo>("dia");
  const [lojaFiltro, setLojaFiltro] = useState<string>("TODAS");
  const [motivosExpandidos, setMotivosExpandidos] = useState<Set<string>>(new Set());

  const { config } = dados;

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
      {/* Filtros: período + loja */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 rounded-md border border-ragga-blue/15 p-1">
          {MODOS_PERIODO.map((modo) => (
            <button
              key={modo.id}
              type="button"
              onClick={() => setModoPeriodo(modo.id)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                modoPeriodo === modo.id ? "bg-ragga-blue text-white" : "text-foreground/60 hover:bg-ragga-bg"
              }`}
            >
              {modo.nome}
            </button>
          ))}
        </div>

        <select
          value={lojaFiltro}
          onChange={(e) => setLojaFiltro(e.target.value)}
          className="rounded-md border border-ragga-blue/15 bg-ragga-surface px-3 py-1.5 text-sm text-foreground"
        >
          <option value="TODAS">Todas as lojas</option>
          {UNIDADES.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>

      {!dados.conectado && (
        <div className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          Banco de dados ainda não conectado (<code>DATABASE_URL</code> não definida). Os
          indicadores abaixo ficam pendentes até a carga de dados reais ser autorizada —
          nenhum valor foi inventado. Os filtros acima são controles funcionais de UI; a busca
          reativa por período/loja será ligada quando o backend estiver conectado.
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

      {/* Tabela Por unidade */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-ragga-blue-dark">Por unidade</h3>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
                <th className="px-4 py-2">Filial</th>
                <th className="px-4 py-2">Valor</th>
                <th className="px-4 py-2">Faturamento</th>
                <th className="px-4 py-2">% fat.</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Plano de ação</th>
              </tr>
            </thead>
            <tbody>
              {dados.porFilial.length === 0 ? (
                <EstadoVazio colSpan={6} />
              ) : (
                dados.porFilial.map((linha) => (
                  <tr key={linha.unidade} className="border-b border-ragga-blue/5 last:border-0">
                    <td className="px-4 py-2 font-medium text-ragga-blue-dark">{linha.unidade}</td>
                    <td className="px-4 py-2">{formatadorMoeda.format(linha.valor)}</td>
                    <td className="px-4 py-2">{formatadorMoeda.format(linha.faturamento)}</td>
                    <td className="px-4 py-2">{formatadorPercentual.format(linha.percentualFaturamento)}%</td>
                    <td className="px-4 py-2">
                      <SemaforoBadge cor={linha.semaforo} texto={TEXTO_SEMAFORO[linha.semaforo]} />
                    </td>
                    <td className="px-4 py-2 text-foreground/40">—</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}
