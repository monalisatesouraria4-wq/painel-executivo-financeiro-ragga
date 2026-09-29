"use client";

import { useState, useTransition } from "react";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";
import type { AberturaFechamentoData } from "@/lib/services/aberturaFechamento";
import { FiltroDataReferencia, paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { buscarControlesCaixaPorData } from "@/lib/actions/buscarControlesCaixaPorData";
import { buscarAberturaFechamentoPorData } from "@/lib/actions/buscarAberturaFechamentoPorData";
import { FechamentoTab } from "./FechamentoTab";
import { PdvMaquininhaTab } from "./PdvMaquininhaTab";
import { TrocoTab } from "./TrocoTab";
import { ConferenciaTab } from "./ConferenciaTab";
import { QuebraCaixaTab } from "./QuebraCaixaTab";

/**
 * Sub-abas de Controles de Caixa — mesma organização do painel legado
 * (data-sub="fechamento|pdv|troco|conferencia|quebra" dentro de
 * data-tab="controles"). Filtro único de "Data de referência" no topo,
 * compartilhado pelas 5 sub-abas — cada bloco continua aplicando sua
 * própria janela já validada sobre essa mesma data:
 * Fechamento = data exata selecionada (mesmo esquema de `aberturaFechamento.server.ts`,
 * incorporado aqui nesta etapa — sem D-1); PDV × Maquininha = D-2; Troco = semana real
 * (`semanaRealDoPeriodo`); Conferência e Quebra de Caixa = ciclo real
 * 16→15 (`fontesPorPeriodo`). Nenhuma regra de janela foi alterada.
 */
const SUBABAS = [
  { id: "fechamento", nome: "Fechamento" },
  { id: "pdv", nome: "PDV × Maquininha" },
  { id: "troco", nome: "Troco" },
  { id: "conferencia", nome: "Conferência" },
  { id: "quebra", nome: "Quebra de Caixa" },
] as const;

type SubAba = (typeof SUBABAS)[number]["id"];

export function ControlesCaixaTabs({
  dadosIniciais,
  dadosFechamentoIniciais,
  dataInicial,
}: {
  dadosIniciais: ControlesCaixaData;
  dadosFechamentoIniciais: AberturaFechamentoData;
  dataInicial: Date;
}) {
  const [subAtiva, setSubAtiva] = useState<SubAba>("fechamento");
  const [dados, setDados] = useState(dadosIniciais);
  const [dadosFechamento, setDadosFechamento] = useState(dadosFechamentoIniciais);
  const [dataSelecionada, setDataSelecionada] = useState(() => paraInputDate(dataInicial));
  const [pendente, iniciarTransicao] = useTransition();

  function alterarData(novaData: string) {
    setDataSelecionada(novaData);
    iniciarTransicao(async () => {
      const data = dataDoInput(novaData);
      const [resultado, resultadoFechamento] = await Promise.all([
        buscarControlesCaixaPorData(data),
        buscarAberturaFechamentoPorData(data),
      ]);
      setDados(resultado);
      setDadosFechamento(resultadoFechamento);
    });
  }

  return (
    <div>
      <div className="border-b border-ragga-blue/10 px-6 py-3">
        <FiltroDataReferencia valor={dataSelecionada} aoAlterar={alterarData} carregando={pendente} />
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
        {subAtiva === "fechamento" && <FechamentoTab dados={dadosFechamento} />}
        {subAtiva === "pdv" && <PdvMaquininhaTab dados={dados.pdvMaquininha} dataReferencia={dataDoInput(dataSelecionada)} />}
        {subAtiva === "troco" && <TrocoTab dados={dados.troco} />}
        {subAtiva === "conferencia" && <ConferenciaTab dados={dados.conferencia} />}
        {subAtiva === "quebra" && <QuebraCaixaTab dados={dados.quebraCaixa} />}
      </div>
    </div>
  );
}
