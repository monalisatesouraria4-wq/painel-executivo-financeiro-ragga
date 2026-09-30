"use client";

import { useRef, useState, useTransition } from "react";
import type { CodigoUnidade } from "@painel/shared";
import { RetiradaDepositoTab } from "./RetiradaDepositoTab";
import { IndicadorPainel } from "@/components/indicadores/IndicadorPainel";
import { FiltroLojaPeriodo } from "@/components/ui/FiltroLojaPeriodo";
import { paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { dataDMenos1 } from "@/lib/rules/datas";
import type { IndicadorData } from "@/lib/services/indicadores";
import { buscarIndicadorPeriodo } from "@/lib/actions/buscarIndicadorPeriodo";

/**
 * Sub-abas de Retiradas — mesmos rótulos exatos do sidebar do legado
 * (linhas 631-632): "Retirada para Depósito" e "Retirada Compra Direta".
 * Filtro de Loja + Período (item 2 da etapa de revisão) compartilhado
 * entre as duas sub-abas — cada uma continua aplicando sua própria regra
 * (D-1 para Compra Direta; ciclo de depósito, inalterado, para Retirada
 * p/ Depósito) sobre a mesma referência.
 */
const SUBABAS = [
  { id: "deposito", nome: "Retirada para Depósito" },
  { id: "compradireta", nome: "Retirada Compra Direta" },
] as const;

type SubAba = (typeof SUBABAS)[number]["id"];

export function RetiradasTabs({
  compraDireta,
  dataInicial,
}: {
  compraDireta: IndicadorData;
  dataInicial: Date;
}) {
  const [subAtiva, setSubAtiva] = useState<SubAba>("deposito");
  const [unidade, setUnidade] = useState<string>("TODAS");
  const [dataInicio, setDataInicio] = useState(() => paraInputDate(dataInicial));
  const [dataFim, setDataFim] = useState(() => paraInputDate(dataInicial));
  const [dadosCompraDireta, setDadosCompraDireta] = useState(compraDireta);
  const [pendente, iniciarTransicao] = useTransition();
  // Guarda de corrida (mesmo bug real encontrado em IndicadoresTabs.tsx):
  // início e fim disparam chamadas separadas — sem isso, a resposta de uma
  // janela já desatualizada podia chegar depois e sobrescrever o resultado
  // correto da chamada mais recente.
  const ultimaRequisicao = useRef(0);

  function recarregarCompraDireta(novaUnidade: string, novoInicio: string, novoFim: string) {
    const idRequisicao = ++ultimaRequisicao.current;
    iniciarTransicao(async () => {
      const unidadeFiltro = novaUnidade !== "TODAS" ? (novaUnidade as CodigoUnidade) : undefined;
      const resultado = await buscarIndicadorPeriodo("compraDireta", dataDoInput(novoInicio), dataDoInput(novoFim), unidadeFiltro);
      if (idRequisicao !== ultimaRequisicao.current) return; // resposta de uma requisição já superada — descartada
      setDadosCompraDireta(resultado);
    });
  }

  function alterarUnidade(nova: string) {
    setUnidade(nova);
    recarregarCompraDireta(nova, dataInicio, dataFim);
  }

  function alterarInicio(nova: string) {
    setDataInicio(nova);
    recarregarCompraDireta(unidade, nova, dataFim);
  }

  function alterarFim(nova: string) {
    setDataFim(nova);
    recarregarCompraDireta(unidade, dataInicio, nova);
  }

  const unidadeFiltro = unidade !== "TODAS" ? (unidade as CodigoUnidade) : undefined;

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
        {SUBABAS.map((sub) => (
          <button
            key={sub.id}
            type="button"
            onClick={() => setSubAtiva(sub.id)}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              subAtiva === sub.id
                ? "border-ragga-blue text-ragga-blue"
                : "border-transparent text-foreground/60 hover:text-ragga-blue-dark"
            }`}
          >
            {sub.nome}
          </button>
        ))}
      </div>

      <div className="px-6 py-6">
        {subAtiva === "deposito" && (
          <RetiradaDepositoTab periodoInicio={dataDoInput(dataInicio)} periodoFim={dataDoInput(dataFim)} unidade={unidadeFiltro} />
        )}
        {subAtiva === "compradireta" && (
          <IndicadorPainel dados={dadosCompraDireta} dataOcorrencia={dataDMenos1(dataDoInput(dataFim))} />
        )}
      </div>
    </div>
  );
}
