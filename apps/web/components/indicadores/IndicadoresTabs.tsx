"use client";

import { useRef, useState, useTransition } from "react";
import type { CodigoUnidade } from "@painel/shared";
import { IndicadorPainel } from "./IndicadorPainel";
import { FiltroLojaPeriodo } from "@/components/ui/FiltroLojaPeriodo";
import { paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { dataDMenos1 } from "@/lib/rules/datas";
import { FONTES_INDICADOR, type FonteIndicador, type IndicadorData } from "@/lib/services/indicadores";
import { buscarIndicadorPeriodo } from "@/lib/actions/buscarIndicadorPeriodo";

const FONTES_TELA_INDICADORES: FonteIndicador[] = ["brindes", "cancelamentoSalao", "cancelamentoDelivery"];

/**
 * Sub-abas de fonte (Brindes/Cancelamento Salão/Cancelamento Delivery) +
 * corpo compartilhado `IndicadorPainel` (KPIs, tabelas) — reproduz
 * `createIndicatorController(..., showTabs=true)` do legado. Filtro de
 * Loja + Período (item 2 da etapa de revisão) compartilhado entre as 3
 * sub-abas — cada uma continua aplicando D-1 sobre a mesma referência
 * (regra preservada em `indicadores.server.ts`/`buscarIndicadorPeriodo`).
 */
export function IndicadoresTabs({
  dadosPorFonte,
  dataInicial,
}: {
  dadosPorFonte: Record<FonteIndicador, IndicadorData>;
  dataInicial: Date;
}) {
  const [fonteAtiva, setFonteAtiva] = useState<FonteIndicador>("brindes");
  const [unidade, setUnidade] = useState<string>("TODAS");
  const [dataInicio, setDataInicio] = useState(() => paraInputDate(dataInicial));
  const [dataFim, setDataFim] = useState(() => paraInputDate(dataInicial));
  const [dados, setDados] = useState(dadosPorFonte);
  const [pendente, iniciarTransicao] = useTransition();
  const fontes = FONTES_INDICADOR.filter((f) => FONTES_TELA_INDICADORES.includes(f.fonte));
  // Guarda de corrida: início e fim disparam requisições separadas (cada uma
  // com sua própria promessa); sem isso, uma resposta mais lenta de uma
  // janela desatualizada podia sobrescrever o resultado mais recente/correto
  // (bug real encontrado nesta etapa — só a ÚLTIMA chamada a `recarregar`
  // pode aplicar seu resultado).
  const ultimaRequisicao = useRef(0);

  function recarregar(novaUnidade: string, novoInicio: string, novoFim: string) {
    const idRequisicao = ++ultimaRequisicao.current;
    iniciarTransicao(async () => {
      const inicio = dataDoInput(novoInicio);
      const fim = dataDoInput(novoFim);
      const unidadeFiltro = novaUnidade !== "TODAS" ? (novaUnidade as CodigoUnidade) : undefined;
      const resultados = await Promise.all(
        FONTES_TELA_INDICADORES.map((f) => buscarIndicadorPeriodo(f, inicio, fim, unidadeFiltro))
      );
      if (idRequisicao !== ultimaRequisicao.current) return; // resposta de uma requisição já superada — descartada
      setDados(Object.fromEntries(resultados.map((d) => [d.fonte, d])) as Record<FonteIndicador, IndicadorData>);
    });
  }

  function alterarUnidade(nova: string) {
    setUnidade(nova);
    recarregar(nova, dataInicio, dataFim);
  }

  function alterarInicio(nova: string) {
    setDataInicio(nova);
    recarregar(unidade, nova, dataFim);
  }

  function alterarFim(nova: string) {
    setDataFim(nova);
    recarregar(unidade, dataInicio, nova);
  }

  return (
    <div>
      <div className="border-b border-ragga-blue/10 px-6 py-3">
        <FiltroLojaPeriodo
          unidade={unidade}
          aoAlterarUnidade={alterarUnidade}
          dataInicio={dataInicio}
          dataFim={dataFim}
          aoAlterarInicio={alterarInicio}
          aoAlterarFim={alterarFim}
          carregando={pendente}
        />
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
        <IndicadorPainel dados={dados[fonteAtiva]} dataOcorrencia={dataDMenos1(dataDoInput(dataFim))} />
      </div>
    </div>
  );
}
