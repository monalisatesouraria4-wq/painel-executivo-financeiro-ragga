"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { buscarQuebraCaixaIntervalo } from "@/lib/actions/buscarQuebraCaixaIntervalo";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";

// timeZone: "UTC" — data pura (meia-noite UTC), mesmo padrão de ConferenciaTab.tsx.
const formatadorData = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Sub-aba Quebra de Caixa (`renderQuebraCaixa`, linha 5336 do legado).
 * KPIs: Registros no período, Total Geral (warn se >0). Tabela
 * consolidada por Operador (chave CPF+Operador, ordenada por valor
 * desc.) + tabela detalhada por lançamento (Data, Filial, Valor, Motivo,
 * Operador, expansível Conferente/CPF). Ordenação apenas por Data
 * decrescente, sem reordenar por filial — igual ao legado.
 *
 * Filtro de período PERSONALIZADO (item 8 da etapa de revisão): opcional,
 * além dos filtros/ciclos existentes (`dados` = ciclo 16→15 já resolvido
 * pelo filtro de Data de Referência). Mesma regra de soma/agrupamento por
 * operador, só troca a origem do intervalo de datas.
 */
export function QuebraCaixaTab({ dados }: { dados: ControlesCaixaData["quebraCaixa"] }) {
  const [intervalo, setIntervalo] = useState<{ inicio: string; fim: string } | null>(null);
  const [dadosIntervalo, setDadosIntervalo] = useState<ControlesCaixaData["quebraCaixa"] | null>(null);
  const [pendente, iniciarTransicao] = useTransition();

  const dadosExibidos = dadosIntervalo ?? dados;

  function aplicarIntervalo(inicio: string, fim: string) {
    if (!inicio || !fim) return;
    setIntervalo({ inicio, fim });
    iniciarTransicao(async () => {
      const resultado = await buscarQuebraCaixaIntervalo(dataDoInput(inicio), dataDoInput(fim));
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
            Voltar para o ciclo/filtro padrão
          </button>
        )}
        {pendente && <span className="text-xs text-foreground/50">Carregando...</span>}
      </div>
      {intervalo && (
        <p className="text-xs text-foreground/50">
          Mostrando período personalizado: {formatadorData.format(dataDoInput(intervalo.inicio))} até{" "}
          {formatadorData.format(dataDoInput(intervalo.fim))}.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:max-w-md">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Registros no período</p>
          <p className={`mt-1 text-2xl font-semibold ${dadosExibidos.disponivel ? "text-ragga-blue-dark" : "text-foreground/30"}`}>
            {dadosExibidos.disponivel ? dadosExibidos.detalhado.length : "—"}
          </p>
          {!dadosExibidos.disponivel && <p className="mt-2 text-xs text-foreground/50">Sem dados para o período</p>}
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Total Geral de Quebra</p>
          <p className={`mt-1 text-2xl font-semibold ${dadosExibidos.disponivel ? "text-ragga-blue-dark" : "text-foreground/30"}`}>
            {dadosExibidos.disponivel ? formatadorMoeda.format(dadosExibidos.totalGeral ?? 0) : "—"}
          </p>
          {!dadosExibidos.disponivel && <p className="mt-2 text-xs text-foreground/50">Sem dados para o período</p>}
        </Card>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ragga-blue-dark">Consolidado por Operador</h3>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
                <th className="px-4 py-2">Operador</th>
                <th className="px-4 py-2">CPF</th>
                <th className="px-4 py-2">Quantidade</th>
                <th className="px-4 py-2">Valor total</th>
              </tr>
            </thead>
            <tbody>
              {dadosExibidos.porOperador.length === 0 ? (
                <EstadoVazio colSpan={4} />
              ) : (
                dadosExibidos.porOperador.map((linha) => (
                  <tr key={`${linha.cpf}-${linha.operador}`} className="border-b border-ragga-blue/5 last:border-0">
                    <td className="px-4 py-2 font-medium text-ragga-blue-dark">{linha.operador}</td>
                    <td className="px-4 py-2">{linha.cpf}</td>
                    <td className="px-4 py-2">{linha.quantidade}</td>
                    <td className="px-4 py-2">{formatadorMoeda.format(linha.valorTotal)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ragga-blue-dark">Detalhamento por lançamento</h3>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
                <th className="px-4 py-2">Data</th>
                <th className="px-4 py-2">Loja</th>
                <th className="px-4 py-2">Valor</th>
                <th className="px-4 py-2">Motivo</th>
                <th className="px-4 py-2">Operador</th>
                <th className="px-4 py-2">Conferente</th>
                <th className="px-4 py-2">CPF</th>
              </tr>
            </thead>
            <tbody>
              {dadosExibidos.detalhado.length === 0 ? (
                <EstadoVazio colSpan={7} />
              ) : (
                dadosExibidos.detalhado.map((linha, i) => (
                  <tr key={`${linha.unidade}-${i}`} className="border-b border-ragga-blue/5 last:border-0">
                    <td className="px-4 py-2">{formatadorData.format(linha.data)}</td>
                    <td className="px-4 py-2 font-medium text-ragga-blue-dark">{linha.unidade}</td>
                    <td className="px-4 py-2">{formatadorMoeda.format(linha.valor)}</td>
                    <td className="px-4 py-2">{linha.motivo}</td>
                    <td className="px-4 py-2">{linha.operador}</td>
                    <td className="px-4 py-2">{linha.conferente}</td>
                    <td className="px-4 py-2">{linha.cpf}</td>
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
