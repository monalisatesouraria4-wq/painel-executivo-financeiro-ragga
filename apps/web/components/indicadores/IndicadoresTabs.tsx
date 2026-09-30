"use client";

import { useState, useTransition } from "react";
import { IndicadorPainel } from "./IndicadorPainel";
import { FiltroDataReferencia, paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { dataDMenos1 } from "@/lib/rules/datas";
import { FONTES_INDICADOR, type FonteIndicador, type IndicadorData } from "@/lib/services/indicadores";
import { buscarIndicadorPorData } from "@/lib/actions/buscarIndicadorPorData";

const FONTES_TELA_INDICADORES: FonteIndicador[] = ["brindes", "cancelamentoSalao", "cancelamentoDelivery"];

/**
 * Sub-abas de fonte (Brindes/Cancelamento Salão/Cancelamento Delivery) +
 * corpo compartilhado `IndicadorPainel` (filtros, KPIs, tabelas) —
 * reproduz `createIndicatorController(..., showTabs=true)` do legado.
 * Filtro de Data de Referência compartilhado entre as 3 sub-abas — cada
 * uma continua aplicando D-1 sobre a mesma data.
 */
export function IndicadoresTabs({
  dadosPorFonte,
  dataInicial,
}: {
  dadosPorFonte: Record<FonteIndicador, IndicadorData>;
  dataInicial: Date;
}) {
  const [fonteAtiva, setFonteAtiva] = useState<FonteIndicador>("brindes");
  const [dataSelecionada, setDataSelecionada] = useState(() => paraInputDate(dataInicial));
  const [dados, setDados] = useState(dadosPorFonte);
  const [pendente, iniciarTransicao] = useTransition();
  const fontes = FONTES_INDICADOR.filter((f) => FONTES_TELA_INDICADORES.includes(f.fonte));

  function alterarData(novaData: string) {
    setDataSelecionada(novaData);
    iniciarTransicao(async () => {
      const data = dataDoInput(novaData);
      const resultados = await Promise.all(FONTES_TELA_INDICADORES.map((f) => buscarIndicadorPorData(f, data)));
      setDados(Object.fromEntries(resultados.map((d) => [d.fonte, d])) as Record<FonteIndicador, IndicadorData>);
    });
  }

  return (
    <div>
      <div className="border-b border-ragga-blue/10 px-6 py-3">
        <FiltroDataReferencia valor={dataSelecionada} aoAlterar={alterarData} carregando={pendente} />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-ragga-blue/10 px-6">
        {fontes.map((f) => (
          <button
            key={f.fonte}
            type="button"
            onClick={() => setFonteAtiva(f.fonte)}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              fonteAtiva === f.fonte
                ? "border-ragga-blue text-ragga-blue"
                : "border-transparent text-foreground/60 hover:text-ragga-blue-dark"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="px-6 py-6">
        <IndicadorPainel dados={dados[fonteAtiva]} dataOcorrencia={dataDMenos1(dataDoInput(dataSelecionada))} />
      </div>
    </div>
  );
}
