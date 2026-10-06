"use client";

import { useEffect, useMemo, useState } from "react";
import type { CodigoUnidade } from "@painel/shared";
import { Card } from "@/components/ui/Card";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { Secao, moeda, pct } from "@/components/ui/PainelAnalitico";
import {
  montarDepositoGerencial,
  periodoAnteriorMesmaDuracao,
  type LojaRetiradaGerencial,
  type SituacaoRetiradaLoja,
} from "@/lib/services/retiradaDepositoGerencial";
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
 *
 * Camada gerencial acima da tabela (cards, ranking por loja, comparativo e pontos de atenção): usa as MESMAS linhas
 * da tabela para o período selecionado e a mesma consulta para o período imediatamente anterior de mesma duração —
 * ver `lib/services/retiradaDepositoGerencial.ts`. A tabela operacional abaixo não foi alterada.
 */
const formatadorDiaMes = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

function BigNumberCard({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe?: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-foreground/50">{titulo}</p>
      <p className="mt-1 text-2xl font-semibold text-ragga-blue-dark">{valor}</p>
      {detalhe && <p className="mt-2 text-xs text-foreground/50">{detalhe}</p>}
    </Card>
  );
}

const sinal = (v: number) => (v > 0 ? "+" : v < 0 ? "-" : "");
const textoVariacao = (v: number | null) => (v === null ? "Sem base anterior" : `${sinal(v)}${pct.format(Math.abs(v))}%`);

function SituacaoLoja({ situacao }: { situacao: SituacaoRetiradaLoja }) {
  if (situacao === "aumentou") return <span className="whitespace-nowrap text-xs font-semibold text-semaforo-vermelho">↑ Aumentou</span>;
  if (situacao === "reduziu") return <span className="whitespace-nowrap text-xs font-semibold text-semaforo-verde">↓ Reduziu</span>;
  if (situacao === "estavel") return <span className="whitespace-nowrap text-xs font-semibold text-foreground/50">= Estável</span>;
  return <span className="whitespace-nowrap text-xs font-semibold text-foreground/45">Sem base anterior</span>;
}

/** Barras simples lado a lado (atual × anterior) por loja, na mesma escala — sem biblioteca de gráfico. */
function BarrasComparativo({ lojas }: { lojas: LojaRetiradaGerencial[] }) {
  const maximo = Math.max(...lojas.flatMap((l) => [l.atual, l.anterior]), 0);
  const largura = (v: number) => (maximo > 0 ? `${Math.max((v / maximo) * 100, v > 0 ? 1 : 0)}%` : "0%");
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-4 text-[11px] text-foreground/55">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-ragga-blue" /> Período atual
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-ragga-blue/30" /> Período anterior
        </span>
      </div>
      {lojas.map((l) => (
        <div key={l.unidade} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 text-xs">
          <span className="font-semibold text-ragga-blue-dark">{l.unidade}</span>
          <div className="space-y-1">
            <div className="h-2.5 rounded-sm bg-ragga-blue" style={{ width: largura(l.atual) }} title={`Atual: ${moeda.format(l.atual)}`} />
            <div className="h-2.5 rounded-sm bg-ragga-blue/30" style={{ width: largura(l.anterior) }} title={`Anterior: ${moeda.format(l.anterior)}`} />
          </div>
          <span className="text-right tabular-nums text-foreground/65">
            {moeda.format(l.atual)} <span className="text-foreground/40">× {moeda.format(l.anterior)}</span>
          </span>
        </div>
      ))}
    </div>
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
  const [dados, setDados] = useState<RetiradaDepositoPersonalizadoData | null>(null);
  const [chaveDados, setChaveDados] = useState<string | null>(null);
  const [anterior, setAnterior] = useState<{ chave: string; dados: RetiradaDepositoPersonalizadoData } | null>(null);

  const inicioMs = periodoInicio.getTime();
  const fimMs = periodoFim.getTime();
  // Chave do que está selecionado (período + loja): só se exibem na camada gerencial dados que pertencem a ela.
  const chave = `${inicioMs}|${fimMs}|${unidade ?? "TODAS"}`;
  const periodoAnterior = useMemo(() => periodoAnteriorMesmaDuracao(new Date(inicioMs), new Date(fimMs)), [inicioMs, fimMs]);

  useEffect(() => {
    let ativo = true;
    buscarRetiradaDepositoPersonalizado(periodoInicio, periodoFim, unidade).then((resultado) => {
      if (ativo) {
        setDados(resultado);
        setChaveDados(chave);
      }
    });
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodoInicio, periodoFim, unidade]);

  // Período imediatamente anterior, de mesma duração, com a MESMA consulta e o MESMO filtro de loja.
  useEffect(() => {
    let ativo = true;
    buscarRetiradaDepositoPersonalizado(periodoAnterior.inicio, periodoAnterior.fim, unidade).then((resultado) => {
      if (ativo) setAnterior({ chave, dados: resultado });
    });
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodoAnterior, unidade]);

  const pronto = dados !== null && chaveDados === chave && anterior !== null && anterior.chave === chave;
  const gerencial = useMemo(
    () => (pronto && dados && anterior ? montarDepositoGerencial(dados.linhas, anterior.dados.linhas) : null),
    [pronto, dados, anterior]
  );
  const periodoAtualTxt = `${formatadorDiaMes.format(periodoInicio)} a ${formatadorDiaMes.format(periodoFim)}`;
  const periodoAnteriorTxt = `${formatadorDiaMes.format(periodoAnterior.inicio)} a ${formatadorDiaMes.format(periodoAnterior.fim)}`;

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

      {/* 1) Resumo executivo do período (respeita período e loja do filtro da página) */}
      {gerencial === null ? (
        <p className="text-sm text-foreground/50">Carregando o comparativo do período…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <BigNumberCard titulo="Total retirado" valor={moeda.format(gerencial.totalAtual)} detalhe={periodoAtualTxt} />
            <BigNumberCard
              titulo="Lojas com retirada"
              valor={String(gerencial.lojasComRetirada)}
              detalhe={gerencial.lojasComRetirada === 1 ? "1 loja distinta no período" : `${gerencial.lojasComRetirada} lojas distintas no período`}
            />
            <BigNumberCard titulo="Média por loja" valor={moeda.format(gerencial.mediaPorLoja)} detalhe="Total retirado ÷ lojas com retirada" />
            <BigNumberCard
              titulo="Vs. período anterior"
              valor={textoVariacao(gerencial.variacaoTotalPercentual)}
              detalhe={`Anterior: ${moeda.format(gerencial.totalAnterior)} (${periodoAnteriorTxt})`}
            />
          </div>

          {/* 2) Ranking por loja */}
          <Secao titulo="Maiores retiradas por loja">
            {gerencial.lojas.length === 0 ? (
              <p className="text-sm text-foreground/45">Sem retiradas para depósito no período selecionado nem no anterior.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="border-b border-ragga-blue/10 text-left text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                      <th className="py-2 pr-4">Ranking</th>
                      <th className="px-3 py-2">Loja</th>
                      <th className="px-3 py-2">Período atual</th>
                      <th className="px-3 py-2">Período anterior</th>
                      <th className="px-3 py-2">Diferença em R$</th>
                      <th className="px-3 py-2">Variação %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gerencial.lojas.map((l, i) => (
                      <tr key={l.unidade} className="border-b border-ragga-blue/5">
                        <td className="py-2.5 pr-4 font-semibold text-ragga-blue-dark">{i + 1}º</td>
                        <td className="px-3 font-medium text-ragga-blue-dark">{l.unidade}</td>
                        <td className="px-3 font-semibold">{moeda.format(l.atual)}</td>
                        <td className="px-3 text-foreground/70">{moeda.format(l.anterior)}</td>
                        <td className="px-3">{`${sinal(l.diferenca)}${moeda.format(Math.abs(l.diferenca))}`}</td>
                        <td className="px-3">{l.variacaoPercentual === null ? <span className="text-xs text-foreground/45">Sem base anterior</span> : textoVariacao(l.variacaoPercentual)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-ragga-blue/20 font-bold text-ragga-blue-dark">
                      <td className="py-2.5 pr-4" colSpan={2}>TOTAL</td>
                      <td className="px-3">{moeda.format(gerencial.totalAtual)}</td>
                      <td className="px-3">{moeda.format(gerencial.totalAnterior)}</td>
                      <td className="px-3">{`${sinal(gerencial.totalAtual - gerencial.totalAnterior)}${moeda.format(Math.abs(gerencial.totalAtual - gerencial.totalAnterior))}`}</td>
                      <td className="px-3">{textoVariacao(gerencial.variacaoTotalPercentual)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[11px] text-foreground/40">
              Período atual: {periodoAtualTxt} · Período anterior (mesma duração, imediatamente antes): {periodoAnteriorTxt}. Ordenado pela maior retirada atual; empate: maior diferença em R$.
            </p>
          </Secao>

          {/* 3) Comparativo atual × anterior */}
          <Secao titulo="Comparativo atual × período anterior">
            {gerencial.lojas.length === 0 ? <p className="text-sm text-foreground/45">Sem dados para comparar.</p> : <BarrasComparativo lojas={gerencial.lojas} />}
          </Secao>

          {/* 4) Pontos de atenção */}
          <Secao titulo="Principais pontos de atenção">
            {gerencial.pontosDeAtencao.length === 0 ? (
              <p className="text-sm text-foreground/45">Nenhuma loja com aumento de retirada em relação ao período anterior.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                {gerencial.pontosDeAtencao.map((l, i) => (
                  <li key={l.unidade} className="rounded-lg border border-semaforo-vermelho/20 bg-semaforo-vermelho/5 px-3 py-2">
                    <p className="text-xs text-foreground/50">{i + 1}º maior aumento</p>
                    <p className="text-base font-bold text-ragga-blue-dark">{l.unidade}</p>
                    <p className="text-sm font-semibold tabular-nums text-semaforo-vermelho">{textoVariacao(l.variacaoPercentual)}</p>
                    <p className="text-xs text-foreground/60">
                      {moeda.format(l.anterior)} → {moeda.format(l.atual)}
                    </p>
                    <SituacaoLoja situacao={l.situacao} />
                  </li>
                ))}
              </ul>
            )}
            {gerencial.semBaseAnterior.length > 0 && (
              <p className="mt-3 text-xs text-foreground/55">
                <span className="font-semibold">Sem base anterior</span> (não há retirada no período anterior; variação % não calculada):{" "}
                {gerencial.semBaseAnterior.map((l) => `${l.unidade} (${moeda.format(l.atual)})`).join(" · ")}
              </p>
            )}
            <p className="mt-2 text-[11px] text-foreground/40">Maiores aumentos percentuais contra o período anterior; só lojas com base de comparação.</p>
          </Secao>
        </>
      )}

      {/* Tabela operacional — inalterada */}
      <p className="pt-2 text-[11px] font-bold uppercase tracking-wide text-ragga-blue/70">Detalhamento por ciclo</p>
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
