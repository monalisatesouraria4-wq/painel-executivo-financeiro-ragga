"use client";

import { useMemo, useState, useTransition } from "react";
import type { CodigoUnidade } from "@painel/shared";
import type { ControlesCaixaData } from "@/lib/services/controlesCaixa";
import type { AberturaFechamentoData } from "@/lib/services/aberturaFechamento";
import { FiltroDataReferencia, paraInputDate, dataDoInput } from "@/components/ui/FiltroDataReferencia";
import { dataDMenos2 } from "@/lib/rules/datas";
import { buscarControlesCaixaPorData } from "@/lib/actions/buscarControlesCaixaPorData";
import { buscarAberturaFechamentoPorData } from "@/lib/actions/buscarAberturaFechamentoPorData";
import { buscarAberturaFechamentoIntervalo } from "@/lib/actions/buscarAberturaFechamentoIntervalo";
import { buscarPdvMaquininhaIntervalo } from "@/lib/actions/buscarPdvMaquininhaIntervalo";
import { buscarTrocoIntervalo } from "@/lib/actions/buscarTrocoIntervalo";
import { buscarConferenciaIntervalo } from "@/lib/actions/buscarConferenciaIntervalo";
import { buscarQuebraCaixaIntervalo } from "@/lib/actions/buscarQuebraCaixaIntervalo";
import { FechamentoTab } from "./FechamentoTab";
import { PdvMaquininhaTab } from "./PdvMaquininhaTab";
import { TrocoTab } from "./TrocoTab";
import { ConferenciaTab } from "./ConferenciaTab";
import { QuebraCaixaTab } from "./QuebraCaixaTab";

/**
 * Sub-abas de Controles de Caixa — mesma organização do painel legado
 * (data-sub="fechamento|pdv|troco|conferencia|quebra" dentro de
 * data-tab="controles"). Item 2 da etapa de revisão — filtro padrão de
 * Loja + Período:
 *
 * - "Loja" é sempre aplicado, nas duas modalidades abaixo.
 * - Por padrão (sem período ativo), cada sub-aba continua usando
 *   EXATAMENTE sua janela já validada sobre a "Data de referência"
 *   (Fechamento = data exata; PDV × Maquininha = D-2; Troco = semana
 *   real; Conferência/Quebra = ciclo 16→15) — nada mudou aqui, e o
 *   filtro de loja é aplicado client-side, filtrando as linhas/detalhes
 *   já retornados (nenhuma consulta nova, nenhum total de rede alterado).
 * - Ao definir um "Período" (data inicial ≠ data final, ou o botão
 *   aplicado), as 5 sub-abas passam a usar as consultas *Intervalo
 *   (já existentes/adicionadas nesta etapa), que preservam a MESMA regra
 *   de deslocamento aplicada às duas pontas do intervalo (D-2 para PDV;
 *   semana real expandida para Troco; literal para Fechamento/Conferência/
 *   Quebra) — nenhuma regra de negócio foi alterada, só passou a aceitar
 *   um intervalo em vez de uma única referência.
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
  const [unidade, setUnidade] = useState<string>("TODAS");
  const [periodo, setPeriodo] = useState<{ inicio: string; fim: string } | null>(null);
  const [dadosPeriodo, setDadosPeriodo] = useState<{
    fechamento: AberturaFechamentoData;
    pdvMaquininha: ControlesCaixaData["pdvMaquininha"];
    troco: ControlesCaixaData["troco"];
    conferencia: ControlesCaixaData["conferencia"];
    quebraCaixa: ControlesCaixaData["quebraCaixa"];
  } | null>(null);
  const [pendente, iniciarTransicao] = useTransition();

  const unidadeFiltro = unidade !== "TODAS" ? (unidade as CodigoUnidade) : undefined;

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

  function aplicarPeriodo(inicio: string, fim: string, novaUnidade: string) {
    if (!inicio || !fim) return;
    setPeriodo({ inicio, fim });
    iniciarTransicao(async () => {
      const dtInicio = dataDoInput(inicio);
      const dtFim = dataDoInput(fim);
      const unidadeFiltroAtual = novaUnidade !== "TODAS" ? (novaUnidade as CodigoUnidade) : undefined;
      const [fechamentoR, pdvR, trocoR, conferenciaR, quebraR] = await Promise.all([
        buscarAberturaFechamentoIntervalo(dtInicio, dtFim, unidadeFiltroAtual),
        buscarPdvMaquininhaIntervalo(dataDMenos2(dtInicio), dataDMenos2(dtFim), unidadeFiltroAtual),
        buscarTrocoIntervalo(dtInicio, dtFim, unidadeFiltroAtual),
        buscarConferenciaIntervalo(dtInicio, dtFim, unidadeFiltroAtual),
        buscarQuebraCaixaIntervalo(dtInicio, dtFim, unidadeFiltroAtual),
      ]);
      setDadosPeriodo({ fechamento: fechamentoR, pdvMaquininha: pdvR, troco: trocoR, conferencia: conferenciaR, quebraCaixa: quebraR });
    });
  }

  function limparPeriodo() {
    setPeriodo(null);
    setDadosPeriodo(null);
  }

  function alterarUnidade(nova: string) {
    setUnidade(nova);
    if (periodo) aplicarPeriodo(periodo.inicio, periodo.fim, nova);
  }

  // Período SELECIONADO (base do comparativo por loja das sub-abas Fechamento, PDV × Maquininha e Troco): o intervalo
  // escolhido ou, sem período, a data de referência (dia único). Cada sub-aba aplica a sua própria regra de janela.
  const janelaSelecionada = useMemo(
    () =>
      periodo && periodo.inicio && periodo.fim
        ? { inicio: dataDoInput(periodo.inicio), fim: dataDoInput(periodo.fim) }
        : { inicio: dataDoInput(dataSelecionada), fim: dataDoInput(dataSelecionada) },
    [periodo, dataSelecionada]
  );

  const fechamentoExibido = dadosPeriodo?.fechamento ?? dadosFechamento;
  const pdvExibido = dadosPeriodo?.pdvMaquininha ?? dados.pdvMaquininha;
  const trocoExibido = dadosPeriodo?.troco ?? dados.troco;
  const conferenciaExibido = dadosPeriodo?.conferencia ?? dados.conferencia;
  const quebraExibido = dadosPeriodo?.quebraCaixa ?? dados.quebraCaixa;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-4 border-b border-ragga-blue/10 px-6 py-3">
        <FiltroDataReferencia valor={dataSelecionada} aoAlterar={alterarData} carregando={pendente && !periodo} />

        <label className="flex items-center gap-2 text-sm font-medium text-ragga-blue-dark">
          🏪 Loja
          <select
            value={unidade}
            onChange={(e) => alterarUnidade(e.target.value)}
            className="rounded-md border border-ragga-blue/15 bg-ragga-surface px-3 py-2 text-sm"
          >
            <option value="TODAS">Todas as lojas</option>
            {["BG 01", "BG 02", "BG 03", "BG 04", "BG 05", "BG 06", "BG 07", "BG 08 E 09", "BG 10", "BG 11", "BG 12", "BG 13", "IS 01", "IS 02", "IS 03", "ROBS", "MAPOLI"].map(
              (u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              )
            )}
          </select>
        </label>

        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-foreground/60">📅 Período — data inicial</label>
            <input
              type="date"
              value={periodo?.inicio ?? ""}
              onChange={(e) => aplicarPeriodo(e.target.value, periodo?.fim ?? e.target.value, unidade)}
              className="mt-1 rounded-md border border-ragga-blue/15 bg-ragga-surface px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground/60">Data final</label>
            <input
              type="date"
              value={periodo?.fim ?? ""}
              onChange={(e) => aplicarPeriodo(periodo?.inicio ?? e.target.value, e.target.value, unidade)}
              className="mt-1 rounded-md border border-ragga-blue/15 bg-ragga-surface px-3 py-2 text-sm"
            />
          </div>
          {periodo && (
            <button
              type="button"
              onClick={limparPeriodo}
              className="rounded-md border border-ragga-blue/15 px-3 py-2 text-xs font-medium text-ragga-blue-dark hover:bg-ragga-bg"
            >
              Voltar para a Data de referência
            </button>
          )}
        </div>

        {pendente && <span className="text-xs text-foreground/50">Carregando...</span>}
      </div>

      <p className="px-6 pt-2 text-xs text-foreground/50">
        {periodo
          ? "Mostrando o período personalizado selecionado — cada sub-aba aplica sua própria regra de janela (D-2/semana real/ciclo/data exata) sobre as duas pontas do intervalo."
          : "Mostrando a Data de referência — cada sub-aba aplica sua própria janela padrão (Fechamento = data exata; PDV × Maquininha = D-2; Troco = semana real; Conferência/Quebra = ciclo 16→15)."}
      </p>

      <div className="flex flex-wrap gap-1 border-b border-ragga-blue/10 px-6 pt-2">
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
        {subAtiva === "fechamento" && (
          <FechamentoTab dados={fechamentoExibido} unidade={periodo ? undefined : unidadeFiltro} janela={janelaSelecionada} lojaFiltro={unidadeFiltro} />
        )}
        {subAtiva === "pdv" && (
          <PdvMaquininhaTab
            dados={pdvExibido}
            dataReferencia={dataDoInput(dataSelecionada)}
            unidade={periodo ? undefined : unidadeFiltro}
            janela={janelaSelecionada}
            lojaFiltro={unidadeFiltro}
          />
        )}
        {subAtiva === "troco" && <TrocoTab dados={trocoExibido} unidade={periodo ? undefined : unidadeFiltro} janela={janelaSelecionada} lojaFiltro={unidadeFiltro} />}
        {subAtiva === "conferencia" && <ConferenciaTab dados={conferenciaExibido} unidade={periodo ? undefined : unidadeFiltro} />}
        {subAtiva === "quebra" && <QuebraCaixaTab dados={quebraExibido} unidade={periodo ? undefined : unidadeFiltro} lojaFiltro={unidadeFiltro} />}
      </div>
    </div>
  );
}
