"use client";

import { useEffect, useMemo, useState } from "react";
import { Secao, moeda, pct, sinalMoeda } from "@/components/ui/PainelAnalitico";
import { buscarResumoSemanal, type ResumoSemanalAcao } from "@/lib/actions/buscarResumoSemanal";
import type { ResumoSemanalResposta } from "@/lib/services/resumoSemanal.server";
import {
  MAX_SEMANAS,
  ORDEM_INDICADORES,
  ROTULO_INDICADOR,
  ROTULO_SITUACAO,
  janelaAnterior,
  janelaDeSemanas,
  semanasDisponiveis,
  type CelulaPeriodo,
  type IndicadorId,
  type IndicadorSemanal,
  type Janela,
  type LojaIndicador,
  type LojaResumo,
  type MotivoAtencao,
  type SituacaoSemanal,
  type Variacao,
} from "@/lib/services/resumoSemanal";

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const rotuloJanela = (j: Janela) => `${dm(j.inicio)} a ${dm(j.fim)}/${j.fim.slice(0, 4)}`;

const valorOuSem = (v: number | null) => (v === null ? "Sem dados" : moeda.format(v));
const pctOuSem = (v: number | null) => (v === null ? "—" : `${pct.format(v)}%`);
const sinal = (v: number) => (v > 0 ? "+" : v < 0 ? "-" : "");

const COR_SITUACAO: Record<SituacaoSemanal, string> = {
  melhorou: "bg-semaforo-verde/10 text-semaforo-verde",
  piorou: "bg-semaforo-vermelho/10 text-semaforo-vermelho",
  estavel: "bg-foreground/5 text-foreground/60",
  "sem-ocorrencia": "bg-foreground/5 text-foreground/50",
  "sem-base": "bg-semaforo-amarelo/10 text-semaforo-amarelo",
};
const ICONE_SITUACAO: Record<SituacaoSemanal, string> = { melhorou: "▼", piorou: "▲", estavel: "=", "sem-ocorrencia": "○", "sem-base": "?" };

function Badge({ situacao }: { situacao: SituacaoSemanal }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${COR_SITUACAO[situacao]}`}>
      {ICONE_SITUACAO[situacao]} {ROTULO_SITUACAO[situacao]}
    </span>
  );
}

const corVariacao = (situacao: SituacaoSemanal) =>
  situacao === "melhorou" ? "text-semaforo-verde" : situacao === "piorou" ? "text-semaforo-vermelho" : "text-foreground/70";

function VariacaoTexto({ v, curta = false }: { v: Variacao; curta?: boolean }) {
  if (v.variacaoReais === null) return <span className="text-foreground/45">—</span>;
  return (
    <span className={`font-semibold tabular-nums ${corVariacao(v.situacao)}`}>
      {sinalMoeda(v.variacaoReais)}
      {!curta && (
        <span className="ml-1 font-normal text-foreground/60">
          ({v.variacaoPercentual === null ? "—" : `${sinal(v.variacaoPercentual)}${pct.format(Math.abs(v.variacaoPercentual))}%`})
        </span>
      )}
    </span>
  );
}

function PpTexto({ v }: { v: Variacao }) {
  if (v.variacaoPp === null) return <span className="text-foreground/45">—</span>;
  return (
    <span className={`font-semibold tabular-nums ${corVariacao(v.situacao)}`}>
      {sinal(v.variacaoPp)}
      {pct.format(Math.abs(v.variacaoPp))} p.p.
    </span>
  );
}

function Detalhes({ c }: { c: CelulaPeriodo }) {
  if (c.valor === null || c.detalhes.length === 0) return null;
  return (
    <p className="mt-0.5 text-[11px] text-foreground/45">
      {c.detalhes
        .map((d) => `${d.rotulo}: ${d.rotulo === "Ocorrências" ? d.valor : moeda.format(d.valor)}${d.foraDoTotal ? " (fora do total)" : ""}`)
        .join(" · ")}
    </p>
  );
}

function CardIndicador({ i }: { i: IndicadorSemanal }) {
  const semDados = i.atual.valor === null;
  return (
    <div className="flex flex-col rounded-2xl border border-ragga-blue/10 bg-white p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-bold uppercase tracking-wide text-ragga-blue-dark">{i.rotulo}</p>
        <Badge situacao={i.situacao} />
      </div>
      <p className={`mt-3 text-2xl font-bold tabular-nums ${semDados ? "text-foreground/40" : "text-ragga-blue-dark"}`}>{valorOuSem(i.atual.valor)}</p>
      <Detalhes c={i.atual} />
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-foreground/55">Período de comparação</dt>
          <dd className="font-semibold tabular-nums text-foreground/80">{valorOuSem(i.anterior.valor)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-foreground/55">Variação em R$ (e % do valor)</dt>
          <dd>
            <VariacaoTexto v={i} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-foreground/55">{i.id === "brindes" ? "Controláveis ÷ fat." : "% do faturamento"}</dt>
          <dd className="font-semibold tabular-nums text-foreground/80">
            {pctOuSem(i.atual.percentual)} <span className="font-normal text-foreground/45">(ant. {pctOuSem(i.anterior.percentual)})</span>
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-foreground/55">Variação do % (p.p.)</dt>
          <dd>
            <PpTexto v={i} />
          </dd>
        </div>
      </dl>
      {i.id === "brindes" && (
        <p className="mt-3 text-[11px] text-foreground/40">
          Total s/ fat.: {pctOuSem(i.atual.percentualTotal)} (ant. {pctOuSem(i.anterior.percentualTotal)}). Situação pelos brindes controláveis ÷ faturamento (regra existente da aba Brindes).
        </p>
      )}
      {i.id === "quebra" && (
        <div className="mt-3 space-y-1 text-[11px] text-foreground/45">
          <p>Sem meta de Quebra no painel: situação = comparação do % sobre o faturamento.</p>
          {i.diasSemRegistro && (
            <p className="font-semibold text-semaforo-amarelo">
              Dias sem registro: {i.diasSemRegistro.atual} de {i.diasSemRegistro.dias} (atual) e {i.diasSemRegistro.anterior} de {i.diasSemRegistro.dias} (comparação). Lidos como “sem ocorrência”, sem confirmação de que a importação esteja completa.
            </p>
          )}
        </div>
      )}
      {i.id === "compraDireta" && <p className="mt-3 text-[11px] text-foreground/40">Nota Fiscal fica fora da saída real de caixa.</p>}
    </div>
  );
}

const ROTULO_MOTIVO: Record<MotivoAtencao, string> = { "maior-percentual": "maior % s/ fat.", "maior-valor": "maior valor", piora: "maior piora" };
const SIGLA: Record<IndicadorId, string> = { brindes: "Brindes", cancelamentos: "Cancel.", compraDireta: "C. Direta", quebra: "Quebra" };

function CelulaLoja({ l }: { l: LojaIndicador | null }) {
  if (!l || l.atual.valor === null) return <span className="text-foreground/40">Sem dados</span>;
  if (l.coberturaParcial) {
    return (
      <div className="leading-tight">
        <p className="font-semibold tabular-nums text-ragga-blue-dark">{moeda.format(l.atual.valor)}</p>
        <p className="text-[11px] font-semibold text-semaforo-amarelo">⚠ Faturamento parcial — sem % e sem ranking proporcional</p>
      </div>
    );
  }
  return (
    <div className="leading-tight">
      <p className="font-semibold tabular-nums text-ragga-blue-dark">{moeda.format(l.atual.valor)}</p>
      <p className="text-xs tabular-nums text-foreground/60">
        {pctOuSem(l.atual.percentual)} {l.atual.percentual !== l.atual.percentualTotal ? "controláv. " : ""}do fat.
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px]">
        <span className={`font-semibold ${corVariacao(l.situacao)}`}>
          {ICONE_SITUACAO[l.situacao]} {ROTULO_SITUACAO[l.situacao]}
        </span>
        {l.variacaoPp !== null && l.situacao !== "estavel" && l.situacao !== "sem-ocorrencia" && (
          <span className={`tabular-nums ${corVariacao(l.situacao)}`}>
            {sinal(l.variacaoPp)}
            {pct.format(Math.abs(l.variacaoPp))} p.p.
          </span>
        )}
      </p>
    </div>
  );
}

function TabelaLojas({ lojas }: { lojas: LojaResumo[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
            <th className="py-2 pr-3">Loja</th>
            {ORDEM_INDICADORES.map((id) => (
              <th key={id} className="px-3 py-2">
                {SIGLA[id]}
              </th>
            ))}
            <th className="px-3 py-2">Área de atenção</th>
          </tr>
        </thead>
        <tbody>
          {lojas.map((l) => (
            <tr key={l.unidade} className={`border-b border-ragga-blue/5 align-top ${l.atencao.length > 0 ? "bg-semaforo-amarelo/[0.04]" : ""}`}>
              <td className="py-3 pr-3 font-bold text-ragga-blue-dark">{l.unidade}</td>
              {ORDEM_INDICADORES.map((id) => (
                <td key={id} className="px-3 py-3">
                  <CelulaLoja l={l.porIndicador[id]} />
                </td>
              ))}
              <td className="px-3 py-3">
                {l.atencao.length === 0 ? (
                  <span className="text-xs text-foreground/40">—</span>
                ) : (
                  <ul className="space-y-0.5 text-[11px]">
                    {l.atencao.map((a, k) => (
                      <li key={k} className={a.motivo === "piora" ? "font-semibold text-semaforo-vermelho" : "text-foreground/70"}>
                        {SIGLA[a.indicador]}: {a.posicao}º {ROTULO_MOTIVO[a.motivo]}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const selectCls = "rounded-md border border-ragga-blue/20 bg-white px-3 py-2 text-sm text-ragga-blue-dark";

export function ResumoSemanalView({ hoje, inicial }: { hoje: string; inicial: ResumoSemanalResposta }) {
  const semanas = useMemo(() => semanasDisponiveis(hoje, 26), [hoje]);
  const [segundaFinal, setSegundaFinal] = useState(semanas[0].inicio);
  const [nSemanas, setNSemanas] = useState(1);
  /** "anterior" = período imediatamente anterior de mesma duração; senão, a segunda-feira da semana final da comparação. */
  const [compModo, setCompModo] = useState<string>("anterior");

  const atual = useMemo(() => janelaDeSemanas(segundaFinal, nSemanas), [segundaFinal, nSemanas]);
  const comparacao = useMemo(
    () => (compModo === "anterior" ? janelaAnterior(atual) : janelaDeSemanas(compModo, nSemanas)),
    [compModo, atual, nSemanas]
  );
  const sobrepoe = !(comparacao.fim < atual.inicio || comparacao.inicio > atual.fim);
  const chave = `${atual.inicio}|${atual.fim}|${comparacao.inicio}|${comparacao.fim}`;
  const chaveInicial = useMemo(() => {
    const r = inicial.resumo;
    return r ? `${r.atual.inicio}|${r.atual.fim}|${r.comparacao.inicio}|${r.comparacao.fim}` : null;
  }, [inicial]);

  const [carregado, setCarregado] = useState<{ chave: string; resposta: ResumoSemanalAcao } | null>(
    chaveInicial ? { chave: chaveInicial, resposta: inicial } : null
  );

  useEffect(() => {
    if (sobrepoe || carregado?.chave === chave) return;
    let vivo = true;
    buscarResumoSemanal(atual, comparacao)
      .then((resposta) => vivo && setCarregado({ chave, resposta }))
      .catch(() => vivo && setCarregado({ chave, resposta: { erro: "Não foi possível carregar o resumo agora. Tente novamente." } }));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, sobrepoe]);

  const atualizando = !sobrepoe && carregado?.chave !== chave;
  const resposta = carregado?.resposta;
  const resumo = resposta && "resumo" in resposta ? resposta.resumo : null;
  const erro = resposta && "erro" in resposta ? resposta.erro : null;
  const exibir = !atualizando ? resumo : null;

  // Opções de comparação: semanas finais equivalentes que não se sobrepõem à atual.
  const opcoesComparacao = semanas.filter((s) => {
    const j = janelaDeSemanas(s.inicio, nSemanas);
    return j.fim < atual.inicio || j.inicio > atual.fim;
  });

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <section className="rounded-2xl border border-ragga-blue/10 bg-white p-5">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-foreground/50">
            Semana final
            <select className={`${selectCls} mt-1 block`} value={segundaFinal} onChange={(e) => { setSegundaFinal(e.target.value); setCompModo("anterior"); }}>
              {semanas.map((s, i) => (
                <option key={s.inicio} value={s.inicio}>
                  {rotuloJanela(s)}
                  {i === 0 ? " (última completa)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-foreground/50">
            Semanas no período
            <select className={`${selectCls} mt-1 block`} value={nSemanas} onChange={(e) => { setNSemanas(Number(e.target.value)); setCompModo("anterior"); }}>
              {[1, 2, 4, MAX_SEMANAS].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "semana" : "semanas"}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-foreground/50">
            Comparar com
            <select className={`${selectCls} mt-1 block`} value={compModo} onChange={(e) => setCompModo(e.target.value)}>
              <option value="anterior">Período imediatamente anterior (padrão)</option>
              {opcoesComparacao.map((s) => (
                <option key={s.inicio} value={s.inicio}>
                  {rotuloJanela(janelaDeSemanas(s.inicio, nSemanas))}
                </option>
              ))}
            </select>
          </label>
          {compModo !== "anterior" && (
            <button type="button" onClick={() => setCompModo("anterior")} className="rounded-md px-3 py-2 text-sm font-medium text-ragga-blue hover:bg-ragga-blue/5">
              Voltar ao padrão
            </button>
          )}
        </div>
        <p className="mt-3 text-sm text-foreground/65">
          <strong className="text-ragga-blue-dark">Período atual:</strong> {rotuloJanela(atual)} · <strong className="text-ragga-blue-dark">Comparação:</strong> {rotuloJanela(comparacao)}
          {atualizando && <span className="ml-2 font-semibold text-ragga-blue">Atualizando…</span>}
        </p>
        <p className="mt-1 text-[11px] text-foreground/40">
          Semanas completas de segunda a domingo, por data de ocorrência. A semana em andamento nunca é analisada. Os dois períodos têm a mesma duração e não se sobrepõem.
        </p>
        {sobrepoe && <p className="mt-2 text-sm font-semibold text-semaforo-vermelho">Os períodos se sobrepõem — escolha outra comparação.</p>}
      </section>

      {erro && <p className="rounded-lg border border-semaforo-vermelho/30 bg-semaforo-vermelho/5 p-4 text-sm text-semaforo-vermelho">{erro}</p>}
      {resposta && "conectado" in resposta && !resposta.conectado && (
        <p className="rounded-lg border border-semaforo-amarelo/40 bg-semaforo-amarelo/10 p-4 text-sm text-foreground/70">Banco de dados não conectado — nenhum resultado a exibir.</p>
      )}
      {atualizando && !erro && <p className="text-sm text-foreground/50">Carregando o resumo do período selecionado…</p>}

      {exibir && (
        <>
          {exibir.avisos.length > 0 && (
            <section className="rounded-2xl border border-semaforo-amarelo/40 bg-semaforo-amarelo/10 p-4">
              <p className="text-sm font-bold text-ragga-blue-dark">⚠ Atenção à cobertura dos dados</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground/75">
                {exibir.avisos.map((a, i) => (
                  <li key={i}>
                    <strong>{a.periodo === "atual" ? "Período atual" : "Comparação"}:</strong> {a.mensagem}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-foreground/50">Onde não há dado válido o painel mostra “Sem dados”, nunca zero.</p>
            </section>
          )}

          {exibir.avisosLojas.length > 0 && (
            <section className="rounded-2xl border border-semaforo-amarelo/40 bg-semaforo-amarelo/10 p-4">
              <p className="text-sm font-bold text-ragga-blue-dark">⚠ Lojas com faturamento em menos dias que o período</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground/75">
                {exibir.avisosLojas.map((a, k) => (
                  <li key={k}>
                    <strong>{a.unidade}</strong> ({a.periodo === "atual" ? "período atual" : "comparação"}): faturamento em {a.diasComFaturamento} de {a.dias} dias.
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-foreground/50">
                Valores em R$ mantidos; o % sobre o faturamento não é exibido como se representasse o período inteiro, e a loja fica fora dos rankings proporcionais (maior % e piora) e sem situação de melhora/piora.
              </p>
            </section>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {exibir.indicadores.map((i) => (
              <CardIndicador key={i.id} i={i} />
            ))}
          </div>

          <Secao titulo="Comparativo executivo da rede">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                    <th className="py-2 pr-3">Indicador</th>
                    <th className="px-3 py-2">Atual</th>
                    <th className="px-3 py-2">Anterior</th>
                    <th className="px-3 py-2">Variação R$</th>
                    <th className="px-3 py-2">Variação % do valor</th>
                    <th className="px-3 py-2">% fat. atual*</th>
                    <th className="px-3 py-2">% fat. anterior*</th>
                    <th className="px-3 py-2">Var. do % fat. (p.p.)</th>
                    <th className="px-3 py-2">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {exibir.indicadores.map((i) => (
                    <tr key={i.id} className="border-b border-ragga-blue/5">
                      <td className="py-2.5 pr-3 font-semibold text-ragga-blue-dark">{ROTULO_INDICADOR[i.id]}</td>
                      <td className="px-3">{valorOuSem(i.atual.valor)}</td>
                      <td className="px-3">{valorOuSem(i.anterior.valor)}</td>
                      <td className={`px-3 font-semibold ${corVariacao(i.situacao)}`}>{i.variacaoReais === null ? "—" : sinalMoeda(i.variacaoReais)}</td>
                      <td className={`px-3 font-semibold ${corVariacao(i.situacao)}`}>
                        {i.variacaoPercentual === null ? "—" : `${sinal(i.variacaoPercentual)}${pct.format(Math.abs(i.variacaoPercentual))}%`}
                      </td>
                      <td className="px-3">{pctOuSem(i.atual.percentual)}</td>
                      <td className="px-3">{pctOuSem(i.anterior.percentual)}</td>
                      <td className="px-3">
                        <PpTexto v={i} />
                      </td>
                      <td className="px-3">
                        <Badge situacao={i.situacao} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-foreground/40">
              *Brindes: % dos controláveis sobre o faturamento (a métrica da regra existente); demais: valor ÷ faturamento. Em todos os indicadores, menor = melhorou. A situação usa o % sobre o faturamento quando há faturamento completo nos dois períodos; do contrário, o valor em R$. “—” = sem dado ou sem base (anterior zerado não gera %).
            </p>
          </Secao>

          <Secao titulo="Lojas — área de atenção">
            <TabelaLojas lojas={exibir.lojas} />
            <p className="mt-3 text-[11px] text-foreground/40">
              Destaques são rankings (top 3), sem limites novos: <strong>maior % s/ fat.</strong> (proporcional), <strong>maior valor</strong> (apenas descritivo — não define piora) e <strong>maior piora</strong> (entre as lojas que pioraram, pelo p.p. do % sobre o faturamento).
              Lojas são ordenadas pela quantidade de destaques.
            </p>
          </Secao>
        </>
      )}
    </div>
  );
}
