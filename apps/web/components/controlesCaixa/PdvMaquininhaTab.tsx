"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { dataDMenos2 } from "@/lib/rules/datas";
import { buscarPdvMaquininhaIntervalo } from "@/lib/actions/buscarPdvMaquininhaIntervalo";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";

/**
 * Sub-aba PDV × Maquininha (`renderPdvMaquininha`, linha 2668 do legado).
 * KPIs: Total PDV, Total Maquininha, Diferença. Threshold de "diferença
 * zero" confirmado no legado: Math.abs(diferenca) > 0.005 ? warn : ok
 * (linha 2697) — tolerância de ponto flutuante, não faixa de negócio.
 *
 * Filtro de período PERSONALIZADO (item 6 da etapa de revisão): opcional,
 * além da consulta padrão D-2. Ao aplicar um intervalo, o texto acima dos
 * KPIs deixa explícito qual período está sendo mostrado — a regra D-2 em
 * si não muda, só passa a ser OPCIONAL em vez de única.
 */
const TOLERANCIA_DIFERENCA_ZERO = 0.005;
const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

export function PdvMaquininhaTab({ dados, dataReferencia }: { dados: ControlesCaixaData["pdvMaquininha"]; dataReferencia: Date }) {
  const [intervalo, setIntervalo] = useState<{ inicio: string; fim: string } | null>(null);
  const [dadosIntervalo, setDadosIntervalo] = useState<ControlesCaixaData["pdvMaquininha"] | null>(null);
  const [pendente, iniciarTransicao] = useTransition();

  const dadosExibidos = dadosIntervalo ?? dados;
  const statusRede =
    dadosExibidos.diferencaRede !== null ? Math.abs(dadosExibidos.diferencaRede) > TOLERANCIA_DIFERENCA_ZERO : null;

  function aplicarIntervalo(inicio: string, fim: string) {
    if (!inicio || !fim) return;
    setIntervalo({ inicio, fim });
    iniciarTransicao(async () => {
      const resultado = await buscarPdvMaquininhaIntervalo(dataDoInput(inicio), dataDoInput(fim));
      setDadosIntervalo(resultado);
    });
  }

  function limparIntervalo() {
    setIntervalo(null);
    setDadosIntervalo(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-ragga-blue/10 bg-ragga-surface px-4 py-3">
        <div>
          <label className="block text-xs font-medium text-foreground/60">Período personalizado — data inicial</label>
          <input
            type="date"
            className="mt-1 rounded border border-ragga-blue/20 px-2 py-1 text-sm"
            value={intervalo?.inicio ?? ""}
            onChange={(e) => aplicarIntervalo(e.target.value, intervalo?.fim ?? e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground/60">Data final</label>
          <input
            type="date"
            className="mt-1 rounded border border-ragga-blue/20 px-2 py-1 text-sm"
            value={intervalo?.fim ?? ""}
            onChange={(e) => aplicarIntervalo(intervalo?.inicio ?? e.target.value, e.target.value)}
          />
        </div>
        {intervalo && (
          <button
            type="button"
            onClick={limparIntervalo}
            className="rounded border border-ragga-blue/20 px-3 py-1.5 text-xs font-medium text-ragga-blue-dark hover:bg-ragga-blue/5"
          >
            Voltar para a consulta padrão (D-2)
          </button>
        )}
        {pendente && <span className="text-xs text-foreground/50">Carregando...</span>}
      </div>

      <p className="text-xs text-foreground/50">
        {intervalo
          ? `Mostrando período personalizado: ${formatadorData.format(dataDoInput(intervalo.inicio))} até ${formatadorData.format(dataDoInput(intervalo.fim))}.`
          : `Mostrando a consulta padrão (D-2): ${formatadorData.format(dataDMenos2(dataReferencia))}.`}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Total PDV</p>
          <p className={`mt-1 text-2xl font-semibold ${dadosExibidos.disponivel ? "text-ragga-blue-dark" : "text-foreground/30"}`}>
            {dadosExibidos.disponivel ? formatadorMoeda.format(dadosExibidos.totalPdvRede ?? 0) : "—"}
          </p>
          {!dadosExibidos.disponivel && <p className="mt-2 text-xs text-foreground/50">Sem dados para o período</p>}
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Total Maquininha</p>
          <p className={`mt-1 text-2xl font-semibold ${dadosExibidos.disponivel ? "text-ragga-blue-dark" : "text-foreground/30"}`}>
            {dadosExibidos.disponivel ? formatadorMoeda.format(dadosExibidos.totalMaquininhaRede ?? 0) : "—"}
          </p>
          {!dadosExibidos.disponivel && <p className="mt-2 text-xs text-foreground/50">Sem dados para o período</p>}
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Diferença</p>
          <p className={`mt-1 text-2xl font-semibold ${dadosExibidos.disponivel ? "text-ragga-blue-dark" : "text-foreground/30"}`}>
            {dadosExibidos.disponivel ? formatadorMoeda.format(dadosExibidos.diferencaRede ?? 0) : "—"}
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

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
              <th className="px-4 py-2">Loja</th>
              <th className="px-4 py-2">PDV</th>
              <th className="px-4 py-2">Maquininha</th>
              <th className="px-4 py-2">Diferença</th>
              <th className="px-4 py-2">% sobre faturamento</th>
            </tr>
          </thead>
          <tbody>
            {dadosExibidos.linhas.length === 0 ? (
              <EstadoVazio colSpan={5} />
            ) : (
              dadosExibidos.linhas.map((linha) => (
                <tr key={linha.unidade} className="border-b border-ragga-blue/5 last:border-0">
                  <td className="px-4 py-2 font-medium text-ragga-blue-dark">{linha.unidade}</td>
                  <td className="px-4 py-2">{formatadorMoeda.format(linha.totalPdv)}</td>
                  <td className="px-4 py-2">{formatadorMoeda.format(linha.totalMaquininha)}</td>
                  <td className="px-4 py-2">{formatadorMoeda.format(linha.diferenca)}</td>
                  <td className="px-4 py-2">{linha.percentualSobreFaturamento ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
