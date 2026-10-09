"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Secao } from "@/components/ui/PainelAnalitico";
import { buscarTrocoSemanal } from "@/lib/actions/buscarTrocoSemanal";
import {
  ROTULO_SITUACAO,
  ROTULO_STATUS_CAIXA,
  analisarSemanaTroco,
  compararSemanasTroco,
  dataBR,
  hojeBrasilISO,
  rankingFaltasSemana,
  resumoLojasNaoConferidas,
  avisoCoberturaFaltas,
  semanaAnteriorISO,
  semanaRealISO,
  statusCaixaTroco,
  type LojaSemana,
  type SituacaoConferencia,
  type TrocoSemanalDados,
} from "@/lib/services/trocoSemanal";

/**
 * Aba Troco — conferência SEMANAL do dinheiro físico reservado para troco (não é Retirada de Depósito).
 * Regras e cálculos em `lib/services/trocoSemanal.ts` (módulo próprio do Troco; nenhuma função de outras abas foi alterada):
 *  - caixa não conferido = conferido 0 e informado 0 (0/0); loja conferida = ao menos um caixa com conferência;
 *    pendente = todos os caixas em 0/0; sem registro = nenhuma linha na base (≠ conferência não realizada);
 *  - prazo = quarta-feira da semana (seg–dom): antes → pendente; depois → atrasada; semana sem linhas = não carregada;
 *  - falta = diferença negativa (conferido − informado); sobra = positiva. Valor para a Quebra = Σ |faltas|; sobras à
 *    parte, sem compensar;
 *  - sem D-2: a semana real é a que contém a data/período escolhido (para período de várias semanas, a última);
 *    sem filtro de data ativo, a aba abre na última semana com registros.
 * Os filtros globais (Data de referência, Período, Loja) continuam em `ControlesCaixaTabs`.
 */

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const iso = (d: Date) => d.toISOString().slice(0, 10);

const TOM_SITUACAO: Record<SituacaoConferencia, "ok" | "warn" | "alert" | "neutro"> = {
  conferida: "ok",
  pendente: "warn",
  atrasada: "alert",
  "sem-registro": "neutro",
};

function Situacao({ s }: { s: SituacaoConferencia }) {
  return <StatusBadge tom={TOM_SITUACAO[s]} texto={ROTULO_SITUACAO[s]} />;
}

function CardNumero({ titulo, valor, detalhe, tom }: { titulo: string; valor: string; detalhe?: string; tom?: "alerta" | "aviso" }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">{titulo}</p>
      <p className={`mt-1 text-2xl font-semibold ${tom === "alerta" ? "text-semaforo-vermelho" : "text-ragga-blue-dark"}`}>{valor}</p>
      {detalhe && <p className={`mt-2 text-xs ${tom === "aviso" ? "font-semibold text-semaforo-amarelo" : "text-foreground/50"}`}>{detalhe}</p>}
    </Card>
  );
}

export function TrocoTab({
  janela,
  lojaFiltro,
  filtroDeDataAtivo,
}: {
  /** Período SELECIONADO nos filtros globais (data de referência: início = fim; ou intervalo). */
  janela: { inicio: Date; fim: Date };
  lojaFiltro?: CodigoUnidade;
  /** `false` = ninguém mexeu nos filtros de data: a aba abre na última semana com registros. */
  filtroDeDataAtivo: boolean;
}) {
  const hoje = useMemo(() => hojeBrasilISO(), []);
  const referencia = filtroDeDataAtivo ? iso(janela.fim) : null;
  const periodoVariasSemanas = filtroDeDataAtivo && semanaRealISO(iso(janela.inicio)).inicio !== semanaRealISO(iso(janela.fim)).inicio;
  const chave = referencia ?? "ultima-semana-com-registro";

  const [carregado, setCarregado] = useState<{ chave: string; dados: TrocoSemanalDados } | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  useEffect(() => {
    let vivo = true;
    buscarTrocoSemanal(referencia)
      .then((dados) => {
        if (vivo) {
          setFalhou(null);
          setCarregado({ chave, dados });
        }
      })
      .catch(() => {
        if (vivo) setFalhou(chave);
      });
    return () => {
      vivo = false;
    };
  }, [referencia, chave]);
  const dados = carregado && carregado.chave === chave ? carregado.dados : null;

  const inicioSemana = dados?.semana?.inicio ?? null;
  const universo = useMemo(() => (lojaFiltro ? [lojaFiltro as string] : undefined), [lojaFiltro]);
  const atual = useMemo(() => (dados && inicioSemana ? analisarSemanaTroco({ linhas: dados.linhas, inicioSemana, hoje, universo }) : null), [dados, inicioSemana, hoje, universo]);
  const anterior = useMemo(
    () => (dados && inicioSemana ? analisarSemanaTroco({ linhas: dados.linhas, inicioSemana: semanaAnteriorISO(inicioSemana).inicio, hoje, universo }) : null),
    [dados, inicioSemana, hoje, universo]
  );
  const comparacao = useMemo(() => (atual && anterior ? compararSemanasTroco(atual, anterior) : null), [atual, anterior]);
  const ranking = useMemo(() => (atual ? rankingFaltasSemana(atual.lojas) : []), [atual]);

  function alternar(u: string) {
    setAbertas((a) => {
      const n = new Set(a);
      if (n.has(u)) n.delete(u);
      else n.add(u);
      return n;
    });
  }

  if (falhou === chave) return <p className="text-sm font-semibold text-semaforo-vermelho">Não foi possível carregar o Troco desta semana. Troque o filtro ou recarregue a página.</p>;
  if (!dados) return <p className="text-sm text-foreground/50">Carregando o Troco…</p>;
  if (!dados.conectado) return <p className="text-sm text-foreground/50">Banco de dados não conectado — nenhum valor foi inventado.</p>;
  if (!dados.semana || !atual || !anterior || !comparacao) return <p className="text-sm text-foreground/50">A base de Troco ainda não tem registros.</p>;

  const semana = atual.semana;
  const semanaCalendarioAtual = semanaRealISO(hoje);
  const semanaCorrenteSemDados = !filtroDeDataAtivo && semanaCalendarioAtual.inicio > semana.inicio;
  const dataRegistroTxt = atual.datasRegistro.length > 0 ? atual.datasRegistro.map(dataBR).join(", ") : "—";
  const naoConferidas = resumoLojasNaoConferidas(atual);
  const avisoCobertura = avisoCoberturaFaltas(atual);
  const semanaAnt = comparacao && anterior.semana;

  return (
    <div className="space-y-5">
      {/* Semana, data do registro e prazo */}
      <Card className="space-y-2">
        <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Semana (segunda a domingo)</p>
            <p className="mt-1 font-medium text-ragga-blue-dark">
              {dataBR(semana.inicio)} a {dataBR(semana.fim)}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Data efetiva do registro da conferência</p>
            <p className="mt-1 font-medium text-ragga-blue-dark">{atual.semanaCarregada ? dataRegistroTxt : "Semana ainda não carregada"}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">Prazo da conferência</p>
            <p className="mt-1 font-medium text-ragga-blue-dark">
              Quarta-feira, {dataBR(atual.prazo)} — {atual.prazoEncerrado ? "prazo encerrado" : "dentro do prazo"}
            </p>
          </div>
        </div>
        {!filtroDeDataAtivo && <p className="text-xs text-foreground/55">Aberto na última semana com registros de troco. Use a Data de referência ou o Período para outra semana (a conferência é sempre analisada pela semana real, sem D-2).</p>}
        {periodoVariasSemanas && <p className="text-xs font-semibold text-semaforo-amarelo">O período escolhido tem mais de uma semana: o Troco é analisado uma semana por vez — exibindo a última do período.</p>}
        {semanaCorrenteSemDados && (
          <p className="text-xs font-semibold text-semaforo-amarelo">
            A semana atual ({dataBR(semanaCalendarioAtual.inicio)} a {dataBR(semanaCalendarioAtual.fim)}) ainda não possui dados de troco na base — exibindo a última semana com registros.
          </p>
        )}
      </Card>

      {!atual.semanaCarregada && (
        <div role="alert" className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          <strong>Sem registro — semana ainda não carregada.</strong> A base não tem nenhuma linha de troco entre {dataBR(semana.inicio)} e {dataBR(semana.fim)}
          {dados.ultimaData ? ` (último registro: ${dataBR(dados.ultimaData)})` : ""}. Isso não significa que a conferência foi realizada nem que não foi, e nenhuma falta ou zero é apresentado como resultado.
        </div>
      )}

      {/* A. CONFERÊNCIA SEMANAL */}
      <Secao titulo="A. Conferência semanal">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Lojas conferidas</p>
            <p className="mt-1 text-3xl font-semibold text-ragga-blue-dark">{atual.semanaCarregada ? `${atual.conferidas} de ${atual.universo}` : "—"}</p>
            <p className="mt-2 text-xs text-foreground/50">Lojas com pelo menos um caixa conferido (fora de 0/0). Loja parcialmente conferida conta como conferida.</p>
          </Card>
          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">Lojas não conferidas</p>
            <p className={`mt-1 text-3xl font-semibold ${atual.atrasadas > 0 ? "text-semaforo-vermelho" : "text-ragga-blue-dark"}`}>{naoConferidas.valor}</p>
            <p className={`mt-2 text-xs ${atual.atrasadas + atual.pendentes + atual.semRegistro > 0 ? "font-semibold text-ragga-blue-dark" : "text-foreground/50"}`}>{naoConferidas.auxiliar}</p>
          </Card>
        </div>
      </Secao>

      {atual.semanaCarregada && (
        <>
          {/* B. INDICADORES DE FALTAS */}
          <Secao titulo="B. Indicadores de faltas">
            {avisoCobertura && (
              <div
                role="status"
                className={`mb-4 rounded-lg border px-4 py-2.5 text-sm ${avisoCobertura.completa ? "border-ragga-blue/10 bg-ragga-bg/60 text-foreground/70" : "border-semaforo-amarelo/30 bg-semaforo-amarelo/10 text-ragga-blue-dark"}`}
              >
                <p className="font-semibold">{avisoCobertura.completa ? "" : "⚠ "}{avisoCobertura.texto}</p>
                {avisoCobertura.esclarecimento && <p className="mt-0.5 text-xs text-foreground/60">{avisoCobertura.esclarecimento}</p>}
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <CardNumero titulo="Lojas com falta" valor={String(atual.lojasComFalta)} />
              <CardNumero titulo="Caixas com falta" valor={String(atual.caixasComFalta)} />
              <CardNumero titulo="Faltas a encaminhar para Quebra" valor={moeda.format(atual.valorFaltas)} detalhe="Soma do valor absoluto das diferenças negativas. Sobras não entram." tom={atual.valorFaltas > 0 ? "alerta" : undefined} />
              <CardNumero titulo="Caixas com sobra" valor={String(atual.caixasComSobra)} detalhe="Informativo — não compensa faltas" />
              <CardNumero titulo="Valor das sobras" valor={moeda.format(atual.valorSobras)} detalhe="Informativo — não entra na Quebra" />
            </div>
            <p className="mt-3 text-[11px] text-foreground/45">Diferença = conferido pelo gerente − informado pelo colaborador. Negativa = falta; positiva = sobra. Faltas e sobras nunca são compensadas.</p>
          </Secao>

          {/* C. RANKING DE FALTAS */}
          <Secao titulo="C. Ranking de faltas por loja">
            {ranking.length === 0 ? (
              <p className="text-sm text-foreground/45">Nenhuma falta (diferença negativa) na semana.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                      <th className="py-2 pr-4">Ranking</th>
                      <th className="px-3 py-2">Loja</th>
                      <th className="px-3 py-2">Caixas com falta</th>
                      <th className="px-3 py-2">Valor das faltas</th>
                      <th className="px-3 py-2">Plano de ação registrado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((l, i) => (
                      <tr key={l.unidade} className="border-b border-ragga-blue/5 align-top">
                        <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">{i + 1}º</td>
                        <td className="px-3 font-medium text-ragga-blue-dark">{l.unidade}</td>
                        <td className="px-3">{l.caixasComFalta}</td>
                        <td className="px-3 font-semibold text-semaforo-vermelho">{moeda.format(l.valorFalta)}</td>
                        <td className="px-3 text-xs text-foreground/70">{l.planos.length > 0 ? l.planos.join(" · ") : <span className="text-foreground/40">—</span>}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
                      <td className="py-2.5 pr-4" colSpan={2}>TOTAL A ENCAMINHAR PARA QUEBRA</td>
                      <td className="px-3">{atual.caixasComFalta}</td>
                      <td className="px-3">{moeda.format(atual.valorFaltas)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[11px] text-foreground/40">Só diferenças negativas, da maior falta financeira para a menor. Sobras não são listadas como faltas. O plano de ação é o texto original da base.</p>
          </Secao>
        </>
      )}

      {/* D. CONFERÊNCIA DE TROCO POR LOJA (+ E. DETALHAMENTO POR CAIXA na expansão) */}
      <Secao titulo="D. Conferência de troco por loja">
        <div className="-mx-5 overflow-x-auto sm:-mx-6">
          <table className="w-full min-w-[860px] text-sm tabular-nums">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                <th className="px-5 py-2.5 sm:px-6">Loja</th>
                <th className="px-3 py-2.5">Situação</th>
                <th className="px-3 py-2.5">Caixas</th>
                <th className="px-3 py-2.5">Não conferidos (0/0)</th>
                <th className="px-3 py-2.5">Caixas c/ falta</th>
                <th className="px-3 py-2.5">Valor das faltas</th>
                <th className="px-3 py-2.5">Caixas c/ sobra</th>
                <th className="px-3 py-2.5">Valor das sobras</th>
                <th className="px-3 py-2.5">Plano de ação</th>
              </tr>
            </thead>
            <tbody>
              {atual.lojas.map((l) => (
                <LinhaLoja key={l.unidade} l={l} aberta={abertas.has(l.unidade)} aoAlternar={() => alternar(l.unidade)} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-foreground/40">Loja sem registro não tem linhas na base para a semana — os campos ficam em “—”, não em zero. Clique na loja para ver os caixas.</p>
      </Secao>

      {/* F. COMPARAÇÃO COM A SEMANA ANTERIOR */}
      <Secao titulo="F. Comparação com a semana anterior">
        <p className="mb-3 text-xs text-foreground/60">
          Semana selecionada: {dataBR(semana.inicio)} a {dataBR(semana.fim)} · Semana anterior equivalente: {dataBR(semanaAnt!.inicio)} a {dataBR(semanaAnt!.fim)}.
        </p>
        {comparacao.ressalva && (
          <p role="note" className="mb-4 rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-3 py-2 text-xs text-ragga-blue-dark">
            ⚠ {comparacao.ressalva}
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <CardNumero titulo="Faltas — semana atual" valor={atual.semanaCarregada ? moeda.format(comparacao.faltasAtual) : "—"} detalhe={`${comparacao.coberturaAtual.conferidas} conferida(s) · ${comparacao.coberturaAtual.pendentes + comparacao.coberturaAtual.atrasadas} pendente(s)/atrasada(s) · ${comparacao.coberturaAtual.semRegistro} sem registro`} />
          <CardNumero
            titulo="Faltas — semana anterior"
            valor={anterior.semanaCarregada ? moeda.format(comparacao.faltasAnterior) : "Sem registro"}
            detalhe={`${comparacao.coberturaAnterior.conferidas} conferida(s) · ${comparacao.coberturaAnterior.pendentes + comparacao.coberturaAnterior.atrasadas} pendente(s)/atrasada(s) · ${comparacao.coberturaAnterior.semRegistro} sem registro`}
          />
          <CardNumero
            titulo="Variação dos totais de falta"
            valor={atual.semanaCarregada && anterior.semanaCarregada ? `${comparacao.variacaoTotal > 0 ? "+" : comparacao.variacaoTotal < 0 ? "-" : ""}${moeda.format(Math.abs(comparacao.variacaoTotal))}` : "—"}
            detalhe="Total da rede (todas as lojas), com a cobertura de cada semana ao lado"
          />
          <CardNumero
            titulo={`Lojas comparáveis (${comparacao.comparavel.lojas})`}
            valor={comparacao.leitura === "indisponivel" ? "Sem leitura" : comparacao.leitura === "iguais" ? "Faltas iguais" : comparacao.leitura === "aumentaram" ? "Faltas aumentaram" : "Faltas diminuíram"}
            detalhe={
              comparacao.leitura === "indisponivel"
                ? "Nenhuma loja foi conferida nas duas semanas"
                : `Só lojas conferidas nas duas semanas: ${moeda.format(comparacao.comparavel.faltasAnterior)} → ${moeda.format(comparacao.comparavel.faltasAtual)}`
            }
          />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm tabular-nums">
            <thead>
              <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                <th className="py-2 pr-3">Loja</th>
                <th className="px-3 py-2">Conferência (anterior)</th>
                <th className="px-3 py-2">Conferência (atual)</th>
                <th className="px-3 py-2">Falta anterior</th>
                <th className="px-3 py-2">Falta atual</th>
                <th className="px-3 py-2">Variação</th>
              </tr>
            </thead>
            <tbody>
              {comparacao.linhas.map((l) => (
                <tr key={l.unidade} className="border-b border-ragga-blue/5">
                  <td className="py-2 pr-3 font-medium text-ragga-blue-dark">{l.unidade}</td>
                  <td className="px-3">
                    <Situacao s={l.situacaoAnterior} />
                  </td>
                  <td className="px-3">
                    <Situacao s={l.situacaoAtual} />
                  </td>
                  <td className="px-3">{l.faltaAnterior === null ? <span className="text-foreground/40">—</span> : moeda.format(l.faltaAnterior)}</td>
                  <td className="px-3">{l.faltaAtual === null ? <span className="text-foreground/40">—</span> : moeda.format(l.faltaAtual)}</td>
                  <td className="px-3">
                    {l.variacao === null ? (
                      <span className="text-xs text-foreground/50">Não comparável</span>
                    ) : (
                      <span className="font-semibold text-foreground/75">
                        {l.variacao > 0 ? "+" : l.variacao < 0 ? "-" : ""}
                        {moeda.format(Math.abs(l.variacao))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-foreground/40">
          Falta apurada só existe para lojas conferidas na semana; para pendente, atrasada ou sem registro aparece “—” (não é zero). A variação só é calculada quando a loja foi conferida nas duas semanas. Esta comparação não declara melhora ou piora: ausência de falta não prova que houve conferência.
        </p>
      </Secao>
    </div>
  );
}

/** Linha da tabela por loja + expansão com o detalhamento por caixa (E). */
function LinhaLoja({ l, aberta, aoAlternar }: { l: LojaSemana; aberta: boolean; aoAlternar: () => void }) {
  const semRegistro = l.situacao === "sem-registro";
  const tracos = <span className="text-foreground/35">—</span>;
  return (
    <Fragment>
      <tr onClick={semRegistro ? undefined : aoAlternar} className={`border-b border-ragga-blue/5 ${semRegistro ? "" : "cursor-pointer hover:bg-ragga-blue/[0.04]"}`}>
        <td className="px-5 py-3 font-semibold text-ragga-blue-dark sm:px-6">
          <span className="mr-1.5 inline-block w-3 text-ragga-blue/45">{semRegistro ? "" : aberta ? "▾" : "▸"}</span>
          {l.unidade}
        </td>
        <td className="px-3 py-3">
          <Situacao s={l.situacao} />
        </td>
        <td className="px-3 py-3">{semRegistro ? tracos : l.total}</td>
        <td className="px-3 py-3">{semRegistro ? tracos : l.naoConferidos}</td>
        <td className="px-3 py-3">{semRegistro ? tracos : l.comFalta}</td>
        <td className={`px-3 py-3 font-semibold ${l.valorFalta > 0 ? "text-semaforo-vermelho" : ""}`}>{semRegistro ? tracos : moeda.format(l.valorFalta)}</td>
        <td className="px-3 py-3">{semRegistro ? tracos : l.comSobra}</td>
        <td className="px-3 py-3">{semRegistro ? tracos : moeda.format(l.valorSobra)}</td>
        <td className="max-w-[18rem] px-3 py-3 text-xs text-foreground/70">{l.planos.length > 0 ? l.planos.join(" · ") : tracos}</td>
      </tr>
      {aberta && !semRegistro && (
        <tr>
          <td colSpan={9} className="bg-ragga-bg/60 px-5 py-4 sm:px-6">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">E. Detalhamento por caixa — {l.unidade}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-xs tabular-nums">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-foreground/50">
                    <th className="px-2 py-1">Caixa</th>
                    <th className="px-2 py-1">Data do registro</th>
                    <th className="px-2 py-1 text-right">Conferido (gerente)</th>
                    <th className="px-2 py-1 text-right">Informado (colaborador)</th>
                    <th className="px-2 py-1 text-right">Diferença</th>
                    <th className="px-2 py-1">Status da conferência</th>
                    <th className="px-2 py-1">Operador</th>
                    <th className="px-2 py-1">Plano de ação</th>
                  </tr>
                </thead>
                <tbody>
                  {l.caixas.map((c, i) => {
                    const st = statusCaixaTroco(c);
                    return (
                      <tr key={`${c.caixa}-${i}`} className={`border-t border-ragga-blue/5 ${st === "falta" ? "bg-semaforo-vermelho/5" : ""}`}>
                        <td className="px-2 py-1.5 font-medium text-ragga-blue-dark">{c.caixa}</td>
                        <td className="px-2 py-1.5">{dataBR(c.data)}</td>
                        <td className="px-2 py-1.5 text-right">{moeda.format(c.conferido)}</td>
                        <td className="px-2 py-1.5 text-right">{moeda.format(c.informado)}</td>
                        <td className={`px-2 py-1.5 text-right ${st === "falta" ? "font-semibold text-semaforo-vermelho" : st === "sobra" ? "font-semibold text-semaforo-amarelo" : ""}`}>{moeda.format(c.diferenca)}</td>
                        <td className="px-2 py-1.5">
                          <StatusBadge tom={st === "conferido" ? "ok" : st === "falta" ? "alert" : st === "sobra" ? "warn" : "neutro"} texto={ROTULO_STATUS_CAIXA[st]} />
                        </td>
                        <td className="px-2 py-1.5">{c.operador || "—"}</td>
                        <td className="px-2 py-1.5">{c.planoDeAcao || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
