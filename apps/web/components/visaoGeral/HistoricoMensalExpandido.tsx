"use client";

import { useEffect, useState } from "react";
import type { CodigoUnidade } from "@painel/shared";
import { buscarHistoricoMensalLoja } from "@/lib/actions/buscarHistoricoMensalLoja";
import { rotuloMesCompleto } from "@/lib/services/historicoMensalLoja";
import type { HistoricoMensalLojaData, CelulaMensal } from "@/lib/services/historicoMensalLoja";

const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatadorPercentual = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function CelulaValor({ celula }: { celula: CelulaMensal }) {
  if (!celula.disponivel || celula.valor === undefined) {
    return <span className="text-foreground/40">Sem dados</span>;
  }
  return (
    <span>
      {formatadorMoeda.format(celula.valor)}
      {celula.percentualFaturamento !== undefined && (
        <span className="ml-1 text-foreground/50">({formatadorPercentual.format(celula.percentualFaturamento)}%)</span>
      )}
    </span>
  );
}

/**
 * Histórico mensal REAL de uma loja (itens 4/5 da etapa de revisão) —
 * expandido dentro da linha de "Detalhamento por loja" da Visão Geral,
 * sem sair da página. Busca sob demanda (só ao expandir pela primeira
 * vez), reaproveitando `buscarHistoricoMensalLoja` (mesmas tabelas já
 * usadas em toda a Visão Geral, agrupadas por mês e por loja — nenhuma
 * base/regra nova). Mês sem dado real mostra "Sem dados", nunca zero.
 * Não altera o Comparativo mensal existente (tela separada).
 */
export function HistoricoMensalExpandido({ unidade }: { unidade: CodigoUnidade }) {
  const [dados, setDados] = useState<HistoricoMensalLojaData | null>(null);

  useEffect(() => {
    let ativo = true;
    buscarHistoricoMensalLoja(unidade).then((resultado) => {
      if (ativo) setDados(resultado);
    });
    return () => {
      ativo = false;
    };
  }, [unidade]);

  if (dados === null) {
    return <p className="px-2 py-2 text-xs text-foreground/50">Carregando histórico...</p>;
  }

  if (!dados?.conectado || dados.linhas.length === 0) {
    return <p className="px-2 py-2 text-xs text-foreground/50">Sem histórico mensal disponível para esta loja.</p>;
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left uppercase tracking-wide text-foreground/50">
          <th className="px-2 py-1">Mês</th>
          <th className="px-2 py-1">Faturamento</th>
          <th className="px-2 py-1">Brindes (%)</th>
          <th className="px-2 py-1">Cancel. Salão (%)</th>
          <th className="px-2 py-1">Cancel. Delivery (%)</th>
          <th className="px-2 py-1">Compra Direta (%)</th>
        </tr>
      </thead>
      <tbody>
        {dados.linhas.map((linha) => (
          <tr key={linha.mes} className="border-b border-ragga-blue/5 last:border-0">
            <td className="px-2 py-1.5 font-medium text-ragga-blue-dark">{rotuloMesCompleto(linha.mes)}</td>
            <td className="px-2 py-1.5">
              {linha.faturamento.disponivel && linha.faturamento.valor !== undefined ? (
                formatadorMoeda.format(linha.faturamento.valor)
              ) : (
                <span className="text-foreground/40">Sem dados</span>
              )}
            </td>
            <td className="px-2 py-1.5">
              <CelulaValor celula={linha.brindes} />
            </td>
            <td className="px-2 py-1.5">
              <CelulaValor celula={linha.cancelamentoSalao} />
            </td>
            <td className="px-2 py-1.5">
              <CelulaValor celula={linha.cancelamentoDelivery} />
            </td>
            <td className="px-2 py-1.5">
              <CelulaValor celula={linha.compraDireta} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
