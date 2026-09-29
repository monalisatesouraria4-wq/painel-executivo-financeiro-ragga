"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { MiniBarChart } from "./MiniBarChart";
import type { ComparativoMensalData, IndicadorMensal } from "@/lib/services/comparativoMensal";
import { rotuloMes } from "@/lib/services/comparativoMensal";

const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatadorInteiro = new Intl.NumberFormat("pt-BR");

type TipoFormato = "moeda" | "percentual" | "inteiro";

function formatarValor(valor: number, tipo: TipoFormato): string {
  if (tipo === "moeda") return formatadorMoeda.format(valor);
  if (tipo === "percentual") return `${formatadorPercentual.format(valor)}%`;
  return formatadorInteiro.format(valor);
}

function LinhaTabela({ indicador, meses, tipo }: { indicador: IndicadorMensal; meses: string[]; tipo: TipoFormato }) {
  return (
    <tr className="border-b border-ragga-blue/5 last:border-0">
      <td className="sticky left-0 bg-ragga-surface px-4 py-2 font-medium text-ragga-blue-dark">{indicador.label}</td>
      {meses.map((mes) => {
        const celula = indicador.porMes[mes];
        return (
          <td key={mes} className="px-4 py-2 text-right whitespace-nowrap">
            {celula?.disponivel && celula.valor !== undefined ? (
              formatarValor(celula.valor, tipo)
            ) : (
              <span className="text-foreground/40">Sem dados</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function CardResumo({
  titulo,
  indicador,
  meses,
  tipo,
}: {
  titulo: string;
  indicador: IndicadorMensal;
  meses: string[];
  tipo: TipoFormato;
}) {
  const mesesComDado = meses.filter((m) => indicador.porMes[m]?.disponivel);
  const ultimoMes = mesesComDado[mesesComDado.length - 1];
  const penultimoMes = mesesComDado[mesesComDado.length - 2];
  const valorAtual = ultimoMes ? indicador.porMes[ultimoMes].valor : undefined;
  const valorAnterior = penultimoMes ? indicador.porMes[penultimoMes].valor : undefined;

  const variacao =
    valorAtual !== undefined && valorAnterior !== undefined && valorAnterior !== 0
      ? ((valorAtual - valorAnterior) / Math.abs(valorAnterior)) * 100
      : null;

  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">{titulo}</p>
      {valorAtual !== undefined ? (
        <>
          <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">{formatarValor(valorAtual, tipo)}</p>
          <p className="mt-1 text-xs text-foreground/50">
            {ultimoMes && rotuloMes(ultimoMes)}
            {variacao !== null && (
              <span className="ml-2 text-foreground/60">
                {variacao >= 0 ? "▲" : "▼"} {formatadorPercentual.format(Math.abs(variacao))}% vs {penultimoMes && rotuloMes(penultimoMes)}
              </span>
            )}
          </p>
        </>
      ) : (
        <p className="mt-1 text-2xl font-semibold text-foreground/30">Sem dados</p>
      )}
    </Card>
  );
}

/**
 * Uma seção por indicador — título, badge de variação (mês mais recente
 * vs anterior, SEM qualificar como bom/ruim: nenhuma cor de semáforo,
 * só a seta e o percentual) e o gráfico. Indicadores sem NENHUM dado no
 * período selecionado não renderizam nada (evita gráfico vazio na tela).
 */
function SecaoGrafico({ indicador, meses, tipo }: { indicador: IndicadorMensal; meses: string[]; tipo: TipoFormato }) {
  const pontos = meses.map((mes) => ({
    mes,
    rotulo: rotuloMes(mes),
    disponivel: Boolean(indicador.porMes[mes]?.disponivel),
    valor: indicador.porMes[mes]?.valor,
  }));

  const mesesComDado = meses.filter((m) => indicador.porMes[m]?.disponivel);
  if (mesesComDado.length === 0) return null;

  const ultimoMes = mesesComDado[mesesComDado.length - 1];
  const penultimoMes = mesesComDado[mesesComDado.length - 2];
  const valorAtual = indicador.porMes[ultimoMes]?.valor;
  const valorAnterior = penultimoMes ? indicador.porMes[penultimoMes]?.valor : undefined;
  const variacao =
    valorAtual !== undefined && valorAnterior !== undefined && valorAnterior !== 0
      ? ((valorAtual - valorAnterior) / Math.abs(valorAnterior)) * 100
      : null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ragga-blue-dark">{indicador.label}</h3>
        {variacao !== null && (
          <span className="text-xs text-foreground/60">
            {variacao >= 0 ? "▲" : "▼"} {formatadorPercentual.format(Math.abs(variacao))}% vs {rotuloMes(penultimoMes!)}
          </span>
        )}
      </div>
      <Card>
        <MiniBarChart
          pontos={pontos}
          formatador={(v) => (tipo === "moeda" ? formatadorMoeda.format(v) : formatarValor(v, tipo))}
        />
      </Card>
    </div>
  );
}

export function ComparativoMensalView({ dados }: { dados: ComparativoMensalData }) {
  const [mesesSelecionados, setMesesSelecionados] = useState<string[]>(dados.meses);

  const mesesExibidos = useMemo(
    () => dados.meses.filter((m) => mesesSelecionados.includes(m)),
    [dados.meses, mesesSelecionados]
  );

  function alternarMes(mes: string) {
    setMesesSelecionados((atual) => (atual.includes(mes) ? atual.filter((m) => m !== mes) : [...atual, mes].sort()));
  }

  if (dados.meses.length === 0) {
    return (
      <main className="flex flex-1 flex-col gap-6 px-6 py-6">
        <p className="text-foreground/60">
          Sem dados disponíveis para o comparativo — nenhuma base com histórico foi encontrada.
        </p>
      </main>
    );
  }

  const linhas: { indicador: IndicadorMensal; tipo: TipoFormato }[] = [
    { indicador: dados.faturamento, tipo: "moeda" },
    { indicador: dados.brindes, tipo: "moeda" },
    { indicador: dados.percentualBrindes, tipo: "percentual" },
    { indicador: dados.cancelamentoSalao, tipo: "moeda" },
    { indicador: dados.cancelamentoDelivery, tipo: "moeda" },
    { indicador: dados.compraDireta, tipo: "moeda" },
    { indicador: dados.trocoDiferenca, tipo: "moeda" },
    { indicador: dados.trocoDivergencias, tipo: "inteiro" },
    { indicador: dados.quebraCaixa, tipo: "moeda" },
  ];

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-6">
      {/* Filtro de período */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ragga-blue-dark">Meses no comparativo</h2>
        <div className="flex flex-wrap gap-2">
          {dados.meses.map((mes) => (
            <button
              key={mes}
              type="button"
              onClick={() => alternarMes(mes)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                mesesSelecionados.includes(mes)
                  ? "border-ragga-blue bg-ragga-blue text-white"
                  : "border-ragga-blue/20 text-foreground/60 hover:bg-ragga-bg"
              }`}
            >
              {rotuloMes(mes)}
            </button>
          ))}
        </div>
      </section>

      {/* Cards resumo */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CardResumo titulo="Faturamento" indicador={dados.faturamento} meses={mesesExibidos} tipo="moeda" />
        <CardResumo titulo="% Brindes / Faturamento" indicador={dados.percentualBrindes} meses={mesesExibidos} tipo="percentual" />
        <CardResumo titulo="Cancelamento Delivery" indicador={dados.cancelamentoDelivery} meses={mesesExibidos} tipo="moeda" />
        <CardResumo titulo="Quebra de Caixa" indicador={dados.quebraCaixa} meses={mesesExibidos} tipo="moeda" />
      </section>

      {/* Tabela comparativa */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ragga-blue-dark">Tabela comparativa</h2>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
                <th className="sticky left-0 bg-ragga-surface px-4 py-2">Indicador</th>
                {mesesExibidos.map((mes) => (
                  <th key={mes} className="px-4 py-2 text-right">
                    {rotuloMes(mes)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ indicador, tipo }) => (
                <LinhaTabela key={indicador.label} indicador={indicador} meses={mesesExibidos} tipo={tipo} />
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      {/* Gráficos de evolução */}
      <section className="space-y-6">
        <h2 className="text-sm font-semibold text-ragga-blue-dark">Evolução mês a mês</h2>
        <div className="grid grid-cols-1 gap-6">
          <SecaoGrafico indicador={dados.faturamento} meses={mesesExibidos} tipo="moeda" />
          <SecaoGrafico indicador={dados.percentualBrindes} meses={mesesExibidos} tipo="percentual" />
          <SecaoGrafico indicador={dados.cancelamentoSalao} meses={mesesExibidos} tipo="moeda" />
          <SecaoGrafico indicador={dados.cancelamentoDelivery} meses={mesesExibidos} tipo="moeda" />
          <SecaoGrafico indicador={dados.compraDireta} meses={mesesExibidos} tipo="moeda" />
          <SecaoGrafico indicador={dados.trocoDiferenca} meses={mesesExibidos} tipo="moeda" />
          <SecaoGrafico indicador={dados.quebraCaixa} meses={mesesExibidos} tipo="moeda" />
        </div>
      </section>

      {/* Indicadores fora do comparativo */}
      {dados.indicadoresExcluidos.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ragga-blue-dark">Fora do comparativo (histórico insuficiente)</h2>
          <Card>
            <ul className="space-y-2 text-sm">
              {dados.indicadoresExcluidos.map((item) => (
                <li key={item.nome}>
                  <span className="font-medium text-ragga-blue-dark">{item.nome}:</span>{" "}
                  <span className="text-foreground/60">{item.motivo}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </main>
  );
}
