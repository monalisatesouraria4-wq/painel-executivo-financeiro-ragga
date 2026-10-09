"use client";

import { useMemo, useState } from "react";
import type { CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { Item, Situacao, moeda as moedaPainel, sinalMoeda } from "@/components/ui/PainelAnalitico";
import { PainelLojasComparativo, useComparacaoPeriodo, formatadorDiaPainel, diaBR } from "./PainelLojasComparativo";
import { buscarAberturaFechamentoIntervalo } from "@/lib/actions/buscarAberturaFechamentoIntervalo";
import { agregarFechamento, recortarLojaPainel, redeFechamento, type MetricaLoja } from "@/lib/services/controlesLojaPainel";
import { filtrarLinhasPorStatus, type AberturaFechamentoData, type CaixaAberturaFechamentoLinha, type FiltroStatusFechamento } from "@/lib/services/aberturaFechamento";
import {
  abertoVencido,
  dataBR,
  dataFechamentoISO,
  hojeBrasilISO,
  pendenciasPorLoja,
  prazoPendencia,
  resumirFechamentoGerencial,
  semanaAnterior,
  semanaDe,
  statusConciliacao,
  totalDifereDaSoma,
} from "@/lib/services/fechamentoGerencial";

const formatadorMoeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const moeda = (v: number) => formatadorMoeda.format(v);

/**
 * Sub-aba Fechamento. Cada linha da base = um FECHAMENTO individual de caixa por operador (não é PDV físico distinto).
 * Situação oficial = `situacao` da base (Aberto / Fechado / Conciliado) — nunca deduzida dos valores. Regras e prazos
 * em `lib/services/fechamentoGerencial.ts`; as fórmulas do comparativo por loja (Σ DIF. TOTAL) seguem as mesmas de
 * `controlesLojaPainel.ts`. Filtros de Data de referência, Período e Loja vêm de `ControlesCaixaTabs` (inalterados).
 */
function CardIndicador({
  titulo,
  valor,
  detalhe,
  disponivel,
  aviso,
}: {
  titulo: string;
  valor: string;
  detalhe?: string;
  disponivel: boolean;
  aviso?: boolean;
}) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">{titulo}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${disponivel ? "text-ragga-blue-dark" : "text-foreground/30"}`}>{disponivel ? valor : "—"}</p>
      {detalhe && disponivel && <p className={`mt-2 text-xs ${aviso ? "font-semibold text-semaforo-amarelo" : "text-foreground/50"}`}>{detalhe}</p>}
    </Card>
  );
}

const classeValor = (v: number | null) => (v !== null && v < 0 ? "font-semibold text-semaforo-vermelho" : "");

/** Situação de conciliação do registro, com o prazo quando é uma pendência. */
function CelulaSituacao({ linha, hoje }: { linha: CaixaAberturaFechamentoLinha; hoje: string }) {
  const st = statusConciliacao(linha);
  if (st === "conciliado") return <span className="font-medium text-semaforo-verde">Conciliado</span>;
  if (st === "fechado-pendente") {
    const p = prazoPendencia(linha, hoje);
    return (
      <span>
        <span className="font-medium text-ragga-blue-dark">Pendente de conciliação</span>
        {p && (
          <span
            title={`Prazo de conciliação: quarta-feira ${dataBR(p.prazo)}`}
            className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${p.situacao === "vencida" ? "bg-semaforo-vermelho/10 text-semaforo-vermelho" : "bg-ragga-blue/10 text-ragga-blue"}`}
          >
            {p.situacao === "vencida" ? "Vencida" : "No prazo"}
          </span>
        )}
      </span>
    );
  }
  if (st === "aberto") {
    const vencido = abertoVencido(linha, hoje);
    return (
      <span>
        <span className="font-medium text-ragga-blue-dark">{vencido === false ? "Em operação" : "Em aberto"}</span>
        {vencido !== false && <span className="ml-2 rounded bg-semaforo-amarelo/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-semaforo-amarelo">Sem fechamento</span>}
      </span>
    );
  }
  return <span>{linha.situacao || "—"}</span>;
}

/** Dif. conciliação: só tem significado para Conciliado (sem ajuste = conciliado sem diferença adicional); Fechado fica pendente. */
function CelulaDifConciliacao({ linha }: { linha: CaixaAberturaFechamentoLinha }) {
  const st = statusConciliacao(linha);
  if (st === "fechado-pendente") return <span className="text-xs text-foreground/50">Pendente</span>;
  if (st === "aberto") return <span className="text-foreground/40">—</span>;
  if (linha.difConciliacao === null || Math.abs(linha.difConciliacao) < 0.005) return <span className="text-xs text-foreground/50">Sem ajuste</span>;
  return <span className={classeValor(linha.difConciliacao)}>{moeda(linha.difConciliacao)}</span>;
}

function CelulaDifTotal({ linha }: { linha: CaixaAberturaFechamentoLinha }) {
  if (linha.difTotal === null) return <span className="text-foreground/40">—</span>;
  const pendente = statusConciliacao(linha) === "fechado-pendente";
  return (
    <span className={classeValor(linha.difTotal)}>
      {moeda(linha.difTotal)}
      {pendente && (
        <span title="Caixa ainda não conciliado: a diferença total é provisória" className="ml-1 text-[10px] font-normal text-foreground/45">
          prov.
        </span>
      )}
      {totalDifereDaSoma(linha) && statusConciliacao(linha) === "conciliado" && (
        <span title="A Dif. total da base difere de Dif. fechamento + Dif. conciliação (valor da base preservado)" className="ml-1 cursor-help rounded bg-semaforo-amarelo/10 px-1 text-[10px] font-semibold text-semaforo-amarelo">
          ≠ soma
        </span>
      )}
    </span>
  );
}

function CelulaDataFechamento({ linha }: { linha: CaixaAberturaFechamentoLinha }) {
  const iso = dataFechamentoISO(linha.data, linha.fechamento);
  if (!iso) return <span className={statusConciliacao(linha) === "aberto" ? "text-foreground/40" : "text-xs font-medium text-semaforo-amarelo"}>{statusConciliacao(linha) === "aberto" ? "Não fechado" : "Data não identificada"}</span>;
  return <span className="whitespace-nowrap font-medium text-ragga-blue-dark">{dataBR(iso)}</span>;
}

export function FechamentoTab({
  dados,
  unidade,
  janela,
  lojaFiltro,
  aoSelecionarPeriodo,
}: {
  dados: AberturaFechamentoData;
  unidade?: CodigoUnidade;
  /** Período usado pela aba (data de referência exata ou intervalo escolhido) — base do comparativo por loja. */
  janela: { inicio: Date; fim: Date };
  /** Loja selecionada no filtro (mostra só ela na tabela por loja). */
  lojaFiltro?: CodigoUnidade;
  /** Atalho de período (usa o MESMO filtro de Período da página); ausente = sem atalhos. */
  aoSelecionarPeriodo?: (inicio: string, fim: string) => void;
}) {
  // Filtro de STATUS (Todos/Conciliado/Fechado/Aberto): recorta as linhas já carregadas (junto com Loja/Data).
  const [status, setStatus] = useState<FiltroStatusFechamento>("TODOS");
  const hoje = useMemo(() => hojeBrasilISO(), []);
  const linhasLoja = unidade ? dados.linhas.filter((l) => l.unidade === unidade) : dados.linhas;
  const linhas = filtrarLinhasPorStatus(linhasLoja, status);
  const resumo = useMemo(() => resumirFechamentoGerencial(linhas, hoje), [linhas, hoje]);
  const disponivel = linhas.length > 0;
  const semDadosPorStatus = status !== "TODOS" && linhas.length === 0;
  const pendencias = useMemo(() => pendenciasPorLoja(linhas, hoje), [linhas, hoje]);

  // Análise por loja (REDE → LOJA → caixas) + comparativo: o período comparado é o equivalente anterior do MESMO período.
  const comp = useComparacaoPeriodo(janela, (ini, fim) => buscarAberturaFechamentoIntervalo(ini, fim));
  const atualPainel = useMemo(() => recortarLojaPainel(agregarFechamento(linhas), lojaFiltro, redeFechamento), [linhas, lojaFiltro]);
  const comparadoPainel = useMemo(
    () => (comp.dados ? recortarLojaPainel(agregarFechamento(filtrarLinhasPorStatus(comp.dados.linhas, status)), lojaFiltro, redeFechamento) : null),
    [comp.dados, status, lojaFiltro]
  );
  const periodoAtualTxt =
    janela.inicio.getTime() === janela.fim.getTime()
      ? formatadorDiaPainel.format(janela.inicio)
      : `${formatadorDiaPainel.format(janela.inicio)} a ${formatadorDiaPainel.format(janela.fim)}`;
  const periodoCompTxt = comp.compInicio && comp.compFim ? `${diaBR(comp.compInicio)} a ${diaBR(comp.compFim)}` : "—";

  // Prazo de conciliação do período de fechamento: a quarta-feira seguinte à semana (seg–dom) de cada dia do período.
  const iniISO = janela.inicio.toISOString().slice(0, 10);
  const fimISO = janela.fim.toISOString().slice(0, 10);
  const semanaCompleta = semanaDe(iniISO).inicio === iniISO && semanaDe(iniISO).fim === fimISO;
  const ehSemanaAtual = semanaCompleta && semanaDe(hoje).inicio === iniISO;
  const prazoTexto = (() => {
    const p = prazoPendencia({ situacao: "Fechado", data: fimISO }, hoje);
    if (!p) return "—";
    return `${dataBR(p.prazo)} (quarta-feira) para os caixas ${semanaCompleta ? `da semana de ${dataBR(iniISO)} a ${dataBR(fimISO)}` : `até ${dataBR(fimISO)}`} — ${p.situacao === "vencida" ? "prazo encerrado" : "dentro do prazo"}`;
  })();

  return (
    <div className="space-y-4">
      {/* Referência × comparação × prazo (os três períodos são coisas diferentes) */}
      <Card className="space-y-3">
        <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Período de fechamento operacional</p>
            <p className="mt-1 font-medium text-ragga-blue-dark">{periodoAtualTxt}</p>
            <p className="text-xs text-foreground/50">{semanaCompleta ? (ehSemanaAtual ? "Semana completa (seg–dom), em andamento" : "Semana completa (seg–dom)") : "Período livre — para a apresentação semanal use a semana completa (seg–dom)"}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Período comparado</p>
            <p className="mt-1 font-medium text-ragga-blue-dark">{periodoCompTxt}</p>
            <p className="text-xs text-foreground/50">Equivalente anterior (editável no painel por loja abaixo)</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Prazo de conciliação financeira</p>
            <p className="mt-1 font-medium text-ragga-blue-dark">{prazoTexto}</p>
            <p className="text-xs text-foreground/50">Apresentação na quinta; conciliar até quarta os caixas da semana anterior (seg–dom)</p>
          </div>
        </div>
        {aoSelecionarPeriodo && (
          <div className="flex flex-wrap items-center gap-2 border-t border-ragga-blue/10 pt-3 text-xs">
            <span className="font-medium text-foreground/60">Atalhos:</span>
            <button
              type="button"
              onClick={() => {
                const s = semanaAnterior(hoje);
                aoSelecionarPeriodo(s.inicio, s.fim);
              }}
              className="rounded-md border border-ragga-blue/20 bg-white px-3 py-1.5 font-medium text-ragga-blue-dark hover:bg-ragga-blue/5"
            >
              Semana anterior (seg–dom)
            </button>
            <button
              type="button"
              onClick={() => {
                const s = semanaDe(hoje);
                aoSelecionarPeriodo(s.inicio, s.fim);
              }}
              className="rounded-md border border-ragga-blue/20 bg-white px-3 py-1.5 font-medium text-ragga-blue-dark hover:bg-ragga-blue/5"
            >
              Semana atual (seg–dom)
            </button>
          </div>
        )}
      </Card>

      <label className="flex items-center gap-2 text-sm font-medium text-ragga-blue-dark">
        Status
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as FiltroStatusFechamento)}
          className="rounded-md border border-ragga-blue/15 bg-ragga-surface px-3 py-2 text-sm"
        >
          <option value="TODOS">Todos</option>
          <option value="Conciliado">Conciliado</option>
          <option value="Fechado">Fechado</option>
          <option value="Aberto">Aberto</option>
        </select>
      </label>

      {!disponivel && (
        <div className="rounded-lg border border-ragga-blue/15 bg-ragga-bg px-4 py-3 text-sm text-ragga-blue-dark">
          {semDadosPorStatus ? "Sem dados no período." : "Sem dados para esta referência."}
          {!semDadosPorStatus && dados.dataMaisRecenteDisponivel && (
            <span className="text-foreground/50"> Última data com registro: {dados.dataMaisRecenteDisponivel.toLocaleDateString("pt-BR", { timeZone: "UTC" })}.</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <CardIndicador
          titulo="Caixas fechados"
          valor={String(resumo.fechados)}
          detalhe={`Fechamentos operacionais concluídos (Fechado + Conciliado), de ${resumo.registros} registros no recorte`}
          disponivel={disponivel}
        />
        <CardIndicador
          titulo="Caixas em aberto"
          valor={String(resumo.emAberto)}
          detalhe={`Abertos de dias anteriores, sem fechamento operacional${resumo.emOperacao > 0 ? ` · +${resumo.emOperacao} em operação hoje` : ""}`}
          disponivel={disponivel}
          aviso={resumo.emAberto > 0}
        />
        <CardIndicador titulo="Caixas conciliados" valor={String(resumo.conciliados)} detalhe="Conferência financeira concluída" disponivel={disponivel} />
        <CardIndicador
          titulo="Pendentes de conciliação"
          valor={String(resumo.pendentes)}
          detalhe={`Fechados aguardando conferência financeira: ${resumo.pendentesVencidas} com prazo vencido · ${resumo.pendentesNoPrazo} no prazo`}
          disponivel={disponivel}
          aviso={resumo.pendentesVencidas > 0}
        />
        <CardIndicador
          titulo="Diferença dos fechamentos"
          valor={moeda(resumo.difFechamento)}
          detalhe={`Soma da Dif. fechamento (operador) de ${resumo.registros - resumo.registrosSemDifFechamento} registros${resumo.registrosSemDifFechamento > 0 ? `; ${resumo.registrosSemDifFechamento} sem valor na base não entram` : ""}`}
          disponivel={disponivel}
        />
        <CardIndicador
          titulo="Diferença após conciliação"
          valor={moeda(resumo.difAposConciliacao)}
          detalhe={`Soma da Dif. total dos ${resumo.conciliados} registros conciliados (valor da base)${resumo.totalDifereDaSoma > 0 ? ` · ⚠ ${resumo.totalDifereDaSoma} com Dif. total ≠ fechamento + conciliação` : ""}`}
          disponivel={disponivel}
          aviso={resumo.totalDifereDaSoma > 0}
        />
      </div>
      {disponivel && (
        <p className="text-[11px] text-foreground/45">
          Cada registro é um fechamento individual de caixa por operador (não é PDV físico distinto nem movimento isolado). Fechados = Fechado + Conciliado; um caixa fechado pode seguir pendente de conciliação. Em aberto = situação Aberto de dia anterior.
          {resumo.outrasSituacoes > 0 && ` Há ${resumo.outrasSituacoes} registro(s) com situação fora de Aberto/Fechado/Conciliado.`}
        </p>
      )}

      <PainelLojasComparativo<CaixaAberturaFechamentoLinha[]>
        titulo="🏪 Fechamento de caixa por loja"
        rotuloValor="Dif. total"
        periodoAtualTxt={periodoAtualTxt}
        compInicio={comp.compInicio}
        compFim={comp.compFim}
        compManual={comp.compManual}
        setCompManual={comp.setCompManual}
        carregando={comp.pendente}
        atual={atualPainel}
        comparacao={comparadoPainel}
        lojaFiltro={lojaFiltro}
        opcoesOrdem={[
          { id: "valor", rotulo: "Valor (mais negativo primeiro)" },
          { id: "loja", rotulo: "Loja" },
          { id: "performance", rotulo: "Performance / Status" },
        ]}
        ordemInicial="valor"
        sentidoValor="negativo-primeiro"
        colunasExtras={[
          { titulo: "Registros", celula: (l) => l.quantidade },
          { titulo: "Pendentes concil.", celula: (l) => l.detalhe.filter((x) => statusConciliacao(x) === "fechado-pendente").length },
          { titulo: "Em aberto", celula: (l) => l.detalhe.filter((x) => statusConciliacao(x) === "aberto").length },
        ]}
        notaStatus="Dif. total = soma do campo DIF. TOTAL da base (com sinal: negativo = falta; registros sem DIF. TOTAL não entram). Variação = atual − comparado: uma variação positiva significa diferença menos negativa (ex.: −R$ 1.351,41 contra −R$ 3.456,47 = +R$ 2.105,06), mas ainda há diferença a acompanhar. Status = distância até zero contra o período comparado (menor = 🟢 melhorou · maior = 🔴 piorou). Não há meta/limite de Fechamento cadastrado. O filtro de Status acima vale para esta tabela."
        renderDetalhe={(loja, c, temBase, periodoComp) => <DetalheFechamentoLoja loja={loja} comparada={c} temBase={temBase} periodoComp={periodoComp} hoje={hoje} />}
      />

      {pendencias.length > 0 && (
        <>
          <p className="pt-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Pendências de conciliação por loja</p>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
                  <th className="px-4 py-2">Loja</th>
                  <th className="px-4 py-2">Prazo vencido</th>
                  <th className="px-4 py-2">No prazo</th>
                  <th className="px-4 py-2">Caixa vencido mais antigo</th>
                </tr>
              </thead>
              <tbody>
                {pendencias.map((p) => (
                  <tr key={p.unidade} className="border-b border-ragga-blue/5 last:border-0">
                    <td className="px-4 py-2 font-medium text-ragga-blue-dark">{p.unidade}</td>
                    <td className={`px-4 py-2 ${p.vencidas > 0 ? "font-semibold text-semaforo-vermelho" : "text-foreground/50"}`}>{p.vencidas}</td>
                    <td className="px-4 py-2">{p.noPrazo}</td>
                    <td className="px-4 py-2">{p.maisAntiga ? dataBR(p.maisAntiga) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p className="text-[11px] text-foreground/45">Prazo vencido = Fechado cujo prazo (quarta-feira seguinte à semana seg–dom do caixa) já passou sem conciliação. Antes disso a pendência está no prazo — não é atraso.</p>
        </>
      )}

      <p className="pt-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Detalhamento por caixa</p>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b border-ragga-blue/10 text-left text-xs uppercase tracking-wide text-foreground/50">
              <th className="px-4 py-2">Loja</th>
              <th className="px-4 py-2">Caixa</th>
              <th className="px-4 py-2">Movimento</th>
              <th className="px-4 py-2">Data do fechamento</th>
              <th className="px-4 py-2">Abertura</th>
              <th className="px-4 py-2">Operador</th>
              <th className="px-4 py-2">Situação</th>
              <th className="px-4 py-2 text-right">Dif. Fechamento</th>
              <th className="px-4 py-2 text-right">Dif. Conciliação</th>
              <th className="px-4 py-2 text-right">Dif. Total</th>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <EstadoVazio colSpan={10} />
            ) : (
              linhas.map((linha, i) => (
                <tr key={`${linha.unidade}-${linha.data ?? ""}-${linha.caixa}-${linha.movimento}-${i}`} className="border-b border-ragga-blue/5 last:border-0">
                  <td className="px-4 py-2 font-medium text-ragga-blue-dark">{linha.unidade}</td>
                  <td className="px-4 py-2">{linha.caixa}</td>
                  <td className="px-4 py-2">{linha.movimento}</td>
                  <td className="px-4 py-2">
                    <CelulaDataFechamento linha={linha} />
                  </td>
                  <td className="px-4 py-2">{linha.abertura ?? "—"}</td>
                  <td className="px-4 py-2">{linha.operador ?? "—"}</td>
                  <td className="px-4 py-2">
                    <CelulaSituacao linha={linha} hoje={hoje} />
                  </td>
                  <td className={`px-4 py-2 text-right ${classeValor(linha.difFechamento)}`}>{linha.difFechamento !== null ? moeda(linha.difFechamento) : "—"}</td>
                  <td className="px-4 py-2 text-right">
                    <CelulaDifConciliacao linha={linha} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <CelulaDifTotal linha={linha} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/**
 * Expansão da loja em 3 níveis: (1) rede = painel acima; (2) resumo compacto da loja; (3) caixas individuais.
 * Σ da coluna Dif. total = diferença da loja (mesma fonte do painel).
 */
function DetalheFechamentoLoja({
  loja,
  comparada,
  temBase,
  periodoComp,
  hoje,
}: {
  loja: MetricaLoja<CaixaAberturaFechamentoLinha[]>;
  comparada: MetricaLoja<unknown> | null;
  temBase: boolean;
  periodoComp: string;
  hoje: string;
}) {
  const [ordem, setOrdem] = useState<"divergencia" | "data">("divergencia");
  const caixas = useMemo(() => {
    const c = [...loja.detalhe];
    if (ordem === "data") return c.sort((a, b) => (a.data ?? "").localeCompare(b.data ?? "") || a.caixa.localeCompare(b.caixa) || a.movimento.localeCompare(b.movimento));
    return c.sort((a, b) => (a.difTotal ?? 0) - (b.difTotal ?? 0) || (a.data ?? "").localeCompare(b.data ?? "") || a.caixa.localeCompare(b.caixa));
  }, [loja.detalhe, ordem]);
  const total = caixas.reduce((s, c) => s + (c.difTotal ?? 0), 0);
  const pendentes = loja.detalhe.filter((c) => statusConciliacao(c) === "fechado-pendente");
  const vencidas = pendentes.filter((c) => prazoPendencia(c, hoje)?.situacao === "vencida").length;
  const menor = Math.min(0, ...loja.detalhe.map((c) => c.difTotal ?? 0)); // maior divergência negativa da loja (sem limite inventado)
  const variacao = temBase && comparada ? loja.valor - comparada.valor : null;

  return (
    <div className="space-y-4">
      {/* Nível 2 — resumo compacto da loja */}
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Item rotulo="Caixas (registros)" valor={String(loja.quantidade)} />
        <Item rotulo="Pendentes de conciliação" valor={pendentes.length === 0 ? "0" : `${pendentes.length} (${vencidas} vencidas)`} />
        <Item rotulo="Diferença atual" valor={moedaPainel.format(loja.valor)} />
        <Item rotulo="Diferença do período comparado" valor={temBase && comparada ? `${moedaPainel.format(comparada.valor)} (${comparada.quantidade} regs.)` : "Sem dados"} />
        <Item rotulo="Variação financeira" valor={variacao !== null ? sinalMoeda(variacao) : "—"} />
        <Item rotulo="Situação da evolução" valor={<Situacao atual={loja.grandeza} anterior={comparada?.grandeza ?? 0} temBase={temBase} />} />
      </div>
      <p className="text-[11px] text-foreground/50">
        Período comparado: {periodoComp}.{variacao !== null && Math.abs(loja.valor) >= 0.005 ? " Ainda há diferença financeira a acompanhar." : ""}
      </p>

      {/* Nível 3 — caixas individuais */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Caixas individuais</p>
        <label className="flex items-center gap-2 text-xs font-medium text-ragga-blue-dark">
          Ordenar por
          <select value={ordem} onChange={(e) => setOrdem(e.target.value as "divergencia" | "data")} className="rounded-md border border-ragga-blue/15 bg-white px-2 py-1 text-xs">
            <option value="divergencia">Maior divergência</option>
            <option value="data">Data do fechamento</option>
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm tabular-nums">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
              <th className="py-1 pr-3">Data do fechamento</th>
              <th className="px-2 py-1">Caixa / PDV</th>
              <th className="px-2 py-1">Movimento</th>
              <th className="px-2 py-1">Operador</th>
              <th className="px-2 py-1">Situação da conciliação</th>
              <th className="px-2 py-1 text-right">Dif. Fechamento</th>
              <th className="px-2 py-1 text-right">Dif. Conciliação</th>
              <th className="px-2 py-1 text-right">Dif. Total</th>
            </tr>
          </thead>
          <tbody>
            {caixas.map((c, i) => {
              const maior = menor < 0 && (c.difTotal ?? 0) === menor;
              return (
                <tr key={`${c.data ?? ""}-${c.caixa}-${c.movimento}-${i}`} className={`border-t border-ragga-blue/5 ${maior ? "bg-semaforo-vermelho/5" : ""}`}>
                  <td className="py-1.5 pr-3">
                    <CelulaDataFechamento linha={c} />
                  </td>
                  <td className="px-2 font-medium text-ragga-blue-dark">{c.caixa}</td>
                  <td className="px-2">{c.movimento}</td>
                  <td className="px-2">{c.operador ?? "—"}</td>
                  <td className="px-2">
                    <CelulaSituacao linha={c} hoje={hoje} />
                  </td>
                  <td className={`px-2 text-right ${classeValor(c.difFechamento)}`}>{c.difFechamento !== null ? moeda(c.difFechamento) : "—"}</td>
                  <td className="px-2 text-right">
                    <CelulaDifConciliacao linha={c} />
                  </td>
                  <td className="px-2 text-right">
                    <CelulaDifTotal linha={c} />
                    {maior && <span className="ml-1 text-[10px] font-semibold uppercase text-semaforo-vermelho">maior</span>}
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-ragga-blue/15 font-semibold text-ragga-blue-dark">
              <td className="py-1.5 pr-3" colSpan={7}>
                Total da loja (Dif. total)
              </td>
              <td className="px-2 text-right">{moeda(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
