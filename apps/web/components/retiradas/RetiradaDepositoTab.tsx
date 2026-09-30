"use client";

import { useEffect, useState } from "react";
import type { CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import type { RetiradaDepositoPersonalizadoData } from "@/lib/services/retiradaDeposito";
import { buscarRetiradaDepositoPersonalizado } from "@/lib/actions/buscarRetiradaDepositoPersonalizado";

const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Reproduz `renderRetirada`/`renderRetiradaPersonalizado` (legado,
 * linhas 2151-2296). Item 2 da etapa de revisão: o filtro de Loja +
 * Período agora vem do componente pai (`RetiradasTabs`,
 * `FiltroLojaPeriodo` compartilhado) — não há mais um seletor de
 * data/modo próprio aqui, para não duplicar filtro por card. A regra de
 * ciclo (cada ciclo somado por inteiro, nunca misturado com outro) é
 * exatamente a mesma de `buscarRetiradaDepositoPersonalizado`, já
 * validada.
 */
export function RetiradaDepositoTab({
  periodoInicio,
  periodoFim,
  unidade,
}: {
  periodoInicio: Date;
  periodoFim: Date;
  unidade?: CodigoUnidade;
}) {
  const [dados, setDados] = useState<RetiradaDepositoPersonalizadoData | null>(null);

  useEffect(() => {
    let ativo = true;
    buscarRetiradaDepositoPersonalizado(periodoInicio, periodoFim, unidade).then((resultado) => {
      if (ativo) setDados(resultado);
    });
    return () => {
      ativo = false;
    };
  }, [periodoInicio, periodoFim, unidade]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ragga-blue-dark">Retirada para depósito</h2>
      </div>

      <p className="text-xs text-foreground/50">
        Cada ciclo é somado por inteiro e mostrado em uma linha separada — valores de ciclos
        diferentes nunca são somados juntos.
      </p>

      {dados?.conectado === false && (
        <div className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          Banco de dados ainda não conectado (<code>DATABASE_URL</code> não definida) — nenhum valor foi inventado.
        </div>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
              <th className="px-4 py-2">Filial</th>
              <th className="px-4 py-2">Ciclo</th>
              <th className="px-4 py-2">Retirada no ciclo</th>
              <th className="px-4 py-2">Depósito esperado</th>
            </tr>
          </thead>
          <tbody>
            {!dados || dados.linhas.length === 0 ? (
              <EstadoVazio colSpan={4} />
            ) : (
              dados.linhas.map((linha, i) => (
                <tr key={`${linha.unidade}-${i}`} className="border-b border-ragga-blue/5 last:border-0">
                  <td className="px-4 py-2 font-medium text-ragga-blue-dark">{linha.unidade}</td>
                  <td className="px-4 py-2">{linha.cicloLabel}</td>
                  <td className="px-4 py-2">{formatadorMoeda.format(linha.retiradaCiclo)}</td>
                  <td className="px-4 py-2 text-foreground/60">{linha.depositoEsperadoLabel}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
