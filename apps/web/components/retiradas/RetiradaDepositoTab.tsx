"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { Secao, moeda, pct } from "@/components/ui/PainelAnalitico";
import { buscarPainelDeposito, type PainelDepositoDados } from "@/lib/actions/buscarPainelDeposito";
import { periodoAnteriorMesmaDuracao } from "@/lib/services/retiradaDepositoGerencial";
import { montarPainelDeposito, valorRegistrado, type DiaDeposito, type LinhaTotalLoja, type PainelDeposito } from "@/lib/services/retiradaDepositoAnalise";
import { acoesDoErro, criarBuscador, type EstadoBusca } from "@/lib/services/retiradaDepositoBusca";

/**
 * Retirada para Depósito — painel gerencial. Indicador = SOMENTE lançamentos `DEPÓSITO` (ERRO e SUPRIMENTO ficam de
 * fora). É transferência de caixa para o banco, não despesa: SEM faturamento, percentual sobre faturamento ou semáforo.
 * Ciclos de depósito (regra existente) em linhas próprias — nunca somados entre si. Cobertura explícita: dia sem
 * registro na base NÃO é zero; a comparação com o período anterior de mesma duração só aparece quando a base a
 * sustenta ("Sem base de comparação" caso contrário). Usuário e autorizador não são carregados nem exibidos.
 * Filtros de loja e período vêm de `RetiradasTabs` (`FiltroLojaPeriodo`).
 */

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diaSemana = (iso: string) => SEMANA[new Date(`${iso}T00:00:00.000Z`).getUTCDay()];
const sinal = (v: number) => (v > 0 ? "+" : v < 0 ? "-" : "");
const isoDe = (d: Date) => d.toISOString().slice(0, 10);
const SEM_DEPOSITO = "Sem DEPÓSITO registrado";
const textoVariacao = (v: number) => (v === 0 ? "sem diferença" : `${sinal(v)}${moeda.format(Math.abs(v))}`);

function CardNumero({ titulo, valor, detalhe, aviso, valorPequeno }: { titulo: string; valor: string; detalhe?: string; aviso?: boolean; valorPequeno?: boolean }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">{titulo}</p>
      <p className={`mt-1 font-semibold text-ragga-blue-dark ${valorPequeno ? "text-base leading-8" : "text-2xl"}`}>{valor}</p>
      {detalhe && <p className={`mt-2 text-xs ${aviso ? "font-semibold text-semaforo-amarelo" : "text-foreground/50"}`}>{detalhe}</p>}
    </Card>
  );
}

function LinhaDia({ d, max, selecionado, aoClicar }: { d: DiaDeposito; max: number; selecionado: boolean; aoClicar: () => void }) {
  const base = "grid grid-cols-[6.5rem_1fr_7rem] items-center gap-3 rounded-md px-2 py-1.5 text-xs";
  if (d.estado === "deposito" && d.valor !== null) {
    return (
      <button type="button" onClick={aoClicar} aria-pressed={selecionado} className={`${base} w-full text-left hover:bg-ragga-blue/[0.05] ${selecionado ? "bg-ragga-blue/10 ring-1 ring-ragga-blue/40" : ""}`}>
        <span className="font-semibold text-ragga-blue-dark">
          {dm(d.data)} <span className="font-normal text-foreground/45">{diaSemana(d.data)}</span>
        </span>
        <span className="h-2.5 rounded-sm bg-ragga-blue" style={{ width: `${Math.max((d.valor / max) * 100, 1)}%` }} aria-hidden />
        <span className="text-right font-semibold tabular-nums text-ragga-blue-dark">
          {moeda.format(d.valor)}
          <span className="block text-[10px] font-normal text-foreground/45">{d.lancamentos} {d.lancamentos === 1 ? "lançamento" : "lançamentos"}</span>
        </span>
      </button>
    );
  }
  const texto =
    d.estado === "sem-registro"
      ? { t: "⚠ Sem registro na base", c: "font-semibold text-semaforo-amarelo" }
      : d.estado === "sem-deposito-registrado"
        ? { t: "Sem DEPÓSITO registrado (há outros lançamentos no dia)", c: "text-foreground/55" }
        : { t: "Fora do intervalo da base", c: "text-foreground/40" };
  return (
    <div className={base}>
      <span className="font-semibold text-foreground/60">
        {dm(d.data)} <span className="font-normal text-foreground/40">{diaSemana(d.data)}</span>
      </span>
      <span className={texto.c}>{texto.t}</span>
      <span className="text-right text-foreground/35">—</span>
    </div>
  );
}

function LinhaLoja({ l }: { l: LinhaTotalLoja }) {
  const semRegistro = <span className="text-xs text-foreground/50">{SEM_DEPOSITO}</span>;
  const naoComparavel = <span className="text-xs text-foreground/50">Não comparável</span>;
  return (
    <tr className="border-b border-ragga-blue/5">
      <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">{l.unidade}</td>
      <td className="px-3 font-semibold">{l.atual === null ? semRegistro : moeda.format(l.atual)}</td>
      <td className="px-3">{l.lancamentos ?? <span className="text-foreground/40">—</span>}</td>
      <td className="px-3">{l.ciclos ?? <span className="text-foreground/40">—</span>}</td>
      <td className="px-3 text-foreground/70">
        {l.tipo === "sem-comparacao" ? <span className="text-xs text-foreground/45">Sem base</span> : l.anterior === null ? semRegistro : moeda.format(l.anterior)}
      </td>
      <td className="px-3">
        {l.tipo === "sem-comparacao" ? (
          <span className="text-foreground/40">—</span>
        ) : l.tipo === "comparavel" && l.diferenca !== null ? (
          <span className="font-semibold text-foreground/75">
            {textoVariacao(l.diferenca)}
            {l.variacaoPercentual !== null && <span className="ml-1 font-normal">({sinal(l.variacaoPercentual)}{pct.format(Math.abs(l.variacaoPercentual))}%)</span>}
          </span>
        ) : (
          naoComparavel
        )}
      </td>
    </tr>
  );
}

export function RetiradaDepositoTab({
  periodoInicio,
  periodoFim,
  unidade,
}: {
  periodoInicio: Date;
  periodoFim: Date;
  unidade?: CodigoUnidade;
}) {
  const inicio = isoDe(periodoInicio);
  const fim = isoDe(periodoFim);
  const anterior = useMemo(() => periodoAnteriorMesmaDuracao(periodoInicio, periodoFim), [periodoInicio, periodoFim]);
  const inicioConsulta = isoDe(anterior.inicio);
  const chave = `${inicio}|${fim}|${unidade ?? "TODAS"}`;

  const [estadoBusca, setEstadoBusca] = useState<EstadoBusca<PainelDepositoDados> | null>(null);
  const buscadorRef = useRef<ReturnType<typeof criarBuscador<PainelDepositoDados>> | null>(null);
  const [diaSel, setDiaSel] = useState<string | null>(null);
  const [ordemLanc, setOrdemLanc] = useState<"valor" | "data">("valor");
  const intervaloValido = inicio <= fim && inicio >= "2000-01-01";

  useEffect(() => {
    if (!intervaloValido) return;
    // Cada filtro novo invalida a busca anterior (token): resposta antiga nunca sobrescreve a mais recente.
    const buscador = criarBuscador<PainelDepositoDados>(setEstadoBusca);
    buscadorRef.current = buscador;
    void buscador.buscar(chave, () => buscarPainelDeposito(inicioConsulta, fim, unidade));
    return () => {
      buscador.cancelar();
      if (buscadorRef.current === buscador) buscadorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, intervaloValido]);

  const estadoAtual = estadoBusca !== null && estadoBusca.chave === chave ? estadoBusca : null;
  const dados = estadoAtual?.estado === "sucesso" ? estadoAtual.dados : null;
  const painel: PainelDeposito | null = useMemo(
    () => (dados ? montarPainelDeposito({ inicio, fim, lancamentos: dados.lancamentos, cobertura: dados.cobertura, unidade }) : null),
    [dados, inicio, fim, unidade]
  );
  const diaEfetivo = painel && diaSel && painel.diario.some((d) => d.data === diaSel && d.estado === "deposito") ? diaSel : null;

  if (!intervaloValido) return <p className="text-sm text-foreground/50">Selecione um intervalo de datas válido (início até fim).</p>;
  if (estadoAtual?.estado === "erro") {
    return (
      <div role="alert" className="space-y-3 rounded-lg border border-semaforo-vermelho/30 bg-semaforo-vermelho/5 px-4 py-4 text-sm text-ragga-blue-dark">
        <p className="font-semibold">{estadoAtual.mensagem}</p>
        <p className="text-xs text-foreground/60">Nenhum valor foi estimado: sem a consulta, o painel não mostra números.</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void buscadorRef.current?.tentarNovamente()}
            className="rounded-md bg-ragga-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-ragga-blue-dark"
          >
            Tentar novamente
          </button>
          {acoesDoErro(estadoAtual.motivo).recarregarPagina && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md border border-ragga-blue/30 bg-white px-3 py-1.5 text-sm font-semibold text-ragga-blue-dark hover:bg-ragga-blue/5"
            >
              Recarregar página
            </button>
          )}
        </div>
      </div>
    );
  }
  if (!painel || !dados) {
    return (
      <p role="status" className="text-sm text-foreground/50">
        Carregando a retirada para depósito…
      </p>
    );
  }

  const cob = painel.cobertura;
  const cmp = painel.comparacao;
  const periodoTxt = `${dmy(painel.periodo.inicio)} a ${dmy(painel.periodo.fim)}`;
  const anteriorTxt = `${dmy(painel.anterior.inicio)} a ${dmy(painel.anterior.fim)}`;
  const maxDia = Math.max(...painel.diario.map((d) => d.valor ?? 0), 0);
  const lancamentos = [...painel.lancamentos]
    .filter((l) => !diaEfetivo || l.data === diaEfetivo)
    .sort((a, b) => (ordemLanc === "valor" ? b.valor - a.valor || b.data.localeCompare(a.data) : b.data.localeCompare(a.data) || b.valor - a.valor));
  const totalLanc = lancamentos.reduce((s, l) => s + l.valor, 0);
  const semBase = !dados.conectado;
  // null = nenhum lançamento DEPÓSITO (ausência de registro); número = total real (inclusive R$ 0,00 de lançamento real)
  const totalAtual = valorRegistrado(painel.resumo.lancamentos, painel.resumo.total);
  const totalAnterior = cmp.anterior ? valorRegistrado(cmp.anterior.lancamentos, cmp.anterior.total) : null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-ragga-blue-dark">Retirada para depósito</h2>
        <p className="mt-1 text-xs text-foreground/55">
          Somente lançamentos com motivo DEPÓSITO (ERRO e SUPRIMENTO ficam fora). É transferência de caixa para o banco — não é despesa e não há percentual sobre faturamento.
        </p>
      </div>

      {semBase && (
        <div className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">
          Banco de dados ainda não conectado (<code>DATABASE_URL</code> não definida) — nenhum valor foi inventado.
        </div>
      )}

      {/* Aviso de cobertura (resumo) */}
      {cob.minBase && cob.maxBase ? (
        <div className="rounded-lg border border-ragga-blue/15 bg-white px-4 py-3 text-xs text-foreground/70">
          <p>
            <span className="font-semibold text-ragga-blue-dark">Intervalo real da base:</span> {dmy(cob.minBase)} a {dmy(cob.maxBase)} ({cob.historicoDias} dias). Período selecionado:{" "}
            {periodoTxt}
            {cob.periodoDentroDaBase ? "" : " — parte dele está fora do intervalo da base."}
          </p>
          {cob.lacunasNoPeriodo.length > 0 && (
            <p className="mt-1 font-semibold text-semaforo-amarelo">
              ⚠ Sem registro na base em {cob.lacunasNoPeriodo.map(dmy).join(", ")} dentro do período: não significa que não houve depósito.
            </p>
          )}
        </div>
      ) : (
        !semBase && <div className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-4 py-3 text-sm text-ragga-blue-dark">A base de Retirada para Depósito não tem registros.</div>
      )}

      {/* 1) RESULTADO DO PERÍODO */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {totalAtual === null ? (
          <CardNumero titulo="Total retirado para depósito" valor={SEM_DEPOSITO} valorPequeno detalhe={`${periodoTxt} · nenhum lançamento DEPÓSITO na base (não prova que não houve depósito)`} aviso />
        ) : (
          <CardNumero titulo="Total retirado para depósito" valor={moeda.format(totalAtual)} detalhe={`${periodoTxt} · ${painel.resumo.lancamentos} ${painel.resumo.lancamentos === 1 ? "lançamento" : "lançamentos"}`} />
        )}
        <CardNumero
          titulo="Lojas com retirada registrada"
          valor={String(painel.resumo.lojasComRetirada)}
          detalhe={painel.resumo.lojasComRetirada === 1 ? "1 loja com DEPÓSITO no período" : `${painel.resumo.lojasComRetirada} lojas com DEPÓSITO no período`}
        />
        <CardNumero
          titulo="Média por loja com retirada"
          valor={painel.resumo.lojasComRetirada > 0 ? moeda.format(painel.resumo.mediaPorLoja) : "—"}
          detalhe="Total retirado ÷ lojas com ao menos um lançamento DEPÓSITO no período (lojas sem registro não entram)"
        />
        <CardNumero
          titulo="Dias com depósito registrado"
          valor={`${painel.resumo.diasComDeposito} de ${painel.periodo.dias}`}
          detalhe={painel.resumo.diasSemRegistro > 0 ? `${painel.resumo.diasSemRegistro} dia(s) sem registro na base` : "Dias restantes: sem DEPÓSITO registrado ou fora da base"}
          aviso={painel.resumo.diasSemRegistro > 0}
        />
        {cmp.destaque ? (
          <CardNumero
            titulo="Variação nas lojas comparáveis"
            valor={cmp.destaque.variacaoPercentual === null ? "Sem % (anterior = 0)" : `${sinal(cmp.destaque.variacaoPercentual)}${pct.format(Math.abs(cmp.destaque.variacaoPercentual))}%`}
            detalhe={`${cmp.destaque.quantidadeLojas} ${cmp.destaque.quantidadeLojas === 1 ? "loja comparável" : "lojas comparáveis"} (DEPÓSITO registrado nos dois períodos): ${moeda.format(cmp.destaque.anterior)} → ${moeda.format(cmp.destaque.atual)} (${cmp.destaque.diferenca === 0 ? "sem diferença" : `${sinal(cmp.destaque.diferenca)}${moeda.format(Math.abs(cmp.destaque.diferenca))}`}). Detalhes e totais registrados na seção de comparação.`}
          />
        ) : (
          <CardNumero titulo="Vs. período anterior" valor="Sem base de comparação" detalhe={cmp.motivoSemDestaque ?? undefined} aviso />
        )}
      </div>

      {/* COMPARAÇÃO COM O PERÍODO ANTERIOR — só lojas comparáveis; totais registrados separados */}
      <Secao titulo="Comparação com o período anterior">
        <p className="mb-3 text-xs text-foreground/60">
          Período selecionado: {periodoTxt} · Período anterior (mesma duração, imediatamente antes): {anteriorTxt}.
        </p>
        {!cmp.comparabilidade.valida ? (
          <p className="rounded-lg border border-semaforo-amarelo/30 bg-semaforo-amarelo/10 px-3 py-2 text-sm text-ragga-blue-dark">
            <strong>Sem base de comparação.</strong> {cmp.comparabilidade.motivo}
          </p>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Lojas comparáveis — DEPÓSITO registrado nos dois períodos</p>
              {cmp.lojasComparaveis.length === 0 ? (
                <p className="text-sm text-foreground/55">{cmp.motivoSemDestaque}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm tabular-nums">
                    <thead>
                      <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                        <th className="py-2 pr-4">Loja</th>
                        <th className="px-3 py-2">Período anterior</th>
                        <th className="px-3 py-2">Período atual</th>
                        <th className="px-3 py-2">Variação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cmp.lojasComparaveis.map((l) => (
                        <tr key={l.unidade} className="border-b border-ragga-blue/5">
                          <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">{l.unidade}</td>
                          <td className="px-3 text-foreground/70">{moeda.format(l.anterior)}</td>
                          <td className="px-3 font-semibold">{moeda.format(l.atual)}</td>
                          <td className="px-3 font-semibold text-foreground/75">
                            {l.diferenca === 0 ? "sem diferença" : `${sinal(l.diferenca)}${moeda.format(Math.abs(l.diferenca))}`}
                            {l.variacaoPercentual !== null && <span className="ml-1 font-normal">({sinal(l.variacaoPercentual)}{pct.format(Math.abs(l.variacaoPercentual))}%)</span>}
                          </td>
                        </tr>
                      ))}
                      {cmp.destaque && (
                        <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
                          <td className="py-2.5 pr-4">SOMENTE LOJAS COMPARÁVEIS ({cmp.destaque.quantidadeLojas})</td>
                          <td className="px-3">{moeda.format(cmp.destaque.anterior)}</td>
                          <td className="px-3">{moeda.format(cmp.destaque.atual)}</td>
                          <td className="px-3">
                            {cmp.destaque.diferenca === 0 ? "sem diferença" : `${sinal(cmp.destaque.diferenca)}${moeda.format(Math.abs(cmp.destaque.diferenca))}`}
                            {cmp.destaque.variacaoPercentual !== null && <span className="ml-1 font-normal">({sinal(cmp.destaque.variacaoPercentual)}{pct.format(Math.abs(cmp.destaque.variacaoPercentual))}%)</span>}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {(cmp.soNoAtual.length > 0 || cmp.soNoAnterior.length > 0) && (
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">DEPÓSITO registrado em apenas um dos períodos — não comparável (sem variação)</p>
                <ul className="space-y-1 text-sm text-foreground/75">
                  {cmp.soNoAtual.map((l) => (
                    <li key={`a-${l.unidade}`}>
                      <span className="font-semibold text-ragga-blue-dark">{l.unidade}</span> — registro <strong>apenas no período atual</strong>: {moeda.format(l.atual)}. Sem DEPÓSITO registrado no período anterior (isso não prova que não houve depósito).
                    </li>
                  ))}
                  {cmp.soNoAnterior.map((l) => (
                    <li key={`p-${l.unidade}`}>
                      <span className="font-semibold text-ragga-blue-dark">{l.unidade}</span> — registro <strong>apenas no período anterior</strong>: {moeda.format(l.anterior)}. Sem DEPÓSITO registrado no período atual (não é uma queda para zero: a ausência de registro não prova ausência de depósito).
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {cmp.anterior && (
              <div className="rounded-lg border border-ragga-blue/10 bg-ragga-bg/60 px-3 py-2 text-xs text-foreground/65">
                <p className="font-bold uppercase tracking-wide text-ragga-blue/70">Totais registrados (separados da variação comparável)</p>
                <p className="mt-1">
                  Período atual:{" "}
                  <strong className="tabular-nums">
                    {totalAtual === null ? SEM_DEPOSITO : `${moeda.format(totalAtual)} (${painel.resumo.lojasComRetirada} ${painel.resumo.lojasComRetirada === 1 ? "loja" : "lojas"})`}
                  </strong>{" "}
                  · Período anterior:{" "}
                  <strong className="tabular-nums">
                    {totalAnterior === null || !cmp.anterior ? SEM_DEPOSITO : `${moeda.format(totalAnterior)} (${cmp.anterior.lojasComRetirada} ${cmp.anterior.lojasComRetirada === 1 ? "loja" : "lojas"})`}
                  </strong>{" "}
                  · Diferença entre os totais:{" "}
                  <strong className="tabular-nums">
                    {totalAtual === null || totalAnterior === null || cmp.variacaoReais === null ? "não calculada (um dos períodos sem DEPÓSITO registrado)" : textoVariacao(cmp.variacaoReais)}
                  </strong>
                  . Esta diferença mistura lojas com registro em apenas um dos períodos e <strong>não é uma variação comparável</strong>.
                </p>
              </div>
            )}
          </div>
        )}
        <p className="mt-3 text-[11px] text-foreground/45">
          Limitação da cobertura: a base é um registro de lançamentos (poucas linhas por dia, de poucas lojas). Ela comprova que a janela de datas foi importada, mas <strong>não</strong> que cada loja foi coberta em cada dia — por isso só se comparam lojas com DEPÓSITO registrado nos dois períodos,
          e ausência de lançamento nunca é tratada como ausência de depósito.
        </p>
      </Secao>

      {/* 2) O QUE FOI RETIRADO POR LOJA E CICLO? */}
      <Secao titulo="O que foi retirado por loja e ciclo?">
        {painel.linhasLojas.length === 0 ? (
          <p className="text-sm text-foreground/50">Sem DEPÓSITO registrado no período selecionado{unidade ? ` para ${unidade}` : ""}. Isso não prova que não houve depósito: veja a cobertura da base.</p>
        ) : (
          <>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Total por loja — lojas com DEPÓSITO registrado no período atual e/ou no anterior</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                    <th className="py-2 pr-4">Loja</th>
                    <th className="px-3 py-2">Total retirado</th>
                    <th className="px-3 py-2">Lançamentos</th>
                    <th className="px-3 py-2">Ciclos</th>
                    <th className="px-3 py-2">Período anterior</th>
                    <th className="px-3 py-2">Variação</th>
                  </tr>
                </thead>
                <tbody>
                  {painel.linhasLojas.map((l) => (
                    <LinhaLoja key={l.unidade} l={l} />
                  ))}
                  <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
                    <td className="py-2.5 pr-4">TOTAL</td>
                    <td className="px-3">{totalAtual === null ? <span className="text-xs font-normal text-foreground/50">{SEM_DEPOSITO}</span> : moeda.format(painel.lojas.reduce((s, l) => s + l.total, 0))}</td>
                    <td className="px-3">{painel.lojas.reduce((s, l) => s + l.lancamentos, 0)}</td>
                    <td className="px-3">{painel.ciclos.length}</td>
                    <td className="px-3" colSpan={2}>
                      {cmp.comparabilidade.valida && cmp.anterior ? (
                        <span className="text-xs font-normal text-foreground/60">Total registrado no anterior: {moeda.format(cmp.anterior.total)} (não comparável — veja a seção de comparação)</span>
                      ) : (
                        <span className="text-xs font-normal text-foreground/45">Sem base de comparação</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {painel.ciclos.length > 0 && (
            <>
            <p className="mb-2 mt-6 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Detalhamento por ciclo e depósito esperado</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                    <th className="py-2 pr-4">Filial</th>
                    <th className="px-3 py-2">Ciclo</th>
                    <th className="px-3 py-2">Lançamentos</th>
                    <th className="px-3 py-2">Retirada no ciclo</th>
                    <th className="px-3 py-2">Depósito esperado</th>
                  </tr>
                </thead>
                <tbody>
                  {painel.ciclos.map((c) => (
                    <tr key={`${c.unidade}|${c.ciclo.inicio}`} className="border-b border-ragga-blue/5 align-top">
                      <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">{c.unidade}</td>
                      <td className="px-3">
                        {dm(c.ciclo.inicio)} a {dm(c.ciclo.fim)}
                        {c.parcialNoPeriodo && <span className="block text-[11px] font-semibold text-semaforo-amarelo">⚠ ciclo parcial no período (só os dias selecionados foram somados)</span>}
                        {c.incompletoNaBase && <span className="block text-[11px] font-semibold text-semaforo-amarelo">⚠ ciclo ainda incompleto na base</span>}
                      </td>
                      <td className="px-3">{c.lancamentos}</td>
                      <td className="px-3 font-semibold">{moeda.format(c.valor)}</td>
                      <td className="px-3 text-foreground/70">
                        {dm(c.ciclo.depositoEsperado)}
                        <span className="block text-[11px] text-foreground/50">{c.ciclo.rotulo}</span>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
                    <td className="py-2.5 pr-4" colSpan={2}>TOTAL DOS CICLOS</td>
                    <td className="px-3">{painel.ciclos.reduce((s, c) => s + c.lancamentos, 0)}</td>
                    <td className="px-3">{moeda.format(painel.ciclos.reduce((s, c) => s + c.valor, 0))}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-foreground/40">
              Cada ciclo fica em linha própria (segunda–quinta → depósito na sexta; sexta–domingo → depósito na segunda) e ciclos diferentes nunca são somados. Os totais por loja, os ciclos e o total geral reconciliam.
              Período anterior (mesma duração, imediatamente antes): {anteriorTxt}.
            </p>
            </>
            )}
          </>
        )}
      </Secao>

      {/* 3) EVOLUÇÃO DIÁRIA */}
      <Secao titulo="Evolução diária de DEPÓSITO">
        <p className="mb-3 text-xs text-foreground/55">
          Valores por data do lançamento. Dias sem registro na base ficam destacados e <strong>não</strong> são tratados como R$ 0,00. Clique num dia com depósito para ver os lançamentos dele.
        </p>
        <div className="max-h-[26rem] space-y-0.5 overflow-y-auto pr-1">
          {painel.diario.map((d) => (
            <LinhaDia key={d.data} d={d} max={maxDia} selecionado={diaEfetivo === d.data} aoClicar={() => setDiaSel((a) => (a === d.data ? null : d.data))} />
          ))}
        </div>
      </Secao>

      {/* 4) INVESTIGAR LANÇAMENTOS */}
      <Secao
        titulo="Investigar lançamentos"
        acao={
          <label className="flex items-center gap-2 text-xs font-medium text-ragga-blue-dark">
            Ordenar por
            <select value={ordemLanc} onChange={(e) => setOrdemLanc(e.target.value as "valor" | "data")} className="rounded-md border border-ragga-blue/15 bg-white px-2 py-1.5 text-xs">
              <option value="valor">Maior valor</option>
              <option value="data">Data (mais recente)</option>
            </select>
          </label>
        }
      >
        {diaEfetivo && (
          <p className="mb-3 text-xs text-foreground/70">
            Filtrando o dia <span className="font-semibold text-ragga-blue-dark">{dmy(diaEfetivo)}</span>.{" "}
            <button type="button" onClick={() => setDiaSel(null)} className="font-semibold text-ragga-blue hover:underline">
              limpar dia
            </button>
          </p>
        )}
        {lancamentos.length === 0 ? (
          <p className="text-sm text-foreground/50">Nenhum lançamento DEPÓSITO no período selecionado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm tabular-nums">
              <thead>
                <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                  <th className="py-2 pr-3">Data</th>
                  <th className="px-3 py-2">Loja</th>
                  <th className="px-3 py-2">Ciclo</th>
                  <th className="px-3 py-2">Depósito esperado</th>
                  <th className="px-3 py-2">Caixa</th>
                  <th className="px-3 py-2">Motivo</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {lancamentos.map((l, i) => (
                  <tr key={`${l.unidade}|${l.data}|${l.caixa}|${i}`} className="border-b border-ragga-blue/5">
                    <td className="py-2 pr-3">
                      {dm(l.data)} <span className="text-foreground/40">{diaSemana(l.data)}</span>
                    </td>
                    <td className="px-3 font-semibold text-ragga-blue-dark">{l.unidade}</td>
                    <td className="px-3">
                      {dm(l.ciclo.inicio)} a {dm(l.ciclo.fim)}
                    </td>
                    <td className="px-3 text-foreground/70">{dm(l.ciclo.depositoEsperado)}</td>
                    <td className="px-3 text-foreground/70">{l.caixa}</td>
                    <td className="px-3 text-foreground/70">{l.motivo}</td>
                    <td className="px-3 text-right font-semibold">{moeda.format(l.valor)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
                  <td className="py-2 pr-3" colSpan={6}>
                    {diaEfetivo ? "TOTAL DO DIA" : "TOTAL DO PERÍODO"} ({lancamentos.length} {lancamentos.length === 1 ? "lançamento" : "lançamentos"})
                  </td>
                  <td className="px-3 text-right">{moeda.format(totalLanc)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-foreground/40">Cada linha é um lançamento da base (sem agregação): a contagem de lançamentos não é valor em dinheiro.</p>
      </Secao>

      {/* 5) COBERTURA E QUALIDADE */}
      <Secao titulo="Cobertura e qualidade dos dados">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground/75">
          {cob.minBase && cob.maxBase ? (
            <li>
              A base consultada vai de <strong>{dmy(cob.minBase)}</strong> a <strong>{dmy(cob.maxBase)}</strong> ({cob.historicoDias} dias): lançamentos posteriores a {dmy(cob.maxBase)} ainda não foram importados.
            </li>
          ) : (
            <li>A base não tem registros.</li>
          )}
          {cob.lacunasBase.length > 0 ? (
            <li>
              Dia(s) <strong>sem registro na base</strong>: {cob.lacunasBase.map(dmy).join(", ")}. Isso é falta de dados — não significa que não houve depósito, e o painel não converte em R$ 0,00.
            </li>
          ) : (
            <li>Nenhum dia sem registro entre o primeiro e o último registro da base.</li>
          )}
          <li>
            Somente <strong>{cob.lojasComDeposito.length}</strong> {cob.lojasComDeposito.length === 1 ? "loja possui" : "lojas possuem"} DEPÓSITO no histórico atual
            {cob.lojasComDeposito.length > 0 ? ` (${cob.lojasComDeposito.join(", ")})` : ""}. As demais aparecem como “sem DEPÓSITO registrado” — a base não distingue loja sem depósito de loja sem dado.
          </li>
          {cob.historicoCurto && (
            <li>
              O histórico é curto ({cob.historicoDias} dias, menos de um mês): não presuma cobertura mensal completa nem compare com meses anteriores.
            </li>
          )}
          <li>
            <strong>Sem registro na base</strong> (nenhuma linha no dia) é diferente de <strong>sem DEPÓSITO registrado</strong> (há outros lançamentos no dia, mas nenhum DEPÓSITO). Nenhum dos dois comprova ausência de retirada.
          </li>
          <li>A comparação com o período anterior só é exibida com os dois períodos dentro da base, sem dia sem registro e com DEPÓSITO registrado no período anterior.</li>
        </ul>
      </Secao>
    </div>
  );
}
